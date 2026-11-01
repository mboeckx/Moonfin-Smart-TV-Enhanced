import {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {getImageUrl, getBackdropId, getLogoUrl} from '../../utils/helpers';
import {autocropLogoUrl} from '../../utils/logoAutocrop';
import {formatClockTime, shiftedNow} from '../../utils/clock';
import {KEYS} from '../../utils/keys';
import * as jellyfinApi from '../../services/jellyfinApi';
import ScreensaverGradient, {isGradientBackdrop} from './ScreensaverGradient';
import ScreensaverRunner from './ScreensaverRunner';
import {resolveLayout, startBounce} from './screensaverLayout';
import css from './Screensaver.module.less';

const BOUNCE_MARGIN = 20;
const BACKDROP_INTERVAL = 30000;
const BACKDROP_BATCH_SIZE = 60;
export const RUNNER_BASE_SIZE = 96;
export const CLOCK_FONT_SIZE = 32;
// Patched: only the Tizen key table names the colour keys, and 404 and 405 are what Samsung and
// LG remotes send for green and yellow, so those stand in elsewhere.
const GREEN_KEY = KEYS.GREEN || 404;
const YELLOW_KEY = KEYS.YELLOW || 405;

const SORT_FIELDS = ['DateCreated', 'CommunityRating'];
const SORT_ORDERS = ['Descending', 'Ascending'];
const START_OFFSETS = [0, 30, 60, 90];
const LIBRARY_TYPES = ['movies', 'tvshows'];
const ITEM_FIELDS = 'ImageTags,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,ParentLogoItemId,ParentLogoImageTag,OfficialRating,Genres';

const RATING_MAP = {0: 'G', 7: 'PG', 13: 'PG-13', 17: 'R', 18: 'NC-17'};

export const COMPONENT_SIZE = {
	moonfinLogo: {width: 320, height: 140},
	clock: {width: 200, height: 56},
	runner: {width: 120, height: 120}
};

const pickOne = (values) => values[Math.floor(Math.random() * values.length)];

const shuffle = (items) => {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const held = items[i];
		items[i] = items[j];
		items[j] = held;
	}
	return items;
};

const includeItemTypesFor = (contentType) => {
	if (contentType === 'movies') return 'Movie';
	if (contentType === 'tv' || contentType === 'tvshows') return 'Series';
	return 'Movie,Series';
};

const viewMatchesContentType = (collectionType, contentType) => {
	if (!collectionType) return true;
	if (contentType === 'movies') return collectionType === 'movies';
	if (contentType === 'tv' || contentType === 'tvshows') return collectionType === 'tvshows';
	return LIBRARY_TYPES.indexOf(collectionType) !== -1;
};

// Patched: titles shown lately, kept for as long as the app runs, so shuffling the whole
// library doesn't bring the same one back within a session.
const RECENT_LIMIT = 150;
const recentlyShown = [];
const rememberShown = (id) => {
	if (!id) return;
	const at = recentlyShown.indexOf(id);
	if (at !== -1) recentlyShown.splice(at, 1);
	recentlyShown.push(id);
	if (recentlyShown.length > RECENT_LIMIT) recentlyShown.shift();
};
export const forgetRecentlyShown = () => { recentlyShown.length = 0; };

// The backdrop to show for an item: a random one of its own when it has several, otherwise
// its parent's. The tag goes in the url so the server lets the TV cache the picture.
export const pickBackdrop = (item, randomIndex) => {
	if (!item) return null;
	const own = item.BackdropImageTags || [];
	if (own.length > 0) {
		const index = randomIndex ? Math.floor(Math.random() * own.length) : 0;
		return {id: item.Id, index, tag: own[index]};
	}
	const parent = item.ParentBackdropImageTags || [];
	if (item.ParentBackdropItemId && parent.length > 0) {
		const index = randomIndex ? Math.floor(Math.random() * parent.length) : 0;
		return {id: item.ParentBackdropItemId, index, tag: parent[index]};
	}
	return null;
};

const loadBackdropBatch = async ({contentType, libraryIds, collectionIds, excludedGenres, maxRating, shuffleLibrary}) => {
	let parentIds = libraryIds.concat(collectionIds).filter(Boolean);
	if (parentIds.length === 0) {
		const views = await jellyfinApi.api.getAllLibraries();
		parentIds = (views?.Items || [])
			.filter(view => viewMatchesContentType(view.CollectionType, contentType))
			.map(view => view.Id)
			.filter(Boolean);
	}

	// Shuffle asks the server for a random draw from the whole library. The original way
	// sorts by date added or rating and reads near one end, which never reaches the middle.
	const query = {
		IncludeItemTypes: includeItemTypesFor(contentType),
		ExcludeItemTypes: 'BoxSet',
		Recursive: true,
		SortBy: shuffleLibrary ? 'Random' : pickOne(SORT_FIELDS),
		SortOrder: shuffleLibrary ? 'Ascending' : pickOne(SORT_ORDERS),
		Limit: BACKDROP_BATCH_SIZE,
		Fields: ITEM_FIELDS,
		EnableTotalRecordCount: false,
		EnableImageTypes: 'Backdrop,Logo'
	};
	if (maxRating != null && RATING_MAP[maxRating]) {
		query.MaxOfficialRating = RATING_MAP[maxRating];
	}

	const startIndex = shuffleLibrary ? 0 : pickOne(START_OFFSETS);

	const fetchFrom = async (parentId) => {
		const run = (start) => {
			const params = {...query, StartIndex: start};
			if (parentId) params.ParentId = parentId;
			return jellyfinApi.api.getItems(params).then(result => result?.Items || []);
		};
		const page = await run(startIndex);
		// A random offset can overshoot a small library and come back with nothing,
		// so the second pass starts from the top.
		if (page.length === 0 && startIndex > 0) return run(0);
		return page;
	};

	const batches = parentIds.length > 0
		? await Promise.all(parentIds.map(parentId => fetchFrom(parentId).catch(() => [])))
		: [await fetchFrom(null)];

	const excluded = excludedGenres.filter(Boolean);
	const items = shuffle([].concat.apply([], batches)).filter(item => {
		if (!getBackdropId(item)) return false;
		return !(item.Genres || []).some(genre => excluded.indexOf(genre) !== -1);
	});

	if (shuffleLibrary) {
		// Fresh titles first. A small library runs out of them, so the recent ones fill in
		// behind rather than leaving the screen empty.
		const fresh = items.filter(item => recentlyShown.indexOf(item.Id) === -1);
		const recent = items.filter(item => recentlyShown.indexOf(item.Id) !== -1);
		return fresh.concat(recent).slice(0, BACKDROP_BATCH_SIZE);
	}

	return items.slice(0, BACKDROP_BATCH_SIZE);
};

const Screensaver = ({
	visible,
	backdrop = 'library',
	component = 'moonfinLogo',
	movement = 'moderate',
	position = 'middle',
	size = 'medium',
	contentType = 'both',
	libraryIds,
	collectionIds,
	excludedGenres,
	dimmingLevel = 50,
	clockDisplay = '24-hour',
	timeOffsetHours = 0,
	maxRating = null,
	onDismiss,
	onPlayItem,
	onColorKey,
	keyHandlerRef,
	shuffleLibrary = true,
	serverUrl
}) => {
	const showLibrary = backdrop === 'library';
	const showClock = component === 'clock';
	const {scale, speedMultiplier, bounces, box, boxStyle, anchorClass} = resolveLayout({
		component,
		movement,
		position,
		size,
		sizes: COMPONENT_SIZE
	});

	const [rendered, setRendered] = useState(false);
	const [showOverlay, setShowOverlay] = useState(false);
	const [clockText, setClockText] = useState(() => formatClockTime(shiftedNow(timeOffsetHours), clockDisplay));
	const boxRef = useRef(null);
	const boxAnimRef = useRef(null);
	const facingRef = useRef(false);

	const [currentItem, setCurrentItem] = useState(null);
	// Picked once per title shown, so a re-render doesn't swap the picture mid-fade.
	const currentBackdrop = useMemo(() => pickBackdrop(currentItem, shuffleLibrary), [currentItem, shuffleLibrary]);
	useEffect(() => {
		if (shuffleLibrary && currentItem) rememberShown(currentItem.Id);
	}, [currentItem, shuffleLibrary]);
	const [backdropVisible, setBackdropVisible] = useState(false);
	const [batchReady, setBatchReady] = useState(false);
	const [croppedLogoUrl, setCroppedLogoUrl] = useState(null);
	const backdropTimerRef = useRef(null);
	const backdropBatchRef = useRef([]);
	const backdropUsedRef = useRef(0);

	const currentItemLogoUrl = currentItem ? getLogoUrl(serverUrl, currentItem, {maxWidth: 800, quality: 90}) : null;

	// Same padding-trim pass as the video player, so a logo with a lot of
	// transparent margin baked in doesn't read smaller than a tightly cropped one.
	useEffect(() => {
		setCroppedLogoUrl(null);
		if (!currentItemLogoUrl) return undefined;
		let cancelled = false;
		autocropLogoUrl(currentItemLogoUrl).then((result) => {
			if (!cancelled) setCroppedLogoUrl(result?.url || null);
		});
		return () => { cancelled = true; };
	}, [currentItemLogoUrl]);

	// Fresh arrays on every parent render would restart the slideshow, so the
	// query is keyed off the joined ids instead.
	const libraryKey = (libraryIds || []).join(',');
	const collectionKey = (collectionIds || []).join(',');
	const genreKey = (excludedGenres || []).join(',');

	useEffect(() => {
		if (visible) {
			setRendered(true);
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => {
					setShowOverlay(true);
				});
			});
		} else {
			setShowOverlay(false);
			setCurrentItem(null);
			setBackdropVisible(false);
			setBatchReady(false);
			backdropBatchRef.current = [];
			backdropUsedRef.current = 0;
			const timer = setTimeout(() => setRendered(false), 1000);
			return () => clearTimeout(timer);
		}
	}, [visible]);

	useEffect(() => {
		if (!visible || !showClock) return;
		const interval = setInterval(() => {
			setClockText(formatClockTime(shiftedNow(timeOffsetHours), clockDisplay));
		}, 1000);
		return () => clearInterval(interval);
	}, [visible, showClock, clockDisplay, timeOffsetHours]);

	useEffect(() => {
		if (!visible || !showLibrary || !serverUrl) return;
		let cancelled = false;

		const options = {
			contentType,
			libraryIds: libraryKey ? libraryKey.split(',') : [],
			collectionIds: collectionKey ? collectionKey.split(',') : [],
			excludedGenres: genreKey ? genreKey.split(',') : [],
			maxRating,
			shuffleLibrary
		};

		const fetchItems = async () => {
			try {
				const items = await loadBackdropBatch(options);
				if (cancelled || items.length === 0) return;
				backdropBatchRef.current = items;
				backdropUsedRef.current = 0;
				setCurrentItem(items[0]);
				setBatchReady(true);
				setTimeout(() => {
					if (!cancelled) setBackdropVisible(true);
				}, 500);
			} catch (err) {
				console.error('[Screensaver] Failed to fetch backdrop items:', err);
			}
		};

		const initialTimer = setTimeout(fetchItems, 2000);
		return () => {
			cancelled = true;
			clearTimeout(initialTimer);
		};
	}, [visible, showLibrary, serverUrl, contentType, libraryKey, collectionKey, genreKey, maxRating, shuffleLibrary]);

	useEffect(() => {
		if (!visible || !showLibrary || !serverUrl || !batchReady) return;

		const options = {
			contentType,
			libraryIds: libraryKey ? libraryKey.split(',') : [],
			collectionIds: collectionKey ? collectionKey.split(',') : [],
			excludedGenres: genreKey ? genreKey.split(',') : [],
			maxRating,
			shuffleLibrary
		};

		const cycle = async () => {
			backdropUsedRef.current += 1;

			if (backdropUsedRef.current >= backdropBatchRef.current.length) {
				backdropUsedRef.current = 0;
				try {
					const items = await loadBackdropBatch(options);
					if (items.length > 0) backdropBatchRef.current = items;
				} catch (err) {
					console.error('[Screensaver] Failed to refresh backdrop items:', err);
				}
			}

			const nextItem = backdropBatchRef.current[backdropUsedRef.current];
			if (nextItem) {
				setBackdropVisible(false);
				setTimeout(() => {
					setCurrentItem(nextItem);
					setTimeout(() => setBackdropVisible(true), 100);
				}, 1000);
			}
		};

		backdropTimerRef.current = setInterval(cycle, BACKDROP_INTERVAL);
		return () => {
			if (backdropTimerRef.current) {
				clearInterval(backdropTimerRef.current);
			}
		};
	}, [visible, showLibrary, serverUrl, batchReady, contentType, libraryKey, collectionKey, genreKey, maxRating, shuffleLibrary]);

	useEffect(() => {
		if (!visible || !bounces || !box || !boxRef.current) return;
		return startBounce({
			boxRef,
			animRef: boxAnimRef,
			facingRef,
			bounds: {width: window.innerWidth, height: window.innerHeight},
			width: box.width * scale,
			height: box.height * scale,
			speedMultiplier,
			margin: BOUNCE_MARGIN
		});
	}, [visible, bounces, box, scale, speedMultiplier, rendered]);

	// Patched: OK on a showing backdrop plays that title. The press is held back from the
	// screen underneath, keyup included, so it doesn't also click whatever had focus there.
	const shownItemRef = useRef(null);
	shownItemRef.current = currentItem && backdropVisible ? currentItem : null;
	const onPlayItemRef = useRef(onPlayItem);
	onPlayItemRef.current = onPlayItem;
	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;
	const onColorKeyRef = useRef(onColorKey);
	onColorKeyRef.current = onColorKey;

	// Patched: a short message over the screensaver, for what a coloured key did.
	const [notice, setNotice] = useState(null);
	const noticeTimerRef = useRef(null);
	const showNotice = useCallback((message) => {
		if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
		setNotice({message, key: Date.now()});
		noticeTimerRef.current = setTimeout(() => setNotice(null), 3500);
	}, []);
	useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);
	useEffect(() => { if (!visible) setNotice(null); }, [visible]);
	const visibleRef = useRef(visible);
	visibleRef.current = visible;
	const swallowEnterUpRef = useRef(false);

	// Patched: the app's inactivity listener hands the presses made while the screensaver is up
	// to this first (keyHandlerRef), and anything that returns true goes no further, so the
	// screen underneath never sees it and the screensaver only closes if the action closes it.
	useEffect(() => {
		if (!keyHandlerRef) return undefined;
		const isEnter = (e) => (e.keyCode || e.which) === KEYS.ENTER;
		const handler = (e) => {
			if (!visibleRef.current) return false;
			const code = e.keyCode || e.which;
			// Yellow and green act on the title on screen.
			if (onColorKeyRef.current && shownItemRef.current && (code === GREEN_KEY || code === YELLOW_KEY)) {
				const color = code === GREEN_KEY ? 'green' : 'yellow';
				Promise.resolve(onColorKeyRef.current(color, shownItemRef.current))
					.then((message) => { if (message && visibleRef.current) showNotice(message); })
					.catch(() => {});
				return true;
			}
			if (!onPlayItemRef.current || !isEnter(e)) return false;
			swallowEnterUpRef.current = true;
			const item = shownItemRef.current;
			if (item) onPlayItemRef.current(item);
			else if (onDismissRef.current) onDismissRef.current();
			return true;
		};
		keyHandlerRef.current = handler;
		// The release of that OK press is held back too, so it doesn't click whatever had focus.
		const handleKeyUp = (e) => {
			if (!swallowEnterUpRef.current || !isEnter(e)) return;
			swallowEnterUpRef.current = false;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener('keyup', handleKeyUp, true);
		return () => {
			if (keyHandlerRef.current === handler) keyHandlerRef.current = null;
			window.removeEventListener('keyup', handleKeyUp, true);
		};
	}, [keyHandlerRef, showNotice]);

	const handleInteraction = useCallback((e) => {
		e.preventDefault();
		e.stopPropagation();
		if (onDismiss) onDismiss();
	}, [onDismiss]);

	if (!rendered) return null;

	const dimmingAlpha = Math.max(0, Math.min(100, dimmingLevel)) / 100;
	const clockAlpha = 1 - (dimmingAlpha * 0.7);

	const backdropUrl = currentBackdrop
		? getImageUrl(serverUrl, currentBackdrop.id, `Backdrop/${currentBackdrop.index}`, {maxWidth: 1920, quality: 80, tag: currentBackdrop.tag})
		: null;
	const displayLogoUrl = croppedLogoUrl || currentItemLogoUrl;

	const renderComponent = () => {
		if (component === 'moonfinLogo') {
			return <img src="resources/banner-dark.png" alt="Moonfin" className={css.componentLogo} />;
		}
		if (component === 'clock') {
			return (
				<div className={css.componentClock} style={{fontSize: Math.round(CLOCK_FONT_SIZE * scale) + 'px', opacity: clockAlpha}}>
					{clockText}
				</div>
			);
		}
		if (component === 'runner') {
			return (
				<ScreensaverRunner
					size={Math.round(RUNNER_BASE_SIZE * scale)}
					speedMultiplier={bounces ? speedMultiplier : 1}
					facingRef={facingRef}
				/>
			);
		}
		return null;
	};

	return (
		<div
			className={css.overlay + ' ' + (showOverlay ? css.overlayVisible : '')}
			onClick={handleInteraction}
		>
			{showLibrary && (
				<div className={css.backdropContainer}>
					{backdropUrl && (
						<div
							className={css.backdropImage + ' ' + (backdropVisible ? css.backdropImageVisible : '')}
							style={{backgroundImage: 'url(' + backdropUrl + ')'}}
						/>
					)}
					<div className={css.backdropVignette} />
					{currentItem && backdropVisible && (currentItemLogoUrl || currentItem.Name) && (
						<div className={css.backdropInfo}>
							{currentItemLogoUrl ? (
								<img
									src={displayLogoUrl}
									alt={currentItem.Name || ''}
									className={css.backdropLogo}
								/>
							) : (
								<h1 className={css.backdropTitle}>{currentItem.Name}</h1>
							)}
						</div>
					)}
				</div>
			)}

			{isGradientBackdrop(backdrop) && <ScreensaverGradient backdrop={backdrop} />}

			{notice && <div key={notice.key} className={css.notice}>{notice.message}</div>}

			{showLibrary && !backdropUrl && (
				<div className={css.logoContainerCentered}>
					<img
						src="resources/banner-dark.png"
						alt="Moonfin"
						className={css.logo}
					/>
				</div>
			)}

			{dimmingLevel > 0 && (
				<div
					className={css.dimmingLayer}
					style={{opacity: dimmingAlpha}}
				/>
			)}

			{box && (
				<div className={bounces ? css.bounceLayer : css.staticLayer}>
					<div
						ref={bounces ? boxRef : null}
						className={css.componentBox + (bounces ? '' : ' ' + css[anchorClass])}
						style={boxStyle}
					>
						{renderComponent()}
					</div>
				</div>
			)}
		</div>
	);
};

export default Screensaver;
