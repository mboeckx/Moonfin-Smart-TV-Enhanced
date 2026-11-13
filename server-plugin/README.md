# Archive plugin for Jellyfin

Two places to put movies and shows you want off the main library without deleting them:

- **The archive**: titles you want to keep but not see every day.
- **Soft delete**: titles on their way out, kept for a while in case they're missed.

Each is a library of its own. A title moved there leaves its library, so it is no longer in
"all movies". It is still on the server, in that library's own screen and, if you allow it, on
the pages of its actors, directors and crew.

Moonfin adds the buttons to a movie or show's details screen: **Move to Archive**, which becomes
**Restore from Archive** on an archived title, and **Soft Delete**, which becomes **Undo Soft
Delete**. Any other client can use the HTTP API below.

## What it does

- **Moves the files.** A title in its own folder (`Movies/Alpha (2001)/…`) moves as a folder,
  with its extras, subtitles, artwork and nfo. A title loose in a library folder moves with every
  file that starts with its name, such as `Gamma (2003).en.srt`. The plugin remembers where each
  title came from, even after it moves from one shelf to the other, so a restore puts it back in
  the same place. Moves within one drive are a rename. Across drives, the files are copied, and
  the originals are deleted only after the copy finishes.
- **Rescans only what changed**, then finds the title under its new path. The title gets a new
  id, and Moonfin opens it, or leaves the page when the person who moved it can't see where it went.
- **Keeps watched state.** Played status, play count, resume position, favourites and ratings
  move with the title, for every user. If the server only picks the title up on a later scan,
  the plugin applies the saved state then.
- **Gives each button to chosen people.** For the archive and for soft delete separately: the
  users you tick, plus every administrator unless you turn that off. This is separate from who
  can see the library, so somebody can soft delete a title without being able to see soft deleted
  titles. Moving a title off a shelf needs that shelf's button too, so bringing a title back needs
  both the button and access to the library it's in.
- **Limits who can see each library.** The plugin sets each user's own library access, so the
  limit holds in every app, the web client included, and on actor and director pages too. A user
  on "all libraries" who may not see one of them is given every *other* library instead,
  including libraries added later. They get "all libraries" back once they're allowed to see both.
  Turn **Set each user's library access to match** off to manage access yourself.
- Optionally keeps each library out of its viewers' **Latest** rows, and off people's pages in
  clients that support the plugin.
- Moonfin also leaves both out of its screensaver. People who can see the archive can turn
  archived titles back on under Settings → Screensaver → **Include Archived Titles**. Soft deleted
  titles never show there.

## Setting it up

1. Make a folder on the server's disk for the archive and one for soft deleted titles, and add
   each as a new library in *Dashboard → Libraries*. Use the same content type as the library you
   move titles out of.
2. Install the plugin (below) and restart Jellyfin.
3. Open *Dashboard → Plugins → Archive*. For each of the two, choose its library, and tick who gets
   the button and who can see the library. Leave a library set to None to switch that one off.

Jellyfin needs write access to the library folders and to both new folders.

Pointing either setting at a different library turns the old one back into an ordinary library,
and anyone the plugin had kept from it gets access to it again.

## Building and installing

Needs the .NET 10 SDK. Built against Jellyfin 12.0, and tested on Jellyfin 12.4.

```bash
cd server-plugin/Jellyfin.Plugin.Archive
dotnet build -c Release
```

Copy `bin/Release/net10.0/Jellyfin.Plugin.Archive.dll` into a folder named `Archive_1.0.0.0`
inside the server's `plugins` folder (for Docker, `/config/plugins/Archive_1.0.0.0/`), then
restart Jellyfin.

## API

Every route needs a signed-in user. Places are `Library`, `Archive` and `SoftDelete`.

| Route | What it does |
|---|---|
| `GET /Archive/Info` | For `Archive` and `SoftDelete`: whether it is set up, whether this user can see it and has its button, its library id (only for users who can see it), and the person page setting. |
| `GET /Archive/Items/{id}` | The title's `Location`, and `CanArchive`, `CanSoftDelete` and `CanRestore` for this user, plus any move already running for it. |
| `POST /Archive/Items/{id}/Move?to=Archive` | Starts moving the title to `Archive`, `SoftDelete` or back to its `Library`. Answers `202` with a job, or `403` without the rights for both ends. |
| `GET /Archive/Jobs/{jobId}` | The job's `State`: `Queued`, `Moving`, `Scanning`, `Done` (with `NewItemId`), `DoneNotScanned` (the files moved, and the next scan picks the title up) or `Failed` (with `Error`, and nothing moved). Only the user who started it can read it. |
| `GET /Archive/Admin/Choices` | Libraries and users for the settings page. Administrators only. |

## Limits

- Only movies and shows. Seasons and episodes stay with their show.
- Nothing can be moved onto a path that already exists. The move fails and leaves everything as
  it was.
- When people's pages leave shelved titles out, it's Moonfin doing it. The server itself still
  lists them under their cast for anyone allowed to see that library.
- The first title moved into a library that was empty when it was added sets off a scan of every
  library, because Jellyfin doesn't record an empty library's folder until then.
