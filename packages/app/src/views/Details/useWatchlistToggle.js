// Patched: the details page's watchlist button, for films and series. It reads whether the title
// is on its watchlist when the page opens and flips it on a press, saying what happened in the
// page's toast.

import {useCallback, useEffect, useRef, useState} from 'react';
import $L from '@enact/i18n/$L';

import {isOnWatchlist, toggleWatchlist, watchlistMessage} from '../../services/watchlistPlaylist';

const ON_STATUSES = ['added', 'created', 'already'];

const useWatchlistToggle = ({item, api, onToast}) => {
	const offered = Boolean(item?.Id && api && (item.Type === 'Movie' || item.Type === 'Series'));
	const [on, setOn] = useState(false);
	const busyRef = useRef(false);
	const itemId = item?.Id;

	useEffect(() => {
		setOn(false);
		if (!offered) return undefined;
		let cancelled = false;
		isOnWatchlist(api, item)
			.then((result) => { if (!cancelled) setOn(result); })
			.catch(() => {});
		return () => { cancelled = true; };
		// The title, not each fresh copy of it, decides when to ask again.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [offered, itemId, api]);

	const toggle = useCallback(async () => {
		if (!offered || busyRef.current) return;
		busyRef.current = true;
		try {
			const result = await toggleWatchlist(api, item);
			setOn(ON_STATUSES.includes(result.status));
			onToast?.(watchlistMessage(result, item, $L));
		} catch (err) {
			console.error('[Details] Watchlist change failed:', err);
			onToast?.(watchlistMessage(null, item, $L));
		} finally {
			busyRef.current = false;
		}
	}, [offered, api, item, onToast]);

	return offered ? {on, toggle} : null;
};

export default useWatchlistToggle;
