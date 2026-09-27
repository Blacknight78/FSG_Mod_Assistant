/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

/* global I18N, MA, bootstrap */

const historyState = {
	collections    : [],
	entries        : [],
	isBusy         : false,
	mode           : 'history',
	recentChanges  : [],
}

const fallbackLabels = {
	history_action_collection_backup_restored : 'Restored from backup manifest',
	history_action_collection_mod_disabled    : 'Disabled for testing',
	history_action_manifest_installed : 'Shared collection mod installed',
	history_action_update_applied     : 'Update applied',
	history_action_update_rolled_back : 'Update rolled back',
	history_action_update_staged      : 'Update staged',
	history_action_vault_cleanup_deleted : 'Vault cleanup deleted',
	history_action_vault_copied       : 'Copied from vault',
	history_backup_saved              : 'Backup saved',
	history_empty                     : 'No collection history has been recorded yet.',
	history_entries_found             : 'history entrie(s) found.',
	history_filter_all_actions        : 'All actions',
	history_filter_all_collections    : 'All collections',
	history_filter_no_matches         : 'No history entries match the current filters.',
	history_integrity_checked         : 'ZIP checked',
	history_replaced_existing         : 'replaced existing copy',
	history_rollback_button           : 'Rollback to this version',
	history_rollback_failed           : 'Rollback failed:',
	history_rollback_restored         : 'Rollback restored.',
	history_rollback_restoring        : 'Restoring rollback backup...',
}

function formatTimestamp(timestamp) {
	const date = new Date(timestamp)
	if ( Number.isNaN(date.getTime()) ) { return timestamp ?? '' }
	return date.toLocaleString()
}

function normalValue(value) {
	return (value ?? '').toString().toLowerCase()
}

function dateValue(timestamp) {
	const date = new Date(timestamp)
	if ( Number.isNaN(date.getTime()) ) { return null }
	return date
}

function plainLabel(key) {
	const label = I18N.defer(key, false)
	if ( label.includes('<i18n-text') ) { return fallbackLabels[key] ?? key }
	return label
}

function setText(id, text) {
	const node = MA.byId(id)
	if ( node !== null ) { node.textContent = text }
}

function setStatus(message, type = 'secondary') {
	const node = MA.byId('historyStatus')
	if ( node === null ) { return }
	node.className = `alert history-status-card alert-${type} mb-3`
	node.textContent = message
}

function setControlDisabled(id, disabled) {
	const node = MA.byId(id)
	if ( node !== null ) { node.disabled = disabled }
}

function setBusy(isBusy) {
	historyState.isBusy = isBusy
	for ( const id of [
		'historyRefresh',
		'historyModeHistory',
		'historyModeRecent',
		'historyModeHistorySide',
		'historyModeRecentSide',
		'historyRecentCollection',
		'historyClearFilters',
		'historyClearLog',
		'historyBackToUpdates',
	] ) {
		setControlDisabled(id, isBusy)
	}
}

function actionLabelText(action) {
	if ( action === 'collection_backup_restored' ) { return plainLabel('history_action_collection_backup_restored') }
	if ( action === 'collection_mod_disabled' ) { return plainLabel('history_action_collection_mod_disabled') }
	if ( action === 'update_applied' ) { return plainLabel('history_action_update_applied') }
	if ( action === 'update_rolled_back' ) { return plainLabel('history_action_update_rolled_back') }
	if ( action === 'update_staged' ) { return plainLabel('history_action_update_staged') }
	if ( action === 'manifest_installed' ) { return plainLabel('history_action_manifest_installed') }
	if ( action === 'vault_cleanup_deleted' ) { return plainLabel('history_action_vault_cleanup_deleted') }
	if ( action === 'vault_copied' ) { return plainLabel('history_action_vault_copied') }
	return action ?? ''
}

function fillSelect(selectID, values, allLabelKey) {
	const select = MA.byId(selectID)
	if ( select === null ) { return }
	const previousValue = select.value
	select.innerHTML = ''

	const allOption = document.createElement('option')
	allOption.value = ''
	allOption.textContent = plainLabel(allLabelKey)
	select.appendChild(allOption)

	for ( const value of values ) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = selectID === 'historyCollectionFilter' ? value : actionLabelText(value)
		select.appendChild(option)
	}

	if ( previousValue !== '' && values.includes(previousValue) ) {
		select.value = previousValue
	}
}

function renderRecentCollectionSelect() {
	const select = MA.byId('historyRecentCollection')
	if ( select === null ) { return }
	const previousValue = select.value
	select.innerHTML = ''

	if ( historyState.collections.length === 0 ) {
		const option = document.createElement('option')
		option.value = ''
		option.textContent = 'No collections available'
		select.appendChild(option)
		select.disabled = true
		return
	}

	for ( const collection of historyState.collections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}

	if ( previousValue !== '' && historyState.collections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	}
	select.disabled = historyState.isBusy
}

function setupFilters(entries) {
	const collections = [...new Set(entries.map((entry) => entry.collectionName).filter(Boolean))].sort()
	const actions = [...new Set(entries.map((entry) => entry.action).filter(Boolean))].sort()
	fillSelect('historyCollectionFilter', collections, 'history_filter_all_collections')
	fillSelect('historyActionFilter', actions, 'history_filter_all_actions')
}

function filterHistory(entries) {
	const collectionFilter = MA.byId('historyCollectionFilter')?.value ?? ''
	const actionFilter = MA.byId('historyActionFilter')?.value ?? ''
	const fromFilter = MA.byId('historyFromFilter')?.value ?? ''
	const toFilter = MA.byId('historyToFilter')?.value ?? ''
	const textFilter = normalValue(MA.byId('historyTextFilter')?.value)
	const fromDate = fromFilter === '' ? null : new Date(`${fromFilter}T00:00:00`)
	const toDate = toFilter === '' ? null : new Date(`${toFilter}T23:59:59`)

	return entries.filter((entry) => {
		if ( collectionFilter !== '' && entry.collectionName !== collectionFilter ) { return false }
		if ( actionFilter !== '' && entry.action !== actionFilter ) { return false }

		const entryDate = dateValue(entry.timestamp)
		if ( fromDate !== null && (entryDate === null || entryDate < fromDate) ) { return false }
		if ( toDate !== null && (entryDate === null || entryDate > toDate) ) { return false }

		if ( textFilter !== '' ) {
			const searchText = normalValue([
				entry.action,
				entry.collectionName,
				entry.fileName,
				entry.modName,
				entry.currentVersion,
				entry.previousVersion,
				entry.source,
				entry.sourceURL,
				entry.stagedPath,
				entry.backupPath,
				entry.targetPath,
				entry.cleanupHash,
			].join(' '))
			if ( !searchText.includes(textFilter) ) { return false }
		}

		return true
	})
}

function canRollbackEntry(entry) {
	return typeof entry?.backupPath === 'string' &&
		typeof entry?.targetPath === 'string' &&
		entry.action !== 'update_rolled_back'
}

function appendBadge(container, text, className) {
	if ( typeof text !== 'string' || text === '' ) { return }
	const badge = document.createElement('span')
	badge.className = `badge ${className} me-1 mb-1`
	badge.textContent = text
	container.appendChild(badge)
}

function appendPath(container, value) {
	if ( typeof value !== 'string' || value === '' ) { return }
	const pathNode = document.createElement('div')
	pathNode.className = 'small mt-1 history-path user-select-text'
	pathNode.textContent = value
	container.appendChild(pathNode)
}

function appendVersionBadges(container, entry) {
	const previousVersion = typeof entry?.previousVersion === 'string' && entry.previousVersion !== '' ? entry.previousVersion : null
	const currentVersion = typeof entry?.currentVersion === 'string' && entry.currentVersion !== '' ? entry.currentVersion : null

	if ( previousVersion === null && currentVersion === null ) { return }
	if ( previousVersion !== null && currentVersion !== null && previousVersion !== currentVersion ) {
		appendBadge(container, `From ${previousVersion}`, 'text-bg-secondary')
		appendBadge(container, `To ${currentVersion}`, 'text-bg-info')
		return
	}
	appendBadge(container, `Version ${currentVersion ?? previousVersion}`, 'text-bg-info')
}

// eslint-disable-next-line complexity
function historyTimeline(entry) {
	const previousVersion = typeof entry?.previousVersion === 'string' && entry.previousVersion !== '' ? entry.previousVersion : null
	const currentVersion = typeof entry?.currentVersion === 'string' && entry.currentVersion !== '' ? entry.currentVersion : null
	const rollbackVersion = typeof entry?.rollbackVersion === 'string' && entry.rollbackVersion !== '' ? entry.rollbackVersion : currentVersion
	const modName = entry?.modName ?? 'mod'

	if ( entry?.action === 'update_applied' && previousVersion !== null && currentVersion !== null ) {
		return `Updated ${modName} from ${previousVersion} to ${currentVersion}. Previous copy saved for rollback.`
	}
	if ( entry?.action === 'update_rolled_back' && rollbackVersion !== null ) {
		const fromText = previousVersion !== null ? ` from ${previousVersion}` : ''
		return `Restored ${modName}${fromText} to ${rollbackVersion}. The replaced copy was saved as a new rollback point.`
	}
	if ( entry?.action === 'vault_copied' && currentVersion !== null ) {
		return `Copied version ${currentVersion} from the Vault into this collection.`
	}
	if ( entry?.action === 'manifest_installed' && currentVersion !== null ) {
		const previousText = previousVersion === null ? '' : `, replacing ${previousVersion}`
		return `Installed shared collection mod ${modName} version ${currentVersion}${previousText}.`
	}
	if ( entry?.action === 'collection_mod_disabled' ) {
		return `Disabled ${modName} for collection troubleshooting.`
	}
	if ( entry?.integrityChecked ) {
		const versionText = typeof entry?.integrityVersion === 'string' && entry.integrityVersion !== '' ? ` Version ${entry.integrityVersion}.` : ''
		return `ZIP integrity was checked before this action completed.${versionText}`
	}
	return ''
}

async function rollbackHistoryEntry(entry, button) {
	button.disabled = true
	setStatus(plainLabel('history_rollback_restoring'), 'warning')

	const result = await window.history_IPC.rollbackEntry(entry)
	if ( result.ok ) {
		setStatus(plainLabel('history_rollback_restored'), 'success')
		await reloadHistory()
	} else {
		setStatus(`${plainLabel('history_rollback_failed')} ${result.error}`, 'danger')
		button.disabled = false
	}
}

function renderHistory(entries, totalEntries) {
	const list = MA.byId('historyList')
	if ( list === null ) { return }
	list.innerHTML = ''

	if ( entries.length === 0 ) {
		setStatus(totalEntries === 0 ? plainLabel('history_empty') : plainLabel('history_filter_no_matches'))
		return
	}

	setStatus(`${entries.length} / ${totalEntries} ${plainLabel('history_entries_found')}`)

	for ( const entry of entries ) {
		const row = document.createElement('article')
		row.className = 'history-entry'

		const header = document.createElement('div')
		header.className = 'd-flex justify-content-between gap-3'

		const titleBlock = document.createElement('div')
		const title = document.createElement('div')
		title.className = 'fw-bold'
		title.textContent = entry.modName ?? ''
		const fileName = document.createElement('div')
		fileName.className = 'small fst-italic'
		fileName.textContent = entry.fileName ?? ''
		titleBlock.append(title, fileName)

		const actionBlock = document.createElement('div')
		actionBlock.className = 'text-end'
		const action = document.createElement('div')
		appendBadge(action, actionLabelText(entry.action), 'text-bg-info')
		const time = document.createElement('div')
		time.className = 'small'
		time.textContent = formatTimestamp(entry.timestamp)
		actionBlock.append(action, time)
		header.append(titleBlock, actionBlock)
		row.appendChild(header)

		const badges = document.createElement('div')
		badges.className = 'mt-2'
		appendBadge(badges, entry.collectionName ?? '', 'text-bg-secondary')
		appendBadge(badges, entry.source ?? '', 'text-bg-warning')
		if ( entry.replacedExisting ) { appendBadge(badges, plainLabel('history_replaced_existing'), 'text-bg-success') }
		if ( entry.backupPath ) { appendBadge(badges, plainLabel('history_backup_saved'), 'text-bg-success') }
		if ( entry.integrityChecked ) { appendBadge(badges, plainLabel('history_integrity_checked'), 'text-bg-primary') }
		appendVersionBadges(badges, entry)
		row.appendChild(badges)

		const timeline = historyTimeline(entry)
		if ( timeline !== '' ) {
			const timelineNode = document.createElement('div')
			timelineNode.className = 'small mt-2'
			timelineNode.textContent = timeline
			row.appendChild(timelineNode)
		}

		appendPath(row, entry.stagedPath)
		appendPath(row, entry.backupPath)
		appendPath(row, entry.targetPath)
		appendPath(row, entry.sourceURL)

		if ( canRollbackEntry(entry) ) {
			const rollbackButton = document.createElement('button')
			rollbackButton.className = 'btn btn-sm btn-info mt-2'
			rollbackButton.type = 'button'
			rollbackButton.textContent = plainLabel('history_rollback_button')
			rollbackButton.addEventListener('click', () => { rollbackHistoryEntry(entry, rollbackButton) })
			row.appendChild(rollbackButton)
		}

		list.appendChild(row)
	}
}

function renderFilteredHistory() {
	renderHistory(filterHistory(historyState.entries), historyState.entries.length)
}

async function reloadHistory() {
	setBusy(true)
	try {
		historyState.entries = await window.history_IPC.all()
		setupFilters(historyState.entries)
		renderFilteredHistory()
	} finally {
		setBusy(false)
	}
}

function selectedRecentCollectionKey() {
	return MA.byId('historyRecentCollection')?.value ?? ''
}

function selectedRecentCollectionName() {
	return MA.byId('historyRecentCollection')?.selectedOptions?.[0]?.textContent ?? 'the selected collection'
}

function renderRecentChanges() {
	const list = MA.byId('historyList')
	if ( list === null ) { return }
	list.innerHTML = ''

	if ( historyState.recentChanges.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'history-entry text-body-secondary'
		empty.textContent = 'No recent collection changes were found for this collection.'
		list.appendChild(empty)
		return
	}

	for ( const entry of historyState.recentChanges ) {
		const row = document.createElement('article')
		row.className = 'history-entry'

		const content = document.createElement('div')

		const header = document.createElement('div')
		header.className = 'd-flex flex-wrap justify-content-between gap-2'
		const title = document.createElement('div')
		const strong = document.createElement('strong')
		strong.textContent = entry.modName ?? entry.fileName ?? 'Unknown mod'
		title.appendChild(strong)
		appendBadge(title, actionLabelText(entry.action), 'text-bg-secondary')
		const date = document.createElement('div')
		date.className = 'text-body-secondary text-end flex-shrink-0'
		date.textContent = formatTimestamp(entry.timestamp)
		header.append(title, date)
		content.appendChild(header)

		const meta = document.createElement('div')
		meta.className = 'text-body-secondary small mt-1'
		meta.textContent = [
			entry.fileName,
			entry.currentVersion ? `version ${entry.currentVersion}` : '',
			entry.previousVersion ? `previous ${entry.previousVersion}` : '',
			entry.source ? `source: ${entry.source}` : '',
		].filter((item) => item !== '').join(' | ')
		content.appendChild(meta)

		appendPath(content, entry.targetPath)

		if ( entry.exists === false ) {
			const missing = document.createElement('div')
			missing.className = 'text-warning small mt-1'
			missing.textContent = 'This ZIP is no longer in the collection folder.'
			content.appendChild(missing)
		}

		row.appendChild(content)
		list.appendChild(row)
	}
}

async function loadRecentChanges() {
	const collectionKey = selectedRecentCollectionKey()
	if ( collectionKey === '' ) {
		historyState.recentChanges = []
		setStatus('Choose a collection to review recent changes.')
		renderRecentChanges()
		return
	}

	setBusy(true)
	setStatus('Loading recent collection changes...')
	try {
		const result = await window.history_IPC.recentChanges({
			collectionKey,
			limit : 80,
		})
		if ( result.ok === false ) {
			historyState.recentChanges = []
			setStatus(`Recent changes failed to load: ${result.error}`, 'danger')
			renderRecentChanges()
			return
		}
		historyState.recentChanges = Array.isArray(result.entries) ? result.entries : []
		setStatus(`${historyState.recentChanges.length} recent change(s) found for ${result.collectionName ?? selectedRecentCollectionName()}.`, historyState.recentChanges.length === 0 ? 'secondary' : 'info')
		renderRecentChanges()
	} catch (err) {
		historyState.recentChanges = []
		setStatus(`Recent changes failed to load: ${err.message}`, 'danger')
		renderRecentChanges()
	} finally {
		setBusy(false)
	}
}

async function loadCollections() {
	const collections = await window.history_IPC.collections()
	historyState.collections = Array.isArray(collections) ? collections : []
	renderRecentCollectionSelect()
}

function updateModeButtons() {
	const historyActive = historyState.mode === 'history'
	const recentActive = historyState.mode === 'recent'
	for ( const id of ['historyModeHistory', 'historyModeHistorySide'] ) {
		const node = MA.byId(id)
		if ( node !== null ) {
			node.className = node.className.replace(/btn-outline-info|btn-info|btn-outline-warning|btn-warning/gu, historyActive ? 'btn-info' : 'btn-outline-info')
		}
	}
	for ( const id of ['historyModeRecent', 'historyModeRecentSide'] ) {
		const node = MA.byId(id)
		if ( node !== null ) {
			node.className = node.className.replace(/btn-outline-info|btn-info|btn-outline-warning|btn-warning/gu, recentActive ? 'btn-warning' : 'btn-outline-warning')
		}
	}
}

async function setHistoryMode(mode) {
	const nextMode = mode === 'recent' ? 'recent' : 'history'
	historyState.mode = nextMode
	updateModeButtons()
	setText('historyTitle', nextMode === 'recent' ? 'Recent Collection Changes' : 'Collection History')
	const filterPanel = MA.byId('historyFilterPanel')
	const recentPanel = MA.byId('historyRecentPanel')
	if ( filterPanel !== null ) { filterPanel.classList.toggle('d-none', nextMode !== 'history') }
	if ( recentPanel !== null ) { recentPanel.classList.toggle('d-none', nextMode !== 'recent') }

	if ( nextMode === 'recent' ) {
		await loadRecentChanges()
	} else {
		renderFilteredHistory()
	}
}

async function refreshCurrentMode() {
	if ( historyState.mode === 'recent' ) {
		await loadRecentChanges()
	} else {
		await reloadHistory()
	}
}

window.addEventListener('DOMContentLoaded', async () => {
	MA.byId('historyList').addEventListener('contextmenu', window.history_IPC.context)
	for ( const tooltip of document.querySelectorAll('[data-bs-toggle="tooltip"]') ) {
		bootstrap.Tooltip.getOrCreateInstance(tooltip)
	}

	MA.byId('historyClearFilters').addEventListener('click', () => {
		for ( const inputID of ['historyCollectionFilter', 'historyActionFilter', 'historyFromFilter', 'historyToFilter', 'historyTextFilter'] ) {
			MA.byId(inputID).value = ''
		}
		renderFilteredHistory()
	})
	MA.byId('historyClearLog').addEventListener('click', async () => {
		if ( !MA.confirm('Clear the collection history log? This will not delete mod backups or mod files.') ) { return }
		const result = await window.history_IPC.clear()
		if ( result.ok ) {
			await reloadHistory()
		}
	})
	MA.byId('historyBackToUpdates').addEventListener('click', () => { window.history_IPC.dispatchModManagement() })
	MA.byId('historyRefresh').addEventListener('click', refreshCurrentMode)
	MA.byId('historyModeHistory').addEventListener('click', () => { setHistoryMode('history') })
	MA.byId('historyModeRecent').addEventListener('click', () => { setHistoryMode('recent') })
	MA.byId('historyModeHistorySide').addEventListener('click', () => { setHistoryMode('history') })
	MA.byId('historyModeRecentSide').addEventListener('click', () => { setHistoryMode('recent') })
	MA.byId('historyRecentCollection').addEventListener('change', loadRecentChanges)
	for ( const inputID of ['historyCollectionFilter', 'historyActionFilter', 'historyFromFilter', 'historyToFilter', 'historyTextFilter'] ) {
		MA.byId(inputID).addEventListener('input', renderFilteredHistory)
	}
	window.history_IPC.receive('history:mode', (mode) => { setHistoryMode(mode) })

	await loadCollections()
	await reloadHistory()
	await setHistoryMode('history')
})
