// Patched: a series' explicit audio and subtitle language, set from the series page. It
// outranks everything remembered from earlier playback, because the viewer chose it as the
// rule for the whole series. An episode without that language falls back to the usual
// choice, so the override never leaves an episode silent or on the wrong track.

import {languageMatches, normalizeLanguageCode} from './audioLanguage';

// The subtitle value meaning subtitles off.
export const SUBTITLES_OFF = 'none';

// Player and server records name things differently, so both come round to one shape.
export const fromServerTrack = (stream) => ({
	index: stream?.Index,
	language: stream?.Language || '',
	isDefault: Boolean(stream?.IsDefault),
	isForced: Boolean(stream?.IsForced),
	isHearingImpaired: Boolean(stream?.IsHearingImpaired),
	isAudioDescription: Boolean(stream?.IsAudioDescription)
});

const inLanguage = (streams, language) => (streams || []).filter((stream) =>
	stream && stream.index !== undefined && stream.index !== null && languageMatches(stream.language, language));

const preferDefault = (candidates) => (candidates.find((stream) => stream.isDefault) || candidates[0] || null);

/**
 * The audio stream index for an override language, or null when the episode has no track in
 * it. An audio description track is only taken when it is the language's only track.
 */
export const overrideAudioIndex = (streams, language) => {
	if (!normalizeLanguageCode(language)) return null;
	const matching = inLanguage(streams, language);
	if (!matching.length) return null;
	const regular = matching.filter((stream) => !stream.isAudioDescription);
	const pick = preferDefault(regular.length ? regular : matching);
	return pick ? pick.index : null;
};

/**
 * The subtitle stream index for an override: -1 for off, the best track in the language, or
 * null when the episode has none in it. Full tracks beat forced-only ones, which carry just
 * the foreign lines, and hearing-impaired tracks follow the viewer's SDH preference.
 */
export const overrideSubtitleIndex = (streams, value, {preferSdh = false} = {}) => {
	if (value === SUBTITLES_OFF) return -1;
	if (!normalizeLanguageCode(value)) return null;
	const matching = inLanguage(streams, value);
	if (!matching.length) return null;
	const full = matching.filter((stream) => !stream.isForced);
	const pool = full.length ? full : matching;
	const bySdh = pool.filter((stream) => Boolean(stream.isHearingImpaired) === Boolean(preferSdh));
	const pick = preferDefault(bySdh.length ? bySdh : pool);
	return pick ? pick.index : null;
};

/**
 * The languages to offer, as {value, label, inFirstEpisode}: the ones the first episode has,
 * in the order it lists them, then every other known language. A language the known list
 * doesn't name is shown by its code.
 */
export const languageChoices = (firstEpisodeStreams, knownOptions) => {
	const labelOf = new Map((knownOptions || []).map((option) => [option.value, option.label]));
	const seen = new Set();
	const first = [];
	(firstEpisodeStreams || []).forEach((stream) => {
		const code = normalizeLanguageCode(stream?.language);
		if (!code || seen.has(code)) return;
		seen.add(code);
		first.push({value: code, label: labelOf.get(code) || code.toUpperCase(), inFirstEpisode: true});
	});
	const rest = (knownOptions || [])
		.filter((option) => option.value && !seen.has(option.value))
		.map((option) => ({value: option.value, label: option.label, inFirstEpisode: false}));
	return [...first, ...rest];
};
