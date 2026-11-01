import {languageChoices, overrideAudioIndex, overrideSubtitleIndex} from './seriesTrackOverride';

const audio = [
	{index: 1, language: 'eng', isDefault: true},
	{index: 2, language: 'nld'},
	{index: 3, language: 'dut', isAudioDescription: true},
	{index: 4, language: 'jpn'},
	{index: 5, language: 'ja', isDefault: true}
];

describe('audio override', () => {
	test('picks the track in the chosen language, whichever code the file uses', () => {
		expect(overrideAudioIndex(audio, 'eng')).toBe(1);
		expect(overrideAudioIndex(audio, 'nld')).toBe(2);
	});
	test('prefers the default-flagged track within the language', () => {
		expect(overrideAudioIndex(audio, 'jpn')).toBe(5);
	});
	test('skips audio description unless it is the only track in the language', () => {
		expect(overrideAudioIndex(audio, 'nld')).toBe(2);
		expect(overrideAudioIndex([{index: 9, language: 'fra', isAudioDescription: true}], 'fra')).toBe(9);
	});
	test('an episode without the language, or no override, leaves the choice open', () => {
		expect(overrideAudioIndex(audio, 'deu')).toBeNull();
		expect(overrideAudioIndex(audio, '')).toBeNull();
		expect(overrideAudioIndex(audio, undefined)).toBeNull();
	});
});

const subs = [
	{index: 10, language: 'eng', isForced: true},
	{index: 11, language: 'eng'},
	{index: 12, language: 'eng', isHearingImpaired: true},
	{index: 13, language: 'nl', isDefault: true},
	{index: 14, language: 'nld'}
];

describe('subtitle override', () => {
	test('none turns subtitles off', () => {
		expect(overrideSubtitleIndex(subs, 'none')).toBe(-1);
	});
	test('a full track beats a forced-only one', () => {
		expect(overrideSubtitleIndex(subs, 'eng')).toBe(11);
	});
	test('hearing-impaired tracks follow the SDH preference', () => {
		expect(overrideSubtitleIndex(subs, 'eng', {preferSdh: true})).toBe(12);
	});
	test('prefers the default-flagged track within the language', () => {
		expect(overrideSubtitleIndex(subs, 'nld')).toBe(13);
	});
	test('forced-only is still used when it is all the language has', () => {
		expect(overrideSubtitleIndex([{index: 20, language: 'fra', isForced: true}], 'fra')).toBe(20);
	});
	test('an episode without the language leaves the choice open', () => {
		expect(overrideSubtitleIndex(subs, 'deu')).toBeNull();
		expect(overrideSubtitleIndex(subs, '')).toBeNull();
	});
});

describe('language list', () => {
	const known = [{value: 'eng', label: 'English'}, {value: 'fra', label: 'French'}, {value: 'nld', label: 'Dutch'}, {value: 'jpn', label: 'Japanese'}];
	test('the first episode\'s languages lead, in its order, without repeats', () => {
		const choices = languageChoices([{language: 'jpn'}, {language: 'en'}, {language: 'eng'}, {language: 'und'}], known);
		expect(choices.map((c) => [c.value, c.inFirstEpisode])).toEqual([
			['jpn', true], ['eng', true], ['fra', false], ['nld', false]
		]);
		expect(choices[0].label).toBe('Japanese');
	});
	test('a language the list does not know is shown by its code', () => {
		expect(languageChoices([{language: 'fil'}], known)[0]).toEqual({value: 'fil', label: 'FIL', inFirstEpisode: true});
	});
	test('with no episode streams it is simply the full list', () => {
		expect(languageChoices([], known).map((c) => c.value)).toEqual(['eng', 'fra', 'nld', 'jpn']);
	});
});
