// The Archive server plugin, as the app sees it.
//
// The archive is a library of its own on the server. Titles moved there leave their library on
// disk, so the library they came from no longer lists them, and the plugin opens the archive
// library only to the people the admin picked. What's left for the app is to keep the archive out
// of the rows that sweep the whole server, to offer the button that moves a title, and to honour
// the admin's choice about archived titles on a person's page.
//
// Everything here fails closed for the button and open for the rows: without the plugin there is
// no button, and the rows behave as they always did.

// Long enough that a screen of rows asks once, short enough that a new permission arrives without
// a restart.
const INFO_TTL_MS = 5 * 60 * 1000;
const JOB_POLL_MS = 1500;
const JOB_TIMEOUT_MS = 90 * 1000;

export const MOVABLE_TYPES = ['Movie', 'Series'];

const sessions = new Map();

const identityOf = (api) => {
	const info = typeof api?.getServerInfo === 'function' ? api.getServerInfo() : null;
	return info ? `${info.serverUrl}|${info.userId}` : 'default';
};

export const resetArchiveInfo = () => sessions.clear();

const NO_ARCHIVE = Object.freeze({
	configured: false, archiveLibraryId: null, archiveLibraryName: null,
	canView: false, canManage: false, includeInPersonBrowse: true
});

// Reads the plugin's answer into the shape the app uses, tolerating either casing.
export const parseArchiveInfo = (raw) => {
	if (!raw || typeof raw !== 'object') return NO_ARCHIVE;
	const pick = (key) => (raw[key] !== undefined ? raw[key] : raw[key.charAt(0).toLowerCase() + key.slice(1)]);
	const libraryId = pick('ArchiveLibraryId');
	return {
		configured: pick('Configured') === true,
		archiveLibraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
		archiveLibraryName: typeof pick('ArchiveLibraryName') === 'string' ? pick('ArchiveLibraryName') : null,
		canView: pick('CanView') === true,
		canManage: pick('CanManage') === true,
		includeInPersonBrowse: pick('IncludeInPersonBrowse') !== false
	};
};

// What the archive is for this server and user. A server without the plugin answers once with
// nothing, and isn't asked again until the answer goes stale.
export const readArchiveInfo = (api) => {
	if (typeof api?.getArchiveInfo !== 'function') return Promise.resolve(NO_ARCHIVE);
	const key = identityOf(api);
	const cached = sessions.get(key);
	if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.promise;

	const promise = Promise.resolve()
		.then(() => api.getArchiveInfo())
		.then(parseArchiveInfo)
		.catch(() => NO_ARCHIVE);
	sessions.set(key, {at: Date.now(), promise});
	return promise;
};

// Library ids compare without their dashes, since the server writes them both ways.
const bare = (id) => String(id || '').replace(/-/g, '').toLowerCase();

export const isArchiveLibrary = (info, libraryId) =>
	Boolean(info?.archiveLibraryId) && bare(info.archiveLibraryId) === bare(libraryId);

// The archive library id, when a sweep of the whole server should leave it out.
export const archiveExcludes = async (api) => {
	const info = await readArchiveInfo(api);
	return info.archiveLibraryId ? [info.archiveLibraryId] : [];
};

// A person's titles without the archived ones, when the admin keeps the archive off people's
// pages. Asking the archive library for that person's titles finds exactly which to drop. Should
// that ask fail, the archived titles stay rather than the page losing its titles.
export const withoutArchivedForPerson = async (api, personId, items) => {
	const list = Array.isArray(items) ? items : [];
	if (!list.length || typeof api?.getItems !== 'function') return list;
	const info = await readArchiveInfo(api);
	if (!info.archiveLibraryId || info.includeInPersonBrowse) return list;

	try {
		const archived = await api.getItems({
			PersonIds: personId,
			ParentId: info.archiveLibraryId,
			Recursive: true,
			IncludeItemTypes: 'Movie,Series,Episode,MusicVideo',
			Limit: 500
		});
		const drop = new Set((archived?.Items || []).map((item) => item.Id));
		if (!drop.size) return list;
		return list.filter((item) => !drop.has(item.Id) && !(item.SeriesId && drop.has(item.SeriesId)));
	} catch (e) {
		return list;
	}
};

// Whether a title is archived and what this viewer may do with it. Null without the plugin, or
// for anything the plugin can't move.
export const readArchiveStatus = async (api, item) => {
	if (!item?.Id || MOVABLE_TYPES.indexOf(item.Type) < 0) return null;
	if (typeof api?.getArchiveStatus !== 'function') return null;
	const info = await readArchiveInfo(api);
	if (!info.configured || !info.canManage) return null;

	try {
		const raw = await api.getArchiveStatus(item.Id);
		if (!raw) return null;
		const pick = (key) => (raw[key] !== undefined ? raw[key] : raw[key.charAt(0).toLowerCase() + key.slice(1)]);
		return {
			isArchived: pick('IsArchived') === true,
			canArchive: pick('CanArchive') === true,
			canRestore: pick('CanRestore') === true,
			activeJob: pick('ActiveJob') || null
		};
	} catch (e) {
		return null;
	}
};

const jobField = (job, key) => (job?.[key] !== undefined ? job[key] : job?.[key.charAt(0).toLowerCase() + key.slice(1)]);

export const jobState = (job) => String(jobField(job, 'State') || '');
export const jobFinished = (job) => ['Done', 'DoneNotScanned', 'Failed'].indexOf(jobState(job)) >= 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Moves a title into or out of the archive and waits for the server to finish, which includes
// scanning it in under its new path. Resolves with {state, newItemId, error}.
export const moveTitle = async (api, itemId, toArchive, {
	interval = JOB_POLL_MS, timeout = JOB_TIMEOUT_MS, isCancelled = () => false
} = {}) => {
	let job = await api.moveArchiveItem(itemId, toArchive);
	const started = Date.now();
	while (!jobFinished(job) && Date.now() - started < timeout && !isCancelled()) {
		await wait(interval);
		if (isCancelled()) break;
		try {
			job = await api.getArchiveJob(jobField(job, 'Id'));
		} catch (e) {
			// One missed poll is no reason to give up on a move that is still running.
		}
	}

	return {
		state: jobFinished(job) ? jobState(job) : 'Running',
		newItemId: jobField(job, 'NewItemId') || null,
		error: jobField(job, 'Error') || null
	};
};
