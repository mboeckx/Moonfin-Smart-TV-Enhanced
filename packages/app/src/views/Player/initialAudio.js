import {getSeriesAudioPref, getSeriesTrackOverride} from '../../services/subtitlePrefs';
import {matchSeriesTrackIndex} from '../../utils/seriesTrackPrefs';
import {overrideAudioIndex} from '../../utils/seriesTrackOverride';

/**
 * The audio track remembered for this series, when one of the episode's own tracks
 * can still be it. Null leaves the choice to the language preferences.
 */
export const resolveSeriesAudio = async (item, audioStreams) => {
	if (!item?.SeriesId || !audioStreams?.length) return null;

	// Patched: the language set on the series page comes first.
	const override = (await getSeriesTrackOverride(item.SeriesId)) || {};
	const overridden = overrideAudioIndex(audioStreams, override.audio);
	if (overridden !== null) return audioStreams.find((stream) => stream.index === overridden) || null;

	const pref = await getSeriesAudioPref(item.SeriesId);
	if (!pref) return null;

	const matched = matchSeriesTrackIndex(audioStreams, pref);
	if (matched === null || matched < 0) return null;

	return audioStreams.find((stream) => stream.index === matched) || null;
};
