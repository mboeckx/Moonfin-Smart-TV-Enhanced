import {resolveSeriesAudio} from './initialAudio';
import {resolveInitialSubtitle} from './initialSubtitle';

const mockPrefs = {override: {}, itemSubtitle: undefined, seriesSubtitle: undefined, seriesAudio: undefined, itemAudio: undefined};
jest.mock('../../services/subtitlePrefs', () => ({
	getSeriesTrackOverride: async () => mockPrefs.override,
	getItemSubtitlePref: async () => mockPrefs.itemSubtitle,
	getSeriesSubtitlePref: async () => mockPrefs.seriesSubtitle,
	getSeriesAudioPref: async () => mockPrefs.seriesAudio,
	getItemAudioPref: async () => mockPrefs.itemAudio
}));

const episode = {Id: 'e1', SeriesId: 's1'};
const audioStreams = [{index: 1, language: 'eng', isDefault: true}, {index: 2, language: 'nld'}];
const subtitleStreams = [{index: 10, language: 'eng'}, {index: 11, language: 'nld'}];
const settings = {subtitleMode: 'default'};

beforeEach(() => {
	mockPrefs.override = {};
	mockPrefs.itemSubtitle = undefined;
	mockPrefs.seriesSubtitle = undefined;
	mockPrefs.seriesAudio = {language: 'eng', title: '', relativeIndex: 0};
	mockPrefs.itemAudio = undefined;
});

test('the series audio override also beats the track picked on this episode', async () => {
	mockPrefs.itemAudio = 1;
	mockPrefs.override = {audio: 'nld'};
	expect((await resolveSeriesAudio(episode, audioStreams)).index).toBe(2);
});

test('the series audio override beats the remembered track', async () => {
	mockPrefs.override = {audio: 'nld'};
	expect((await resolveSeriesAudio(episode, audioStreams)).index).toBe(2);
});

test('without an override the remembered track is used, as before', async () => {
	expect((await resolveSeriesAudio(episode, audioStreams)).index).toBe(1);
});

test('an override language the episode lacks falls back to the remembered track', async () => {
	mockPrefs.override = {audio: 'deu'};
	expect((await resolveSeriesAudio(episode, audioStreams)).index).toBe(1);
});

test('the subtitle override beats this episode\'s remembered subtitle', async () => {
	mockPrefs.itemSubtitle = 10;
	mockPrefs.override = {subtitle: 'nld'};
	expect((await resolveInitialSubtitle({subtitleStreams}, episode, undefined, settings, null)).index).toBe(11);
});

test('subtitles set to none turn them off even when a track was remembered', async () => {
	mockPrefs.itemSubtitle = 10;
	mockPrefs.override = {subtitle: 'none'};
	expect(await resolveInitialSubtitle({subtitleStreams}, episode, undefined, settings, null)).toBeNull();
});

test('a track picked for this playback still wins over the override', async () => {
	mockPrefs.override = {subtitle: 'nld'};
	expect((await resolveInitialSubtitle({subtitleStreams}, episode, 10, settings, null)).index).toBe(10);
});

test('without an override the remembered subtitle is used, as before', async () => {
	mockPrefs.itemSubtitle = 10;
	expect((await resolveInitialSubtitle({subtitleStreams}, episode, undefined, settings, null)).index).toBe(10);
});
