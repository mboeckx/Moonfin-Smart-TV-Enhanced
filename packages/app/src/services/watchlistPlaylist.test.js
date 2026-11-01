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
