import {useState, useCallback, useMemo, useRef, useEffect} from 'react';
import PropTypes from 'prop-types';
import $L from '@enact/i18n/$L';
import {useStorage} from '../../hooks/useStorage';
import {KEYS} from '../../utils/keys';
import {autoView, displayOf} from '../../utils/playlistView';

import useItemMenuHold, {itemWithIdAt} from '../../hooks/useItemMenuHold';
import {formatDuration, getImageUrl} from '../../utils/helpers';
import {DETAIL_ICON_PATHS} from './detailIcons';
import {SpottableDiv, HorizontalContainer} from './detailsSpottables';
import {handleSeasonButtonKeyDown} from './detailsFocus';
import {PosterBadges} from './DetailBadges';
import PlaylistSortFilterBar, {EmptyPlaylistFilterState, EmptyPlaylistState} from '../../components/PlaylistSortFilterBar';
import {
	sortAndFilterPlaylistTracks,
	showsPlaylistOrder,
	playlistRowMenu,
	PLAYLIST_SORT_ORDER,
	PLAYLIST_SORT_RANDOM,
	SORT_DIR_ASC,
	PLAYED_ALL
} from '../../utils/playlistSortFilter';

import css from './Details.module.less';

// Patched: Material icons for the view button.
const GRID_ICON = 'M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Zm400-400Zm0 240Zm-240 0Zm0-240Z';
const LIST_ICON = 'M280-600v-80h560v80H280Zm0 160v-80h560v80H280Zm0 160v-80h560v80H280ZM160-600q-17 0-28.5-11.5T120-640q0-17 11.5-28.5T160-680q17 0 28.5 11.5T200-640q0 17-11.5 28.5T160-600Zm0 160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520q17 0 28.5 11.5T200-480q0 17-11.5 28.5T160-440Zm0 160q-17 0-28.5-11.5T120-320q0-17 11.5-28.5T160-360q17 0 28.5 11.5T200-320q0 17-11.5 28.5T160-280Z';

const PlaylistScreen = ({
	item,
	serverUrl,
	showsSection,
	posterUrl,
	genres,
	playlistItems = [],
	onPlay,
	onShuffle,
	onToggleFavorite,
	onItemSelect,
	onItemKeyDown,
	onFocusRow,
	playlistMenu,
	spotlightBackRef,
	onOpenItem,
	onDelete
}) => {
	const sortFilterBackRef = useRef(null);
	useEffect(() => {
		if (!spotlightBackRef) return undefined;
		const handler = () => Boolean(sortFilterBackRef.current?.());
		spotlightBackRef.current = handler;
		return () => {
			if (spotlightBackRef.current === handler) spotlightBackRef.current = null;
		};
	}, [spotlightBackRef]);

	// Patched: the sort is remembered per playlist, like the view.
	const [sortBy, setSortBy] = useStorage(`playlist_sortby_${item.Id}`, PLAYLIST_SORT_ORDER);
	const [sortDirection, setSortDirection] = useStorage(`playlist_sortdir_${item.Id}`, SORT_DIR_ASC);
	const [playedFilter, setPlayedFilter] = useState(PLAYED_ALL);
	const [favoriteOnly, setFavoriteOnly] = useState(false);
	const [mediaTypeFilter, setMediaTypeFilter] = useState(null);
	const [randomSeed, setRandomSeed] = useState(42);

	const availableMediaTypes = useMemo(() => {
		const set = new Set();
		playlistItems.forEach((t) => {
			const type = t.MediaType || t.Type;
			if (type) set.add(type);
		});
		return Array.from(set);
	}, [playlistItems]);

	const displayedTracks = useMemo(() => sortAndFilterPlaylistTracks({
		tracks: playlistItems,
		sortBy,
		sortDirection,
		playedFilter,
		favoriteOnly,
		mediaTypeFilter,
		randomSeed
	}), [playlistItems, sortBy, sortDirection, playedFilter, favoriteOnly, mediaTypeFilter, randomSeed]);

	const isDefaultOrder = showsPlaylistOrder({sortBy, sortDirection, playedFilter, favoriteOnly, mediaTypeFilter});

	// Patched: posters or the list, remembered per playlist. It starts on posters for films and
	// shows and on the list for songs.
	const [storedView, setStoredView] = useStorage(`playlist_view_${item.Id}`, '');
	const view = storedView || autoView(playlistItems);
	const handleToggleView = useCallback(() => setStoredView(view === 'posters' ? 'list' : 'posters'), [view, setStoredView]);
	// Moving an entry only means something while the list shows the playlist's own order.
	const reorderable = isDefaultOrder && view === 'list';
	// Rows and cards carry their place in the playlist itself, so removing one works in any order.
	const realIndex = useMemo(() => {
		const map = new Map();
		playlistItems.forEach((entry, index) => map.set(entry.PlaylistItemId || entry.Id, index));
		return map;
	}, [playlistItems]);
	const handleEntryKeyDown = useCallback((ev) => {
		if (!reorderable && (ev.keyCode === KEYS.LEFT || ev.keyCode === KEYS.RIGHT)) return;
		onItemKeyDown?.(ev);
	}, [reorderable, onItemKeyDown]);
	// On a poster, OK opens the title; an episode opens its series, the way its poster shows it.
	const handlePosterSelect = useCallback((ev) => {
		const entry = displayedTracks[parseInt(ev.currentTarget.getAttribute('data-index'), 10)];
		if (!entry || !onOpenItem) return;
		if (entry.Type === 'Episode' && entry.SeriesId) {
			const series = {Id: entry.SeriesId, Type: 'Series', Name: entry.SeriesName};
			['_serverUrl', '_serverAccessToken', '_serverUserId', '_serverName', '_serverId', '_serverType'].forEach((key) => {
				if (entry[key]) series[key] = entry[key];
			});
			onOpenItem(series);
		} else {
			onOpenItem(entry);
		}
	}, [displayedTracks, onOpenItem]);

	const handleSortChange = useCallback((newSort, newDir) => {
		setSortBy(newSort);
		setSortDirection(newDir);
		if (newSort === PLAYLIST_SORT_RANDOM) {
			setRandomSeed(Date.now());
		}
	}, [setSortBy, setSortDirection]);

	const handleFilterChange = useCallback(({playedFilter: pf, favoriteOnly: fo, mediaTypeFilter: mtf}) => {
		if (pf !== undefined) setPlayedFilter(pf);
		if (fo !== undefined) setFavoriteOnly(fo);
		if (mtf !== undefined) setMediaTypeFilter(mtf);
	}, []);

	const handleReset = useCallback(() => {
		setSortBy(PLAYLIST_SORT_ORDER);
		setSortDirection(SORT_DIR_ASC);
		setPlayedFilter(PLAYED_ALL);
		setFavoriteOnly(false);
		setMediaTypeFilter(null);
		setRandomSeed(Date.now());
	}, [setSortBy, setSortDirection]);

	const handlePlayClick = useCallback(() => {
		if (displayedTracks.length > 0) {
			onPlay?.(displayedTracks[0], displayedTracks);
		}
	}, [displayedTracks, onPlay]);

	const handleShuffleClick = useCallback(() => {
		if (displayedTracks.length > 1) {
			onShuffle?.(displayedTracks);
		}
	}, [displayedTracks, onShuffle]);

	const handleItemClick = useCallback((ev) => {
		const card = ev.currentTarget;
		const idxStr = card?.getAttribute?.('data-index');
		const idx = idxStr != null ? parseInt(idxStr, 10) : -1;
		const track = (idx >= 0 && idx < displayedTracks.length)
			? displayedTracks[idx]
			: displayedTracks.find((t) => (t.PlaylistItemId || t.Id) === card?.dataset?.playlistItemId);
		if (track) {
			if (onItemSelect) {
				onItemSelect(ev, track, displayedTracks);
			} else {
				onPlay?.(track, displayedTracks);
			}
		}
	}, [displayedTracks, onItemSelect, onPlay]);

	const playlistItemCount = displayedTracks.length;
	// Holding OK on a row opens its menu.
	const rowAt = useCallback((target) => {
		const card = target.closest('[data-index]');
		const idx = card ? parseInt(card.getAttribute('data-index'), 10) : -1;
		if (idx >= 0 && idx < displayedTracks.length) return displayedTracks[idx];
		return itemWithIdAt(displayedTracks, 'data-playlist-item-id', target);
	}, [displayedTracks]);
	const rowMenuOptions = useMemo(
		() => playlistRowMenu(playlistMenu, displayedTracks, reorderable),
		[playlistMenu, displayedTracks, reorderable]
	);
	const menuHold = useItemMenuHold(rowAt, rowMenuOptions);
	const totalDuration = displayedTracks.reduce((sum, t) => sum + (t.RunTimeTicks || 0), 0);

	return (
		<>
			<div className={css.seasonDetailHeader}>
				{showsSection('poster') && posterUrl && (
					<div className={css.seasonDetailPoster}>
						<img src={posterUrl} alt="" />
						<PosterBadges userData={item.UserData} />
					</div>
				)}
				<div className={css.seasonDetailInfo}>
					<h1 className={css.seasonDetailTitle}>{item.Name}</h1>
					<span className={css.seasonDetailCount}>
						{playlistItemCount} {playlistItemCount !== 1 ? $L('Items') : $L('Item')}
						{totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ''}
					</span>
					{genres.length > 0 && (
						<span className={css.seasonDetailCount}>{genres.join(', ')}</span>
					)}
					{item.Overview && <p className={css.overview}>{item.Overview}</p>}
				</div>
			</div>

			<HorizontalContainer className={css.actionButtons} onKeyDown={handleSeasonButtonKeyDown} onFocus={onFocusRow}>
				{displayedTracks.length > 0 && (
					<SpottableDiv className={css.btnWrapper} onClick={handlePlayClick} onFocus={onFocusRow} spotlightId="details-primary-btn">
						<div className={css.btnAction}>
							<span className={css.btnIcon}>▶</span>
						</div>
						<span className={css.btnLabel}>{$L('Play')}</span>
					</SpottableDiv>
				)}
				{displayedTracks.length > 1 && (
					<SpottableDiv className={css.btnWrapper} onClick={handleShuffleClick}>
						<div className={css.btnAction}>
							<svg className={css.btnIcon} viewBox="0 -960 960 960" fill="currentColor">
								<path d={DETAIL_ICON_PATHS.shuffle}/>
							</svg>
						</div>
						<span className={css.btnLabel}>{$L('Shuffle')}</span>
					</SpottableDiv>
				)}
				<SpottableDiv className={css.btnWrapper} onClick={onToggleFavorite} spotlightId="details-favorite-btn">
					<div className={css.btnAction}>
						<svg className={`${css.btnIcon} ${item.UserData?.IsFavorite ? css.favorited : ''}`} viewBox="0 -960 960 960" fill="currentColor">
							<path d={DETAIL_ICON_PATHS.favorite}/>
						</svg>
					</div>
					<span className={css.btnLabel}>{item.UserData?.IsFavorite ? $L('Favorited') : $L('Favorite')}</span>
				</SpottableDiv>
				{onDelete && (
					<SpottableDiv className={css.btnWrapper} onClick={onDelete} spotlightId="playlist-delete-btn">
						<div className={css.btnAction}>
							<svg className={css.btnIcon} viewBox="0 -960 960 960" fill="currentColor">
								<path d={DETAIL_ICON_PATHS.delete}/>
							</svg>
						</div>
						<span className={css.btnLabel}>{$L('Delete')}</span>
					</SpottableDiv>
				)}
				{playlistItems.length > 0 && (
					<SpottableDiv className={css.btnWrapper} onClick={handleToggleView} spotlightId="playlist-view-btn">
						<div className={css.btnAction}>
							<svg className={css.btnIcon} viewBox="0 -960 960 960" fill="currentColor">
								<path d={view === 'posters' ? GRID_ICON : LIST_ICON}/>
							</svg>
						</div>
						<span className={css.btnLabel}>{view === 'posters' ? $L('Posters') : $L('List')}</span>
					</SpottableDiv>
				)}
			</HorizontalContainer>

			<PlaylistSortFilterBar
				sortBy={sortBy}
				sortDirection={sortDirection}
				onSortChange={handleSortChange}
				playedFilter={playedFilter}
				favoriteOnly={favoriteOnly}
				mediaTypeFilter={mediaTypeFilter}
				availableMediaTypes={availableMediaTypes}
				onFilterChange={handleFilterChange}
				onReset={handleReset}
				backHandlerRef={sortFilterBackRef}
			/>

			{displayedTracks.length > 0 && (
				<p className={css.playlistHint}>
					{reorderable
						? $L('◀ ▶ to re-order · DEL to remove')
						: (view === 'posters' ? $L('OK to open · hold OK for more · DEL to remove') : $L('DEL to remove'))}
				</p>
			)}

			{playlistItems.length === 0 ? (
				<EmptyPlaylistState />
			) : displayedTracks.length === 0 ? (
				<EmptyPlaylistFilterState onReset={handleReset} />
			) : view === 'posters' ? (
				<div className={css.playlistPosterGrid} onKeyDown={handleEntryKeyDown} {...menuHold}>
					{displayedTracks.map((plItem, idx) => {
						const shown = displayOf(plItem);
						const cardPosterUrl = shown.imageId
							? getImageUrl(serverUrl, shown.imageId, 'Primary', {maxHeight: 330, quality: 80, tag: shown.imageTag})
							: null;
						return (
							<SpottableDiv
								key={plItem.PlaylistItemId || plItem.Id}
								className={css.playlistPoster}
								data-playlist-item-id={plItem.Id}
								data-playlist-index={realIndex.get(plItem.PlaylistItemId || plItem.Id)}
								data-index={idx}
								onClick={handlePosterSelect}
							>
								<div className={css.playlistPosterImage}>
									{cardPosterUrl ? <img src={cardPosterUrl} alt="" /> : <span className={css.playlistPosterFallback}>{shown.title}</span>}
									<PosterBadges userData={plItem.UserData} />
								</div>
								<span className={css.playlistPosterTitle}>{shown.title}</span>
								{shown.subtitle && <span className={css.playlistPosterSubtitle}>{shown.subtitle}</span>}
							</SpottableDiv>
						);
					})}
				</div>
			) : (
				<div className={`${css.trackList} ${css.playlistItemsList}`} onKeyDown={handleEntryKeyDown} {...menuHold}>
					{displayedTracks.map((plItem, idx) => {
						const plDuration = plItem.RunTimeTicks ? formatDuration(plItem.RunTimeTicks) : '';
						const plArtist = plItem.AlbumArtist || plItem.Artists?.[0] || '';
						const isAudio = plItem.MediaType === 'Audio';
						const thumbUrl = plItem.ImageTags?.Primary
							? getImageUrl(serverUrl, plItem.Id, 'Primary', {maxHeight: 80, quality: 80})
							: null;

						return (
							<SpottableDiv
								key={plItem.PlaylistItemId || plItem.Id}
								className={css.playlistItem}
								data-playlist-item-id={plItem.Id}
								data-playlist-index={realIndex.get(plItem.PlaylistItemId || plItem.Id)}
								data-index={idx}
								onClick={handleItemClick}
							>
								<span className={css.trackNumber}>{idx + 1}</span>
								{thumbUrl && (
									<div className={css.playlistItemThumb}>
										<img src={thumbUrl} alt="" />
									</div>
								)}
								<div className={css.trackInfo}>
									<span className={css.trackTitle}>{plItem.Name}</span>
									{plArtist && <span className={css.trackArtist}>{plArtist}</span>}
									{!isAudio && plItem.Type && <span className={css.trackArtist}>{plItem.Type}</span>}
								</div>
								<span className={css.trackDuration}>{plDuration}</span>
								{isDefaultOrder && (
									<div className={css.playlistReorderArrows}>
										<span className={`${css.reorderArrow} ${idx === 0 ? css.reorderArrowDisabled : ''}`}>▲</span>
										<span className={`${css.reorderArrow} ${idx === displayedTracks.length - 1 ? css.reorderArrowDisabled : ''}`}>▼</span>
									</div>
								)}
							</SpottableDiv>
						);
					})}
				</div>
			)}
		</>
	);
};

PlaylistScreen.propTypes = {
	genres: PropTypes.arrayOf(PropTypes.string),
	item: PropTypes.object.isRequired,
	onFocusRow: PropTypes.func,
	onItemKeyDown: PropTypes.func,
	onDelete: PropTypes.func,
	onItemSelect: PropTypes.func,
	onOpenItem: PropTypes.func,
	onPlay: PropTypes.func,
	onShuffle: PropTypes.func,
	onToggleFavorite: PropTypes.func,
	playlistItems: PropTypes.arrayOf(PropTypes.object),
	playlistMenu: PropTypes.object,
	posterUrl: PropTypes.string,
	serverUrl: PropTypes.string,
	showsSection: PropTypes.func.isRequired,
	spotlightBackRef: PropTypes.oneOfType([
		PropTypes.func,
		PropTypes.shape({current: PropTypes.any})
	])
};

export default PlaylistScreen;
