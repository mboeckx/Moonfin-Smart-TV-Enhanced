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
/// The archive and the soft delete library, for clients: what they are, what this user may do
/// with them, and moving titles in and out.
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

    /// <summary>The archive and the soft delete library, and what the signed in user may do with each.</summary>
    /// <returns>One entry per shelf.</returns>
    [HttpGet("Info")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<object> GetInfo()
    {
        var user = CurrentUser();
        if (user is null)
        {
            return Unauthorized();
        }

        object Shelf(Place place)
        {
            var library = _archive.GetShelfLibrary(place);
            var canView = library is not null && _archive.HasAccess(user, place);
            return new
            {
                Configured = library is not null,
                // Somebody without access never learns which library it is.
                LibraryId = canView ? _archive.GetShelfLibraryId(place)?.ToString("N") : null,
                LibraryName = canView ? library!.Name : null,
                CanView = canView,
                CanManage = _archive.CanManage(user, place),
                ArchiveService.SettingsFor(place).IncludeInPersonBrowse
            };
        }

        return Ok(new
        {
            Version = Plugin.Instance!.Version.ToString(),
            Archive = Shelf(Place.Archive),
            SoftDelete = Shelf(Place.SoftDelete)
        });
    }

    /// <summary>Where a title is and where this user may move it.</summary>
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

        var movable = ArchiveService.IsMovable(item);
        var place = _archive.PlaceOf(item);
        var job = _archive.GetActiveJob(item.Id);
        return Ok(new
        {
            Location = place.ToString(),
            CanArchive = movable && _archive.CanMove(user, place, Place.Archive),
            CanSoftDelete = movable && _archive.CanMove(user, place, Place.SoftDelete),
            CanRestore = movable && _archive.CanMove(user, place, Place.Library),
            ActiveJob = job is null ? null : JobDto(job)
        });
    }

    /// <summary>Moves a title into the archive, into the soft delete library, or back to its own library.</summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="to">Archive, SoftDelete or Library.</param>
    /// <returns>The move, which carries on in the background.</returns>
    [HttpPost("Items/{itemId}/Move")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public ActionResult<object> Move([FromRoute] Guid itemId, [FromQuery] string to)
    {
        var user = CurrentUser();
        if (user is null)
        {
            return Unauthorized();
        }

        if (!Enum.TryParse<Place>(to, true, out var target) || !Enum.IsDefined(target))
        {
            return BadRequest(new { Error = "Say where to: Archive, SoftDelete or Library." });
        }

        var item = _libraryManager.GetItemById(itemId);
        if (item is null || !item.IsVisible(user))
        {
            return NotFound();
        }

        if (!ArchiveService.IsMovable(item))
        {
            return BadRequest(new { Error = "Only movies and shows can be moved." });
        }

        var from = _archive.PlaceOf(item);
        if (from == target)
        {
            return Conflict(new { Error = "The title is already there." });
        }

        if (!_archive.CanMove(user, from, target))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { Error = "You aren't allowed to move this title there." });
        }

        return Accepted(JobDto(_archive.StartMove(item, user, target)));
    }

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
        if (user is null || job is null || job.UserId != user.Id)
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
                IsAdministrator = _userManager.GetUserDto(u, null!).Policy?.IsAdministrator == true
            })
        });
    }

    private static object JobDto(MoveJob job) => new
    {
        job.Id,
        job.ItemId,
        From = job.From.ToString(),
        To = job.To.ToString(),
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
