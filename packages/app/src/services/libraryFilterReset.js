// Patched: library filters last only while the viewer stays in the library. Upstream keeps them
// for good, per library; here reaching the home screen clears them, so a library opened from
// home starts unfiltered while a details page and back keeps them.
//
// Not every platform's storage can list its keys, so the filter keys that were written are also
// noted in a list of their own.

import {getAllKeys, getFromStorage, removeFromStorage, saveToStorage} from './storage';

const FILTER_KEY_PREFIX = 'library_filters_';
const REGISTRY_KEY = 'library_filter_keys';

let pendingNote = Promise.resolve();

export const noteLibraryFilterKey = (key) => {
	if (!key || !key.startsWith(FILTER_KEY_PREFIX)) return pendingNote;
	pendingNote = pendingNote.then(async () => {
		const known = (await getFromStorage(REGISTRY_KEY)) || [];
		if (Array.isArray(known) && known.includes(key)) return;
		await saveToStorage(REGISTRY_KEY, [...(Array.isArray(known) ? known : []), key]);
	}).catch(() => {});
	return pendingNote;
};

const listedFilterKeys = async () => {
	try {
		const keys = (await getAllKeys()) || [];
		return keys.filter((key) => typeof key === 'string' && key.startsWith(FILTER_KEY_PREFIX));
	} catch {
		return [];
	}
};

export const resetLibraryFilters = async () => {
	await pendingNote;
	try {
		const known = (await getFromStorage(REGISTRY_KEY)) || [];
		const keys = new Set([...(Array.isArray(known) ? known : []), ...(await listedFilterKeys())]);
		await Promise.all([...keys].map((key) => removeFromStorage(key)));
		if (known.length) await removeFromStorage(REGISTRY_KEY);
	} catch (err) {
		console.warn('[Library] could not clear saved filters:', err);
	}
};
