using System;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Archive.Configuration;

/// <summary>
/// One of the libraries titles can be put away in: the archive, or the soft delete library.
/// </summary>
public class ShelfSettings
{
    /// <summary>Gets or sets the id of the library titles are moved into.</summary>
    public string LibraryId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the users who get the button that moves titles in and out. This is separate
    /// from seeing the library: somebody can be allowed to put titles away without seeing them again.
    /// </summary>
    public Guid[] ManagerUserIds { get; set; } = Array.Empty<Guid>();

    /// <summary>Gets or sets a value indicating whether every administrator gets the button too.</summary>
    public bool AdministratorsCanManage { get; set; } = true;

    /// <summary>Gets or sets the users who may see the library and what's in it.</summary>
    public Guid[] ViewerUserIds { get; set; } = Array.Empty<Guid>();

    /// <summary>Gets or sets a value indicating whether every administrator may see it too.</summary>
    public bool AdministratorsCanView { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether titles in it still show when browsing an actor,
    /// director or other crew member, for those who may see it. Clients that support the plugin read this.
    /// </summary>
    public bool IncludeInPersonBrowse { get; set; }

    /// <summary>Gets or sets a value indicating whether it is kept out of the viewers' Latest rows.</summary>
    public bool HideFromLatest { get; set; } = true;
}

/// <summary>
/// The Archive plugin settings.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Gets or sets the archive.</summary>
    public ShelfSettings Archive { get; set; } = new() { IncludeInPersonBrowse = true };

    /// <summary>Gets or sets the soft delete library.</summary>
    public ShelfSettings SoftDelete { get; set; } = new();

    /// <summary>
    /// Gets or sets the library a title goes back to when it was put away before the plugin kept
    /// track of where it came from. Titles moved through the plugin go back where they were.
    /// </summary>
    public string DefaultRestoreLibraryId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the plugin keeps each user's library access in step
    /// with the viewer lists. Without it, the viewer lists are advisory and library access is set by hand.
    /// </summary>
    public bool EnforceViewerAccess { get; set; } = true;

    /// <summary>Gets or sets the archive library id as the first version stored it. Read once, then cleared.</summary>
    public string? ArchiveLibraryId { get; set; }

    /// <summary>Gets or sets the first version's movers. Read once, then cleared.</summary>
    public Guid[]? ManagerUserIds { get; set; }

    /// <summary>Gets or sets the first version's viewers. Read once, then cleared.</summary>
    public Guid[]? ViewerUserIds { get; set; }

    /// <summary>Gets or sets the first version's person page setting. Read once, then cleared.</summary>
    public bool? IncludeInPersonBrowse { get; set; }

    /// <summary>
    /// Moves settings saved by the first version, which only had the archive, into <see cref="Archive"/>.
    /// </summary>
    /// <returns>True when anything moved, and the settings should be saved.</returns>
    public bool MigrateFirstVersion()
    {
        if (ArchiveLibraryId is null && ManagerUserIds is null && ViewerUserIds is null && IncludeInPersonBrowse is null)
        {
            return false;
        }

        if (string.IsNullOrEmpty(Archive.LibraryId) && !string.IsNullOrEmpty(ArchiveLibraryId))
        {
            Archive.LibraryId = ArchiveLibraryId;
            Archive.ManagerUserIds = ManagerUserIds ?? Archive.ManagerUserIds;
            Archive.ViewerUserIds = ViewerUserIds ?? Archive.ViewerUserIds;
            Archive.IncludeInPersonBrowse = IncludeInPersonBrowse ?? Archive.IncludeInPersonBrowse;
        }

        ArchiveLibraryId = null;
        ManagerUserIds = null;
        ViewerUserIds = null;
        IncludeInPersonBrowse = null;
        return true;
    }
}
