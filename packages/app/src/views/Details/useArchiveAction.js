import {useCallback, useEffect, useRef, useState} from 'react';
import $L from '@enact/i18n/$L';

import {PLACE, canSeePlace, moveTitle, readArchiveInfo, readArchiveStatus} from '../../services/archiveApi';

const MOVING = () => ({
	[PLACE.ARCHIVE]: $L('Moving to the archive…'),
	[PLACE.SOFT_DELETE]: $L('Soft deleting…'),
	[PLACE.LIBRARY]: $L('Moving back to the library…')
});

const MOVED = () => ({
	[PLACE.ARCHIVE]: $L('Moved to the archive'),
	[PLACE.SOFT_DELETE]: $L('Soft deleted'),
	[PLACE.LIBRARY]: $L('Moved back to the library')
});

const MOVED_UNSCANNED = () => ({
	[PLACE.ARCHIVE]: $L('Moved to the archive. It shows up there once the server finishes scanning.'),
	[PLACE.SOFT_DELETE]: $L('Soft deleted. It shows up there once the server finishes scanning.'),
	[PLACE.LIBRARY]: $L('Moved back. It shows up in the library once the server finishes scanning.')
});

// The Archive and Soft Delete buttons on a movie or show, for the people the Archive plugin gives
// them to. Each is one button that flips: Move to Archive becomes Restore from Archive on an
// archived title, and Soft Delete becomes Undo Soft Delete on a soft deleted one.
//
// A move takes the files to another library on disk, so the title comes back under a new id. The
// page opens that one once the server has scanned it in, or, when this viewer may not see where it
// went, leaves the page the way a delete does.
const useArchiveAction = ({item, effectiveApi, onSelectItem, onLeave, showToast}) => {
	const [status, setStatus] = useState(null);
	const [busy, setBusy] = useState(null);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => { mountedRef.current = false; };
	}, []);

	const itemId = item?.Id;
	const itemType = item?.Type;
	useEffect(() => {
		let cancelled = false;
		setStatus(null);
		if (!itemId) return undefined;
		readArchiveStatus(effectiveApi, {Id: itemId, Type: itemType}).then((next) => {
			if (!cancelled) setStatus(next);
		});
		return () => { cancelled = true; };
	}, [effectiveApi, itemId, itemType]);

	const move = useCallback(async (to) => {
		if (busy || !item) return;
		setBusy(to);
		showToast?.(MOVING()[to]);

		let result;
		try {
			result = await moveTitle(effectiveApi, item.Id, to, {isCancelled: () => !mountedRef.current});
		} catch (e) {
			result = {state: 'Failed', error: e?.status === 403 ? $L("You aren't allowed to move this title there.") : null};
		}
		if (!mountedRef.current) return;
		setBusy(null);

		if (result.state === 'Failed') {
			showToast?.(result.error || $L('Could not move this title'));
			return;
		}

		const info = await readArchiveInfo(effectiveApi);
		if (!mountedRef.current) return;
		if (!canSeePlace(info, to)) {
			// Gone somewhere this viewer can't follow, so the page goes the way a delete would.
			showToast?.(MOVED()[to]);
			onLeave?.();
			return;
		}
		if (result.state === 'Done' && result.newItemId) {
			showToast?.(MOVED()[to]);
			onSelectItem?.({Id: result.newItemId, Type: item.Type, Name: item.Name});
			return;
		}
		// The files have moved, and the server's next scan brings the title up in its new place.
		setStatus(null);
		showToast?.(MOVED_UNSCANNED()[to]);
	}, [busy, item, effectiveApi, onSelectItem, onLeave, showToast]);

	const location = status?.location || PLACE.LIBRARY;
	const isArchived = location === PLACE.ARCHIVE;
	const isSoftDeleted = location === PLACE.SOFT_DELETE;

	// Each button takes the title onto its shelf, or off it when it's already there.
	const archiveTarget = isArchived ? PLACE.LIBRARY : PLACE.ARCHIVE;
	const offersArchive = Boolean(status && (isArchived ? status.canRestore : status.canArchive));
	const softDeleteTarget = isSoftDeleted ? PLACE.LIBRARY : PLACE.SOFT_DELETE;
	const offersSoftDelete = Boolean(status && (isSoftDeleted ? status.canRestore : status.canSoftDelete));

	const handleArchive = useCallback(() => move(archiveTarget), [move, archiveTarget]);
	const handleSoftDelete = useCallback(() => move(softDeleteTarget), [move, softDeleteTarget]);

	return {
		handleArchive: offersArchive ? handleArchive : null,
		isArchived,
		archiveBusy: busy === archiveTarget && offersArchive,
		handleSoftDelete: offersSoftDelete ? handleSoftDelete : null,
		isSoftDeleted,
		softDeleteBusy: busy === softDeleteTarget && offersSoftDelete
	};
};

export default useArchiveAction;
