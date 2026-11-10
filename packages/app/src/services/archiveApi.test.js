import {
	parseArchiveInfo, readArchiveInfo, resetArchiveInfo, archiveExcludes, isArchiveLibrary,
	withoutArchivedForPerson, readArchiveStatus, moveTitle
} from './archiveApi';

const INFO = {
	Configured: true, ArchiveLibraryId: 'arch1', ArchiveLibraryName: 'Archive',
	CanView: true, CanManage: true, IncludeInPersonBrowse: true
};

const fakeApi = ({info = INFO, infoFails = false, status, archivedForPerson = [], jobs = []} = {}) => {
	let poll = 0;
	return {
		getServerInfo: () => ({serverUrl: 'http://one', userId: 'user1'}),
		getArchiveInfo: jest.fn(() => (infoFails ? Promise.reject(Object.assign(new Error('404'), {status: 404})) : Promise.resolve(info))),
		getArchiveStatus: jest.fn(() => Promise.resolve(status)),
		getItems: jest.fn(() => Promise.resolve({Items: archivedForPerson.map((Id) => ({Id}))})),
		moveArchiveItem: jest.fn(() => Promise.resolve({Id: 'job1', State: 'Moving'})),
		getArchiveJob: jest.fn(() => Promise.resolve(jobs[Math.min(poll++, jobs.length - 1)]))
	};
};

beforeEach(() => resetArchiveInfo());

describe('parseArchiveInfo', () => {
	test('reads the server answer', () => {
		expect(parseArchiveInfo(INFO)).toEqual({
			configured: true, archiveLibraryId: 'arch1', archiveLibraryName: 'Archive',
			canView: true, canManage: true, includeInPersonBrowse: true
		});
	});

	test('accepts camel case', () => {
		expect(parseArchiveInfo({configured: true, canManage: true, includeInPersonBrowse: false}))
			.toMatchObject({configured: true, canManage: true, includeInPersonBrowse: false});
	});

	test('nothing means no archive at all', () => {
		expect(parseArchiveInfo(null)).toMatchObject({configured: false, canView: false, canManage: false, archiveLibraryId: null});
	});
});

describe('readArchiveInfo', () => {
	test('asks once per server and user', async () => {
		const api = fakeApi();
		await readArchiveInfo(api);
		await readArchiveInfo(api);
		expect(api.getArchiveInfo).toHaveBeenCalledTimes(1);
	});

	test('a server without the plugin reads as no archive', async () => {
		expect((await readArchiveInfo(fakeApi({infoFails: true}))).configured).toBe(false);
	});

	test('an api with no archive routes reads as no archive', async () => {
		expect((await readArchiveInfo({})).configured).toBe(false);
	});
});

describe('archiveExcludes', () => {
	test('leaves the archive out of sweeps for somebody who can see it', async () => {
		expect(await archiveExcludes(fakeApi())).toEqual(['arch1']);
	});

	test('has nothing to leave out for somebody who cannot', async () => {
		expect(await archiveExcludes(fakeApi({info: {...INFO, CanView: false, ArchiveLibraryId: null}}))).toEqual([]);
	});

	test('compares library ids without dashes', () => {
		expect(isArchiveLibrary({archiveLibraryId: 'ab12'}, 'AB-12')).toBe(true);
		expect(isArchiveLibrary({archiveLibraryId: null}, 'ab12')).toBe(false);
	});
});

describe('withoutArchivedForPerson', () => {
	const items = [{Id: 'm1'}, {Id: 'm2'}, {Id: 'e1', SeriesId: 's1'}];

	test('keeps everything when the admin lets archived titles show on people', async () => {
		const api = fakeApi({archivedForPerson: ['m2']});
		expect(await withoutArchivedForPerson(api, 'p1', items)).toEqual(items);
		expect(api.getItems).not.toHaveBeenCalled();
	});

	test('drops archived titles, and episodes of archived shows, when the admin keeps them off', async () => {
		const api = fakeApi({info: {...INFO, IncludeInPersonBrowse: false}, archivedForPerson: ['m2', 's1']});
		expect(await withoutArchivedForPerson(api, 'p1', items)).toEqual([{Id: 'm1'}]);
		expect(api.getItems).toHaveBeenCalledWith(expect.objectContaining({PersonIds: 'p1', ParentId: 'arch1'}));
	});

	test('keeps everything when the ask fails', async () => {
		const api = fakeApi({info: {...INFO, IncludeInPersonBrowse: false}});
		api.getItems.mockImplementation(() => Promise.reject(new Error('boom')));
		expect(await withoutArchivedForPerson(api, 'p1', items)).toEqual(items);
	});
});

describe('readArchiveStatus', () => {
	test('offers a manager the move', async () => {
		const api = fakeApi({status: {IsArchived: false, CanArchive: true, CanRestore: false}});
		expect(await readArchiveStatus(api, {Id: 'm1', Type: 'Movie'})).toEqual({
			isArchived: false, canArchive: true, canRestore: false, activeJob: null
		});
	});

	test('asks nothing for somebody who may not move titles', async () => {
		const api = fakeApi({info: {...INFO, CanManage: false}});
		expect(await readArchiveStatus(api, {Id: 'm1', Type: 'Movie'})).toBeNull();
		expect(api.getArchiveStatus).not.toHaveBeenCalled();
	});

	test('asks nothing for what cannot be archived', async () => {
		const api = fakeApi();
		expect(await readArchiveStatus(api, {Id: 'e1', Type: 'Episode'})).toBeNull();
		expect(api.getArchiveStatus).not.toHaveBeenCalled();
	});
});

describe('moveTitle', () => {
	test('follows the job until the title has its new id', async () => {
		const api = fakeApi({jobs: [{Id: 'job1', State: 'Scanning'}, {Id: 'job1', State: 'Done', NewItemId: 'm9'}]});
		expect(await moveTitle(api, 'm1', true, {interval: 0})).toEqual({state: 'Done', newItemId: 'm9', error: null});
		expect(api.moveArchiveItem).toHaveBeenCalledWith('m1', true);
	});

	test('passes the server reason on a failure', async () => {
		const api = fakeApi({jobs: [{Id: 'job1', State: 'Failed', Error: 'Something already exists where the title would go.'}]});
		expect(await moveTitle(api, 'm1', false, {interval: 0})).toMatchObject({state: 'Failed', error: 'Something already exists where the title would go.'});
	});

	test('stops following a job that runs too long', async () => {
		const api = fakeApi({jobs: [{Id: 'job1', State: 'Scanning'}]});
		expect((await moveTitle(api, 'm1', true, {interval: 0, timeout: 5})).state).toBe('Running');
	});
});
