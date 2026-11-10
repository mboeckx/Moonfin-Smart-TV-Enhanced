# Archive plugin for Jellyfin

An archive is a second library for movies and shows you want to keep on the server without
seeing them next to everything else. A title moved to the archive leaves its library, so it is
no longer in "all movies". It is still on the server, in the archive's own library screen, and,
if you allow it, on the pages of its actors, directors and crew.

Moonfin adds the buttons: **Move to Archive** on a movie or show, and **Restore from Archive** on
an archived one. Any other client can use the HTTP API below.

## What it does

- **Moves the files.** A title in its own folder (`Movies/Alpha (2001)/…`) moves as a folder,
  with its extras, subtitles, artwork and nfo. A title loose in a library folder moves with every
  file that starts with its name, such as `Gamma (2003).en.srt`. The plugin remembers where each
  title came from, so a restore puts it back in the same place. Moves within one drive are a
  rename. Across drives, the files are copied, and the originals are deleted only after the copy
  finishes.
- **Rescans only what changed**, then finds the title under its new path. The title gets a new
  id, and Moonfin opens it.
- **Keeps watched state.** Played status, play count, resume position, favourites and ratings
  move with the title, for every user. If the server only picks the title up on a later scan,
  the plugin applies the saved state then.
- **Limits who may move titles.** Only the users you tick, plus every administrator unless you
  turn that off. Everyone else gets `403`.
- **Limits who may see the archive.** The plugin sets each user's own library access, so the
  limit holds in every app, the web client included, and on actor and director pages too. A
  user on "all libraries" who may not see the archive is given every *other* library instead,
  including libraries added later. They get "all libraries" back once you tick them. Turn
  **Set each user's library access to match** off to manage access yourself.
- Optionally keeps the archive out of the viewers' **Latest** rows, and off people's pages in
  clients that support the plugin.

## Setting it up

1. Make a folder for the archive on the server's disk, and add it as a new library in
   *Dashboard → Libraries*. Use the same content type as the library you archive from.
2. Install the plugin (below) and restart Jellyfin.
3. Open *Dashboard → Plugins → Archive*, choose the archive library, and tick who may move
   titles and who may see the archive.

Jellyfin needs write access to both the library folders and the archive folder.

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

Every route needs a signed-in user.

| Route | What it does |
|---|---|
| `GET /Archive/Info` | Whether an archive is set up, whether this user can see it and move titles, the archive library id (only for users who can see it), and the person page setting. |
| `GET /Archive/Items/{id}` | `IsArchived`, `CanArchive`, `CanRestore`, and any move already running for the title. |
| `POST /Archive/Items/{id}/Archive` | Starts moving the title into the archive. Answers `202` with a job. |
| `POST /Archive/Items/{id}/Restore` | Starts moving the title back out. Answers `202` with a job. |
| `GET /Archive/Jobs/{jobId}` | The job's `State`: `Queued`, `Moving`, `Scanning`, `Done` (with `NewItemId`), `DoneNotScanned` (the files moved, and the next scan picks the title up) or `Failed` (with `Error`, and nothing moved). |
| `GET /Archive/Admin/Choices` | Libraries and users for the settings page. Administrators only. |

## Limits

- Only movies and shows. Seasons and episodes stay with their show.
- Nothing can be moved onto a path that already exists. The move fails and leaves everything as
  it was.
- When people's pages leave archived titles out, it's Moonfin doing it. The server itself still
  lists archived titles under their cast for anyone allowed to see the archive.
