import {getFromStorage, saveToStorage} from './storage';
import {createSeriesTrackPref, toSeriesTrackPref} from '../utils/seriesTrackPrefs';

// Remembers the tracks a user picked so they don't have to be reselected on every
// play. The per-item index restores the exact subtitle when replaying the same
// title, and the per-series record carries a choice to other episodes, matched by
// what the track was rather than where it sat, because episodes list their tracks
// in different orders. Mirrors Moonfin Core's per-item and per-series preferences.

const STORAGE_KEY = 'subtitlePrefs';
const MAX_ITEMS = 300;

const OFF_INDEX = -1;

// Series entries used to be the language on its own, where an empty one meant off.
// They are brought up to the record form on the way in, so anything saved before
// keeps working and is rewritten in the new shape the next time it is touched.
const readSeries = (stored) => {
	const out = {};
	if (stored && typeof stored === 'object') {
		for (const [id, value] of Object.entries(stored)) {
			const pref = toSeriesTrackPref(value);
			if (pref) out[id] = pref;
		}
	}
	return out;
};

const loadPrefs = async () => {
	const stored = await getFromStorage(STORAGE_KEY);
	return {
		items: stored?.items && typeof stored.items === 'object' ? stored.items : {},
		series: readSeries(stored?.series),
		seriesAudio: readSeries(stored?.seriesAudio),
		seriesOverrides: stored?.seriesOverrides && typeof stored.seriesOverrides === 'object' ? stored.seriesOverrides : {}
	};
};

// `streams` is every subtitle track the episode offers, which is what tells the
// pick apart from the others in its language.
export const saveSubtitlePref = async (item, streamIndex, streams) => {
	if (!item?.Id) return;
	const prefs = await loadPrefs();

	// Reinsert so the freshest item sits last, then trim the oldest once over the cap.
	delete prefs.items[item.Id];
	prefs.items[item.Id] = streamIndex >= 0 ? streamIndex : OFF_INDEX;
	const ids = Object.keys(prefs.items);
	if (ids.length > MAX_ITEMS) {
		for (const id of ids.slice(0, ids.length - MAX_ITEMS)) {
			delete prefs.items[id];
		}
	}

	if (item.SeriesId) {
		const pref = createSeriesTrackPref(streams, streamIndex);
		if (pref) prefs.series[item.SeriesId] = pref;
		else delete prefs.series[item.SeriesId];
	}

	await saveToStorage(STORAGE_KEY, prefs);
};

export const saveAudioPref = async (item, streamIndex, streams) => {
	if (!item?.SeriesId) return;
	const prefs = await loadPrefs();

	// Turning audio off isn't a thing, so a pick that names no track leaves the
	// series without an opinion rather than storing one.
	const pref = streamIndex >= 0 ? createSeriesTrackPref(streams, streamIndex) : null;
	if (pref) prefs.seriesAudio[item.SeriesId] = pref;
	else delete prefs.seriesAudio[item.SeriesId];

	await saveToStorage(STORAGE_KEY, prefs);
};

export const getItemSubtitlePref = async (itemId) => {
	if (!itemId) return undefined;
	const prefs = await loadPrefs();
	return Object.prototype.hasOwnProperty.call(prefs.items, itemId) ? prefs.items[itemId] : undefined;
};

export const getSeriesSubtitlePref = async (seriesId) => {
	if (!seriesId) return undefined;
	const prefs = await loadPrefs();
	return prefs.series[seriesId];
};

// Patched: the languages chosen on the series page, {audio, subtitle}. A missing value means
// no override, and a subtitle of 'none' means subtitles off.
export const getSeriesTrackOverride = async (seriesId) => {
	if (!seriesId) return {};
	const prefs = await loadPrefs();
	const stored = prefs.seriesOverrides[seriesId];
	return stored && typeof stored === 'object' ? {...stored} : {};
};

export const setSeriesTrackOverride = async (seriesId, kind, value) => {
	if (!seriesId || (kind !== 'audio' && kind !== 'subtitle')) return {};
	const prefs = await loadPrefs();
	const next = {...(prefs.seriesOverrides[seriesId] || {})};
	if (value) next[kind] = value;
	else delete next[kind];
	if (Object.keys(next).length) prefs.seriesOverrides[seriesId] = next;
	else delete prefs.seriesOverrides[seriesId];
	await saveToStorage(STORAGE_KEY, prefs);
	return next;
};

export const getSeriesAudioPref = async (seriesId) => {
	if (!seriesId) return undefined;
	const prefs = await loadPrefs();
	return prefs.seriesAudio[seriesId];
};
