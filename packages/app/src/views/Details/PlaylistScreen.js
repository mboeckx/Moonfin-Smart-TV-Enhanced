import {useCallback, useMemo} from 'react';
import $L from '@enact/i18n/$L';

import {useStorage} from '../../hooks/useStorage';
import {KEYS} from '../../utils/keys';
import {PLAYLIST_SORTS, autoView, displayOf, sortByKey, sortPlaylistItems} from '../../utils/playlistView';

import useItemMenuHold, {itemWithIdAt} from '../../hooks/useItemMenuHold';
import {formatDuration, getImageUrl} from '../../utils/helpers';
import {DETAIL_ICON_PATHS} from './detailIcons';
import {SpottableDiv, HorizontalContainer} from './detailsSpottables';
import {handleSeasonButtonKeyDown} from './detailsFocus';
import {PosterBadges} from './DetailBadges';

import css from './Details.module.less';

// Material icons for the view, sort and order buttons.
const GRID_ICON = 'M120-520v-320h320v320H120Zm0 400v-320h320v320H120Zm400-400v-320h320v320H520Zm0 400v-320h320v320H520ZM200-600h160v-160H200v160Zm400 0h160v-160H600v160Zm0 400h160v-160H600v160Zm-400 0h160v-160H200v160Zm400-400Zm0 240Zm-240 0Zm0-240Z';
const LIST_ICON = 'M280-600v-80h560v80H280Zm0 160v-80h560v80H280Zm0 160v-80h560v80H280ZM160-600q-17 0-28.5-11.5T120-640q0-17 11.5-28.5T160-680q17 0 28.5 11.5T200-640q0 17-11.5 28.5T160-600Zm0 160q-17 0-28.5-11.5T120-480q0-17 11.5-28.5T160-520q17 0 28.5 11.5T200-480q0 17-11.5 28.5T160-440Zm0 160q-17 0-28.5-11.5T120-320q0-17 11.5-28.5T160-360q17 0 28.5 11.5T200-320q0 17-11.5 28.5T160-280Z';
const SORT_ICON = 'M120-240v-80h240v80H120Zm0-200v-80h480v80H120Zm0-200v-80h720v80H120Z';
const UP_ICON = 'M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z';
const DOWN_ICON = 'M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z';

const PlaylistScreen = ({
	item,
	serverUrl,
	showsSection,
	posterUrl,
	genres,
	playlistItems,
	onPlay,
	onShuffle,
	onToggleFavorite,
	onItemSelect,
	onItemKeyDown,
	onFocusRow,
	playlistMenu,
	onOpenItem,
	onDelete
}) => {
	const playlistItemCount = playlistItems.length;

	// Patched: posters or the list, and an order to show them in, remembered per playlist. The
	// view starts on posters for films and shows and on the list for songs.
	const [storedView, setStoredView] = useStorage(`playlist_view_${item.Id}`, '');
	const [sortKey, setSortKey] = useStorage(`playlist_sort_${item.Id}`, 'playlist');
	const [storedDescending, setStoredDescending] = useStorage(`playlist_desc_${item.Id}`, null);
	const view = storedView || autoView(playlistItems);
	const sort = sortByKey(sortKey);
	const descending = typeof storedDescending === 'boolean' ? storedDescending : sort.descending;
	const shownItems = useMemo(() => sortPlaylistItems(playlistItems, sort.key, descending), [playlistItems, sort.key, descending]);
	// Moving a row only means something while the screen shows the playlist's own order as a list.
	const reorderable = sort.key === 'playlist' && !descending && view === 'list';
	// Rows and cards carry their place in the playlist itself, which is what moving and removing use.
	const realIndex = useMemo(() => {
		const map = new Map();
		playlistItems.forEach((entry, index) => map.set(entry.PlaylistItemId || entry.Id, index));
		return map;
	}, [playlistItems]);

	const handleToggleView = useCallback(() => setStoredView(view === 'posters' ? 'list' : 'posters'), [view, setStoredView]);
	const handleCycleSort = useCallback(() => {
		const at = PLAYLIST_SORTS.findIndex((entry) => entry.key === sort.key);
		setSortKey(PLAYLIST_SORTS[(at + 1) % PLAYLIST_SORTS.length].key);
		setStoredDescending(null);
	}, [sort.key, setSortKey, setStoredDescending]);
	const handleToggleOrder = useCallback(() => setStoredDescending(!descending), [descending, setStoredDescending]);

	// Left and right move a row only while it can be moved; otherwise they just move focus.
	const handleItemKeyDown = useCallback((ev) => {
		if (!reorderable && (ev.keyCode === KEYS.LEFT || ev.keyCode === KEYS.RIGHT)) return;
		onItemKeyDown?.(ev);
	}, [reorderable, onItemKeyDown]);

	// The hold menu's Move Up and Down follow the same rule.
	const shownMenu = useMemo(() => {
		if (!playlistMenu || reorderable) return playlistMenu;
		return {...playlistMenu, playlist: {...playlistMenu.playlist, positionOf: () => ({first: true, last: true})}};
	}, [playlistMenu, reorderable]);

	// On a poster, OK opens the title; an episode opens its series, the way its poster shows it.
	const handlePosterSelect = useCallback((ev) => {
		const entry = playlistItems.find((candidate) => candidate.Id === ev.currentTarget.dataset.playlistItemId);
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
	}, [playlistItems, onOpenItem]);

	// Holding OK on a row opens its menu.
	const rowAt = useCallback((target) => itemWithIdAt(playlistItems, 'data-playlist-item-id', target), [playlistItems]);
	const menuHold = useItemMenuHold(rowAt, shownMenu);
	const totalDuration = playlistItems.reduce((sum, t) => sum + (t.RunTimeTicks || 0), 0);

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
				{playlistItems.length > 0 && (
					<SpottableDiv className={css.btnWrapper} onClick={onPlay} onFocus={onFocusRow} spotlightId="details-primary-btn">
						<div className={css.btnAction}>
							<span className={css.btnIcon}>▶</span>
						</div>
						<span className={css.btnLabel}>{$L('Play')}</span>
					</SpottableDiv>
				)}
				{playlistItems.length > 1 && (
					<SpottableDiv className={css.btnWrapper} onClick={onShuffle}>
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
						<span className={css.btnLabel}>{$L('View')}</span>
						<span className={css.btnDetail}>{view === 'posters' ? $L('Posters') : $L('List')}</span>
					</SpottableDiv>
				)}
				{playlistItems.length > 1 && (
					<SpottableDiv className={css.btnWrapper} onClick={handleCycleSort} spotlightId="playlist-sort-btn">
						<div className={css.btnAction}>
							<svg className={css.btnIcon} viewBox="0 -960 960 960" fill="currentColor">
								<path d={SORT_ICON}/>
							</svg>
						</div>
						<span className={css.btnLabel}>{$L('Sort')}</span>
						<span className={css.btnDetail}>{$L(sort.label)}</span>
					</SpottableDiv>
				)}
				{playlistItems.length > 1 && (
					<SpottableDiv className={css.btnWrapper} onClick={handleToggleOrder} spotlightId="playlist-order-btn">
						<div className={css.btnAction}>
							<svg className={css.btnIcon} viewBox="0 -960 960 960" fill="currentColor">
								<path d={descending ? DOWN_ICON : UP_ICON}/>
							</svg>
						</div>
						<span className={css.btnLabel}>{$L('Order')}</span>
						<span className={css.btnDetail}>{descending ? $L('Descending') : $L('Ascending')}</span>
					</SpottableDiv>
				)}
			</HorizontalContainer>

			<p className={css.playlistHint}>
				{reorderable
					? $L('◀ ▶ to re-order · DEL to remove')
					: (view === 'posters' ? $L('OK to open · hold OK for more · DEL to remove') : $L('Re-ordering works in playlist order · DEL to remove'))}
			</p>

			{view === 'posters' ? (
				<div className={css.playlistPosterGrid} onKeyDown={handleItemKeyDown} {...menuHold}>
					{shownItems.map((plItem) => {
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
			<div className={`${css.trackList} ${css.playlistItemsList}`} onKeyDown={handleItemKeyDown} {...menuHold}>
				{shownItems.map((plItem) => {
					const idx = realIndex.get(plItem.PlaylistItemId || plItem.Id);
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
							data-playlist-index={idx}
							onClick={onItemSelect}
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
							<div className={css.playlistReorderArrows}>
								<span className={`${css.reorderArrow} ${!reorderable || idx === 0 ? css.reorderArrowDisabled : ''}`}>▲</span>
								<span className={`${css.reorderArrow} ${!reorderable || idx === playlistItems.length - 1 ? css.reorderArrowDisabled : ''}`}>▼</span>
							</div>
						</SpottableDiv>
					);
				})}
			</div>
			)}
		</>
	);
};

export default PlaylistScreen;
