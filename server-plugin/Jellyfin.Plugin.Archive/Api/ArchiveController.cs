using System;
using System.Linq;
using System.Net.Mime;
using System.Security.Claims;
using Jellyfin.Plugin.Archive.Services;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Archive.Api;

/// <summary>
/// The archive, for clients: what it is, what this user may do, and moving titles in and out.
/// </summary>
[ApiController]
[Authorize]
[Route("Archive")]
[Produces(MediaTypeNames.Application.Json)]
public class ArchiveController : ControllerBase
{
    private readonly ArchiveService _archive;
    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArchiveController"/> class.
    /// </summary>
    /// <param name="archive">The archive service.</param>
    /// <param name="libraryManager">The library manager.</param>
    /// <param name="userManager">The user manager.</param>
    public ArchiveController(ArchiveService archive, ILibraryManager libraryManager, IUserManager userManager)
    {
        _archive = archive;
        _libraryManager = libraryManager;
        _userManager = userManager;
    }

    /// <summary>What the archive is and what the signed in user may do with it.</summary>
    /// <returns>The archive info.</returns>
    [HttpGet("Info")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<object> GetInfo()
    {
        var user = CurrentUser();
        if (user is null)
        {
            return Unauthorized();
        }

        var library = _archive.GetArchiveLibrary();
        var config = Plugin.Instance!.Configuration;
        var canView = library is not null && _archive.HasArchiveAccess(user);
        return Ok(new
        {
            Version = Plugin.Instance.Version.ToString(),
            Configured = library is not null,
            // Somebody without access never learns which library it is.
            ArchiveLibraryId = canView ? _archive.GetArchiveLibraryId()?.ToString("N") : null,
            ArchiveLibraryName = canView ? library!.Name : null,
            CanView = canView,
            CanManage = library is not null && _archive.CanManage(user),
            IncludeInPersonBrowse = config.IncludeInPersonBrowse
        });
    }

    /// <summary>Whether a title is archived and whether this user may move it.</summary>
    /// <param name="itemId">The item id.</param>
    /// <returns>The status.</returns>
    [HttpGet("Items/{itemId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<object> GetStatus([FromRoute] Guid itemId)
    {
        var user = CurrentUser();
        if (user is null)
        {
            return Unauthorized();
        }

        var item = _libraryManager.GetItemById(itemId);
        if (item is null || !item.IsVisible(user))
        {
            return NotFound();
        }

        var movable = ArchiveService.IsMovable(item) && _archive.GetArchiveLibrary() is not null;
        var archived = _archive.IsArchived(item);
        var canManage = movable && _archive.CanManage(user);
        var job = _archive.GetActiveJob(item.Id);
        return Ok(new
        {
            IsArchived = archived,
            CanArchive = canManage && !archived,
            CanRestore = canManage && archived,
            ActiveJob = job is null ? null : JobDto(job)
        });
    }

    /// <summary>Moves a title into the archive.</summary>
    /// <param name="itemId">The item id.</param>
    /// <returns>The move, which carries on in the background.</returns>
    [HttpPost("Items/{itemId}/Archive")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<object> Archive([FromRoute] Guid itemId) => Move(itemId, MoveDirection.ToArchive);

    /// <summary>Moves a title out of the archive, back where it came from.</summary>
    /// <param name="itemId">The item id.</param>
    /// <returns>The move, which carries on in the background.</returns>
    [HttpPost("Items/{itemId}/Restore")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<object> Restore([FromRoute] Guid itemId) => Move(itemId, MoveDirection.FromArchive);

    /// <summary>How a move is getting on.</summary>
    /// <param name="jobId">The job id.</param>
    /// <returns>The job.</returns>
    [HttpGet("Jobs/{jobId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult<object> GetJob([FromRoute] Guid jobId)
    {
        var user = CurrentUser();
        var job = _archive.GetJob(jobId);
        if (user is null || job is null || (job.UserId != user.Id && !_archive.CanManage(user)))
        {
            return NotFound();
        }

        return Ok(JobDto(job));
    }

    /// <summary>The libraries and users, for the settings page.</summary>
    /// <returns>The choices.</returns>
    [HttpGet("Admin/Choices")]
    [Authorize(Policy = "RequiresElevation")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<object> GetChoices()
    {
        return Ok(new
        {
            Libraries = _libraryManager.GetVirtualFolders().Select(f => new { Id = f.ItemId, f.Name, CollectionType = f.CollectionType?.ToString() }),
            Users = _userManager.GetUsers().Select(u => new
            {
                u.Id,
                Name = u.Username,
                IsAdministrator = _userManager.GetUserDto(u, null!).Policy?.IsAdministrator == true,
                HasArchiveAccess = _archive.HasArchiveAccess(u)
            })
        });
    }

    private ActionResult<object> Move(Guid itemId, MoveDirection direction)
    {
        var user = CurrentUser();
        if (user is null)
        {
            return Unauthorized();
        }

        if (!_archive.CanManage(user))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { Error = "You aren't allowed to move titles to or from the archive." });
        }

        var item = _libraryManager.GetItemById(itemId);
        if (item is null || !item.IsVisible(user))
        {
            return NotFound();
        }

        if (!ArchiveService.IsMovable(item))
        {
            return BadRequest(new { Error = "Only movies and shows can be archived." });
        }

        if (_archive.IsArchived(item) == (direction == MoveDirection.ToArchive))
        {
            return Conflict(new { Error = direction == MoveDirection.ToArchive ? "The title is already archived." : "The title is not archived." });
        }

        var job = _archive.StartMove(item, user, direction);
        return Accepted(JobDto(job));
    }

    private static object JobDto(MoveJob job) => new
    {
        job.Id,
        job.ItemId,
        Direction = job.Direction.ToString(),
        State = job.State.ToString(),
        job.NewItemId,
        job.Error
    };

    private Jellyfin.Database.Implementations.Entities.User? CurrentUser()
    {
        var claim = User.Claims.FirstOrDefault(c => c.Type is "Jellyfin-UserId" or ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(claim, out var id) ? _userManager.GetUserById(id) : null;
    }
}
