using System;

namespace Jellyfin.Plugin.Archive.Services;

/// <summary>Which way a title is moving.</summary>
public enum MoveDirection
{
    /// <summary>Into the archive.</summary>
    ToArchive,

    /// <summary>Back out of the archive.</summary>
    FromArchive
}

/// <summary>Where a move has got to.</summary>
public enum MoveState
{
    /// <summary>Waiting behind another move.</summary>
    Queued,

    /// <summary>Moving the files.</summary>
    Moving,

    /// <summary>The files are in place and the libraries are being scanned.</summary>
    Scanning,

    /// <summary>Finished, and the title has its new id.</summary>
    Done,

    /// <summary>Finished, but the scan has not picked the title up yet. It will on the next scan.</summary>
    DoneNotScanned,

    /// <summary>Nothing was moved.</summary>
    Failed
}

/// <summary>One move to or from the archive.</summary>
public class MoveJob
{
    /// <summary>Gets the job id.</summary>
    public Guid Id { get; } = Guid.NewGuid();

    /// <summary>Gets or sets the item being moved.</summary>
    public Guid ItemId { get; set; }

    /// <summary>Gets or sets the title, for messages.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets which way it goes.</summary>
    public MoveDirection Direction { get; set; }

    /// <summary>Gets or sets where it has got to.</summary>
    public MoveState State { get; set; } = MoveState.Queued;

    /// <summary>Gets or sets the id the title has after the move, once scanned.</summary>
    public Guid? NewItemId { get; set; }

    /// <summary>Gets or sets why it failed.</summary>
    public string? Error { get; set; }

    /// <summary>Gets or sets who asked.</summary>
    public Guid UserId { get; set; }

    /// <summary>Gets when it was asked for.</summary>
    public DateTime CreatedUtc { get; } = DateTime.UtcNow;
}
