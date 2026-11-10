using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Archive.Services;

/// <summary>Where an archived title came from, so a restore can put it back.</summary>
public class ArchiveRecord
{
    /// <summary>Gets or sets the top level path the title occupies in the archive.</summary>
    public string ArchivePath { get; set; } = string.Empty;

    /// <summary>Gets or sets the top level path it had before it was archived.</summary>
    public string OriginalPath { get; set; } = string.Empty;

    /// <summary>Gets or sets the library it was archived from.</summary>
    public Guid OriginalLibraryId { get; set; }

    /// <summary>Gets or sets when it was archived.</summary>
    public DateTime ArchivedAtUtc { get; set; }

    /// <summary>Gets or sets who archived it.</summary>
    public Guid ArchivedBy { get; set; }

    /// <summary>Gets or sets the title, for the log and the settings page.</summary>
    public string Name { get; set; } = string.Empty;
}

/// <summary>Played state for one user, waiting for the moved title to appear under its new path.</summary>
public class PendingUserData
{
    /// <summary>Gets or sets the user.</summary>
    public Guid UserId { get; set; }

    /// <summary>Gets or sets a value indicating whether it was played.</summary>
    public bool Played { get; set; }

    /// <summary>Gets or sets the play count.</summary>
    public int PlayCount { get; set; }

    /// <summary>Gets or sets the resume position.</summary>
    public long PlaybackPositionTicks { get; set; }

    /// <summary>Gets or sets a value indicating whether it is a favorite.</summary>
    public bool IsFavorite { get; set; }

    /// <summary>Gets or sets the user's rating.</summary>
    public double? Rating { get; set; }

    /// <summary>Gets or sets the like.</summary>
    public bool? Likes { get; set; }

    /// <summary>Gets or sets when it was last played.</summary>
    public DateTime? LastPlayedDate { get; set; }

    /// <summary>Gets or sets the chosen audio track.</summary>
    public int? AudioStreamIndex { get; set; }

    /// <summary>Gets or sets the chosen subtitle track.</summary>
    public int? SubtitleStreamIndex { get; set; }
}

/// <summary>Everything the plugin keeps between restarts.</summary>
public class ArchiveState
{
    /// <summary>Gets or sets the titles archived through the plugin.</summary>
    public List<ArchiveRecord> Records { get; set; } = new();

    /// <summary>Gets or sets played state keyed by the path the item will have once the move is scanned.</summary>
    public Dictionary<string, List<PendingUserData>> PendingUserData { get; set; } = new(StringComparer.Ordinal);

    /// <summary>
    /// Gets or sets the users the plugin moved off "all libraries" to keep the archive from them,
    /// so they get every new library too and get "all libraries" back once they may view the archive.
    /// </summary>
    public List<Guid> RestrictedUsers { get; set; } = new();
}

/// <summary>Reads and writes <see cref="ArchiveState"/> as a JSON file in the plugin's data folder.</summary>
public class ArchiveStore
{
    private static readonly JsonSerializerOptions _json = new() { WriteIndented = true };
    private readonly object _lock = new();
    private readonly string _path;
    private readonly ILogger<ArchiveStore> _logger;
    private ArchiveState? _state;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArchiveStore"/> class.
    /// </summary>
    /// <param name="paths">The application paths.</param>
    /// <param name="logger">The logger.</param>
    public ArchiveStore(IApplicationPaths paths, ILogger<ArchiveStore> logger)
    {
        _logger = logger;
        var folder = Path.Combine(paths.PluginConfigurationsPath, "Archive");
        Directory.CreateDirectory(folder);
        _path = Path.Combine(folder, "state.json");
    }

    /// <summary>Runs <paramref name="change"/> on the state and saves it.</summary>
    /// <param name="change">What to change.</param>
    public void Update(Action<ArchiveState> change)
    {
        lock (_lock)
        {
            var state = Load();
            change(state);
            Save(state);
        }
    }

    /// <summary>Reads from the state.</summary>
    /// <typeparam name="T">What is read.</typeparam>
    /// <param name="read">How to read it.</param>
    /// <returns>The value read.</returns>
    public T Read<T>(Func<ArchiveState, T> read)
    {
        lock (_lock)
        {
            return read(Load());
        }
    }

    /// <summary>Finds the record for a path inside the archive.</summary>
    /// <param name="path">A path in the archive.</param>
    /// <returns>The record, or null.</returns>
    public ArchiveRecord? FindRecord(string path) => Read(state => state.Records
        .Where(r => PathUtil.IsSameOrInside(path, r.ArchivePath))
        .OrderByDescending(r => r.ArchivePath.Length)
        .FirstOrDefault());

    private ArchiveState Load()
    {
        if (_state is not null)
        {
            return _state;
        }

        try
        {
            if (File.Exists(_path))
            {
                _state = JsonSerializer.Deserialize<ArchiveState>(File.ReadAllText(_path));
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            _logger.LogError(ex, "Could not read the archive state at {Path}; starting empty", _path);
        }

        _state ??= new ArchiveState();
        return _state;
    }

    private void Save(ArchiveState state)
    {
        var temp = _path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(state, _json));
        File.Move(temp, _path, true);
    }
}
