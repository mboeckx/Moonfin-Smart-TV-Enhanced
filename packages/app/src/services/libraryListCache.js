// The last complete list each library query produced, so opening it again shows those
// titles straight away while a fresh copy loads behind them.
//
// Held for as long as the app runs and keyed by server, user, library, sort and filters, so a
// list never shows under a query or an account it wasn't loaded for. Only a few lists are
// kept; the oldest goes first.

const MAX_LISTS = 6;
const lists = new Map();

export const listSignature = (parts) => JSON.stringify(parts);

export const getCachedList = (signature) => {
	if (!signature || !lists.has(signature)) return null;
	const entry = lists.get(signature);
	// Read again counts as recent use.
	lists.delete(signature);
	lists.set(signature, entry);
	return entry;
};

export const putCachedList = (signature, {items, totalCount, blockedCount}) => {
	if (!signature || !Array.isArray(items)) return;
	lists.delete(signature);
	lists.set(signature, {items, totalCount: totalCount || 0, blockedCount: blockedCount || 0, savedAt: Date.now()});
	while (lists.size > MAX_LISTS) lists.delete(lists.keys().next().value);
};

// A title deleted from its page leaves every remembered list it was in.
export const forgetCachedListItem = (itemId) => {
	if (!itemId) return;
	lists.forEach((entry) => {
		const kept = entry.items.filter((item) => item.Id !== itemId);
		if (kept.length === entry.items.length) return;
		entry.items = kept;
		entry.totalCount = Math.max(0, entry.totalCount - 1);
	});
};

export const clearListCache = () => lists.clear();

// What a card shows and what the filters read, so a fresh copy that differs only in fields
// nobody looks at doesn't rebuild the grid.
const fingerprintOf = (item) => [
	item.Id, item.Name, item.SortName, item.ProductionYear, item.OfficialRating, item.CommunityRating,
	item.CriticRating, item.RunTimeTicks, item.ImageTags?.Primary, item.ImageTags?.Thumb,
	item.BackdropImageTags?.[0], item.UserData?.Played, item.UserData?.IsFavorite,
	item.UserData?.PlaybackPositionTicks, item.UserData?.UnplayedItemCount, item.UserData?.Likes,
	(item.Genres || []).join('/'), (item.Studios || []).map((studio) => studio.Name).join('/')
].join('|');

export const sameList = (a, b) => {
	if (a === b) return true;
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (fingerprintOf(a[i]) !== fingerprintOf(b[i])) return false;
	}
	return true;
};

// Where focus should land once the fresh list replaces the old one: the same title if it is
// still there, otherwise the nearest title after it that survived, otherwise the nearest one
// before it, otherwise the same position.
export const nextFocusIndex = (oldIds, newIds, focusedId, oldIndex) => {
	if (!newIds.length) return -1;
	const at = newIds.indexOf(focusedId);
	if (at !== -1) return at;
	const present = new Set(newIds);
	for (let i = oldIndex + 1; i < oldIds.length; i++) {
		if (present.has(oldIds[i])) return newIds.indexOf(oldIds[i]);
	}
	for (let i = Math.min(oldIndex, oldIds.length) - 1; i >= 0; i--) {
		if (present.has(oldIds[i])) return newIds.indexOf(oldIds[i]);
	}
	return Math.max(0, Math.min(oldIndex, newIds.length - 1));
};
