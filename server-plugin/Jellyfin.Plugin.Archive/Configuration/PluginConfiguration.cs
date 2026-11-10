using System;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Archive.Configuration;

/// <summary>
/// The Archive plugin settings.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Gets or sets the id of the library that serves as the archive.</summary>
    public string ArchiveLibraryId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the library a title goes back to when it was archived before the plugin kept
    /// track of where it came from. Titles archived through the plugin go back where they were.
    /// </summary>
    public string DefaultRestoreLibraryId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether archived titles still show when browsing an actor,
    /// director or other crew member. Clients that support the plugin read this.
    /// </summary>
    public bool IncludeInPersonBrowse { get; set; } = true;

    /// <summary>Gets or sets the users allowed to move titles to and from the archive.</summary>
    public Guid[] ManagerUserIds { get; set; } = Array.Empty<Guid>();

    /// <summary>Gets or sets a value indicating whether every administrator may move titles too.</summary>
    public bool AdministratorsCanManage { get; set; } = true;

    /// <summary>Gets or sets the users allowed to see the archive.</summary>
    public Guid[] ViewerUserIds { get; set; } = Array.Empty<Guid>();

    /// <summary>Gets or sets a value indicating whether every administrator may see the archive too.</summary>
    public bool AdministratorsCanView { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the plugin keeps each user's library access in step
    /// with the viewer list. Without it, the viewer list is advisory and library access is set by hand.
    /// </summary>
    public bool EnforceViewerAccess { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether the archive is kept out of the viewers' Latest rows.</summary>
    public bool HideFromLatest { get; set; } = true;
}
