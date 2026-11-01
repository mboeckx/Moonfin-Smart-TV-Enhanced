import {autoView, displayOf, sortPlaylistItems} from './playlistView';

const items = [
	{Id: 'a', Name: 'Zodiac', SortName: 'zodiac', DateCreated: '2024-01-01', ProductionYear: 2007, CommunityRating: 7.7, RunTimeTicks: 900},
	{Id: 'b', Name: 'The Abyss', SortName: 'abyss', DateCreated: '2026-05-01', PremiereDate: '1989-08-09', CommunityRating: 7.5, RunTimeTicks: 800},
	{Id: 'c', Name: 'Episode 3', Type: 'Episode', SeriesId: 's', SeriesName: 'Mad Men', ParentIndexNumber: 2, IndexNumber: 3, DateCreated: '2025-01-01', RunTimeTicks: 300},
	{Id: 'd', Name: 'Unrated', SortName: 'unrated', RunTimeTicks: 500}
];
const ids = (list) => list.map((item) => item.Id).join('');

test('playlist order is kept, and descending reverses it', () => {
	expect(ids(sortPlaylistItems(items, 'playlist', false))).toBe('abcd');
	expect(ids(sortPlaylistItems(items, 'playlist', true))).toBe('dcba');
});

test('title sorts on sort names, and an episode on its series name', () => {
	expect(ids(sortPlaylistItems(items, 'name', false))).toBe('bcda');
});

test('date added, newest first by default, missing dates last', () => {
	expect(ids(sortPlaylistItems(items, 'added', true))).toBe('bcad');
	expect(ids(sortPlaylistItems(items, 'added', false))).toBe('acbd');
});

test('release date reads premiere dates and plain years alike', () => {
	expect(ids(sortPlaylistItems(items, 'released', true))).toBe('abcd');
});

test('rating puts unrated titles last in both directions', () => {
	expect(ids(sortPlaylistItems(items, 'rating', true))).toBe('abcd');
	expect(ids(sortPlaylistItems(items, 'rating', false))).toBe('bacd');
});

test('runtime sorts numerically', () => {
	expect(ids(sortPlaylistItems(items, 'runtime', false))).toBe('cdba');
});

test('sorting leaves the playlist itself untouched', () => {
	const copy = [...items];
	sortPlaylistItems(items, 'name', true);
	expect(items).toEqual(copy);
});

test('an episode shows as its series, with which episode underneath', () => {
	expect(displayOf({...items[2], SeriesPrimaryImageTag: 'sp'})).toEqual({title: 'Mad Men', subtitle: 'S2E3 · Episode 3', imageId: 's', imageTag: 'sp'});
	expect(displayOf({Id: 'm', Name: 'Film', ProductionYear: 2001, ImageTags: {Primary: 'p'}})).toEqual({title: 'Film', subtitle: '2001', imageId: 'm', imageTag: 'p'});
});

test('posters for films and shows, the list for songs', () => {
	expect(autoView([{MediaType: 'Video'}])).toBe('posters');
	expect(autoView([{MediaType: 'Video'}, {MediaType: 'Audio'}])).toBe('list');
	expect(autoView([])).toBe('list');
});
