import {orderMyMedia} from './myMediaOrder';
import {parseArchiveInfo} from '../services/archiveApi';

const shelves = parseArchiveInfo({Archive: {LibraryId: 'arch'}, SoftDelete: {LibraryId: 'bin'}});

describe('orderMyMedia', () => {
	test('movies, shows, collections, the rest, then the archive and soft delete', () => {
		const libraries = [
			{Id: 'bin', CollectionType: 'movies'},
			{Id: 'music', CollectionType: 'music'},
			{Id: 'sets', CollectionType: 'boxsets'},
			{Id: 'arch', CollectionType: 'movies'},
			{Id: 'shows', CollectionType: 'tvshows'},
			{Id: 'films', CollectionType: 'movies'}
		];
		expect(orderMyMedia(libraries, shelves).map((l) => l.Id)).toEqual(['films', 'shows', 'sets', 'music', 'arch', 'bin']);
	});

	test('libraries of one kind keep the server order', () => {
		const libraries = [{Id: 'b', CollectionType: 'movies'}, {Id: 'a', CollectionType: 'movies'}];
		expect(orderMyMedia(libraries, shelves).map((l) => l.Id)).toEqual(['b', 'a']);
	});

	test('without the plugin the shelves are ordinary libraries', () => {
		const libraries = [{Id: 'arch', CollectionType: 'movies'}, {Id: 'shows', CollectionType: 'tvshows'}];
		expect(orderMyMedia(libraries, parseArchiveInfo(null)).map((l) => l.Id)).toEqual(['arch', 'shows']);
	});
});
