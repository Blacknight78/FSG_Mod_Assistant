/* global MA */

const backupState = {
	backups        : [],
	collections    : [],
	isRestoring    : false,
	selectedBackup : null,
}

const setBackupStatus = (message, type = 'secondary') => {
	const statusBox = MA.byId('backupStatus')
	if ( statusBox === null ) { return }
	statusBox.className = `alert alert-${type} mb-0`
	statusBox.textContent = message
}

const selectedCollectionKey = () => MA.byId('backupCollection')?.value ?? ''

const selectedCollectionName = () => MA.byId('backupCollection')?.selectedOptions?.[0]?.textContent ?? 'the selected collection'

const formatBackupDate = (value) => {
	if ( typeof value !== 'string' || value === '' ) { return 'unknown date' }
	return new Date(value).toLocaleString()
}

const formatBytes = (bytes) => {
	const value = Number(bytes)
	if ( !Number.isFinite(value) || value <= 0 ) { return '0 kB' }
	if ( value >= 1024 * 1024 * 1024 ) { return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB` }
	if ( value >= 1024 * 1024 ) { return `${(value / (1024 * 1024)).toFixed(2)} MB` }
	return `${(value / 1024).toFixed(2)} kB`
}

const setControlDisabled = (id, disabled) => {
	const node = MA.byId(id)
	if ( node !== null ) { node.disabled = disabled }
}

const setCleanupStatus = (node) => {
	const status = MA.byId('backupCleanupStatus')
	if ( status === null ) { return }
	status.innerHTML = ''
	if ( typeof node === 'string' ) {
		if ( node === '' ) { return }
		const wrapper = document.createElement('div')
		wrapper.className = 'alert alert-secondary mb-0'
		wrapper.textContent = node
		status.appendChild(wrapper)
		return
	}
	if ( node instanceof Node ) { status.appendChild(node) }
}

const setBackupBusy = (isBusy) => {
	backupState.isRestoring = isBusy
	for ( const id of ['backupCollection', 'backupCreate', 'backupBackToUpdates', 'backupDeleteOld'] ) {
		setControlDisabled(id, isBusy)
	}
	renderBackupList()
}

const renderCollections = () => {
	const select = MA.byId('backupCollection')
	if ( select === null ) { return }

	const previousValue = select.value
	select.innerHTML = ''

	if ( backupState.collections.length === 0 ) {
		const emptyOption = document.createElement('option')
		emptyOption.value = ''
		emptyOption.textContent = 'No collections found'
		select.appendChild(emptyOption)
		select.disabled = true
		return
	}

	for ( const collection of backupState.collections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}

	if ( previousValue !== '' && backupState.collections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	}
	select.disabled = false
}

const renderCompareEmpty = (message = 'Select a saved backup to compare it with the current collection.') => {
	const compare = MA.byId('backupCompare')
	if ( compare === null ) { return }
	compare.className = 'text-body-secondary mt-3'
	compare.textContent = message
}

const renderRestoreConfirm = (backupID) => {
	const compare = MA.byId('backupCompare')
	if ( compare === null ) { return }
	if ( backupState.isRestoring ) { return }

	for ( const existingPanel of compare.querySelectorAll('.backup-restore-confirm') ) {
		existingPanel.remove()
	}

	const backup = backupState.backups.find((item) => item.id === backupID)
	const wrapper = document.createElement('div')
	wrapper.className = 'alert alert-warning mt-3 backup-restore-confirm'

	const title = document.createElement('h4')
	title.className = 'h5'
	title.textContent = 'Confirm restore from Vault'
	wrapper.appendChild(title)

	const details = document.createElement('p')
	details.className = 'mb-3'
	details.textContent = `Restore ${backup?.collectionName ?? 'this backup'} into ${selectedCollectionName()}? Existing matching ZIPs will be backed up first. Extra mods will not be deleted.`
	wrapper.appendChild(details)

	const progress = document.createElement('div')
	progress.className = 'small text-body-secondary mb-3'
	progress.textContent = 'No files have been changed yet.'
	wrapper.appendChild(progress)

	const actions = document.createElement('div')
	actions.className = 'd-flex flex-wrap gap-2'

	const cancelButton = document.createElement('button')
	cancelButton.className = 'btn btn-outline-secondary'
	cancelButton.type = 'button'
	cancelButton.textContent = 'Cancel'
	cancelButton.addEventListener('click', () => {
		wrapper.remove()
		setBackupStatus('Restore cancelled.', 'secondary')
	})
	actions.appendChild(cancelButton)

	const restoreButton = document.createElement('button')
	restoreButton.className = 'btn btn-warning'
	restoreButton.type = 'button'
	restoreButton.textContent = 'Restore from Vault'
	restoreButton.disabled = backupState.isRestoring
	restoreButton.addEventListener('click', () => executeRestoreBackup(backupID, {
		cancelButton,
		progress,
		restoreButton,
	}))
	actions.appendChild(restoreButton)

	wrapper.appendChild(actions)
	compare.prepend(wrapper)
	setBackupStatus('Review the restore confirmation before continuing.', 'warning')
}

const renderModList = (title, mods, className = 'secondary') => {
	const wrapper = document.createElement('div')
	wrapper.className = 'mb-3'

	const heading = document.createElement('h4')
	heading.className = `h5 text-${className}`
	heading.textContent = `${title}: ${mods.length}`
	wrapper.appendChild(heading)

	if ( mods.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'text-body-secondary'
		empty.textContent = 'None'
		wrapper.appendChild(empty)
		return wrapper
	}

	const list = document.createElement('ul')
	list.className = 'mb-0'
	for ( const mod of mods.slice(0, 20) ) {
		const item = document.createElement('li')
		item.textContent = `${mod.name ?? mod.backup?.name ?? 'Unknown mod'}${mod.version || mod.backup?.version ? ` (${mod.version ?? mod.backup?.version})` : ''}`
		list.appendChild(item)
	}
	if ( mods.length > 20 ) {
		const item = document.createElement('li')
		item.textContent = `...and ${mods.length - 20} more`
		list.appendChild(item)
	}
	wrapper.appendChild(list)
	return wrapper
}

const compareBackup = async (backupID, options = {}) => {
	if ( typeof backupID !== 'string' || backupID === '' ) { return }
	if ( backupState.isRestoring && options.force !== true ) { return }

	backupState.selectedBackup = backupID
	setBackupStatus('Comparing backup against the selected collection...', 'secondary')
	const result = await window.backups_IPC.compare({
		backupID,
		collectionKey : selectedCollectionKey(),
	})

	if ( result.ok === false ) {
		setBackupStatus(`Compare failed: ${result.error}`, 'danger')
		renderCompareEmpty('The selected backup could not be compared.')
		return
	}

	const compare = MA.byId('backupCompare')
	if ( compare === null ) { return }
	compare.className = 'mt-3'
	compare.innerHTML = ''

	const summary = document.createElement('div')
	summary.className = 'alert alert-info'
	summary.textContent = `${result.backup.collectionName} backup from ${formatBackupDate(result.backup.createdAt)}. Missing: ${result.counts.missing}, changed: ${result.counts.changed}, extra current mods: ${result.counts.added}, unchanged: ${result.counts.unchanged}.`
	compare.appendChild(summary)

	if ( result.counts?.duplicatesRemoved?.backup > 0 || result.counts?.duplicatesRemoved?.current > 0 ) {
		const dedupe = document.createElement('div')
		dedupe.className = 'alert alert-secondary'
		dedupe.textContent = `Duplicate manifest entries hidden: ${result.counts.duplicatesRemoved.backup} from backup, ${result.counts.duplicatesRemoved.current} from current collection.`
		compare.appendChild(dedupe)
	}

	if ( result.counts.missing > 50 ) {
		const largeRestore = document.createElement('div')
		largeRestore.className = 'alert alert-warning'
		largeRestore.textContent = `This restore would copy ${result.counts.missing} missing mod(s) from the Vault. Large restores can take several minutes.`
		compare.appendChild(largeRestore)
	}

	compare.appendChild(renderModList('Missing from current collection', result.missing, 'danger'))
	compare.appendChild(renderModList('Different version or filename', result.changed, 'warning'))
	compare.appendChild(renderModList('Extra mods currently in collection', result.added, 'info'))

	const restorePanel = document.createElement('div')
	restorePanel.className = 'mt-3'
	const restoreButton = document.createElement('button')
	restoreButton.className = 'btn btn-warning w-100'
	restoreButton.type = 'button'
	restoreButton.textContent = 'Restore this backup from Vault'
	restoreButton.disabled = backupState.isRestoring
	restoreButton.addEventListener('click', () => renderRestoreConfirm(backupID))
	restorePanel.appendChild(restoreButton)
	compare.appendChild(restorePanel)

	setBackupStatus('Backup comparison complete. Restore will copy backup mods from the Vault and will not delete extra current mods.', 'info')
}

const executeRestoreBackup = async (backupID, ui = {}) => {
	if ( typeof backupID !== 'string' || backupID === '' || backupState.isRestoring ) { return }

	const restoreButton = ui.restoreButton ?? null
	const cancelButton = ui.cancelButton ?? null
	const progress = ui.progress ?? null
	let restoreSucceeded = false

	setBackupBusy(true)
	if ( restoreButton !== null ) {
		restoreButton.disabled = true
		restoreButton.textContent = 'Restoring...'
	}
	if ( cancelButton !== null ) { cancelButton.disabled = true }
	if ( progress !== null ) {
		progress.className = 'small text-warning mb-3'
		progress.textContent = 'Restore is running. The app may pause while ZIPs are copied, backed up, checked, and the collection is refreshed.'
	}

	setBackupStatus('Restoring collection backup from the Vault. Large backups can take several minutes...', 'warning')
	try {
		const result = await window.backups_IPC.restore({
			backupID,
			collectionKey : selectedCollectionKey(),
		})

		if ( result.ok === false ) {
			if ( progress !== null ) {
				progress.className = 'small text-danger mb-3'
				progress.textContent = `Restore failed: ${result.error}`
			}
			setBackupStatus(`Restore failed: ${result.error}`, 'danger')
			return
		}

		restoreSucceeded = true
		const message = `Restore complete. Restored ${result.restored} mod(s); ${result.failed} could not be restored.`
		if ( progress !== null ) {
			progress.className = `small text-${result.failed > 0 ? 'warning' : 'success'} mb-3`
			progress.textContent = message
		}
		setBackupStatus(message, result.failed > 0 ? 'warning' : 'success')
	} catch (err) {
		if ( progress !== null ) {
			progress.className = 'small text-danger mb-3'
			progress.textContent = `Restore failed: ${err.message}`
		}
		setBackupStatus(`Restore failed: ${err.message}`, 'danger')
	} finally {
		setBackupBusy(false)
	}

	if ( restoreSucceeded ) {
		backupState.backups = await window.backups_IPC.list()
		renderBackupList()
		await compareBackup(backupID, { force : true })
	} else {
		if ( restoreButton !== null ) {
			restoreButton.disabled = false
			restoreButton.textContent = 'Restore from Vault'
		}
		if ( cancelButton !== null ) { cancelButton.disabled = false }
	}
}

const restoreBackup = async (backupID) => {
	if ( typeof backupID !== 'string' || backupID === '' ) { return }
	if ( backupState.isRestoring ) { return }
	await compareBackup(backupID)
	renderRestoreConfirm(backupID)
}

const renderBackupList = () => {
	const list = MA.byId('backupList')
	if ( list === null ) { return }

	list.innerHTML = ''

	if ( backupState.backups.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'alert alert-secondary mb-0'
		empty.textContent = 'No collection backup manifests have been created yet.'
		list.appendChild(empty)
		renderCompareEmpty()
		return
	}

	for ( const backup of backupState.backups ) {
		const row = document.createElement('div')
		row.className = 'border rounded-3 p-3 mb-2'

		const header = document.createElement('div')
		header.className = 'd-flex flex-wrap justify-content-between gap-2'

		const title = document.createElement('div')
		title.innerHTML = `<strong>${backup.collectionName}</strong><br><span class="text-body-secondary">${formatBackupDate(backup.createdAt)} - ${backup.modCount} mod(s)</span>`
		header.appendChild(title)

		const actions = document.createElement('div')
		actions.className = 'btn-group'

		const compareButton = document.createElement('button')
		compareButton.className = 'btn btn-outline-info'
		compareButton.type = 'button'
		compareButton.textContent = 'Compare'
		compareButton.disabled = backupState.isRestoring
		compareButton.addEventListener('click', () => compareBackup(backup.id))
		actions.appendChild(compareButton)

		const restoreButton = document.createElement('button')
		restoreButton.className = 'btn btn-warning'
		restoreButton.type = 'button'
		restoreButton.textContent = 'Restore from Vault'
		restoreButton.disabled = backupState.isRestoring
		restoreButton.addEventListener('click', () => restoreBackup(backup.id))
		actions.appendChild(restoreButton)

		header.appendChild(actions)
		row.appendChild(header)
		list.appendChild(row)
	}
}

const loadBackupsWindow = async () => {
	try {
		const [collections, backups] = await Promise.all([
			window.backups_IPC.collections(),
			window.backups_IPC.list(),
		])

		backupState.collections = Array.isArray(collections) ? collections : []
		backupState.backups = Array.isArray(backups) ? backups : []

		renderCollections()
		renderBackupList()
		setBackupStatus('Collection Backups is ready.', 'info')
	} catch (err) {
		setBackupStatus(`Collection Backups failed to load: ${err.message}`, 'danger')
	}
}

const createBackup = async () => {
	const collectionKey = selectedCollectionKey()
	if ( collectionKey === '' ) {
		setBackupStatus('Choose a collection before creating a backup.', 'warning')
		return
	}

	const collectionName = MA.byId('backupCollection')?.selectedOptions?.[0]?.textContent ?? 'the selected collection'
	setBackupStatus(`Creating backup manifest for ${collectionName}...`, 'secondary')
	const result = await window.backups_IPC.create({ collectionKey })
	if ( result.ok === false ) {
		setBackupStatus(`Backup creation failed: ${result.error}`, 'danger')
		return
	}

	setBackupStatus(`Backup created for ${result.backup.collectionName} with ${result.backup.modCount} mod(s).`, 'success')
	backupState.backups = await window.backups_IPC.list()
	renderBackupList()
	await compareBackup(result.backup.id)
}

const reviewOldManifests = async () => {
	if ( backupState.isRestoring ) { return }
	setCleanupStatus('Loading backup manifest cleanup review...')

	try {
		const result = await window.backups_IPC.previewOldManifests({ keepPerCollection : 3 })
		if ( result.ok === false ) { throw new Error(result.error) }

		if ( result.count === 0 ) {
			const clean = document.createElement('div')
			clean.className = 'alert alert-success mb-0'
			clean.textContent = 'No backup manifests were found to review.'
			setCleanupStatus(clean)
			return
		}

		const wrapper = document.createElement('div')
		wrapper.className = 'alert alert-secondary mb-0'

		const title = document.createElement('div')
		title.className = 'fw-bold mb-2'
		title.textContent = `Manual backup manifest cleanup - ${result.count} manifest(s) found.`
		wrapper.appendChild(title)

		const note = document.createElement('div')
		note.className = 'mb-2'
		note.textContent = `Newest ${result.keepPerCollection} backup manifest(s) per collection are marked as recommended keep, but nothing is deleted unless you select it. This only deletes backup JSON manifests. It does not delete collection mods or Vault ZIPs.`
		wrapper.appendChild(note)

		const selectedIDs = new Set()
		const candidates = Array.isArray(result.candidates) ? result.candidates : []

		const selectionSummary = document.createElement('div')
		selectionSummary.className = 'alert alert-info py-2 mb-2'
		wrapper.appendChild(selectionSummary)

		const actions = document.createElement('div')
		actions.className = 'd-flex gap-2 flex-wrap mb-3'

		const selectOlderButton = document.createElement('button')
		selectOlderButton.className = 'btn btn-outline-warning'
		selectOlderButton.type = 'button'
		selectOlderButton.textContent = `Select older than newest ${result.keepPerCollection}`

		const selectNoneButton = document.createElement('button')
		selectNoneButton.className = 'btn btn-outline-secondary'
		selectNoneButton.type = 'button'
		selectNoneButton.textContent = 'Select none'

		const deleteButton = document.createElement('button')
		deleteButton.className = 'btn btn-danger'
		deleteButton.type = 'button'
		deleteButton.textContent = 'Delete selected manifests'
		deleteButton.disabled = true

		const cancelButton = document.createElement('button')
		cancelButton.className = 'btn btn-outline-secondary'
		cancelButton.type = 'button'
		cancelButton.textContent = 'Cancel'
		cancelButton.addEventListener('click', () => setCleanupStatus('Manifest cleanup cancelled.'))

		actions.appendChild(selectOlderButton)
		actions.appendChild(selectNoneButton)
		actions.appendChild(deleteButton)
		actions.appendChild(cancelButton)
		wrapper.appendChild(actions)

		const list = document.createElement('div')
		list.className = 'd-grid gap-2'
		wrapper.appendChild(list)

		const updateSelectionSummary = () => {
			const selectedCandidates = candidates.filter((candidate) => selectedIDs.has(candidate.id))
			const selectedBytes = selectedCandidates.reduce((total, candidate) => total + (Number(candidate.size) || 0), 0)
			const recommendedKeepSelected = selectedCandidates.filter((candidate) => candidate.recommendedKeep === true).length
			selectionSummary.textContent = `${selectedCandidates.length} selected, ${formatBytes(selectedBytes)} recoverable. ${recommendedKeepSelected > 0 ? `${recommendedKeepSelected} selected manifest(s) are marked recommended keep.` : 'No recommended-keep manifests selected.'}`
			deleteButton.disabled = selectedCandidates.length === 0
		}

		const setCheckboxes = (predicate) => {
			for ( const candidate of candidates ) {
				const checkbox = list.querySelector(`[data-backup-cleanup-id="${candidate.id}"]`)
				const shouldCheck = predicate(candidate)
				if ( shouldCheck ) {
					selectedIDs.add(candidate.id)
				} else {
					selectedIDs.delete(candidate.id)
				}
				if ( checkbox !== null ) { checkbox.checked = shouldCheck }
			}
			updateSelectionSummary()
		}

		selectOlderButton.addEventListener('click', () => setCheckboxes((candidate) => candidate.recommendedKeep !== true))
		selectNoneButton.addEventListener('click', () => setCheckboxes(() => false))

		for ( const candidate of candidates ) {
			const row = document.createElement('label')
			row.className = `border rounded p-2 d-flex gap-2 align-items-start ${candidate.recommendedKeep === true ? 'border-warning' : ''}`

			const checkbox = document.createElement('input')
			checkbox.className = 'form-check-input mt-1'
			checkbox.type = 'checkbox'
			checkbox.dataset.backupCleanupId = candidate.id
			checkbox.addEventListener('change', () => {
				if ( checkbox.checked ) {
					selectedIDs.add(candidate.id)
				} else {
					selectedIDs.delete(candidate.id)
				}
				updateSelectionSummary()
			})
			row.appendChild(checkbox)

			const body = document.createElement('div')
			body.className = 'flex-grow-1'

			const heading = document.createElement('div')
			heading.className = 'fw-bold'
			heading.textContent = `${candidate.collectionName} - ${formatBackupDate(candidate.createdAt)}`
			body.appendChild(heading)

			const details = document.createElement('div')
			details.className = 'small'
			details.textContent = `${candidate.modCount} mod(s), ${formatBytes(candidate.size)}`
			body.appendChild(details)

			const recommendation = document.createElement('div')
			recommendation.className = candidate.recommendedKeep === true ? 'text-warning small' : 'text-muted small'
			recommendation.textContent = candidate.recommendation ?? ''
			body.appendChild(recommendation)

			row.appendChild(body)
			list.appendChild(row)
		}

		deleteButton.addEventListener('click', async () => {
			const ids = [...selectedIDs]
			if ( ids.length === 0 ) { return }

			const selectedCandidates = candidates.filter((candidate) => selectedIDs.has(candidate.id))
			const selectedBytes = selectedCandidates.reduce((total, candidate) => total + (Number(candidate.size) || 0), 0)
			const recommendedKeepSelected = selectedCandidates.filter((candidate) => candidate.recommendedKeep === true).length

			const confirmPanel = document.createElement('div')
			confirmPanel.className = 'alert alert-warning mt-3 mb-0'

			const confirmTitle = document.createElement('div')
			confirmTitle.className = 'fw-bold mb-2'
			confirmTitle.textContent = `Confirm deletion of ${ids.length} backup manifest(s)`
			confirmPanel.appendChild(confirmTitle)

			const confirmText = document.createElement('div')
			confirmText.className = 'mb-2'
			confirmText.textContent = `This will recover ${formatBytes(selectedBytes)}. ${recommendedKeepSelected > 0 ? `${recommendedKeepSelected} selected manifest(s) are marked recommended keep.` : 'No recommended-keep manifests are selected.'} Collection ZIPs and Vault ZIPs will not be deleted.`
			confirmPanel.appendChild(confirmText)

			const confirmActions = document.createElement('div')
			confirmActions.className = 'd-flex gap-2 flex-wrap'

			const confirmDeleteButton = document.createElement('button')
			confirmDeleteButton.className = 'btn btn-danger'
			confirmDeleteButton.type = 'button'
			confirmDeleteButton.textContent = 'Confirm delete selected'

			const backButton = document.createElement('button')
			backButton.className = 'btn btn-outline-secondary'
			backButton.type = 'button'
			backButton.textContent = 'Back to review'
			backButton.addEventListener('click', () => confirmPanel.remove())

			confirmActions.appendChild(confirmDeleteButton)
			confirmActions.appendChild(backButton)
			confirmPanel.appendChild(confirmActions)
			wrapper.appendChild(confirmPanel)

			confirmDeleteButton.addEventListener('click', async () => {
			deleteButton.disabled = true
			cancelButton.disabled = true
				selectOlderButton.disabled = true
				selectNoneButton.disabled = true
				confirmDeleteButton.disabled = true
				backButton.disabled = true
				confirmDeleteButton.textContent = 'Deleting...'

			try {
				const deleteResult = await window.backups_IPC.deleteOldManifests({
						ids,
				})
				if ( deleteResult.ok === false ) { throw new Error(deleteResult.error) }

				backupState.backups = await window.backups_IPC.list()
				if ( backupState.selectedBackup !== null && Array.isArray(deleteResult.deletedIDs) && deleteResult.deletedIDs.includes(backupState.selectedBackup) ) {
					backupState.selectedBackup = null
					renderCompareEmpty()
				}
				renderBackupList()

				const success = document.createElement('div')
				success.className = 'alert alert-success mb-0'
				success.textContent = `Deleted ${deleteResult.deleted} old backup manifest(s). Collection ZIPs and Vault ZIPs were not touched.`
				setCleanupStatus(success)
			} catch (err) {
				const failure = document.createElement('div')
				failure.className = 'alert alert-danger mb-0'
				failure.textContent = `Manifest cleanup failed: ${err.message}`
				setCleanupStatus(failure)
			}
			})
		})
		updateSelectionSummary()
		setCleanupStatus(wrapper)
	} catch (err) {
		const failure = document.createElement('div')
		failure.className = 'alert alert-danger mb-0'
		failure.textContent = `Manifest cleanup failed: ${err.message}`
		setCleanupStatus(failure)
	}
}

window.addEventListener('DOMContentLoaded', () => {
	MA.byIdEventIfExists('backupBackToUpdates', () => window.backups_IPC.dispatchModManagement())
	MA.byIdEventIfExists('backupCreate', createBackup)
	MA.byIdEventIfExists('backupDeleteOld', reviewOldManifests)
	MA.byIdEventIfExists('backupCollection', () => {
		if ( backupState.isRestoring ) { return }
		if ( backupState.selectedBackup !== null ) { compareBackup(backupState.selectedBackup) }
	})
	loadBackupsWindow()
})
