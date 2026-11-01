# Moonfin Smart-TV — personal fork

This is a fork of [Moonfin-Client/Smart-TV](https://github.com/Moonfin-Client/Smart-TV) with a set of
Samsung TV (Tizen) fixes and features on top. The original code stays as it is; the changes live on the
**`tv-patches`** branch, which is this fork's default branch.

## Branches

| Branch | What's on it |
| --- | --- |
| `main` | An untouched copy of upstream `main`. Never commit here. |
| `tv-patches` | Upstream plus the changes below. Build and install from this branch. |

## Getting upstream updates

**Automatic:** the *Sync upstream* workflow (`.github/workflows/sync-upstream.yml`) runs every night.
It copies upstream `main` onto this fork's `main` and merges it into `tv-patches`. If the merge goes
through, the *Build TV patches* workflow builds new `.wgt` files and puts them on the
[`tv-patches-latest` release](../../releases/tag/tv-patches-latest). If upstream changed the same
lines as one of the patches, nothing is pushed: the workflow opens an issue called
"Upstream merge needs a hand" instead. You can also start it by hand from the Actions tab
(*Sync upstream* → *Run workflow*).

**By hand**, on your own computer:

```sh
git clone https://github.com/mboeckx/Moonfin-Smart-TV-Enhanced.git
cd Moonfin-Smart-TV-Enhanced
git remote add upstream https://github.com/Moonfin-Client/Smart-TV.git

# whenever upstream has something new
git checkout tv-patches
git fetch upstream
git merge upstream/main        # fix any conflicts, then: git add <files> && git commit
git push origin tv-patches
```

Use `merge`, not `rebase`, so the history that's already on GitHub stays valid.

## Building

```sh
npm ci --force
npm run build:tizen            # Regular  -> Moonfin_Tizen_Regular_v*.wgt
npm run build:tizen:legacy     # Legacy
npm run build:tizen:all        # all three variants
```

Tests: `cd packages/app && npx enact test`.

## What the patches change

**Library lists**
- Movie and show libraries load every page in the background, so scrolling never waits on the
  next page and a letter jump or search sees the whole library.
- Lighter list requests (one image per type, only the fields the grid and filters need, the total
  count only on the first page) with tagged, cacheable image URLs.
- A list you opened before shows immediately while a fresh copy loads behind it. The swap waits
  until the remote has been still, and keeps focus on the same title (or the next one still there
  if it was deleted), on the same row of the screen.
- Coming back from a title also brings back what was typed in the library search, and a changed
  poster shows straight away.
- Filters stay while you go into a title and back, and clear when you back out to the home screen.
  (Upstream remembers them for good.)

**Screensaver**
- Picks from the whole library at random (*Shuffle Whole Library*, on by default; turn off for the
  old behaviour), avoids repeating the last 150 titles, and picks a random backdrop among all the
  ones a title has.
- *OK Button* setting: wake, play, or open the details page of the title shown.
- Yellow opens Change Artwork for the title shown; green adds it to the watchlist.

**Watchlists**
- Green on the screensaver adds a movie to a `Watchlist` playlist, and a series (its next-up or
  first episode) to `Series Watchlist`. Both are created on first use.

**Playlists**
- Every layout opens a playlist on the playlist page, which adds a poster view (episodes show as
  their series) and a Delete button to upstream's sort and filter bar. The view and sort are
  remembered per playlist. DEL removes an entry in any sort order.

**Series audio and subtitles**
- On a series page, Audio and Subtitles set a language for the whole series (subtitles can be
  *None*). Languages in the first episode are listed first. Playback uses that choice before
  anything remembered from earlier playback.

**Other fixes**
- Change Artwork shows each backdrop rather than the first one repeated.
- Long-pressing Change Artwork no longer crashes.
- Theme music: titles without a theme song aren't asked about again in the same session.
