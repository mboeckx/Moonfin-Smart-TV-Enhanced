using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Archive.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.IO;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Archive.Services;

/// <summary>
/// Moves titles between their library, the archive and the soft delete library, and keeps who
/// may see those two in step with the plugin settings.
/// </summary>
public class ArchiveService
{
    // How long a finished job stays readable, so a client that polls late still learns the new id.
    private static readonly TimeSpan _jobRetention = TimeSpan.FromHours(1);

    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;
    private readonly IUserDataManager _userDataManager;
    private readonly ILibraryMonitor _libraryMonitor;
    private readonly IFileSystem _fileSystem;
    private readonly ArchiveStore _store;
    private readonly ILogger<ArchiveService> _logger;
    private readonly ConcurrentDictionary<Guid, MoveJob> _jobs = new();
    private readonly SemaphoreSlim _moveLock = new(1, 1);
    private readonly SemaphoreSlim _accessLock = new(1, 1);

    /// <summary>
    /// Initializes a new instance of the <see cref="ArchiveService"/> class.
    /// </summary>
    /// <param name="libraryManager">The library manager.</param>
    /// <param name="userManager">The user manager.</param>
    /// <param name="userDataManager">The user data manager.</param>
    /// <param name="libraryMonitor">The library monitor.</param>
    /// <param name="fileSystem">The file system.</param>
    /// <param name="store">The plugin's state.</param>
    /// <param name="logger">The logger.</param>
    public ArchiveService(
        ILibraryManager libraryManager,
        IUserManager userManager,
        IUserDataManager userDataManager,
        ILibraryMonitor libraryMonitor,
        IFileSystem fileSystem,
        ArchiveStore store,
        ILogger<ArchiveService> logger)
    {
        _libraryManager = libraryManager;
        _userManager = userManager;
        _userDataManager = userDataManager;
        _libraryMonitor = libraryMonitor;
        _fileSystem = fileSystem;
        _store = store;
        _logger = logger;
    }

    private static PluginConfiguration Config => Plugin.Instance?.Configuration ?? new PluginConfiguration();

    // ---------------------------------------------------------------- shelves and libraries

    /// <summary>The places titles can be put away in.</summary>
    public static readonly Place[] Shelves = { Place.Archive, Place.SoftDelete };

    /// <summary>Gets the settings for a shelf.</summary>
    /// <param name="place">The shelf.</param>
    /// <returns>Its settings.</returns>
    public static ShelfSettings SettingsFor(Place place) => place == Place.SoftDelete ? Config.SoftDelete : Config.Archive;

    /// <summary>Gets a shelf's library, or null when none is chosen or it no longer exists.</summary>
    /// <param name="place">The shelf.</param>
    /// <returns>The library.</returns>
    public VirtualFolderInfo? GetShelfLibrary(Place place)
    {
        if (place == Place.Library)
        {
            return null;
        }

        var library = FindLibrary(SettingsFor(place).LibraryId);
        // One library can't be both shelves. The archive keeps it.
        if (library is not null && place == Place.SoftDelete && ParseId(library.ItemId) == ParseId(Config.Archive.LibraryId))
        {
            return null;
        }

        return library;
    }

    /// <summary>Gets the id of a shelf's library, or null.</summary>
    /// <param name="place">The shelf.</param>
    /// <returns>The id.</returns>
    public Guid? GetShelfLibraryId(Place place) => ParseId(GetShelfLibrary(place)?.ItemId);

    private VirtualFolderInfo? FindLibrary(string? id)
    {
        var wanted = ParseId(id);
        if (wanted is null)
        {
            return null;
        }

        return _libraryManager.GetVirtualFolders().FirstOrDefault(f => ParseId(f.ItemId) == wanted);
    }

    private static Guid? ParseId(string? id) => Guid.TryParse(id, out var guid) && guid != Guid.Empty ? guid : null;

    /// <summary>Finds the library a path lives in, and which of its folders holds it.</summary>
    private (VirtualFolderInfo Library, string Root)? LibraryOfPath(string path)
    {
        (VirtualFolderInfo, string)? best = null;
        var bestLength = -1;
        foreach (var library in _libraryManager.GetVirtualFolders())
        {
            foreach (var location in library.Locations ?? Array.Empty<string>())
            {
                if (PathUtil.IsSameOrInside(path, location) && location.Length > bestLength)
                {
                    best = (library, PathUtil.Trim(location));
                    bestLength = location.Length;
                }
            }
        }

        return best;
    }

    /// <summary>Whether the item can be put away at all: a movie or a show with its own files.</summary>
    /// <param name="item">The item.</param>
    /// <returns>True when it can move.</returns>
    public static bool IsMovable(BaseItem item) =>
        (item is Movie || item is Series) && !string.IsNullOrEmpty(item.Path) && item.LocationType == LocationType.FileSystem;

    /// <summary>Which shelf the item is on, or <see cref="Place.Library"/>.</summary>
    /// <param name="item">The item.</param>
    /// <returns>Where it is.</returns>
    public Place PlaceOf(BaseItem item) => string.IsNullOrEmpty(item.Path) ? Place.Library : PlaceOfLibrary(LibraryOfPath(item.Path)?.Library);

    private Place PlaceOfLibrary(VirtualFolderInfo? library)
    {
        var id = ParseId(library?.ItemId);
        if (id is null)
        {
            return Place.Library;
        }

        return Shelves.FirstOrDefault(shelf => GetShelfLibraryId(shelf) == id, Place.Library);
    }

    // ---------------------------------------------------------------- permissions

    private bool IsAdministrator(User user) => _userManager.GetUserDto(user, null!).Policy?.IsAdministrator == true;

    /// <summary>Whether the user gets a shelf's button: may move titles onto it and off it.</summary>
    /// <param name="user">The user.</param>
    /// <param name="place">The shelf.</param>
    /// <returns>True when allowed.</returns>
    public bool CanManage(User user, Place place)
    {
        if (place == Place.Library)
        {
            return true;
        }

        var settings = SettingsFor(place);
        return GetShelfLibrary(place) is not null
            && (settings.ManagerUserIds.Contains(user.Id) || (settings.AdministratorsCanManage && IsAdministrator(user)));
    }

    /// <summary>Whether the user may move a title from one place to another. Both ends have to allow it.</summary>
    /// <param name="user">The user.</param>
    /// <param name="from">Where it is.</param>
    /// <param name="to">Where it would go.</param>
    /// <returns>True when allowed.</returns>
    public bool CanMove(User user, Place from, Place to) => from != to && CanManage(user, from) && CanManage(user, to);

    /// <summary>Whether the settings say the user may see a shelf.</summary>
    /// <param name="user">The user.</param>
    /// <param name="place">The shelf.</param>
    /// <returns>True when allowed.</returns>
    public bool ShouldView(User user, Place place)
    {
        var settings = SettingsFor(place);
        return settings.ViewerUserIds.Contains(user.Id) || (settings.AdministratorsCanView && IsAdministrator(user));
    }

    /// <summary>Whether the user's library access actually reaches a shelf right now.</summary>
    /// <param name="user">The user.</param>
    /// <param name="place">The shelf.</param>
    /// <returns>True when it is open to them.</returns>
    public bool HasAccess(User user, Place place)
    {
        var libraryId = GetShelfLibraryId(place);
        if (libraryId is null)
        {
            return false;
        }

        var policy = _userManager.GetUserDto(user, null!).Policy;
        if (policy is null || (policy.BlockedMediaFolders ?? Array.Empty<Guid>()).Contains(libraryId.Value))
        {
            return false;
        }

        return policy.EnableAllFolders || (policy.EnabledFolders ?? Array.Empty<Guid>()).Contains(libraryId.Value);
    }

    // ---------------------------------------------------------------- access sync

    /// <summary>
    /// Opens each shelf's library to its viewers and closes it to everybody else, by way of each
    /// user's own library access. A user on "all libraries" who may not see a shelf is moved to a
    /// list of every other library, and gets "all libraries" back once they may see them all.
    /// </summary>
    /// <param name="cancellationToken">The cancellation token.</param>
    /// <returns>A task.</returns>
    public async Task SyncAccessAsync(CancellationToken cancellationToken)
    {
        var config = Config;
        var shelves = Shelves
            .Select(place => (Place: place, Id: GetShelfLibraryId(place)))
            .Where(shelf => shelf.Id is not null)
            .Select(shelf => (shelf.Place, Id: shelf.Id!.Value))
            .ToList();
        if (!config.EnforceViewerAccess || shelves.Count == 0)
        {
            return;
        }

        await _accessLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var allLibraries = _libraryManager.GetVirtualFolders()
                .Select(f => ParseId(f.ItemId))
                .Where(id => id is not null)
                .Select(id => id!.Value)
                .ToArray();
            var restricted = _store.Read(s => s.RestrictedUsers.ToHashSet());

            foreach (var user in _userManager.GetUsers().ToList())
            {
                cancellationToken.ThrowIfCancellationRequested();
                var dto = _userManager.GetUserDto(user, null!);
                var policy = dto.Policy;
                if (policy is null)
                {
                    continue;
                }

                var open = shelves.Where(shelf => ShouldView(user, shelf.Place)).Select(shelf => shelf.Id).ToHashSet();
                var closed = shelves.Where(shelf => !open.Contains(shelf.Id)).Select(shelf => shelf.Id).ToHashSet();
                var enabled = (policy.EnabledFolders ?? Array.Empty<Guid>()).ToList();
                var before = (policy.EnableAllFolders, string.Join(',', enabled.OrderBy(id => id)));

                if (closed.Count == 0 && restricted.Contains(user.Id))
                {
                    // The plugin took "all libraries" away, and nothing needs keeping from them now.
                    policy.EnableAllFolders = true;
                    enabled.Clear();
                    restricted.Remove(user.Id);
                }
                else if (closed.Count > 0 && policy.EnableAllFolders)
                {
                    policy.EnableAllFolders = false;
                    enabled = allLibraries.Where(id => !closed.Contains(id)).ToList();
                    restricted.Add(user.Id);
                }
                else if (!policy.EnableAllFolders)
                {
                    enabled.RemoveAll(closed.Contains);
                    enabled.AddRange(open.Where(id => !enabled.Contains(id)));

                    // Somebody the plugin restricted gets every library added since, bar what they can't see.
                    if (restricted.Contains(user.Id))
                    {
                        enabled.AddRange(allLibraries.Where(id => !closed.Contains(id) && !enabled.Contains(id)));
                    }
                }

                policy.EnabledFolders = enabled.ToArray();
                if (before != (policy.EnableAllFolders, string.Join(',', enabled.OrderBy(id => id))))
                {
                    _logger.LogInformation(
                        "Archive: library access for {User} now opens {Open} and closes {Closed} of the archive and soft delete libraries",
                        user.Username,
                        open.Count,
                        closed.Count);
                    await _userManager.UpdatePolicyAsync(user.Id, policy).ConfigureAwait(false);
                }

                var userConfig = dto.Configuration;
                if (userConfig is not null)
                {
                    var latest = (userConfig.LatestItemsExcludes ?? Array.Empty<Guid>()).ToList();
                    var add = shelves
                        .Where(shelf => open.Contains(shelf.Id) && SettingsFor(shelf.Place).HideFromLatest && !latest.Contains(shelf.Id))
                        .Select(shelf => shelf.Id)
                        .ToList();
                    if (add.Count > 0)
                    {
                        userConfig.LatestItemsExcludes = latest.Concat(add).ToArray();
                        await _userManager.UpdateConfigurationAsync(user.Id, userConfig).ConfigureAwait(false);
                    }
                }
            }

            _store.Update(s => s.RestrictedUsers = restricted.ToList());
        }
        finally
        {
            _accessLock.Release();
        }
    }

    // ---------------------------------------------------------------- jobs

    /// <summary>Gets a job by id.</summary>
    /// <param name="id">The job id.</param>
    /// <returns>The job, or null.</returns>
    public MoveJob? GetJob(Guid id) => _jobs.TryGetValue(id, out var job) ? job : null;

    /// <summary>Gets the unfinished job for an item, if one is running.</summary>
    /// <param name="itemId">The item id.</param>
    /// <returns>The job, or null.</returns>
    public MoveJob? GetActiveJob(Guid itemId) => _jobs.Values.FirstOrDefault(j =>
        j.ItemId == itemId && j.State is MoveState.Queued or MoveState.Moving or MoveState.Scanning);

    /// <summary>Starts moving an item to another place. The caller has checked permission.</summary>
    /// <param name="item">The item.</param>
    /// <param name="user">Who asked.</param>
    /// <param name="to">Where it goes.</param>
    /// <returns>The job, already running.</returns>
    public MoveJob StartMove(BaseItem item, User user, Place to)
    {
        PruneJobs();
        var existing = GetActiveJob(item.Id);
        if (existing is not null)
        {
            return existing;
        }

        var job = new MoveJob { ItemId = item.Id, Name = item.Name, From = PlaceOf(item), To = to, UserId = user.Id };
        _jobs[job.Id] = job;
        _ = Task.Run(() => RunAsync(job, CancellationToken.None));
        return job;
    }

    private void PruneJobs()
    {
        var cutoff = DateTime.UtcNow - _jobRetention;
        foreach (var job in _jobs.Values.Where(j => j.CreatedUtc < cutoff).ToList())
        {
            _jobs.TryRemove(job.Id, out _);
        }
    }

    private async Task RunAsync(MoveJob job, CancellationToken cancellationToken)
    {
        await _moveLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            job.State = MoveState.Moving;
            await MoveAsync(job, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Archive: moving {Name} failed", job.Name);
            job.Error ??= ex.Message;
            job.State = MoveState.Failed;
        }
        finally
        {
            _moveLock.Release();
        }
    }

    // ---------------------------------------------------------------- moving

    private static string ShelfName(Place place) => place == Place.SoftDelete ? "soft delete library" : "archive";

    private async Task MoveAsync(MoveJob job, CancellationToken cancellationToken)
    {
        var item = _libraryManager.GetItemById(job.ItemId) ?? throw Fail(job, "The title no longer exists.");
        if (!IsMovable(item))
        {
            throw Fail(job, "Only movies and shows can be moved.");
        }

        var source = LibraryOfPath(item.Path) ?? throw Fail(job, "The title is not inside any library folder.");
        var from = PlaceOfLibrary(source.Library);
        if (from != job.From)
        {
            throw Fail(job, "The title has moved since.");
        }

        if (from == job.To)
        {
            throw Fail(job, job.To == Place.Library ? "The title is already in its library." : "The title is already in the " + ShelfName(job.To) + ".");
        }

        // What moves: a folder that belongs to this title alone, or else its files one by one. A
        // title the plugin put away moves on exactly the way it went in.
        var record = from == Place.Library ? null : _store.FindRecord(item.Path);
        string fromTop;
        bool isDirectory;
        if (record is not null && (Directory.Exists(record.ArchivePath) || File.Exists(record.ArchivePath)))
        {
            fromTop = PathUtil.Trim(record.ArchivePath);
            isDirectory = Directory.Exists(fromTop);
        }
        else
        {
            record = null;
            fromTop = PathUtil.Trim(item.Path);
            isDirectory = Directory.Exists(fromTop);
            var folder = Path.GetDirectoryName(fromTop)!;
            if (!isDirectory && !PathUtil.Same(folder, source.Root) && FolderBelongsTo(item, folder))
            {
                isDirectory = true;
                fromTop = folder;
            }
        }

        // Where it lands. Onto a shelf, at the same place relative to the library folder. Back to
        // a library, where it first came from.
        string toTop;
        if (job.To != Place.Library)
        {
            var shelf = GetShelfLibrary(job.To) ?? throw Fail(job, "No " + ShelfName(job.To) + " is set up.");
            var root = (shelf.Locations ?? Array.Empty<string>()).FirstOrDefault()
                ?? throw Fail(job, "The " + ShelfName(job.To) + " has no folder.");
            toTop = Path.Combine(root, Path.GetRelativePath(source.Root, fromTop));
        }
        else if (record is not null)
        {
            toTop = record.OriginalPath;
        }
        else
        {
            var fallback = FindLibrary(Config.DefaultRestoreLibraryId)
                ?? throw Fail(job, "It isn't known where this title came from, and no library is set to restore to.");
            var root = (fallback.Locations ?? Array.Empty<string>()).FirstOrDefault()
                ?? throw Fail(job, "The library to restore to has no folder.");
            toTop = Path.Combine(root, Path.GetRelativePath(source.Root, fromTop));
        }

        if (Directory.Exists(toTop) || File.Exists(toTop))
        {
            throw Fail(job, "Something already exists where the title would go.");
        }

        // Played state goes along with the title, keyed by the path each item will have.
        var newItemPath = isDirectory
            ? Path.Combine(toTop, Path.GetRelativePath(fromTop, item.Path))
            : toTop;
        CapturePlayedState(item, fromTop, toTop);

        _logger.LogInformation("Archive: moving {Name} from {From} to {To}", item.Name, fromTop, toTop);
        _libraryMonitor.ReportFileSystemChangeBeginning(fromTop);
        _libraryMonitor.ReportFileSystemChangeBeginning(toTop);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(toTop)!);
            if (isDirectory)
            {
                MoveDirectory(fromTop, toTop);
            }
            else
            {
                MoveLooseFiles(item, fromTop, toTop);
            }
        }
        finally
        {
            _libraryMonitor.ReportFileSystemChangeComplete(fromTop, false);
            _libraryMonitor.ReportFileSystemChangeComplete(toTop, false);
        }

        // One record per title put away, holding where it first came from however often it moves
        // between the shelves.
        _store.Update(s =>
        {
            if (record is not null)
            {
                s.Records.RemoveAll(r => PathUtil.Same(r.ArchivePath, record.ArchivePath));
            }

            if (job.To != Place.Library)
            {
                s.Records.RemoveAll(r => PathUtil.Same(r.ArchivePath, toTop));
                s.Records.Add(new ArchiveRecord
                {
                    ArchivePath = toTop,
                    OriginalPath = record?.OriginalPath ?? fromTop,
                    OriginalLibraryId = record?.OriginalLibraryId ?? ParseId(source.Library.ItemId) ?? Guid.Empty,
                    ArchivedAtUtc = DateTime.UtcNow,
                    ArchivedBy = job.UserId,
                    Name = item.Name,
                    Place = job.To
                });
            }
        });

        job.State = MoveState.Scanning;
        var moved = await RescanAsync(fromTop, toTop, newItemPath, cancellationToken).ConfigureAwait(false);

        // Jellyfin leaves a library folder alone once it's empty, in case it's a drive that went
        // missing, so the last title out of a library would linger there. Its files are gone, so
        // its entry goes too. Nothing on disk is touched.
        var stale = _libraryManager.GetItemById(job.ItemId);
        if (stale is not null && !string.IsNullOrEmpty(stale.Path) && !File.Exists(stale.Path) && !Directory.Exists(stale.Path))
        {
            _libraryManager.DeleteItem(stale, new DeleteOptions { DeleteFileLocation = false }, true);
        }

        if (moved is null)
        {
            job.State = MoveState.DoneNotScanned;
            return;
        }

        ApplyPendingPlayedState(moved);
        if (moved is Folder folderItem)
        {
            foreach (var child in folderItem.GetRecursiveChildren())
            {
                ApplyPendingPlayedState(child);
            }
        }

        job.NewItemId = moved.Id;
        job.State = MoveState.Done;
    }

    private static InvalidOperationException Fail(MoveJob job, string message)
    {
        job.Error = message;
        return new InvalidOperationException(message);
    }

    private static readonly string[] _extraSuffixes =
    {
        "-trailer", ".trailer", "_trailer", "-sample", ".sample", "_sample", "-scene", "-clip", "-interview",
        "-behindthescenes", "-deleted", "-deletedscene", "-featurette", "-short", "-other", "-extra"
    };

    // A folder belongs to a movie when every video file directly in it is that movie, one of its
    // versions or parts, or an extra. Extras folders inside it come along too.
    private bool FolderBelongsTo(BaseItem item, string folder)
    {
        var own = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { PathUtil.Trim(item.Path) };
        if (item is Video video)
        {
            foreach (var path in (video.LocalAlternateVersions ?? Array.Empty<string>()).Concat(video.AdditionalParts ?? Array.Empty<string>()))
            {
                own.Add(PathUtil.Trim(path));
            }
        }

        foreach (var file in Directory.EnumerateFiles(folder))
        {
            if (!IsVideoFile(file) || own.Contains(PathUtil.Trim(file)))
            {
                continue;
            }

            var stem = Path.GetFileNameWithoutExtension(file).ToLowerInvariant();
            if (!_extraSuffixes.Any(stem.EndsWith))
            {
                return false;
            }
        }

        return true;
    }

    private static readonly HashSet<string> _videoExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mkv", ".mp4", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".webm",
        ".iso", ".vob", ".flv", ".ogv", ".3gp", ".divx", ".xvid", ".rmvb", ".strm", ".dvr-ms", ".wtv"
    };

    private static bool IsVideoFile(string path) => _videoExtensions.Contains(Path.GetExtension(path));

    // A movie sitting loose in a library folder takes its versions, parts, subtitles, artwork and
    // nfo along: everything whose name starts with the movie's own.
    private void MoveLooseFiles(BaseItem item, string fromFile, string toFile)
    {
        var fromFolder = Path.GetDirectoryName(fromFile)!;
        var toFolder = Path.GetDirectoryName(toFile)!;
        var stem = Path.GetFileNameWithoutExtension(fromFile);
        var files = new HashSet<string>(StringComparer.Ordinal) { fromFile };
        foreach (var file in Directory.EnumerateFiles(fromFolder, stem + "*"))
        {
            files.Add(PathUtil.Trim(file));
        }

        if (item is Video video)
        {
            foreach (var path in (video.LocalAlternateVersions ?? Array.Empty<string>()).Concat(video.AdditionalParts ?? Array.Empty<string>()))
            {
                if (File.Exists(path))
                {
                    files.Add(PathUtil.Trim(path));
                }
            }
        }

        var conflicts = files.Select(f => Path.Combine(toFolder, Path.GetFileName(f))).Where(File.Exists).ToList();
        if (conflicts.Count > 0)
        {
            throw new IOException("Something already exists where the title would go: " + Path.GetFileName(conflicts[0]));
        }

        foreach (var file in files)
        {
            File.Move(file, Path.Combine(toFolder, Path.GetFileName(file)));
        }
    }

    // A rename where the two folders share a drive, and a copy then delete where they don't.
    private void MoveDirectory(string from, string to)
    {
        try
        {
            Directory.Move(from, to);
            return;
        }
        catch (IOException ex)
        {
            _logger.LogInformation("Archive: {From} can't be renamed to {To} ({Message}); copying instead", from, to, ex.Message);
        }

        try
        {
            CopyDirectory(from, to);
        }
        catch
        {
            // Leave the original as it was, and nothing half copied behind.
            try
            {
                Directory.Delete(to, true);
            }
            catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException)
            {
                _logger.LogWarning(cleanup, "Archive: could not clean up the partial copy at {To}", to);
            }

            throw;
        }

        Directory.Delete(from, true);
    }

    private static void CopyDirectory(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.EnumerateFiles(from))
        {
            File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
        }

        foreach (var dir in Directory.EnumerateDirectories(from))
        {
            CopyDirectory(dir, Path.Combine(to, Path.GetFileName(dir)));
        }
    }

    // ---------------------------------------------------------------- scanning

    // Rescans only the folders the move touched, then finds the title under its new path.
    private async Task<BaseItem?> RescanAsync(string fromTop, string toTop, string newItemPath, CancellationToken cancellationToken)
    {
        var options = new MetadataRefreshOptions(new DirectoryService(_fileSystem));
        foreach (var path in new[] { fromTop, toTop })
        {
            var folder = ContainingFolder(path);
            if (folder is null)
            {
                // A library that was empty when it was added has no folder in the database yet,
                // so the first title into it takes a full scan to bring the folder in.
                _logger.LogInformation("Archive: {Path} is in a library that hasn't been scanned yet; scanning all libraries", path);
                await _libraryManager.ValidateMediaLibrary(new Progress<double>(), cancellationToken).ConfigureAwait(false);
                break;
            }

            try
            {
                await folder.ValidateChildren(new Progress<double>(), options, false, false, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Archive: rescanning {Folder} failed", folder.Path);
            }
        }

        // A full scan can still be writing the title down when it returns, so it gets a moment.
        var moved = _libraryManager.FindByPath(newItemPath, null);
        for (var attempt = 0; moved is null && attempt < 10; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
            moved = _libraryManager.FindByPath(newItemPath, null);
        }

        if (moved is null)
        {
            // The scan will get to it; the monitor and the next library scan both pick it up.
            _libraryMonitor.ReportFileSystemChanged(toTop);
            _libraryMonitor.ReportFileSystemChanged(fromTop);
            return null;
        }

        try
        {
            if (moved is Folder folderItem)
            {
                await folderItem.ValidateChildren(new Progress<double>(), options, true, false, cancellationToken).ConfigureAwait(false);
            }

            await moved.RefreshMetadata(options, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Archive: refreshing {Name} after the move failed", moved.Name);
        }

        return moved;
    }

    // The closest folder the library knows about that holds the path, up to the library folder
    // itself. The library (a CollectionFolder) doesn't scan anything when asked; its folder on
    // disk does.
    private Folder? ContainingFolder(string path)
    {
        var library = LibraryOfPath(path);
        if (library is null)
        {
            return null;
        }

        var root = library.Value.Root;
        var dir = Path.GetDirectoryName(PathUtil.Trim(path));
        while (!string.IsNullOrEmpty(dir) && PathUtil.IsSameOrInside(dir, root))
        {
            if (_libraryManager.FindByPath(dir, true) is Folder folder and not CollectionFolder)
            {
                return folder;
            }

            dir = Path.GetDirectoryName(dir);
        }

        var id = ParseId(library.Value.Library.ItemId);
        return id is not null && _libraryManager.GetItemById(id.Value) is CollectionFolder collection
            ? collection.GetPhysicalFolders().FirstOrDefault(f => PathUtil.Same(f.Path, root))
            : null;
    }

    // ---------------------------------------------------------------- played state

    private void CapturePlayedState(BaseItem item, string fromTop, string toTop)
    {
        var items = new List<BaseItem> { item };
        if (item is Folder folder)
        {
            items.AddRange(folder.GetRecursiveChildren());
        }

        var pending = new Dictionary<string, List<PendingUserData>>(StringComparer.Ordinal);
        var users = _userManager.GetUsers().ToList();
        foreach (var each in items.Where(i => !string.IsNullOrEmpty(i.Path) && PathUtil.IsSameOrInside(i.Path, fromTop)))
        {
            var newPath = PathUtil.Same(each.Path, fromTop)
                ? toTop
                : Path.Combine(toTop, Path.GetRelativePath(fromTop, each.Path));
            foreach (var user in users)
            {
                var data = _userDataManager.GetUserData(user, each);
                if (data is null || !(data.Played || data.PlayCount > 0 || data.PlaybackPositionTicks > 0 || data.IsFavorite || data.Rating.HasValue || data.Likes.HasValue))
                {
                    continue;
                }

                if (!pending.TryGetValue(newPath, out var list))
                {
                    pending[newPath] = list = new List<PendingUserData>();
                }

                list.Add(new PendingUserData
                {
                    UserId = user.Id,
                    Played = data.Played,
                    PlayCount = data.PlayCount,
                    PlaybackPositionTicks = data.PlaybackPositionTicks,
                    IsFavorite = data.IsFavorite,
                    Rating = data.Rating,
                    Likes = data.Likes,
                    LastPlayedDate = data.LastPlayedDate,
                    AudioStreamIndex = data.AudioStreamIndex,
                    SubtitleStreamIndex = data.SubtitleStreamIndex
                });
            }
        }

        if (pending.Count > 0)
        {
            _store.Update(s =>
            {
                foreach (var (path, list) in pending)
                {
                    s.PendingUserData[PathUtil.Trim(path)] = list;
                }
            });
        }
    }

    /// <summary>Gives an item that just appeared the played state it had under its old path.</summary>
    /// <param name="item">The item.</param>
    public void ApplyPendingPlayedState(BaseItem item)
    {
        if (string.IsNullOrEmpty(item.Path))
        {
            return;
        }

        var key = PathUtil.Trim(item.Path);
        var list = _store.Read(s => s.PendingUserData.TryGetValue(key, out var found) ? found : null);
        if (list is null)
        {
            return;
        }

        foreach (var saved in list)
        {
            var user = _userManager.GetUserById(saved.UserId);
            if (user is null)
            {
                continue;
            }

            var data = _userDataManager.GetUserData(user, item);
            if (data is null)
            {
                continue;
            }

            data.Played |= saved.Played;
            data.PlayCount = Math.Max(data.PlayCount, saved.PlayCount);
            if (data.PlaybackPositionTicks == 0)
            {
                data.PlaybackPositionTicks = saved.PlaybackPositionTicks;
            }

            data.IsFavorite |= saved.IsFavorite;
            data.Rating ??= saved.Rating;
            data.Likes ??= saved.Likes;
            if (saved.LastPlayedDate > (data.LastPlayedDate ?? DateTime.MinValue))
            {
                data.LastPlayedDate = saved.LastPlayedDate;
            }

            data.AudioStreamIndex ??= saved.AudioStreamIndex;
            data.SubtitleStreamIndex ??= saved.SubtitleStreamIndex;
            _userDataManager.SaveUserData(user, item, data, UserDataSaveReason.Import, CancellationToken.None);
        }

        _store.Update(s => s.PendingUserData.Remove(key));
    }

    /// <summary>Whether any played state is waiting for a path.</summary>
    /// <param name="path">The path.</param>
    /// <returns>True when some is.</returns>
    public bool HasPendingPlayedState(string? path) =>
        !string.IsNullOrEmpty(path) && _store.Read(s => s.PendingUserData.ContainsKey(PathUtil.Trim(path)));
}
