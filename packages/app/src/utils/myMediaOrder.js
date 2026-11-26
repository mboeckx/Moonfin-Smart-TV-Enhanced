import {PLACE, isShelfLibrary} from '../services/archiveApi';

// My Media leads with movies, then shows, then collections, then every other kind of library,
// and ends with the Archive plugin's archive and soft delete library for those who can see them.
// Libraries of one kind keep the order the server gave them, which is the order the viewer set
// in Library Order.
const TYPE_RANK = {movies: 0, tvshows: 1, boxsets: 2};
const OTHER_RANK = 3;

const rankOf = (library, shelves) => {
	if (isShelfLibrary(shelves, library?.Id, [PLACE.ARCHIVE])) return OTHER_RANK + 1;
	if (isShelfLibrary(shelves, library?.Id, [PLACE.SOFT_DELETE])) return OTHER_RANK + 2;
	const type = String(library?.CollectionType || '').toLowerCase();
	return Object.prototype.hasOwnProperty.call(TYPE_RANK, type) ? TYPE_RANK[type] : OTHER_RANK;
};

export const orderMyMedia = (libraries, shelves) => (Array.isArray(libraries) ? libraries : [])
	.map((library, index) => ({library, index, rank: rankOf(library, shelves)}))
	.sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
	.map(({library}) => library);
