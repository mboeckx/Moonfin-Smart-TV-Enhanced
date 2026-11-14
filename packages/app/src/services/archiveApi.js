// The Archive server plugin, as the app sees it.
//
// The plugin keeps two shelves, the archive and the soft delete library. Each is a library of its
// own on the server, titles moved there leave their library on disk, and the plugin opens each
// library only to the people the admin picked. Who may move titles onto a shelf is set apart from
// who may see it, so somebody can soft delete a title they will never see again.
//
// What's left for the app is to keep the shelves out of the rows that sweep the whole server and
// out of the screensaver, to offer the buttons that move a title, and to honour the admin's choice
// about shelved titles on a person's page.
//
// Everything here fails closed for the buttons and open for the rows: without the plugin there
// are no buttons, and the rows behave as they always did.

// Long enough that a screen of rows asks once, short enough that a new permission arrives without
// a restart.
const INFO_TTL_MS = 5 * 60 * 1000;
const JOB_POLL_MS = 1500;
const JOB_TIMEOUT_MS = 90 * 1000;

export const MOVABLE_TYPES = ['Movie', 'Series'];

// Where a title can be. These match the plugin's names.
export const PLACE = Object.freeze({LIBRARY: 'Library', ARCHIVE: 'Archive', SOFT_DELETE: 'SoftDelete'});
export const SHELVES = [PLACE.ARCHIVE, PLACE.SOFT_DELETE];

const sessions = new Map();

const identityOf = (api) => {
	const info = typeof api?.getServerInfo === 'function' ? api.getServerInfo() : null;
	return info ? `${info.serverUrl}|${info.userId}` : 'default';
};

export const resetArchiveInfo = () => sessions.clear();

// The server writes PascalCase, and either case is read.
const pick = (raw, key) => {
	if (!raw || typeof raw !== 'object') return undefined;
	return raw[key] !== undefined ? raw[key] : raw[key.charAt(0).toLowerCase() + key.slice(1)];
};

const NO_SHELF = Object.freeze({
	configured: false, libraryId: null, libraryName: null, canView: false, canManage: false, includeInPersonBrowse: false
});

const NO_SHELVES = Object.freeze({[PLACE.ARCHIVE]: NO_SHELF, [PLACE.SOFT_DELETE]: NO_SHELF});

const parseShelf = (raw) => {
	if (!raw || typeof raw !== 'object') return NO_SHELF;
	const libraryId = pick(raw, 'LibraryId');
	return {
		configured: pick(raw, 'Configured') === true,
		libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
		libraryName: typeof pick(raw, 'LibraryName') === 'string' ? pick(raw, 'LibraryName') : null,
		canView: pick(raw, 'CanView') === true,
		canManage: pick(raw, 'CanManage') === true,
		includeInPersonBrowse: pick(raw, 'IncludeInPersonBrowse') === true
	};
};

// Reads the plugin's answer into {Archive: shelf, SoftDelete: shelf}.
export const parseArchiveInfo = (raw) => ({
	[PLACE.ARCHIVE]: parseShelf(pick(raw, PLACE.ARCHIVE)),
	[PLACE.SOFT_DELETE]: parseShelf(pick(raw, PLACE.SOFT_DELETE))
});

// The shelves on this server and what this user may do with each. A server without the plugin
// answers once with nothing, and isn't asked again until the answer goes stale.
export const readArchiveInfo = (api) => {
	if (typeof api?.getArchiveInfo !== 'function') return Promise.resolve(NO_SHELVES);
	const key = identityOf(api);
	const cached = sessions.get(key);
	if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.promise;

	const promise = Promise.resolve()
		.then(() => api.getArchiveInfo())
		.then(parseArchiveInfo)
		.catch(() => NO_SHELVES);
	sessions.set(key, {at: Date.now(), promise});
	return promise;
};

// Library ids compare without their dashes, since the server writes them both ways.
const bare = (id) => String(id || '').replace(/-/g, '').toLowerCase();

const shelfLibraryIds = (info, shelves = SHELVES) =>
	shelves.map((shelf) => info?.[shelf]?.libraryId).filter(Boolean);

export const isShelfLibrary = (info, libraryId, shelves = SHELVES) =>
	shelfLibraryIds(info, shelves).some((id) => bare(id) === bare(libraryId));

// The shelf library ids a sweep of the whole server should leave out. Only the shelves this user
// can see have ids to give; the server keeps the rest away already.
export const archiveExcludes = async (api) => shelfLibraryIds(await readArchiveInfo(api));

// A list of libraries without the shelves in it.
export const withoutShelfLibraries = (libraries, info, shelves = SHELVES) =>
	(Array.isArray(libraries) ? libraries : []).filter((library) => !isShelfLibrary(info, library?.Id, shelves));

// Which shelves the screensaver leaves out: soft deleted titles always, archived ones unless the
// viewer asked for them.
export const screensaverHiddenShelves = (includeArchive) =>
	(includeArchive ? [PLACE.SOFT_DELETE] : SHELVES);

// A person's titles without those on shelves the admin keeps off people's pages. Asking each such
// shelf for that person's titles finds exactly which to drop. Should that ask fail, the titles stay
// rather than the page losing its titles.
export const withoutArchivedForPerson = async (api, personId, items) => {
	const list = Array.isArray(items) ? items : [];
	if (!list.length || typeof api?.getItems !== 'function') return list;
	const info = await readArchiveInfo(api);
	const hidden = SHELVES.filter((shelf) => info[shelf].libraryId && !info[shelf].includeInPersonBrowse);
	if (!hidden.length) return list;

	try {
		const answers = await Promise.all(hidden.map((shelf) => api.getItems({
			PersonIds: personId,
			ParentId: info[shelf].libraryId,
			Recursive: true,
			IncludeItemTypes: 'Movie,Series,Episode,MusicVideo',
			Limit: 500
		})));
		const drop = new Set([].concat(...answers.map((answer) => answer?.Items || [])).map((item) => item.Id));
		if (!drop.size) return list;
		return list.filter((item) => !drop.has(item.Id) && !(item.SeriesId && drop.has(item.SeriesId)));
	} catch (e) {
		return list;
	}
};

// Where a title is and where this viewer may move it. Null without the plugin, for anything the
// plugin can't move, and for somebody with no shelf button at all.
export const readArchiveStatus = async (api, item) => {
	if (!item?.Id || MOVABLE_TYPES.indexOf(item.Type) < 0) return null;
	if (typeof api?.getArchiveStatus !== 'function') return null;
	const info = await readArchiveInfo(api);
	if (!SHELVES.some((shelf) => info[shelf].configured && info[shelf].canManage)) return null;

	try {
		const raw = await api.getArchiveStatus(item.Id);
		if (!raw) return null;
		const location = pick(raw, 'Location');
		return {
			location: SHELVES.indexOf(location) >= 0 ? location : PLACE.LIBRARY,
			canArchive: pick(raw, 'CanArchive') === true,
			canSoftDelete: pick(raw, 'CanSoftDelete') === true,
			canRestore: pick(raw, 'CanRestore') === true,
			activeJob: pick(raw, 'ActiveJob') || null
		};
	} catch (e) {
		return null;
	}
};

// Whether the viewer can open a title once it's in `place`. Back in a library, always.
export const canSeePlace = (info, place) => place === PLACE.LIBRARY || Boolean(info?.[place]?.canView);

export const jobState = (job) => String(pick(job, 'State') || '');
export const jobFinished = (job) => ['Done', 'DoneNotScanned', 'Failed'].indexOf(jobState(job)) >= 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Moves a title to `to` (one of PLACE) and waits for the server to finish, which includes scanning
// it in under its new path. Resolves with {state, newItemId, error}.
export const moveTitle = async (api, itemId, to, {
	interval = JOB_POLL_MS, timeout = JOB_TIMEOUT_MS, isCancelled = () => false
} = {}) => {
	let job = await api.moveArchiveItem(itemId, to);
	const started = Date.now();
	while (!jobFinished(job) && Date.now() - started < timeout && !isCancelled()) {
		await wait(interval);
		if (isCancelled()) break;
		try {
			job = await api.getArchiveJob(pick(job, 'Id'));
		} catch (e) {
			// One missed poll is no reason to give up on a move that is still running.
		}
	}

	return {
		state: jobFinished(job) ? jobState(job) : 'Running',
		newItemId: pick(job, 'NewItemId') || null,
		error: pick(job, 'Error') || null
	};
};
