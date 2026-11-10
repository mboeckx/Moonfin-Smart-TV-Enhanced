import {useCallback, useEffect, useRef, useState} from 'react';
import $L from '@enact/i18n/$L';

import {moveTitle, readArchiveStatus} from '../../services/archiveApi';

// The Archive or Restore button on a movie or show, for the people the Archive plugin lets move
// titles. A move takes the files to the other library on disk, so the title comes back under a
// new id, and the page opens that one once the server has scanned it in.
const useArchiveAction = ({item, effectiveApi, onSelectItem, showToast}) => {
	const [status, setStatus] = useState(null);
	const [busy, setBusy] = useState(false);
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

	const isArchived = Boolean(status?.isArchived);
	const offered = Boolean(status && (isArchived ? status.canRestore : status.canArchive));

	const handleArchive = useCallback(async () => {
		if (!offered || busy || !item) return;
		const toArchive = !isArchived;
		setBusy(true);
		showToast?.(toArchive ? $L('Moving to the archive…') : $L('Moving out of the archive…'));

		let result;
		try {
			result = await moveTitle(effectiveApi, item.Id, toArchive, {isCancelled: () => !mountedRef.current});
		} catch (e) {
			result = {state: 'Failed', error: e?.status === 403 ? $L("You aren't allowed to move titles to or from the archive.") : null};
		}
		if (!mountedRef.current) return;
		setBusy(false);

		if (result.state === 'Failed') {
			showToast?.(result.error || $L('Could not move this title'));
			return;
		}
		if (result.state === 'Done' && result.newItemId) {
			showToast?.(toArchive ? $L('Moved to the archive') : $L('Moved back to the library'));
			onSelectItem?.({Id: result.newItemId, Type: item.Type, Name: item.Name});
			return;
		}
		// The files have moved, and the server's next scan brings the title up in its new place.
		setStatus(null);
		showToast?.(toArchive
			? $L('Moved to the archive. It shows up there once the server finishes scanning.')
			: $L('Moved back. It shows up in the library once the server finishes scanning.'));
	}, [offered, busy, item, isArchived, effectiveApi, onSelectItem, showToast]);

	return {
		offersArchive: offered,
		isArchived,
		archiveBusy: busy,
		handleArchive: offered ? handleArchive : null
	};
};

export default useArchiveAction;
