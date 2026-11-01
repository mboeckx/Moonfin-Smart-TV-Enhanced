// Patched: a "Watchlist" playlist on the Jellyfin server, for titles saved from the screensaver.
//
// Jellyfin has no watchlist of its own, so a playlist stands in: it belongs to the user, every
// Jellyfin client shows it, and it is created the first time something is added. A playlist
// holds playable items, and Jellyfin turns a series added to one into every one of its
// episodes, so a series is represented by a single episode instead: the one up next if it has
// been started, otherwise its first episode.

export const WATCHLIST_NAME = 'Watchlist';
// Series get a list of their own, so the episodes standing in for them don't mix with films.
export const SERIES_WATCHLIST_NAME = 'Series Watchlist';

export const watchlistNameFor = (item) => (item?.Type === 'Series' ? SERIES_WATCHLIST_NAME : WATCHLIST_NAME);

const firstRegularEpisode = (episodes) =>
	(episodes || []).find((episode) => (episode.ParentIndexNumber || 0) > 0) || (episodes || [])[0] || null;

// The item that goes on the list for this title, or null when a series has no episode to use.
export const watchlistEntryFor = async (api, item) => {
	if (!item) return null;
	if (item.Type !== 'Series') return item;
	const nextUp = await api.getNextUp(1, item.Id).catch(() => null);
	if (nextUp?.Items?.[0]) return nextUp.Items[0];
	const episodes = await api.getItems({
		ParentId: item.Id,
		Recursive: true,
		IncludeItemTypes: 'Episode',
		SortBy: 'ParentIndexNumber,IndexNumber',
		SortOrder: 'Ascending',
		Limit: 10,
		EnableTotalRecordCount: false,
		EnableImages: false,
		EnableUserData: false
	}).catch(() => null);
	return firstRegularEpisode(episodes?.Items);
};

const named = (name) => (playlist) => String(playlist?.Name || '').trim().toLowerCase() === name.toLowerCase();

/**
 * Puts a title on its watchlist playlist: films and everything else on Watchlist, series on
 * Series Watchlist. Resolves to {status, entry, listName}: 'created' when the playlist was made
 * for it, 'added', 'already' when the title (or, for a series, any of its episodes) is on it,
 * or 'nothing' when a series had no episode to add.
 */
export const addToWatchlist = async (api, item) => {
	const listName = watchlistNameFor(item);
	const entry = await watchlistEntryFor(api, item);
	if (!entry?.Id) return {status: 'nothing', entry: null, listName};

	const playlists = await api.getPlaylists();
	const watchlist = (playlists?.Items || []).find(named(listName));
	if (!watchlist) {
		await api.createPlaylist(listName, [entry.Id]);
		return {status: 'created', entry, listName};
	}

	const current = await api.getPlaylistItems(watchlist.Id, 5000);
	const already = (current?.Items || []).some((listed) =>
		listed.Id === entry.Id || (item.Type === 'Series' && listed.SeriesId === item.Id));
	if (already) return {status: 'already', entry, listName};

	await api.addToPlaylist(watchlist.Id, [entry.Id]);
	return {status: 'added', entry, listName};
};
