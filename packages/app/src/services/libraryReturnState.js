// What a library screen looked like when the viewer stepped into a title, so coming back
// from that title lands on the same filters, letter and card instead of a fresh grid.
//
// The library panel unmounts while a details page is up, so the screen hands its state
// here on the way out and reads it back when it is reached again with back. Leaving to
// the home screen clears everything, which is the one way out that starts a library over.

const snapshots = new Map();
// Titles opened since the library was left, so coming back can check whether any of them
// changed (a new poster, say) while the viewer was away.
const visited = new Set();
const VISITED_LIMIT = 20;

export const noteVisitedItem = (itemId) => {
	if (!itemId) return;
	visited.delete(itemId);
	visited.add(itemId);
	if (visited.size > VISITED_LIMIT) visited.delete(visited.values().next().value);
};

export const takeVisitedItems = () => {
	const ids = [...visited];
	visited.clear();
	return ids;
};

export const saveLibraryState = (key, snapshot) => {
	if (key && snapshot) snapshots.set(key, snapshot);
};

export const getLibraryState = (key) => (key && snapshots.get(key)) || null;

export const clearLibraryStates = () => {
	snapshots.clear();
	visited.clear();
};

// A title deleted from its details page should not come back on the remembered grid.
export const forgetLibraryItem = (itemId) => {
	if (!itemId) return;
	snapshots.forEach((snapshot) => {
		if (!Array.isArray(snapshot.allItems)) return;
		const kept = snapshot.allItems.filter((item) => item.Id !== itemId);
		if (kept.length === snapshot.allItems.length) return;
		snapshot.allItems = kept;
		snapshot.totalCount = Math.max(0, (snapshot.totalCount || 0) - 1);
		snapshot.apiFetchIndex = Math.max(0, (snapshot.apiFetchIndex || 0) - 1);
		if (snapshot.focusedId === itemId) snapshot.focusedId = null;
	});
};
