import {
	PLACE, parseArchiveInfo, readArchiveInfo, resetArchiveInfo, archiveExcludes, isShelfLibrary,
	withoutShelfLibraries, screensaverHiddenShelves, withoutArchivedForPerson, readArchiveStatus,
	canSeePlace, moveTitle
} from './archiveApi';

const SHELF = {Configured: true, CanView: true, CanManage: true};
const INFO = {
	Archive: {...SHELF, LibraryId: 'arch1', LibraryName: 'Archive', IncludeInPersonBrowse: true},
	SoftDelete: {...SHELF, LibraryId: 'bin1', LibraryName: 'Bin', IncludeInPersonBrowse: false}
};

const withShelf = (shelf, changes) => ({...INFO, [shelf]: {...INFO[shelf], ...changes}});

const fakeApi = ({info = INFO, infoFails = false, status, inShelf = {}, jobs = []} = {}) => {
	let poll = 0;
	return {
		getServerInfo: () => ({serverUrl: 'http://one', userId: 'user1'}),
		getArchiveInfo: jest.fn(() => (infoFails ? Promise.reject(Object.assign(new Error('404'), {status: 404})) : Promise.resolve(info))),
		getArchiveStatus: jest.fn(() => Promise.resolve(status)),
		getItems: jest.fn(({ParentId}) => Promise.resolve({Items: (inShelf[ParentId] || []).map((Id) => ({Id}))})),
		moveArchiveItem: jest.fn(() => Promise.resolve({Id: 'job1', State: 'Moving'})),
		getArchiveJob: jest.fn(() => Promise.resolve(jobs[Math.min(poll++, jobs.length - 1)]))
	};
};

beforeEach(() => resetArchiveInfo());

describe('parseArchiveInfo', () => {
	test('reads both shelves', () => {
		expect(parseArchiveInfo(INFO)).toEqual({
			Archive: {configured: true, libraryId: 'arch1', libraryName: 'Archive', canView: true, canManage: true, includeInPersonBrowse: true},
			SoftDelete: {configured: true, libraryId: 'bin1', libraryName: 'Bin', canView: true, canManage: true, includeInPersonBrowse: false}
		});
	});

	test('accepts camel case', () => {
		expect(parseArchiveInfo({softDelete: {configured: true, canManage: true}}).SoftDelete)
			.toMatchObject({configured: true, canManage: true, canView: false});
	});

	test('nothing means no shelves at all', () => {
		const info = parseArchiveInfo(null);
		expect(info.Archive).toMatchObject({configured: false, canView: false, canManage: false, libraryId: null});
		expect(info.SoftDelete).toMatchObject({configured: false, canView: false, canManage: false, libraryId: null});
	});
});

describe('readArchiveInfo', () => {
	test('asks once per server and user', async () => {
		const api = fakeApi();
		await readArchiveInfo(api);
		await readArchiveInfo(api);
		expect(api.getArchiveInfo).toHaveBeenCalledTimes(1);
	});

	test('a server without the plugin reads as no shelves', async () => {
		expect((await readArchiveInfo(fakeApi({infoFails: true}))).Archive.configured).toBe(false);
	});

	test('an api with no archive routes reads as no shelves', async () => {
		expect((await readArchiveInfo({})).SoftDelete.configured).toBe(false);
	});
});

describe('keeping shelves out', () => {
	test('a sweep leaves out every shelf this viewer can see', async () => {
		expect(await archiveExcludes(fakeApi())).toEqual(['arch1', 'bin1']);
	});

	test('a shelf closed to the viewer has nothing to leave out', async () => {
		const info = withShelf('SoftDelete', {CanView: false, LibraryId: null});
		expect(await archiveExcludes(fakeApi({info}))).toEqual(['arch1']);
	});

	test('compares library ids without dashes', () => {
		const info = parseArchiveInfo({Archive: {LibraryId: 'ab12'}});
		expect(isShelfLibrary(info, 'AB-12')).toBe(true);
		expect(isShelfLibrary(info, 'AB-12', [PLACE.SOFT_DELETE])).toBe(false);
	});

	test('the screensaver hides soft deleted titles always, and archived ones unless asked', () => {
		const info = parseArchiveInfo(INFO);
		const libraries = [{Id: 'movies1'}, {Id: 'arch1'}, {Id: 'bin1'}];
		expect(withoutShelfLibraries(libraries, info, screensaverHiddenShelves(false))).toEqual([{Id: 'movies1'}]);
		expect(withoutShelfLibraries(libraries, info, screensaverHiddenShelves(true))).toEqual([{Id: 'movies1'}, {Id: 'arch1'}]);
	});
});

describe('withoutArchivedForPerson', () => {
	const items = [{Id: 'm1'}, {Id: 'm2'}, {Id: 'm3'}, {Id: 'e1', SeriesId: 's1'}];

	test('drops titles from shelves kept off people, and episodes of shows on them', async () => {
		const api = fakeApi({inShelf: {arch1: ['m2'], bin1: ['m3', 's1']}});
		expect(await withoutArchivedForPerson(api, 'p1', items)).toEqual([{Id: 'm1'}, {Id: 'm2'}]);
		expect(api.getItems).toHaveBeenCalledTimes(1);
		expect(api.getItems).toHaveBeenCalledWith(expect.objectContaining({PersonIds: 'p1', ParentId: 'bin1'}));
	});

	test('asks nothing when every shelf is allowed on people', async () => {
		const api = fakeApi({info: withShelf('SoftDelete', {IncludeInPersonBrowse: true})});
		expect(await withoutArchivedForPerson(api, 'p1', items)).toEqual(items);
		expect(api.getItems).not.toHaveBeenCalled();
	});

	test('keeps everything when the ask fails', async () => {
		const api = fakeApi();
		api.getItems.mockImplementation(() => Promise.reject(new Error('boom')));
		expect(await withoutArchivedForPerson(api, 'p1', items)).toEqual(items);
	});
});

describe('readArchiveStatus', () => {
	test('reads where the title is and which buttons this viewer gets', async () => {
		const api = fakeApi({status: {Location: 'Archive', CanArchive: false, CanSoftDelete: true, CanRestore: true}});
		expect(await readArchiveStatus(api, {Id: 'm1', Type: 'Movie'})).toEqual({
			location: 'Archive', canArchive: false, canSoftDelete: true, canRestore: true, activeJob: null
		});
	});

	test('a soft delete button alone is enough to ask', async () => {
		const info = withShelf('Archive', {CanManage: false});
		const api = fakeApi({info, status: {Location: 'Library', CanSoftDelete: true}});
		expect((await readArchiveStatus(api, {Id: 'm1', Type: 'Movie'})).canSoftDelete).toBe(true);
	});

	test('asks nothing for somebody with no shelf button', async () => {
		const info = {Archive: {...INFO.Archive, CanManage: false}, SoftDelete: {...INFO.SoftDelete, CanManage: false}};
		const api = fakeApi({info});
		expect(await readArchiveStatus(api, {Id: 'm1', Type: 'Movie'})).toBeNull();
		expect(api.getArchiveStatus).not.toHaveBeenCalled();
	});

	test('asks nothing for what cannot be moved', async () => {
		const api = fakeApi();
		expect(await readArchiveStatus(api, {Id: 'e1', Type: 'Episode'})).toBeNull();
		expect(api.getArchiveStatus).not.toHaveBeenCalled();
	});
});

describe('canSeePlace', () => {
	test('a library is always open, a shelf only to its viewers', () => {
		const info = parseArchiveInfo(withShelf('SoftDelete', {CanView: false}));
		expect(canSeePlace(info, PLACE.LIBRARY)).toBe(true);
		expect(canSeePlace(info, PLACE.ARCHIVE)).toBe(true);
		expect(canSeePlace(info, PLACE.SOFT_DELETE)).toBe(false);
	});
});

describe('moveTitle', () => {
	test('follows the job until the title has its new id', async () => {
		const api = fakeApi({jobs: [{Id: 'job1', State: 'Scanning'}, {Id: 'job1', State: 'Done', NewItemId: 'm9'}]});
		expect(await moveTitle(api, 'm1', PLACE.SOFT_DELETE, {interval: 0})).toEqual({state: 'Done', newItemId: 'm9', error: null});
		expect(api.moveArchiveItem).toHaveBeenCalledWith('m1', 'SoftDelete');
	});

	test('passes the server reason on a failure', async () => {
		const api = fakeApi({jobs: [{Id: 'job1', State: 'Failed', Error: 'Something already exists where the title would go.'}]});
		expect(await moveTitle(api, 'm1', PLACE.LIBRARY, {interval: 0})).toMatchObject({state: 'Failed', error: 'Something already exists where the title would go.'});
	});

	test('stops following a job that runs too long', async () => {
		const api = fakeApi({jobs: [{Id: 'job1', State: 'Scanning'}]});
		expect((await moveTitle(api, 'm1', PLACE.ARCHIVE, {interval: 0, timeout: 5})).state).toBe('Running');
	});
});
