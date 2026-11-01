import {clearLibraryStates, forgetLibraryItem, getLibraryState, noteVisitedItem, saveLibraryState, takeVisitedItems} from './libraryReturnState';

const snapshot = () => ({
	hasItems: true,
	allItems: [{Id: 'a'}, {Id: 'b'}, {Id: 'c'}],
	totalCount: 3,
	apiFetchIndex: 3,
	startLetter: 'M',
	focusedId: 'b'
});

afterEach(() => clearLibraryStates());

test('a saved library comes back under its key and no other', () => {
	saveLibraryState('movies', snapshot());
	expect(getLibraryState('movies').startLetter).toBe('M');
	expect(getLibraryState('shows')).toBeNull();
});

test('clearing drops every library', () => {
	saveLibraryState('movies', snapshot());
	saveLibraryState('shows', snapshot());
	clearLibraryStates();
	expect(getLibraryState('movies')).toBeNull();
	expect(getLibraryState('shows')).toBeNull();
});

test('a deleted title leaves the remembered grid and its counts', () => {
	saveLibraryState('movies', snapshot());
	forgetLibraryItem('b');
	const restored = getLibraryState('movies');
	expect(restored.allItems.map((item) => item.Id)).toEqual(['a', 'c']);
	expect(restored.totalCount).toBe(2);
	expect(restored.apiFetchIndex).toBe(2);
	expect(restored.focusedId).toBeNull();
});

test('forgetting a title that is not there changes nothing', () => {
	saveLibraryState('movies', snapshot());
	forgetLibraryItem('zzz');
	expect(getLibraryState('movies').totalCount).toBe(3);
});

test('titles opened on the way come back once, newest last, without repeats', () => {
	noteVisitedItem('a');
	noteVisitedItem('b');
	noteVisitedItem('a');
	expect(takeVisitedItems()).toEqual(['b', 'a']);
	expect(takeVisitedItems()).toEqual([]);
});

test('the trail keeps the last twenty titles and clears with the libraries', () => {
	for (let i = 0; i < 25; i++) noteVisitedItem(`m${i}`);
	const ids = takeVisitedItems();
	expect(ids).toHaveLength(20);
	expect(ids[0]).toBe('m5');
	noteVisitedItem('x');
	clearLibraryStates();
	expect(takeVisitedItems()).toEqual([]);
});
