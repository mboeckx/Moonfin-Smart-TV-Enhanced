import {clearListCache, forgetCachedListItem, getCachedList, listSignature, nextFocusIndex, putCachedList, sameList} from './libraryListCache';

const movie = (id, extra = {}) => ({Id: id, Name: id, SortName: id, UserData: {Played: false}, ...extra});

afterEach(() => clearListCache());

describe('remembered lists', () => {
	test('a list only comes back for the exact query, user and server it was loaded for', () => {
		const sig = listSignature(['http://pi', 'u1', 'movies', 'SortName', '', false]);
		putCachedList(sig, {items: [movie('a')], totalCount: 1});
		expect(getCachedList(sig).items).toHaveLength(1);
		expect(getCachedList(listSignature(['http://pi', 'u2', 'movies', 'SortName', '', false]))).toBeNull();
		expect(getCachedList(listSignature(['http://pi', 'u1', 'movies', 'DateCreated', '', false]))).toBeNull();
	});

	test('only the six most recently used lists are kept', () => {
		for (let i = 0; i < 7; i++) putCachedList(`s${i}`, {items: [movie(`m${i}`)], totalCount: 1});
		expect(getCachedList('s0')).toBeNull();
		expect(getCachedList('s6')).not.toBeNull();
		// Reading one keeps it from being the next to go.
		getCachedList('s1');
		putCachedList('s7', {items: [], totalCount: 0});
		expect(getCachedList('s1')).not.toBeNull();
		expect(getCachedList('s2')).toBeNull();
	});

	test('a deleted title leaves every remembered list', () => {
		putCachedList('a', {items: [movie('x'), movie('y')], totalCount: 2});
		putCachedList('b', {items: [movie('y')], totalCount: 1});
		forgetCachedListItem('y');
		expect(getCachedList('a').items.map((m) => m.Id)).toEqual(['x']);
		expect(getCachedList('a').totalCount).toBe(1);
		expect(getCachedList('b').items).toEqual([]);
	});
});

describe('comparing lists', () => {
	test('identical cards count as the same list', () => {
		expect(sameList([movie('a'), movie('b')], [movie('a'), movie('b')])).toBe(true);
	});
	test('a watched change, a new poster or a reorder counts as different', () => {
		expect(sameList([movie('a')], [movie('a', {UserData: {Played: true}})])).toBe(false);
		expect(sameList([movie('a')], [movie('a', {ImageTags: {Primary: 'new'}})])).toBe(false);
		expect(sameList([movie('a'), movie('b')], [movie('b'), movie('a')])).toBe(false);
		expect(sameList([movie('a')], [movie('a'), movie('b')])).toBe(false);
	});
	test('fields no card shows do not count', () => {
		expect(sameList([movie('a', {Path: '/x'})], [movie('a', {Path: '/y'})])).toBe(true);
	});
});

describe('where focus lands after the swap', () => {
	const oldIds = ['a', 'b', 'c', 'd', 'e'];
	test('the same title, wherever it moved to', () => {
		expect(nextFocusIndex(oldIds, ['new', 'a', 'b', 'c', 'd', 'e'], 'c', 2)).toBe(3);
	});
	test('a deleted title hands focus to the next one that survived', () => {
		expect(nextFocusIndex(oldIds, ['a', 'b', 'd', 'e'], 'c', 2)).toBe(2);
		expect(nextFocusIndex(oldIds, ['a', 'b', 'e'], 'c', 2)).toBe(2);
	});
	test('at the end of the list it falls back to the one before', () => {
		expect(nextFocusIndex(oldIds, ['a', 'b', 'c'], 'e', 4)).toBe(2);
	});
	test('when nothing old survived it keeps the position', () => {
		expect(nextFocusIndex(oldIds, ['x', 'y', 'z'], 'c', 2)).toBe(2);
		expect(nextFocusIndex(oldIds, ['x'], 'e', 4)).toBe(0);
	});
	test('an empty list has nowhere to land', () => {
		expect(nextFocusIndex(oldIds, [], 'a', 0)).toBe(-1);
	});
});
