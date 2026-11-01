// Patched: a "Watchlist" playlist on the Jellyfin server, for titles saved from the screensaver.
//
// Jellyfin has no watchlist of its own, so a playlist stands in: it belongs to the user, every
// Jellyfin client shows it, and it is created the first time something is added. A playlist
// holds playable items, and Jellyfin turns a series added to one into every one of its
// episodes, so a series is represented by a single episode instead: the one up next if it has
// been started, otherwise its first episode.

import {fetchAllPlaylistItems} from '../views/Details/playlistItems';

export const WATCHLIST_NAME = 'Watchlist';
// Series get a list of their own, so the episodes standing in for them don't mix with films.
export const SERIES_WATCHLIST_NAME = 'Series Watchlist';

export const watchlistNameFor = (item) => (item?.Type === 'Series' ? SERIES_WATCHLIST_NAME : WATCHLIST_NAME);

/**
 * The title a card or page puts on a watchlist: a film as itself, a series as itself, and an
 * episode or season as its series. Null for anything else, such as music or a person.
 */
export const watchlistTarget = (item) => {
	if (!item?.Id) return null;
	if (item.Type === 'Movie' || item.Type === 'Series') return item;
	if ((item.Type === 'Episode' || item.Type === 'Season') && item.SeriesId) {
		const series = {Id: item.SeriesId, Type: 'Series', Name: item.SeriesName || item.Name};
		['_serverUrl', '_serverAccessToken', '_serverUserId', '_serverName', '_serverId', '_serverType'].forEach((key) => {
			if (item[key]) series[key] = item[key];
		});
		return series;
	}
	return null;
};

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

const findWatchlist = async (api, listName) => {
	const playlists = await api.getPlaylists();
	return (playlists?.Items || []).find(named(listName)) || null;
};

// The entries on a watchlist that stand for this title: the film itself, or any episode of the series.
const entriesFor = (listed, item) => listed.filter((entry) =>
	entry.Id === item.Id || (item.Type === 'Series' && entry.SeriesId === item.Id));

/** Whether the title is on its watchlist. */
export const isOnWatchlist = async (api, item) => {
	const watchlist = await findWatchlist(api, watchlistNameFor(item));
	if (!watchlist) return false;
	return entriesFor(await fetchAllPlaylistItems(api, watchlist.Id), item).length > 0;
};

/**
 * Takes the title off its watchlist, every entry standing for it. Resolves to {status, listName}:
 * 'removed', or 'absent' when it wasn't on the list.
 */
export const removeFromWatchlist = async (api, item) => {
	const listName = watchlistNameFor(item);
	const watchlist = await findWatchlist(api, listName);
	if (!watchlist) return {status: 'absent', listName};
	const entries = entriesFor(await fetchAllPlaylistItems(api, watchlist.Id), item);
	const entryIds = entries.map((entry) => entry.PlaylistItemId).filter(Boolean);
	if (!entryIds.length) return {status: 'absent', listName};
	await api.removeFromPlaylist(watchlist.Id, entryIds);
	return {status: 'removed', listName};
};

/** What to tell the viewer about a watchlist change, in one line. */
export const watchlistMessage = (result, item, translate = (text) => text) => {
	const name = item?.Name || translate('This title');
	const list = translate(result?.listName || WATCHLIST_NAME);
	const fill = (text) => translate(text).replace('{name}', name).replace('{list}', list);
	switch (result?.status) {
		case 'already': return fill('{name} is already on {list}');
		case 'nothing': return fill('No episode of {name} to add to {list}');
		case 'removed': return fill('Removed from {list}: {name}');
		case 'absent': return fill('{name} is not on {list}');
		case 'created':
		case 'added': {
			const entry = result.entry;
			const episode = item?.Type === 'Series' && entry ? ` (S${entry.ParentIndexNumber || 0}E${entry.IndexNumber || 0})` : '';
			return translate('Added to {list}: {name}').replace('{list}', list).replace('{name}', name + episode);
		}
		default: return fill('Couldn\'t change {list} for {name}');
	}
};

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

	const watchlist = await findWatchlist(api, listName);
	if (!watchlist) {
		await api.createPlaylist(listName, [entry.Id]);
		return {status: 'created', entry, listName};
	}

	const current = await fetchAllPlaylistItems(api, watchlist.Id);
	const already = current.some((listed) => listed.Id === entry.Id) || entriesFor(current, item).length > 0;
	if (already) return {status: 'already', entry, listName};

	await api.addToPlaylist(watchlist.Id, [entry.Id]);
	return {status: 'added', entry, listName};
};

/** Puts the title on its watchlist, or takes it off when it is already there. */
export const toggleWatchlist = async (api, item) => {
	if (await isOnWatchlist(api, item)) return removeFromWatchlist(api, item);
	return addToWatchlist(api, item);
};
