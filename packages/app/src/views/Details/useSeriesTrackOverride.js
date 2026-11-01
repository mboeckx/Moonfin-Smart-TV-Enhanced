// Patched: the series page's audio and subtitle language pickers. Holds the override stored
// for the series, reads the first episode's tracks so its languages can lead the lists, and
// hands the action row and the pickers what they show.

import {useCallback, useEffect, useMemo, useState} from 'react';
import $L from '@enact/i18n/$L';

import {getSeriesTrackOverride, setSeriesTrackOverride} from '../../services/subtitlePrefs';
import {getAudioLanguageOptions} from '../Settings/settingsOptions';
import {SUBTITLES_OFF, fromServerTrack, languageChoices} from '../../utils/seriesTrackOverride';

// The first regular episode: specials sit in season 0 and are left out unless they're all
// there is.
const firstEpisodeOf = (episodes) => (episodes || []).find((episode) => (episode.ParentIndexNumber || 0) > 0) || (episodes || [])[0] || null;

const useSeriesTrackOverride = ({item, api, openModal, closeModal}) => {
	const seriesId = item?.Type === 'Series' ? item.Id : null;
	const [override, setOverride] = useState({});
	const [firstEpisode, setFirstEpisode] = useState(null);

	useEffect(() => {
		let cancelled = false;
		setOverride({});
		setFirstEpisode(null);
		if (!seriesId) return undefined;
		getSeriesTrackOverride(seriesId).then((stored) => { if (!cancelled) setOverride(stored || {}); }).catch(() => {});
		if (api?.getItems) {
			api.getItems({
				ParentId: seriesId,
				Recursive: true,
				IncludeItemTypes: 'Episode',
				SortBy: 'ParentIndexNumber,IndexNumber',
				SortOrder: 'Ascending',
				Limit: 10,
				Fields: 'MediaStreams',
				EnableTotalRecordCount: false,
				EnableImages: false,
				EnableUserData: false
			}).then((result) => {
				if (!cancelled) setFirstEpisode(firstEpisodeOf(result?.Items));
			}).catch(() => {});
		}
		return () => { cancelled = true; };
	}, [seriesId, api]);

	const known = useMemo(() => getAudioLanguageOptions().filter((option) => option.value), []);
	const streams = useMemo(() => firstEpisode?.MediaStreams || [], [firstEpisode]);
	const audioChoices = useMemo(
		() => languageChoices(streams.filter((s) => s.Type === 'Audio').map(fromServerTrack), known),
		[streams, known]
	);
	const subtitleChoices = useMemo(
		() => languageChoices(streams.filter((s) => s.Type === 'Subtitle').map(fromServerTrack), known),
		[streams, known]
	);

	const labelFor = useCallback((choices, value) => {
		if (!value) return $L('Auto');
		if (value === SUBTITLES_OFF) return $L('None');
		const match = choices.find((choice) => choice.value === value);
		return match ? match.label : value.toUpperCase();
	}, []);

	const choose = useCallback(async (kind, value) => {
		if (!seriesId) return;
		const next = await setSeriesTrackOverride(seriesId, kind, value);
		setOverride(next);
		closeModal?.();
	}, [seriesId, closeModal]);

	const onOpenAudio = useCallback(() => openModal?.('seriesAudio'), [openModal]);
	const onOpenSubtitle = useCallback(() => openModal?.('seriesSubtitle'), [openModal]);
	const onChooseAudio = useCallback((ev) => choose('audio', ev.currentTarget?.dataset?.value || ''), [choose]);
	const onChooseSubtitle = useCallback((ev) => choose('subtitle', ev.currentTarget?.dataset?.value || ''), [choose]);

	return useMemo(() => (seriesId ? {
		audio: override.audio || '',
		subtitle: override.subtitle || '',
		audioLabel: labelFor(audioChoices, override.audio),
		subtitleLabel: labelFor(subtitleChoices, override.subtitle),
		audioChoices,
		subtitleChoices,
		episodeLabel: firstEpisode ? `S${firstEpisode.ParentIndexNumber || 0}E${firstEpisode.IndexNumber || 0}` : '',
		onOpenAudio,
		onOpenSubtitle,
		onChooseAudio,
		onChooseSubtitle
	} : null), [seriesId, override, audioChoices, subtitleChoices, firstEpisode, labelFor, onOpenAudio, onOpenSubtitle, onChooseAudio, onChooseSubtitle]);
};

export default useSeriesTrackOverride;
