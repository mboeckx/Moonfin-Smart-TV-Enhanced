// Patched: how the playlist screen's poster view shows its items. Sorting and filtering are
// upstream's (utils/playlistSortFilter).

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

// Posters suit a playlist of films and shows; songs keep the list.
export const autoView = (items) => ((items || []).length > 0 && items.every((item) => item.MediaType !== 'Audio') ? 'posters' : 'list');
