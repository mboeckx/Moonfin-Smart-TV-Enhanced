import {autoView, displayOf} from './playlistView';

const items = [
	{Id: 'a', Name: 'Zodiac', SortName: 'zodiac', DateCreated: '2024-01-01', ProductionYear: 2007, CommunityRating: 7.7, RunTimeTicks: 900},
	{Id: 'b', Name: 'The Abyss', SortName: 'abyss', DateCreated: '2026-05-01', PremiereDate: '1989-08-09', CommunityRating: 7.5, RunTimeTicks: 800},
	{Id: 'c', Name: 'Episode 3', Type: 'Episode', SeriesId: 's', SeriesName: 'Mad Men', ParentIndexNumber: 2, IndexNumber: 3, DateCreated: '2025-01-01', RunTimeTicks: 300},
	{Id: 'd', Name: 'Unrated', SortName: 'unrated', RunTimeTicks: 500}
];
test('an episode shows as its series, with which episode underneath', () => {
	expect(displayOf({...items[2], SeriesPrimaryImageTag: 'sp'})).toEqual({title: 'Mad Men', subtitle: 'S2E3 · Episode 3', imageId: 's', imageTag: 'sp'});
	expect(displayOf({Id: 'm', Name: 'Film', ProductionYear: 2001, ImageTags: {Primary: 'p'}})).toEqual({title: 'Film', subtitle: '2001', imageId: 'm', imageTag: 'p'});
});

test('posters for films and shows, the list for songs', () => {
	expect(autoView([{MediaType: 'Video'}])).toBe('posters');
	expect(autoView([{MediaType: 'Video'}, {MediaType: 'Audio'}])).toBe('list');
	expect(autoView([])).toBe('list');
});
