import {addToWatchlist, watchlistEntryFor} from './watchlistPlaylist';

const makeApi = ({playlists = [], playlistItems = {}, nextUp = [], episodes = []} = {}) => {
	const calls = {created: [], added: []};
	const api = {
		calls,
		getPlaylists: jest.fn(async () => ({Items: playlists})),
		getPlaylistItems: jest.fn(async (id) => ({Items: playlistItems[id] || []})),
		createPlaylist: jest.fn(async (name, ids) => { calls.created.push({name, ids}); return {Id: 'new'}; }),
		addToPlaylist: jest.fn(async (id, ids) => { calls.added.push({id, ids}); }),
		getNextUp: jest.fn(async () => ({Items: nextUp})),
		getItems: jest.fn(async () => ({Items: episodes}))
	};
	return api;
};

const film = {Id: 'm1', Name: 'Film', Type: 'Movie'};
const show = {Id: 's1', Name: 'Show', Type: 'Series'};
const ep = (id, season, number) => ({Id: id, Type: 'Episode', SeriesId: 's1', ParentIndexNumber: season, IndexNumber: number});

test('the first film creates the Watchlist playlist with it', async () => {
	const api = makeApi();
	expect((await addToWatchlist(api, film)).status).toBe('created');
	expect(api.calls.created).toEqual([{name: 'Watchlist', ids: ['m1']}]);
});

test('a film goes on the existing Watchlist, matched regardless of case', async () => {
	const api = makeApi({playlists: [{Id: 'p1', Name: 'watchlist'}]});
	expect((await addToWatchlist(api, film)).status).toBe('added');
	expect(api.calls.added).toEqual([{id: 'p1', ids: ['m1']}]);
});

test('a film already on the list is not added twice', async () => {
	const api = makeApi({playlists: [{Id: 'p1', Name: 'Watchlist'}], playlistItems: {p1: [{Id: 'm1'}]}});
	expect((await addToWatchlist(api, film)).status).toBe('already');
	expect(api.calls.added).toEqual([]);
});

test('a series goes on its own Series Watchlist, never on the film list', async () => {
	const api = makeApi({playlists: [{Id: 'p1', Name: 'Watchlist'}], episodes: [ep('e1', 1, 1)]});
	const result = await addToWatchlist(api, show);
	expect(result.status).toBe('created');
	expect(result.listName).toBe('Series Watchlist');
	expect(api.calls.created).toEqual([{name: 'Series Watchlist', ids: ['e1']}]);
});

test('a started series is represented by its next episode', async () => {
	const api = makeApi({nextUp: [ep('e5', 1, 5)]});
	expect((await watchlistEntryFor(api, show)).Id).toBe('e5');
});

test('an unstarted series is represented by its first regular episode, not a special', async () => {
	const api = makeApi({episodes: [ep('sp1', 0, 1), ep('e1', 1, 1)]});
	expect((await watchlistEntryFor(api, show)).Id).toBe('e1');
});

test('a series with any episode already on its list counts as already there', async () => {
	const api = makeApi({
		playlists: [{Id: 'p2', Name: 'Series Watchlist'}],
		playlistItems: {p2: [ep('e3', 1, 3)]},
		episodes: [ep('e1', 1, 1)]
	});
	expect((await addToWatchlist(api, show)).status).toBe('already');
	expect(api.calls.added).toEqual([]);
});

test('a series without episodes adds nothing', async () => {
	const api = makeApi();
	expect((await addToWatchlist(api, show)).status).toBe('nothing');
	expect(api.calls.created).toEqual([]);
});

describe('toggling', () => {
	const {toggleWatchlist, isOnWatchlist, watchlistTarget, watchlistMessage} = require('./watchlistPlaylist');
	const withRemove = (api) => {
		api.calls.removed = [];
		api.removeFromPlaylist = jest.fn(async (id, entryIds) => { api.calls.removed.push({id, entryIds}); });
		return api;
	};

	test('a film on the list comes off by its playlist entry', async () => {
		const api = withRemove(makeApi({playlists: [{Id: 'p1', Name: 'Watchlist'}], playlistItems: {p1: [{Id: 'm1', PlaylistItemId: 'x1'}, {Id: 'm2', PlaylistItemId: 'x2'}]}}));
		expect(await isOnWatchlist(api, film)).toBe(true);
		expect((await toggleWatchlist(api, film)).status).toBe('removed');
		expect(api.calls.removed).toEqual([{id: 'p1', entryIds: ['x1']}]);
	});

	test('a film not on the list goes on', async () => {
		const api = withRemove(makeApi({playlists: [{Id: 'p1', Name: 'Watchlist'}]}));
		expect((await toggleWatchlist(api, film)).status).toBe('added');
		expect(api.calls.removed).toEqual([]);
	});

	test('a series comes off with every episode standing in for it', async () => {
		const api = withRemove(makeApi({playlists: [{Id: 'p2', Name: 'Series Watchlist'}], playlistItems: {p2: [ep('e1', 1, 1), ep('e5', 1, 5)].map((e, i) => ({...e, PlaylistItemId: `y${i}`}))}}));
		expect((await toggleWatchlist(api, show)).status).toBe('removed');
		expect(api.calls.removed).toEqual([{id: 'p2', entryIds: ['y0', 'y1']}]);
	});

	test('an episode or season card stands for its series; other things have no watchlist', () => {
		expect(watchlistTarget({Id: 'e1', Type: 'Episode', SeriesId: 's1', SeriesName: 'Show'})).toEqual({Id: 's1', Type: 'Series', Name: 'Show'});
		expect(watchlistTarget(film)).toBe(film);
		expect(watchlistTarget({Id: 'a', Type: 'MusicAlbum'})).toBeNull();
	});

	test('messages name the list and the title', () => {
		expect(watchlistMessage({status: 'removed', listName: 'Watchlist'}, film)).toBe('Removed from Watchlist: Film');
		expect(watchlistMessage({status: 'added', listName: 'Series Watchlist', entry: {ParentIndexNumber: 1, IndexNumber: 3}}, show)).toBe('Added to Series Watchlist: Show (S1E3)');
	});
});
