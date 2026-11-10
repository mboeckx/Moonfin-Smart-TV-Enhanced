import {
	permittedLibraryIds, retainPermitted, visibleLibraryIds, searchLibraries, scopedGetItems,
	resetLibraryScope
} from './libraryScope';
import {resetArchiveInfo} from './archiveApi';

const POLICY_OPEN = {EnableAllFolders: true};
const POLICY_CLOSED = {EnableAllFolders: false, EnabledFolders: ['movies1', 'shows1']};

const VIEWS = {
	Items: [
		{Id: 'movies1', CollectionType: 'movies'},
		{Id: 'shows1', CollectionType: 'tvshows'},
		{Id: 'music1', CollectionType: 'music'}
	]
};

const fakeApi = ({policy = POLICY_OPEN, excludes = [], items} = {}) => ({
	getServerInfo: () => ({serverUrl: 'http://one', userId: 'user1'}),
	getUserConfiguration: jest.fn(() => Promise.resolve({
		Policy: policy,
		Configuration: {MyMediaExcludes: excludes}
	})),
	getLibraries: jest.fn(() => Promise.resolve(VIEWS)),
	getItems: jest.fn((params) => Promise.resolve(
		items ? items(params) : {Items: [{Name: params.ParentId || 'sweep'}], TotalRecordCount: 1}
	))
});

beforeEach(() => {
	resetLibraryScope();
	resetArchiveInfo();
});

describe('the archive library', () => {
	const withArchive = (api, archiveLibraryId) => ({
		...api,
		getArchiveInfo: () => Promise.resolve({Configured: true, CanView: true, ArchiveLibraryId: archiveLibraryId})
	});

	test('is left out of a sweep even with nothing hidden', async () => {
		expect(await visibleLibraryIds(withArchive(fakeApi(), 'music1'))).toEqual(['movies1', 'shows1']);
	});

	test('changes nothing for somebody the archive is closed to', async () => {
		expect(await visibleLibraryIds(withArchive(fakeApi(), null))).toBeNull();
	});
});

describe('permittedLibraryIds', () => {
	test('is null when the policy allows every folder', async () => {
		expect(await permittedLibraryIds(fakeApi())).toBeNull();
	});

	test('is the allowed set when the policy restricts folders', async () => {
		expect(await permittedLibraryIds(fakeApi({policy: POLICY_CLOSED}))).toEqual(['movies1', 'shows1']);
	});

	test('reads the user once and keeps it', async () => {
		const api = fakeApi({policy: POLICY_CLOSED});
		await permittedLibraryIds(api);
		await permittedLibraryIds(api);
		await visibleLibraryIds(api, 'Movie');
		expect(api.getUserConfiguration).toHaveBeenCalledTimes(1);
	});

	test('is null when the user cannot be read', async () => {
		const api = fakeApi();
		api.getUserConfiguration = jest.fn(() => Promise.reject(new Error('gone')));
		expect(await permittedLibraryIds(api)).toBeNull();
	});

	test('reading again after a reset asks the server again', async () => {
		const api = fakeApi();
		await permittedLibraryIds(api);
		resetLibraryScope();
		await permittedLibraryIds(api);
		expect(api.getUserConfiguration).toHaveBeenCalledTimes(2);
	});
});

describe('visibleLibraryIds', () => {
	test('is null when the user has hidden nothing, without asking for the views', async () => {
		const api = fakeApi();
		expect(await visibleLibraryIds(api, 'Movie')).toBeNull();
		expect(api.getLibraries).not.toHaveBeenCalled();
	});

	test('narrows to the libraries that can hold the type', async () => {
		expect(await visibleLibraryIds(fakeApi({excludes: ['music1']}), 'Movie')).toEqual(['movies1']);
	});

	test('leaves out a library the policy does not permit', async () => {
		const api = fakeApi({policy: {EnableAllFolders: false, EnabledFolders: ['shows1']}, excludes: ['music1']});
		expect(await visibleLibraryIds(api, 'Series')).toEqual(['shows1']);
	});

	test('falls back to a sweep when the views cannot be read', async () => {
		const api = fakeApi({excludes: ['music1']});
		api.getLibraries = jest.fn(() => Promise.reject(new Error('gone')));
		expect(await visibleLibraryIds(api, 'Movie')).toBeNull();
	});

	test('reads the views once across several rows', async () => {
		const api = fakeApi({excludes: ['music1']});
		await visibleLibraryIds(api, 'Movie');
		await visibleLibraryIds(api, 'Series');
		expect(api.getLibraries).toHaveBeenCalledTimes(1);
	});
});

describe('searchLibraries', () => {
	test('sweeps once when there is nothing to narrow to', async () => {
		const search = jest.fn(() => Promise.resolve({Items: []}));
		expect(await searchLibraries(null, search)).toHaveLength(1);
		expect(search).toHaveBeenCalledWith(null);
	});

	test('asks each library', async () => {
		const search = jest.fn((id) => Promise.resolve({Items: [{Name: id}]}));
		const responses = await searchLibraries(['a', 'b'], search);
		expect(responses.map((r) => r.Items[0].Name)).toEqual(['a', 'b']);
	});

	test('one library failing does not take the row down', async () => {
		const search = jest.fn((id) => (id === 'a'
			? Promise.reject(new Error('denied'))
			: Promise.resolve({Items: [{Name: id}]})));
		const responses = await searchLibraries(['a', 'b'], search);
		expect(responses).toHaveLength(1);
		expect(responses[0].Items[0].Name).toBe('b');
	});
});

describe('scopedGetItems', () => {
	test('sweeps once when nothing is hidden', async () => {
		const api = fakeApi();
		const result = await scopedGetItems(api, {IncludeItemTypes: 'Movie', Recursive: true});
		expect(api.getItems).toHaveBeenCalledTimes(1);
		expect(api.getItems.mock.calls[0][0].ParentId).toBeUndefined();
		expect(result.Items).toHaveLength(1);
	});

	test('asks each visible library and merges the answers', async () => {
		const api = fakeApi({excludes: ['music1']});
		const result = await scopedGetItems(api, {IncludeItemTypes: 'Movie,Series', Recursive: true});

		expect(api.getItems).toHaveBeenCalledTimes(2);
		expect(result.Items.map((i) => i.Name).sort()).toEqual(['movies1', 'shows1']);
		expect(result.TotalRecordCount).toBe(2);
	});

	test('re-sorts and cuts the merged list back to one row worth', async () => {
		const api = fakeApi({
			excludes: ['music1'],
			items: (params) => ({
				Items: params.ParentId === 'movies1'
					? [{Name: 'b'}, {Name: 'd'}]
					: [{Name: 'a'}, {Name: 'c'}],
				TotalRecordCount: 2
			})
		});
		const result = await scopedGetItems(api, {
			IncludeItemTypes: 'Movie,Series', SortBy: 'SortName', SortOrder: 'Ascending', Limit: 3
		});
		expect(result.Items.map((i) => i.Name)).toEqual(['a', 'b', 'c']);
	});

	// Already scoped, or counting on the server to page, so it goes through untouched.
	test('a query that names a parent is passed straight through', async () => {
		const api = fakeApi({excludes: ['music1']});
		await scopedGetItems(api, {ParentId: 'shows1', IncludeItemTypes: 'Series'});
		expect(api.getItems).toHaveBeenCalledTimes(1);
		expect(api.getItems.mock.calls[0][0].ParentId).toBe('shows1');
	});

	test('a query that is paging is passed straight through', async () => {
		const api = fakeApi({excludes: ['music1']});
		await scopedGetItems(api, {IncludeItemTypes: 'Movie', StartIndex: 50});
		expect(api.getItems).toHaveBeenCalledTimes(1);
	});

	test('a caller can hand in the call to make', async () => {
		const api = fakeApi({excludes: ['music1']});
		const via = jest.fn(() => Promise.resolve({Items: [], TotalRecordCount: 0}));
		await scopedGetItems(api, {IncludeItemTypes: 'Movie'}, {via});
		expect(via).toHaveBeenCalled();
		expect(api.getItems).not.toHaveBeenCalled();
	});

	// The recommendation tests hand in an api carrying only getItems, which has to keep working.
	test('an api that cannot answer sweeps once rather than failing', async () => {
		const bare = {getItems: jest.fn(() => Promise.resolve({Items: []}))};
		await scopedGetItems(bare, {IncludeItemTypes: 'Movie'});
		expect(bare.getItems).toHaveBeenCalledTimes(1);
		expect(bare.getItems.mock.calls[0][0].ParentId).toBeUndefined();
	});
});

describe('retainPermitted', () => {
	test('keeps everything when the policy places no restriction', async () => {
		expect(await retainPermitted(fakeApi(), ['a', 'b'])).toEqual(['a', 'b']);
	});

	test('drops ids a stored preference still names', async () => {
		const api = fakeApi({policy: POLICY_CLOSED});
		expect(await retainPermitted(api, ['movies1', 'gone'])).toEqual(['movies1']);
	});
});
