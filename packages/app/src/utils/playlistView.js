// Patched: how a playlist screen can show and order its items. A playlist is fetched whole, so
// sorting happens here rather than on the server, and the playlist's own order stays what
// playing and reordering work on.

export const PLAYLIST_SORTS = [
	{key: 'playlist', label: 'Playlist Order', descending: false},
	{key: 'name', label: 'Title', descending: false},
	{key: 'added', label: 'Date Added', descending: true},
	{key: 'released', label: 'Release Date', descending: true},
	{key: 'rating', label: 'Rating', descending: true},
	{key: 'runtime', label: 'Runtime', descending: false}
];

export const sortByKey = (key) => PLAYLIST_SORTS.find((sort) => sort.key === key) || PLAYLIST_SORTS[0];

// An episode stands for its series on a poster: the series' poster and name, with which episode
// it is underneath. That is what the Series Watchlist needs, and it reads well in any playlist.
export const displayOf = (item) => {
	if (item?.Type === 'Episode' && item.SeriesId) {
		const number = `S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0}`;
		const useSeriesArt = Boolean(item.SeriesPrimaryImageTag);
		return {
			title: item.SeriesName || item.Name || '',
			subtitle: item.Name ? `${number} · ${item.Name}` : number,
			imageId: useSeriesArt ? item.SeriesId : (item.ImageTags?.Primary ? item.Id : null),
			imageTag: useSeriesArt ? item.SeriesPrimaryImageTag : item.ImageTags?.Primary
		};
	}
	return {
		title: item?.Name || '',
		subtitle: item?.ProductionYear ? String(item.ProductionYear) : '',
		imageId: item?.ImageTags?.Primary ? item.Id : null,
		imageTag: item?.ImageTags?.Primary
	};
};

const valueFor = (item, key) => {
	switch (key) {
		case 'name': {
			const base = item.Type === 'Episode' && item.SeriesName ? item.SeriesName : (item.SortName || item.Name || '');
			return String(base).toLowerCase();
		}
		case 'added': return item.DateCreated || null;
		case 'released': return item.PremiereDate || (item.ProductionYear ? String(item.ProductionYear) : null);
		case 'rating': return typeof item.CommunityRating === 'number' ? item.CommunityRating : null;
		case 'runtime': return item.RunTimeTicks || null;
		default: return null;
	}
};

const compare = (a, b) => {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a).localeCompare(String(b));
};

/**
 * The items in the order picked. Items missing the sorted value go last either way, and ties
 * keep their playlist order, so the list never jumps around between two equal titles.
 */
export const sortPlaylistItems = (items, key, descending) => {
	const list = (items || []).map((item, position) => ({item, position}));
	if (key === 'playlist' || !sortByKey(key) || key !== sortByKey(key).key) {
		const ordered = list.map((entry) => entry.item);
		return descending ? ordered.reverse() : ordered;
	}
	list.sort((x, y) => {
		const a = valueFor(x.item, key);
		const b = valueFor(y.item, key);
		if (a === null && b === null) return x.position - y.position;
		if (a === null) return 1;
		if (b === null) return -1;
		const result = compare(a, b);
		if (result !== 0) return descending ? -result : result;
		return x.position - y.position;
	});
	return list.map((entry) => entry.item);
};

// Posters suit a playlist of films and shows; songs keep the list.
export const autoView = (items) => ((items || []).length > 0 && items.every((item) => item.MediaType !== 'Audio') ? 'posters' : 'list');
