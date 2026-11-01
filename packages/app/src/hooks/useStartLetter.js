// The alphabet strip down the side of the favorites and library grids. Picking a letter
// narrows the grid to it and hands focus to the results, so the next press moves through
// them rather than along the letters. Picking the same letter again clears it.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Spotlight from '@enact/spotlight';

import {filterByStartLetter} from '../utils/gridChrome';

const useStartLetter = ({allItems, isLoading, gridSpotlightId, initialLetter = null}) => {
	// Patched: a letter picked before visiting a title comes back with the screen.
	const [startLetter, setStartLetter] = useState(initialLetter);

	const items = useMemo(() => filterByStartLetter(allItems, startLetter), [allItems, startLetter]);

	const handleLetterSelect = useCallback((ev) => {
		const letter = ev.currentTarget?.dataset?.letter;
		if (letter) {
			setStartLetter(letter === startLetter ? null : letter);
		}
	}, [startLetter]);

	// The letter the grid was last handed focus for. The list also rebuilds for a filter or a
	// search, and without this the effect below would answer those too and pull focus away.
	// A restored letter already had its focus pass, so coming back does not move focus again.
	const focusedForLetterRef = useRef(initialLetter);

	// The grid rebuilds around the narrower list, so the focus waits for it to settle.
	useEffect(() => {
		if (!startLetter) {
			// Cleared, so the same letter picked again is a fresh pick.
			focusedForLetterRef.current = null;
			return undefined;
		}
		if (items.length === 0 || isLoading || focusedForLetterRef.current === startLetter) return undefined;
		// Marked when the focus really moves, since a page landing inside the wait cancels it.
		const id = setTimeout(() => {
			focusedForLetterRef.current = startLetter;
			Spotlight.focus(gridSpotlightId);
		}, 100);
		return () => clearTimeout(id);
	}, [startLetter, items.length, isLoading, gridSpotlightId]);

	return {startLetter, handleLetterSelect, items};
};

export default useStartLetter;
