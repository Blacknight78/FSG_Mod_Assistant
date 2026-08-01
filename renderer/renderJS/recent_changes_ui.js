/* global MA */

const recentState = {
	collections    : [],
	isBusy         : false,
	recentChanges  : [],
	selectedRecent : new Set(),
}

const setControlDisabled = (id, disabled) => {
	const node = MA.byId(id)
	if ( node !== null ) {
		node.disabled = disabled
	}
}

const setRecentBusy = (isBusy) => {
	recentState.isBusy = isBusy
	for ( const id of ['recentCollection', 'recentRefresh', 'recentDisableSelected', 'recentBackToUpdates'] ) {
		setControlDisabled(id, isBusy)
	}
}

const setRecentStatus = (message, type = 'secondary') => {
	const statusBox = MA.byId('recentStatus')
	if ( statusBox === null ) { return }
	statusBox.className = `alert alert-${type} mt-3 mb-0`
	statusBox.textContent = message
}

const selectedCollectionKey = () => MA.byId('recentCollection')?.value ?? ''
const selectedCollectionName = () => MA.byId('recentCollection')?.selectedOptions?.[0]?.textContent ?? 'the selected collection'

const formatRecentDate = (value) => {
	if ( value === undefined || value === null || value === '' ) { return '' }
	const date = new Date(value)
	if ( Number.isNaN(date.getTime()) ) { return String(value) }
	return date.toLocaleString()
}

const recentChangeLabel = (action) => {
	const labels = {
		collection_backup_restored : 'Restored from backup manifest',
		collection_mod_disabled    : 'Disabled for testing',
		manifest_installed         : 'Installed from shared manifest',
		update_applied             : 'Updated',
		update_rolled_back         : 'Rolled back',
		vault_copied               : 'Copied from Vault',
	}
	return labels[action] ?? action ?? 'Collection change'
}

const renderCollections = () => {
	const select = MA.byId('recentCollection')
	if ( select === null ) { return }
	const previousValue = select.value
	select.innerHTML = ''
	if ( recentState.collections.length === 0 ) {
		const option = document.createElement('option')
		option.value = ''
		option.textContent = 'No collections available'
		select.appendChild(option)
		return
	}
	for ( const collection of recentState.collections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}
	if ( previousValue !== '' && recentState.collections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	}
}

const renderRecentChanges = () => {
	const container = MA.byId('recentChangesList')
	if ( container === null ) { return }
	container.innerHTML = ''
	if ( recentState.recentChanges.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'text-body-secondary'
		empty.textContent = 'No recent collection changes were found for this collection.'
		container.appendChild(empty)
		return
	}
	for ( const entry of recentState.recentChanges ) {
		const row = document.createElement('div')
		row.className = 'border rounded-3 p-3 mb-2'

		const header = document.createElement('div')
		header.className = 'd-flex flex-wrap justify-content-between gap-2'

		const left = document.createElement('div')
		left.className = 'd-flex gap-2 align-items-start'

		const checkbox = document.createElement('input')
		checkbox.className = 'form-check-input mt-1'
		checkbox.type = 'checkbox'
		checkbox.value = entry.id
		checkbox.checked = recentState.selectedRecent.has(entry.id)
		checkbox.disabled = entry.exists === false || entry.canDisable === false
		checkbox.addEventListener('change', () => {
			if ( checkbox.checked ) {
				recentState.selectedRecent.add(entry.id)
			} else {
				recentState.selectedRecent.delete(entry.id)
			}
		})
		left.appendChild(checkbox)

		const text = document.createElement('div')
		const title = document.createElement('div')
		const strong = document.createElement('strong')
		strong.textContent = entry.modName ?? entry.fileName ?? 'Unknown mod'
		const badge = document.createElement('span')
		badge.className = 'badge bg-secondary ms-2'
		badge.textContent = recentChangeLabel(entry.action)
		title.append(strong, badge)
		text.appendChild(title)

		const meta = document.createElement('div')
		meta.className = 'text-body-secondary small'
		meta.textContent = [
			entry.fileName,
			entry.currentVersion ? `version ${entry.currentVersion}` : '',
			entry.previousVersion ? `previous ${entry.previousVersion}` : '',
			entry.source ? `source: ${entry.source}` : '',
		].filter((item) => item !== '').join(' | ')
		text.appendChild(meta)

		const path = document.createElement('div')
		path.className = 'text-body-secondary small'
		path.textContent = entry.targetPath ?? ''
		text.appendChild(path)

		if ( entry.exists === false ) {
			const missing = document.createElement('div')
			missing.className = 'text-warning small mt-1'
			missing.textContent = 'This ZIP is no longer in the collection folder.'
			text.appendChild(missing)
		}

		left.appendChild(text)
		header.appendChild(left)

		const date = document.createElement('div')
		date.className = 'text-body-secondary text-end flex-shrink-0'
		date.textContent = formatRecentDate(entry.timestamp)
		header.appendChild(date)

		row.appendChild(header)
		container.appendChild(row)
	}
}

const loadRecentChanges = async () => {
	const collectionKey = selectedCollectionKey()
	if ( collectionKey === '' ) {
		recentState.recentChanges = []
		recentState.selectedRecent.clear()
		setRecentStatus('Choose a collection to review recent changes.')
		renderRecentChanges()
		return
	}
	setRecentBusy(true)
	setRecentStatus('Loading recent collection changes...', 'secondary')
	try {
		const result = await window.recent_changes_IPC.recentChanges({
			collectionKey,
			limit : 40,
		})
		if ( result.ok === false ) {
			recentState.recentChanges = []
			recentState.selectedRecent.clear()
			setRecentStatus(`Recent changes failed to load: ${result.error}`, 'danger')
			renderRecentChanges()
			return
		}
		recentState.recentChanges = Array.isArray(result.entries) ? result.entries : []
		recentState.selectedRecent = new Set([...recentState.selectedRecent].filter((id) => recentState.recentChanges.some((entry) => entry.id === id)))
		setRecentStatus(`${recentState.recentChanges.length} recent change(s) found for ${result.collectionName ?? selectedCollectionName()}.`, recentState.recentChanges.length === 0 ? 'secondary' : 'info')
		renderRecentChanges()
	} catch (err) {
		recentState.recentChanges = []
		recentState.selectedRecent.clear()
		setRecentStatus(`Recent changes failed to load: ${err.message}`, 'danger')
		renderRecentChanges()
	} finally {
		setRecentBusy(false)
	}
}

const disableSelectedRecentMods = async () => {
	const selectedEntries = recentState.recentChanges.filter((entry) => recentState.selectedRecent.has(entry.id))
	if ( selectedEntries.length === 0 ) {
		setRecentStatus('Select one or more recent mods to disable.', 'warning')
		return
	}
	setRecentBusy(true)
	setRecentStatus(`Disabling ${selectedEntries.length} selected mod(s)...`, 'warning')
	try {
		const result = await window.recent_changes_IPC.disableRecentMods({
			collectionKey : selectedCollectionKey(),
			items : selectedEntries.map((entry) => ({
				action         : entry.action,
				currentVersion : entry.currentVersion,
				fileName       : entry.fileName,
				id             : entry.id,
				modName        : entry.modName,
				source         : entry.source,
				sourceURL      : entry.sourceURL,
				targetPath     : entry.targetPath,
			})),
		})
		if ( result.ok === false ) {
			setRecentStatus(`Disable failed: ${result.error}`, 'danger')
			return
		}
		recentState.selectedRecent.clear()
		setRecentStatus(`Disabled ${result.disabled} mod(s); ${result.failed} could not be disabled.`, result.failed > 0 ? 'warning' : 'success')
		await loadRecentChanges()
	} catch (err) {
		setRecentStatus(`Disable failed: ${err.message}`, 'danger')
	} finally {
		setRecentBusy(false)
	}
}

const loadRecentWindow = async () => {
	setRecentBusy(true)
	setRecentStatus('Loading collections...', 'secondary')
	try {
		const collections = await window.recent_changes_IPC.collections()
		recentState.collections = Array.isArray(collections) ? collections : []
		renderCollections()
		await loadRecentChanges()
	} catch (err) {
		recentState.collections = []
		renderCollections()
		setRecentStatus(`Recent changes window failed to load: ${err.message}`, 'danger')
	} finally {
		setRecentBusy(false)
	}
}

document.addEventListener('DOMContentLoaded', () => {
	MA.byIdEventIfExists('recentBackToUpdates', () => window.recent_changes_IPC.dispatchModManagement())
	MA.byIdEventIfExists('recentRefresh', loadRecentChanges)
	MA.byIdEventIfExists('recentDisableSelected', disableSelectedRecentMods)
	MA.byIdEventIfExists('recentCollection', loadRecentChanges)
	loadRecentWindow()
})
