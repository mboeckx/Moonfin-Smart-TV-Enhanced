import {noteLibraryFilterKey, resetLibraryFilters} from './libraryFilterReset';
import {getAllKeys, getFromStorage, removeFromStorage, saveToStorage} from './storage';

const mockStore = new Map();
jest.mock('./storage', () => ({
	getAllKeys: jest.fn(),
	getFromStorage: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
	saveToStorage: jest.fn(async (key, value) => { mockStore.set(key, value); return true; }),
	removeFromStorage: jest.fn(async (key) => { mockStore.delete(key); return true; })
}));

beforeEach(() => {
	mockStore.clear();
	getFromStorage.mockImplementation(async (key) => (mockStore.has(key) ? mockStore.get(key) : null));
	saveToStorage.mockImplementation(async (key, value) => { mockStore.set(key, value); return true; });
	removeFromStorage.mockImplementation(async (key) => { mockStore.delete(key); return true; });
});

test('only the saved library filters are cleared', async () => {
	['library_filters_abc', 'library_filters_abc_songs', 'library_sortKey_abc', 'playlist_view_x'].forEach((key) => mockStore.set(key, 1));
	getAllKeys.mockResolvedValue([...mockStore.keys()]);
	await resetLibraryFilters();
	expect([...mockStore.keys()]).toEqual(['library_sortKey_abc', 'playlist_view_x']);
});

test('a storage that cannot list keys still clears the filters it was told about', async () => {
	getAllKeys.mockImplementation(() => { throw new TypeError('not supported'); });
	mockStore.set('library_filters_abc', {favoritesOnly: true});
	mockStore.set('library_sortKey_abc', 'SortName');
	await noteLibraryFilterKey('library_filters_abc');
	await noteLibraryFilterKey('library_filters_abc');
	expect(mockStore.get('library_filter_keys')).toEqual(['library_filters_abc']);
	await resetLibraryFilters();
	expect([...mockStore.keys()]).toEqual(['library_sortKey_abc']);
});

test('other keys are never noted', async () => {
	await noteLibraryFilterKey('library_sortKey_abc');
	expect(mockStore.has('library_filter_keys')).toBe(false);
});
