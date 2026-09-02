/* _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

/* global bootstrap, client_BGData, DATA, MA */

let vaultEntries = []
let vaultCollections = []
let vaultCleanup = { count : 0, entries : [], totalSize : 0 }
let vaultActiveGameVersion = ''
let vaultGameVersions = []
let vaultGameVersionUserSelected = false
let vaultNotes = {}
let vaultTags = {}
let vaultRetentionPolicy = { maximum : 10, versionCount : 3 }
let vaultSourceFilter = ''
let vaultHealthFilter = ''
let vaultSelectedHashes = new Set()
let vaultGroupRows = new Map()
const VAULT_RENDER_BATCH_SIZE = 250
let vaultFilteredGroups = []
let vaultVisibleGroupLimit = VAULT_RENDER_BATCH_SIZE
let vaultRenderSequence = 0
let vaultFilterRenderTimer = null
let vaultBusyDepth = 0
let vaultInteractionLockDepth = 0
let vaultLockedControls = []
let vaultPreviewItems = []
let vaultPreviewIndex = 0

function showVaultBusyProgress(label = '', value = null) {
	const wrapper = MA.byId('vaultBusyProgress')
	const bar = MA.byId('vaultBusyProgressBar')
	const readableLabel = MA.byId('vaultBusyProgressLabel')
	if ( wrapper === null || bar === null ) { return }
	const progress = wrapper.querySelector('.progress')
	wrapper.classList.remove('d-none')
	wrapper.setAttribute('aria-hidden', 'false')
	if ( value === null ) {
		progress?.removeAttribute('aria-valuenow')
		bar.style.width = '100%'
		bar.classList.add('progress-bar-animated')
	} else {
		const safeValue = Math.max(0, Math.min(100, value))
		progress?.setAttribute('aria-valuenow', safeValue.toString())
		bar.style.width = `${safeValue}%`
		bar.classList.toggle('progress-bar-animated', safeValue < 100)
	}
	bar.textContent = ''
	if ( readableLabel !== null ) { readableLabel.textContent = label }
}

function beginVaultBusy(label = '', value = null) {
	vaultBusyDepth++
	showVaultBusyProgress(label, value)
}

function setVaultBusy(label = '', value = null) {
	if ( vaultBusyDepth > 0 ) { showVaultBusyProgress(label, value) }
}

function endVaultBusy() {
	vaultBusyDepth = Math.max(0, vaultBusyDepth - 1)
	if ( vaultBusyDepth !== 0 ) { return }
	const wrapper = MA.byId('vaultBusyProgress')
	if ( wrapper === null ) { return }
	wrapper.classList.add('d-none')
	wrapper.setAttribute('aria-hidden', 'true')
}

function handleVaultProgress(progress = {}) {
	if ( vaultBusyDepth === 0 ) { return }
	const label = typeof progress.label === 'string' && progress.label !== '' ? progress.label : 'Working...'
	const value = typeof progress.value === 'number' ? progress.value : null
	setVaultBusy(label, value)
}

function setVaultInteractionLocked(locked) {
	if ( locked ) {
		vaultInteractionLockDepth++
		if ( vaultInteractionLockDepth !== 1 ) { return }
		document.body.classList.add('vault-locked')
		vaultLockedControls = [...document.querySelectorAll('button, input, select, textarea')]
			.map((control) => ({ control, disabled : control.disabled }))
		for ( const { control } of vaultLockedControls ) {
			control.disabled = true
		}
		return
	}

	vaultInteractionLockDepth = Math.max(0, vaultInteractionLockDepth - 1)
	if ( vaultInteractionLockDepth !== 0 ) { return }
	document.body.classList.remove('vault-locked')
	for ( const { control, disabled } of vaultLockedControls ) {
		if ( control.isConnected ) { control.disabled = disabled }
	}
	vaultLockedControls = []
	updateVaultSelectionControls()
	void updateCleanupSelectionPreview()
}

function uniqueValues(values) {
	return [...new Set(values.filter((value) => typeof value === 'string' && value !== ''))]
}

function friendlyStoreItemType(value) {
	if ( typeof value !== 'string' ) { return '' }
	const cleanValue = value.trim()
	if ( cleanValue === '' || /^\$?l10n_/iu.test(cleanValue) ) { return '' }
	const words = cleanValue
		.replaceAll('_', ' ')
		.replaceAll('-', ' ')
		.replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
		.replace(/\s+/gu, ' ')
		.trim()
	if ( words === '' ) { return '' }
	return words.charAt(0).toLocaleUpperCase() + words.slice(1)
}

function friendlyStoreItemTypes(values) {
	return uniqueValues((values ?? []).map((value) => friendlyStoreItemType(value)))
}

function formatTimestamp(timestamp) {
	const date = new Date(timestamp)
	if ( Number.isNaN(date.getTime()) ) { return '' }
	return date.toLocaleString()
}

function newestDateLabel(values) {
	const labels = uniqueValues(values ?? [])
	if ( labels.length === 0 ) { return '' }

	return labels.toSorted((left, right) => {
		const leftTime = new Date(left).getTime()
		const rightTime = new Date(right).getTime()
		if ( Number.isNaN(leftTime) || Number.isNaN(rightTime) ) { return right.localeCompare(left) }
		return rightTime - leftTime
	})[0]
}

function normalValue(value) {
	return (value ?? '').toString().toLowerCase()
}

function supportedVaultGameVersions() {
	const configuredVersions = uniqueValues(vaultGameVersions
		.map((value) => normalizeGameVersion(value, false))
		.filter((value) => value !== ''))
	return configuredVersions.length === 0 ? ['25', '22', '19', '17', '15', '13'] : configuredVersions
}

function isSupportedVaultGameVersion(value) {
	return supportedVaultGameVersions().includes(value)
}

function normalizeGameVersion(value, requireSupported = true) {
	let normalizedValue = ''
	if ( typeof value === 'number' && Number.isFinite(value) ) {
		normalizedValue = Math.trunc(value).toString()
	} else if ( typeof value === 'string' ) {
		const trimmed = value.trim()
		if ( trimmed === '' ) { return '' }
		const match = trimmed.match(/^(?:FS|Farming Simulator)?\s*(\d{2,4})$/iu)
		if ( match === null ) { return '' }
		const year = Number.parseInt(match[1], 10)
		if ( !Number.isInteger(year) ) { return '' }
		normalizedValue = year >= 2000 ? (year - 2000).toString() : year.toString()
	}
	if ( normalizedValue === '' ) { return '' }
	return !requireSupported || isSupportedVaultGameVersion(normalizedValue) ? normalizedValue : ''
}

function gameVersionLabel(value) {
	return value === 'unknown' ? 'Unknown game' : `FS${value}`
}

function gameVersionsForEntry(entry) {
	const versions = uniqueValues((entry.gameVersions ?? [])
		.map((value) => normalizeGameVersion(value))
		.filter((value) => value !== ''))
	return versions.length === 0 ? ['unknown'] : versions
}

function gameVersionLabels(values) {
	return uniqueValues((values ?? []).map((value) => gameVersionLabel(value)))
}

function activeVaultGameVersion() {
	return normalizeGameVersion(vaultActiveGameVersion)
}

function requestedVaultGameVersion() {
	if ( !vaultGameVersionUserSelected ) { return null }
	return MA.byId('vaultGameVersionFilter')?.value ?? null
}

function canonicalVaultModName(value) {
	const raw = String(value ?? '').trim()
	const withoutPath = raw.split(/[\\/]/u).at(-1) ?? ''
	const baseName = withoutPath.replace(/\.zip$/iu, '')
	return baseName.replace(/^(?:\d{10,}-)+(?=FS(?:19|22|25)_)/iu, '')
}

function vaultNoteKey(modName) {
	return (modName ?? '').toString().trim().toLocaleLowerCase()
}

function cleanVaultTag(value) {
	return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

function parseVaultTagInput(value) {
	const tags = []
	const seenTags = new Set()
	for ( const tag of String(value ?? '').split(',').map((item) => cleanVaultTag(item)) ) {
		if ( tag === '' ) { continue }
		const tagKey = tag.toLocaleLowerCase()
		if ( seenTags.has(tagKey) ) { continue }
		seenTags.add(tagKey)
		tags.push(tag)
	}
	return tags
}

function vaultTagsForMod(modName) {
	const tags = vaultTags[vaultNoteKey(modName)]?.tags
	return Array.isArray(tags) ? tags : []
}

function vaultTagsFromRow(row) {
	try {
		const tags = JSON.parse(row.querySelector('.vault-tags-panel')?.dataset.tags ?? '[]')
		return Array.isArray(tags) ? tags : []
	} catch {
		return []
	}
}

function selectedExistingVaultTagsFromRow(row) {
	try {
		const tags = JSON.parse(row.querySelector('.vault-tags-panel')?.dataset.selectedExistingTags ?? '[]')
		return Array.isArray(tags) ? tags : []
	} catch {
		return []
	}
}

function setSelectedExistingVaultTags(row, tags) {
	const panel = row.querySelector('.vault-tags-panel')
	if ( panel !== null ) { panel.dataset.selectedExistingTags = JSON.stringify(parseVaultTagInput(tags.join(','))) }
}

function setVaultTagsUnsaved(row, hasUnsavedChanges) {
	const panel = row.querySelector('.vault-tags-panel')
	const label = row.querySelector('.vault-tags-unsaved-label')
	if ( panel !== null ) { panel.dataset.hasUnsavedChanges = hasUnsavedChanges.toString() }
	if ( label !== null ) { label.classList.toggle('d-none', !hasUnsavedChanges) }
}

function vaultTagListsMatch(leftTags, rightTags) {
	const left = leftTags.map((tag) => tag.toLocaleLowerCase())
	const right = rightTags.map((tag) => tag.toLocaleLowerCase())
	return left.length === right.length && left.every((tag, index) => tag === right[index])
}

function updateVaultTagsUnsavedState(row) {
	const savedTags = vaultTagsForMod(row.dataset.modName)
	const stagedTags = vaultTagsFromRow(row)
	const selectedExistingTags = selectedExistingVaultTagsFromRow(row)
	setVaultTagsUnsaved(row, selectedExistingTags.length !== 0 || !vaultTagListsMatch(savedTags, stagedTags))
}

function existingVaultTagValues() {
	return uniqueValues(Object.values(vaultTags)
		.flatMap((record) => Array.isArray(record?.tags) ? record.tags : [])
	)
}

function renderVaultTagChips(container, tags, removable = false) {
	container.innerHTML = ''
	for ( const [index, tag] of tags.entries() ) {
		const chip = document.createElement('span')
		chip.className = 'badge rounded-pill text-bg-info d-inline-flex align-items-center gap-1'
		chip.textContent = tag
		if ( removable ) {
			const removeButton = document.createElement('button')
			removeButton.className = 'btn btn-sm btn-link text-reset vault-tag-remove'
			removeButton.type = 'button'
			removeButton.dataset.tagIndex = index.toString()
			removeButton.setAttribute('aria-label', `Remove ${tag}`)
			removeButton.textContent = 'x'
			chip.appendChild(removeButton)
		}
		container.appendChild(chip)
	}
}

function renderExistingVaultTagChips(row, selectedTags) {
	const chips = row.querySelector('.vault-tags-existing-chips')
	if ( chips === null ) { return }
	chips.replaceChildren()
	for ( const tag of selectedTags ) {
		const chip = document.createElement('button')
		chip.className = 'badge rounded-pill text-bg-info border-0 d-inline-flex align-items-center gap-1'
		chip.type = 'button'
		chip.textContent = tag
		chip.setAttribute('aria-label', `Remove selected existing tag ${tag}`)
		chip.addEventListener('click', () => {
			setSelectedExistingVaultTags(row, selectedExistingVaultTagsFromRow(row).filter((selectedTag) => selectedTag !== tag))
			renderExistingVaultTagOptions(row, vaultTagsFromRow(row))
		})
		const remove = document.createElement('span')
		remove.setAttribute('aria-hidden', 'true')
		remove.textContent = 'x'
		chip.append(remove)
		chips.append(chip)
	}
}

function renderExistingVaultTagOptions(row, tags) {
	const button = row.querySelector('.vault-tags-existing-button')
	const menu = row.querySelector('.vault-tags-existing-menu')
	const addButton = row.querySelector('.vault-tags-existing-add')
	if ( button === null || menu === null || addButton === null ) { return }
	const selectedKeys = new Set(tags.map((tag) => tag.toLocaleLowerCase()))
	const availableTags = existingVaultTagValues()
		.filter((tag) => !selectedKeys.has(tag.toLocaleLowerCase()))
	const availableKeys = new Set(availableTags.map((tag) => tag.toLocaleLowerCase()))
	const selectedExistingTags = selectedExistingVaultTagsFromRow(row)
		.filter((tag) => availableKeys.has(tag.toLocaleLowerCase()))
	setSelectedExistingVaultTags(row, selectedExistingTags)
	menu.replaceChildren()
	if ( availableTags.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'dropdown-item-text text-body-secondary small'
		empty.textContent = 'No existing tags available'
		menu.append(empty)
	}
	for ( const [index, tag] of availableTags.entries() ) {
		const wrapper = document.createElement('div')
		wrapper.className = 'form-check dropdown-item m-0'
		const checkbox = document.createElement('input')
		checkbox.className = 'form-check-input vault-tags-existing-check'
		checkbox.checked = selectedExistingTags.includes(tag)
		checkbox.id = `vaultExistingTag_${index}_${tag.replace(/[^a-z0-9_-]+/giu, '-').slice(0, 40)}`
		checkbox.type = 'checkbox'
		checkbox.value = tag
		checkbox.addEventListener('change', () => {
			const currentTags = selectedExistingVaultTagsFromRow(row)
			const nextTags = checkbox.checked
				? parseVaultTagInput([...currentTags, tag].join(','))
				: currentTags.filter((selectedTag) => selectedTag !== tag)
			setSelectedExistingVaultTags(row, nextTags)
			renderExistingVaultTagOptions(row, vaultTagsFromRow(row))
			const status = row.querySelector('.vault-tags-status')
			if ( status !== null ) {
				status.textContent = nextTags.length === 0 ?
					'Existing tag selection cleared.' :
					`${nextTags.length} existing tag${nextTags.length === 1 ? '' : 's'} selected. Click Save tags to keep the change.`
			}
			updateVaultTagsUnsavedState(row)
		})
		wrapper.append(checkbox)
		const label = document.createElement('label')
		label.className = 'form-check-label w-100'
		label.htmlFor = checkbox.id
		label.textContent = tag
		wrapper.append(label)
		menu.append(wrapper)
	}
	button.disabled = availableTags.length === 0
	button.textContent = selectedExistingTags.length === 0 ? 'Add existing tags...' : `${selectedExistingTags.length} selected`
	addButton.disabled = selectedExistingTags.length === 0
	renderExistingVaultTagChips(row, selectedExistingTags)
}

function renderVaultTags(row, tags) {
	const cleanTags = parseVaultTagInput(tags.join(','))
	const panel = row.querySelector('.vault-tags-panel')
	const list = row.querySelector('.vault-custom-tags')
	const editorList = row.querySelector('.vault-tags-editor-list')
	const badge = row.querySelector('.vault-tags-badge')
	const toggle = row.querySelector('.vault-tags-toggle')
	const clearButton = row.querySelector('.vault-tags-clear')
	panel.dataset.tags = JSON.stringify(cleanTags)
	renderVaultTagChips(list, cleanTags)
	renderVaultTagChips(editorList, cleanTags, true)
	renderExistingVaultTagOptions(row, cleanTags)
	list.classList.toggle('d-none', cleanTags.length === 0)
	badge.classList.toggle('d-none', cleanTags.length === 0)
	toggle.textContent = cleanTags.length === 0 ? 'Add tags' : 'Edit tags'
	clearButton.disabled = cleanTags.length === 0
}

function setButtonState(button, disabled, text) {
	button.disabled = disabled
	button.textContent = text
}

function focusVaultSearch() {
	requestAnimationFrame(() => {
		const search = MA.byId('vaultTextFilter')
		window.focus()
		search.focus({ preventScroll : true })
		search.setSelectionRange(search.value.length, search.value.length)
	})
}

function visibleVaultGroups() {
	return [...MA.byId('vaultList').querySelectorAll('.vault-group-body.show')]
		.map((body) => body.closest('.vault-group-row')?.dataset.modName ?? '')
		.filter((modName) => modName !== '')
}

function captureVaultViewState() {
	return {
		openGroups : visibleVaultGroups(),
		scrollX    : window.scrollX,
		scrollY    : window.scrollY,
	}
}

function restoreVaultViewState(state = {}) {
	const openGroups = new Set(state.openGroups ?? [])
	for ( const row of MA.byId('vaultList').querySelectorAll('.vault-group-row') ) {
		if ( !openGroups.has(row.dataset.modName ?? '') ) { continue }
		const body = row.querySelector('.vault-group-body')
		const toggle = row.querySelector('.vault-group-toggle')
		if ( body !== null ) {
			body.classList.add('show')
			ensureVaultGroupRows(body)
		}
		if ( toggle !== null ) { toggle.setAttribute('aria-expanded', 'true') }
	}
	window.scrollTo(state.scrollX ?? window.scrollX, state.scrollY ?? window.scrollY)
}

function cleanListText(values, fallback = 'none') {
	const cleanValues = uniqueValues(values ?? [])
	return cleanValues.length === 0 ? fallback : cleanValues.join(', ')
}

function sortTime(entry) {
	const date = new Date(entry.updatedAt ?? entry.createdAt ?? 0)
	if ( Number.isNaN(date.getTime()) ) { return 0 }
	return date.getTime()
}

function newestTime(entries, field) {
	return Math.max(0, ...entries.map((entry) => {
		const date = new Date(entry[field] ?? 0)
		return Number.isNaN(date.getTime()) ? 0 : date.getTime()
	}))
}

function sortableVersion(value) {
	return (value ?? '')
		.toString()
		.toLowerCase()
		.replace(/^v/u, '')
		.split(/[^0-9a-z]+/u)
		.filter((part) => part !== '')
		.map((part) => {
			const numberValue = Number.parseInt(part, 10)
			return Number.isNaN(numberValue) ? part : numberValue
		})
}

function compareVersionParts(left, right) {
	const maxLength = Math.max(left.length, right.length)
	for ( let index = 0; index < maxLength; index++ ) {
		const leftPart = left[index] ?? 0
		const rightPart = right[index] ?? 0
		if ( leftPart === rightPart ) { continue }
		if ( typeof leftPart === 'number' && typeof rightPart === 'number' ) {
			return leftPart - rightPart
		}
		return leftPart.toString().localeCompare(rightPart.toString(), undefined, { numeric : true })
	}
	return 0
}

function primaryVersion(entry) {
	const versions = uniqueValues(entry.versions ?? [])
	if ( versions.length === 0 ) { return '' }
	if ( versions.length === 1 ) { return versions[0] }
	if ( Array.isArray(entry.sources) && entry.sources.includes('Collection') ) {
		return versions[0]
	}
	return versions[versions.length - 1]
}

function compareVaultEntries(left, right) {
	const versionCompare = compareVersionParts(sortableVersion(primaryVersion(right)), sortableVersion(primaryVersion(left)))
	if ( versionCompare !== 0 ) { return versionCompare }
	return sortTime(right) - sortTime(left)
}

function dateRangeMatches(timestamp, range) {
	if ( range === '' ) { return true }
	if ( timestamp === 0 ) { return range === 'none' }
	if ( range === 'none' ) { return false }

	const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24)
	switch ( range ) {
		case '7' :
			return ageDays <= 7
		case '30' :
			return ageDays <= 30
		case '90' :
			return ageDays <= 90
		case 'older-90' :
			return ageDays > 90
		default :
			return true
	}
}

function compareVaultGroups(left, right, sortMode) {
	switch ( sortMode ) {
		case 'updated-asc' :
			return left.updatedTime - right.updatedTime || left.modName.localeCompare(right.modName)
		case 'size-desc' :
			return right.totalSize - left.totalSize || left.modName.localeCompare(right.modName)
		case 'size-asc' :
			return left.totalSize - right.totalSize || left.modName.localeCompare(right.modName)
		case 'name-desc' :
			return right.modName.localeCompare(left.modName)
		case 'updated-desc' :
			return right.updatedTime - left.updatedTime || left.modName.localeCompare(right.modName)
		default :
			return left.modName.localeCompare(right.modName)
	}
}

function compareGameVersions(left, right) {
	if ( left === 'unknown' ) { return 1 }
	if ( right === 'unknown' ) { return -1 }
	return Number.parseInt(right, 10) - Number.parseInt(left, 10)
}

function badgeTooltip(value, type) {
	switch ( type ) {
		case 'brand' :
			return `Brand or manufacturer found in the mod metadata: ${value}.`
		case 'category' :
			return `Store category found in the mod metadata: ${value}.`
		case 'collection' :
			return `This ZIP is associated with the "${value}" collection.`
		case 'modhub-category' :
			return `Category read from the official ModHub page: ${value}.`
		case 'type' :
			return {
				'Folder mod'      : 'This mod was read from an unpacked folder.',
				'Gameplay script' : 'This mod mainly adds scripts or gameplay behaviour rather than shop items.',
				'Map'             : 'This mod contains map data.',
				'Other'           : 'The vault does not yet have a clearer type for this mod.',
				'Scripted item'   : 'This mod includes shop items and scripts.',
				'Store item'      : 'This mod includes one or more in-game shop items.',
			}[value] ?? `Mod type: ${value}.`
		case 'source' :
			return {
				'Backed up from collection' : 'This ZIP was saved from one of your local mod collections.',
				'Cached GitHub ZIP'        : 'This ZIP was downloaded from GitHub earlier and can be reused without downloading again.',
				'Current rollback copy'    : 'This ZIP is available as a rollback copy for a live mod.',
				'Downloaded from GitHub'   : 'This ZIP came from a GitHub release or repository download.',
				'Rollback action'          : 'This ZIP was involved in restoring an older mod version.',
			}[value] ?? `Source: ${value}.`
		case 'store-item-type' :
			return `Store item type found in the mod shop metadata: ${value}.`
		default :
			return value
	}
}

function badgeLabel(value, type) {
	switch ( type ) {
		case 'modhub-category' :
			return `ModHub: ${value}`
		default :
			return value
	}
}

function makeBadges(values, badgeClass, type = '') {
	return values
		.filter((value) => typeof value === 'string' && value !== '')
		.map((value) => {
			const tooltip = DATA.escapeSpecial(badgeTooltip(value, type))
			return `<span class="badge ${badgeClass}" data-bs-placement="top" data-bs-toggle="tooltip" title="${tooltip}">${DATA.escapeSpecial(badgeLabel(value, type))}</span>`
		})
		.join('')
}

function modHubStatusDisplay(entry) {
	const latestVersion = entry.modHubLatestVersion
	const safeVersion = typeof latestVersion === 'string' && latestVersion !== '' ? DATA.escapeSpecial(latestVersion) : 'version unknown'
	const safeURL = typeof entry.modHubURL === 'string' ? DATA.escapeSpecial(entry.modHubURL) : null
	const versionDisplay = safeURL === null ? safeVersion : `<a href="${safeURL}" target="_BLANK">${safeVersion}</a>`

	switch ( entry.modHubStatus ) {
		case 'update-available' :
			return {
				badge : '<span class="badge text-bg-warning" title="The official ModHub catalogue has a newer version.">ModHub update</span>',
				line  : `Official ModHub version ${versionDisplay} is newer than this stored ZIP.`,
			}
		case 'current' :
			return {
				badge : '<span class="badge text-bg-success" title="This stored ZIP matches the current ModHub version.">ModHub current</span>',
				line  : `Matches official ModHub version ${versionDisplay}.`,
			}
		case 'local-newer' :
			return {
				badge : '<span class="badge text-bg-info" title="The local ZIP has a higher version than the ModHub catalogue.">Local newer</span>',
				line  : `Local version is newer than official ModHub version ${versionDisplay}.`,
			}
		case 'comparison-unknown' :
		case 'version-unknown' :
			return {
				badge : '<span class="badge text-bg-secondary" title="A ModHub match was found, but its version could not be compared safely.">ModHub matched</span>',
				line  : `Matched to ModHub (${versionDisplay}); update status is unknown.`,
			}
		default :
			return {
				badge : '',
				line  : '<span class="text-body-secondary">No reliable ModHub filename match.</span>',
			}
	}
}

function retentionBadgeDisplay(entry) {
	const status = entry.retentionStatus ?? (entry.isUsed ? 'protected' : (entry.fileExists ? 'cleanable' : 'record-only'))
	const label = entry.retentionLabel ?? {
		cleanable   : 'Cleanable',
		protected   : 'Protected',
		'record-only' : 'Record only',
	}[status] ?? 'Vault ZIP'
	const reason = entry.retentionReason ?? 'No retention reason was recorded for this Vault ZIP.'
	const badgeClass = {
		cleanable   : 'text-bg-danger',
		protected   : 'text-bg-success',
		'record-only' : 'text-bg-secondary',
	}[status] ?? 'text-bg-secondary'

	return `<span class="badge ${badgeClass}" data-bs-placement="top" data-bs-toggle="tooltip" title="${DATA.escapeSpecial(reason)}">${DATA.escapeSpecial(label)}</span>`
}

function friendlySourceName(source) {
	switch ( source ) {
		case 'Collection' :
			return 'Backed up from collection'
		case 'GitHub' :
			return 'Downloaded from GitHub'
		case 'GitHub cache' :
			return 'Cached GitHub ZIP'
		case 'Rollback' :
			return 'Rollback action'
		case 'Rollback current' :
			return 'Current rollback copy'
		default :
			return source
	}
}

function hasGitHubSource(entry) {
	try {
		if ( new URL(entry.sourceURL).hostname.toLowerCase() === 'github.com' ) { return true }
	} catch { /* A missing or non-web source is not a GitHub source. */ }
	return (entry.sources ?? []).some((source) => source === 'GitHub' || source === 'GitHub cache')
}

function sourceTypeFromURL(sourceURL) {
	try {
		const url = new URL(sourceURL)
		if ( url.protocol !== 'https:' ) { return 'manual' }
		const host = url.hostname.toLowerCase().replace(/^www\./u, '')
		if ( host === 'github.com' ) { return 'github' }
		if ( host === 'kingmods.net' ) { return 'kingmods' }
		if ( host === 'itch.io' || host.endsWith('.itch.io') ) { return 'itch' }
		if ( host === 'farming-simulator.com' && url.searchParams.has('mod_id') ) { return 'modhub' }
		return 'manual'
	} catch {
		return null
	}
}

function sourceTypesForEntries(entries) {
	const sourceTypes = new Set()
	for ( const entry of entries ) {
		const isModHub = entry.modHubStatus !== 'unmatched' || (entry.modHubIDs ?? []).length !== 0
		const isGitHub = hasGitHubSource(entry)
		const urlSourceType = sourceTypeFromURL(entry.sourceURL)
		if ( isModHub ) { sourceTypes.add('modhub') }
		if ( isGitHub ) { sourceTypes.add('github') }
		if ( urlSourceType !== null ) { sourceTypes.add(urlSourceType) }
		if ( !isModHub && !isGitHub && urlSourceType === null ) { sourceTypes.add('manual') }
	}
	return [...sourceTypes]
}

function hasKnownVaultSource(entry) {
	return (
		typeof entry.sourceURL === 'string' && entry.sourceURL.trim() !== '' ||
		typeof entry.modHubURL === 'string' && entry.modHubURL.trim() !== '' ||
		(entry.modHubIDs ?? []).length !== 0 ||
		(entry.sources ?? []).some((source) => typeof source === 'string' && source.trim() !== '' && source !== 'Manual import' && source !== 'Vault import')
	)
}

function groupHasHealthIssue(group, filter) {
	switch ( filter ) {
		case '':
			return true
		case 'missing-file':
			return group.entries.some((entry) => entry.fileExists !== true)
		case 'missing-game':
			return group.entries.some((entry) => (entry.gameVersions ?? []).length === 0)
		case 'no-source':
			return group.entries.some((entry) => !hasKnownVaultSource(entry))
		case 'update-available':
			return group.hasVaultUpdate
		case 'cleanup-candidate':
			return group.entries.some((entry) => entry.cleanupEligible === true)
		case 'kept':
			return group.entries.some((entry) => entry.keepPinned === true)
		case 'multi-version':
			return group.entries.length > 1
		default:
			return true
	}
}

function healthFilterLabel(filter) {
	switch ( filter ) {
		case 'missing-file':
			return 'Missing files'
		case 'missing-game':
			return 'No game tag'
		case 'no-source':
			return 'No known source'
		case 'update-available':
			return 'Vault updates'
		case 'cleanup-candidate':
			return 'Cleanup candidates'
		case 'kept':
			return 'Kept ZIPs'
		case 'multi-version':
			return 'Multi-version mods'
		default:
			return 'All Vault records'
	}
}

function setHealthFilter(filter, shouldRender = true) {
	vaultHealthFilter = filter
	updateHealthFilterButtons()
	if ( shouldRender ) { renderFilteredVault() }
}

function fragmentToHTML(fragment) {
	const wrapper = document.createElement('div')
	wrapper.appendChild(fragment)
	return wrapper.innerHTML
}

function nextFrame() {
	return new Promise((resolve) => { requestAnimationFrame(resolve) })
}

function modIconHTML(icon) {
	const iconSource = DATA.escapeSpecial(DATA.iconMaker(icon))
	return `<img alt="" class="vault-mod-logo" decoding="async" src="${iconSource}">`
}

function storePreviewIconSource(icon) {
	if ( typeof icon !== 'string' || icon === '' ) { return DATA.iconMaker(icon) }
	if ( icon.startsWith('data:') ) { return icon.replace(/^(data:[^,]+,)\s*/u, '$1') }
	if ( icon.startsWith('$data') ) {
		const iconPointer = icon.replace('.png', '.dds')
		const trueIcon = client_BGData?.icons?.[iconPointer]
		if ( typeof trueIcon === 'string' ) { return trueIcon }
	}
	const compactIcon = icon.replaceAll(/\s/gu, '')
	if ( compactIcon.length > 100 && /^[A-Za-z0-9+/]+=*$/u.test(compactIcon) ) {
		return `data:image/png;base64,${compactIcon}`
	}
	return DATA.iconMaker(icon)
}

function storeItemPreviewHTML(previews, maxItems = 6) {
	if ( !Array.isArray(previews) || previews.length === 0 ) { return '' }

	const gallery = previews.map((preview) => ({
		icon : preview?.icon,
		name : preview?.name || 'Store item',
	}))
	const encodedGallery = DATA.escapeSpecial(encodeURIComponent(JSON.stringify(gallery)))
	const imageHTML = gallery.slice(0, maxItems).map((preview, index) => {
		const iconSource = DATA.escapeSpecial(storePreviewIconSource(preview.icon))
		const title = DATA.escapeSpecial(preview.name || 'Store item')
		return `<button type="button" class="vault-store-preview-button" data-vault-preview-index="${index}" title="Open preview: ${title}"><img alt="" decoding="async" src="${iconSource}"></button>`
	})
	const remaining = gallery.length - maxItems
	if ( remaining > 0 ) {
		imageHTML.push(`<button type="button" class="vault-store-preview-more" data-vault-preview-index="${maxItems}" title="Open all ${gallery.length} previews">+${remaining}</button>`)
	}

	return `<div class="vault-store-preview mt-2" data-vault-preview-gallery="${encodedGallery}">${imageHTML.join('')}</div>`
}

function renderVaultPreview() {
	const item = vaultPreviewItems[vaultPreviewIndex]
	if ( item === undefined ) { return }

	MA.byId('vaultPreviewImage').src = storePreviewIconSource(item.icon)
	MA.byId('vaultPreviewImage').alt = item.name || 'Store item preview'
	MA.byIdText('vaultPreviewTitle', item.name || 'Store item preview')
	MA.byIdText('vaultPreviewCaption', `${vaultPreviewIndex + 1} of ${vaultPreviewItems.length}`)
	MA.byId('vaultPreviewPrevious').disabled = vaultPreviewIndex === 0
	MA.byId('vaultPreviewNext').disabled = vaultPreviewIndex >= vaultPreviewItems.length - 1
}

function showVaultPreviewGallery(previews, startIndex = 0) {
	vaultPreviewItems = Array.isArray(previews) ? previews : []
	if ( vaultPreviewItems.length === 0 ) { return }

	vaultPreviewIndex = Math.max(0, Math.min(vaultPreviewItems.length - 1, startIndex))
	renderVaultPreview()
	const dialog = MA.byId('vaultPreviewDialog')
	if ( !dialog.open ) { dialog.showModal() }
}

function openVaultPreview(event) {
	if ( !(event.target instanceof Element) ) { return false }
	const trigger = event.target.closest('[data-vault-preview-index]')
	if ( trigger === null ) { return false }

	const gallery = trigger.closest('[data-vault-preview-gallery]')
	const serialized = gallery?.dataset.vaultPreviewGallery
	if ( !serialized ) { return false }

	try {
		showVaultPreviewGallery(JSON.parse(decodeURIComponent(serialized)), Number.parseInt(trigger.dataset.vaultPreviewIndex, 10) || 0)
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn('Unable to open Vault preview gallery', err)
	}
	return true
}

function cleanNumber(value) {
	const numberValue = Number.parseFloat(value)
	return Number.isFinite(numberValue) ? numberValue : null
}

function formatSpecNumber(value) {
	const numberValue = cleanNumber(value)
	if ( numberValue === null ) { return '' }
	return Math.round(numberValue).toLocaleString()
}

function formatSpecRange(minValue, maxValue, suffix = '', prefix = '') {
	const minNumber = cleanNumber(minValue)
	const maxNumber = cleanNumber(maxValue)
	if ( minNumber === null && maxNumber === null ) { return '' }
	if ( minNumber !== null && maxNumber !== null && Math.round(minNumber) !== Math.round(maxNumber) ) {
		return `${prefix}${formatSpecNumber(minNumber)}-${formatSpecNumber(maxNumber)}${suffix}`
	}
	return `${prefix}${formatSpecNumber(maxNumber ?? minNumber)}${suffix}`
}

function mergeEquipmentSpecsFromEntries(entries) {
	const mergedSpecs = {}
	for ( const entry of entries ) {
		const specs = entry.equipmentSpecs ?? {}
		for ( const field of ['priceMin', 'priceMax', 'horsepowerMin', 'horsepowerMax', 'speedLimitMax', 'fillLevelMax', 'weightMax'] ) {
			const value = cleanNumber(specs[field])
			if ( value === null ) { continue }
			if ( field.endsWith('Min') ) {
				mergedSpecs[field] = cleanNumber(mergedSpecs[field]) === null ? value : Math.min(mergedSpecs[field], value)
			} else {
				mergedSpecs[field] = cleanNumber(mergedSpecs[field]) === null ? value : Math.max(mergedSpecs[field], value)
			}
		}
	}
	return mergedSpecs
}

function equipmentSpecText(specs = {}) {
	const parts = [
		formatSpecRange(specs.priceMin, specs.priceMax, '', 'Price '),
		formatSpecRange(specs.horsepowerMin, specs.horsepowerMax, ' hp', 'Power '),
		formatSpecRange(null, specs.speedLimitMax, ' km/h', 'Speed '),
		formatSpecRange(null, specs.fillLevelMax, ' L', 'Capacity '),
		formatSpecRange(null, specs.weightMax, ' kg', 'Weight '),
	].filter((part) => part !== '')
	return parts.join(' | ')
}

function equipmentSpecHTML(specs = {}) {
	const text = equipmentSpecText(specs)
	if ( text === '' ) { return '' }
	return `<div class="small mt-2 text-info">${DATA.escapeSpecial(text)}</div>`
}

function rangeMatches(specs, filterValue, minField, maxField) {
	if ( filterValue === '' ) { return true }
	const minValue = cleanNumber(specs[minField])
	const maxValue = cleanNumber(specs[maxField])
	if ( filterValue === 'missing' ) { return minValue === null && maxValue === null }
	if ( minValue === null && maxValue === null ) { return false }
	const [lowText, highText] = filterValue.split('-')
	const filterMin = cleanNumber((lowText ?? '').replace('+', ''))
	const filterMax = typeof highText === 'undefined' ? Number.POSITIVE_INFINITY : cleanNumber(highText)
	if ( filterMin === null || filterMax === null ) { return true }
	const valueMin = minValue ?? maxValue
	const valueMax = maxValue ?? minValue
	return valueMax >= filterMin && valueMin <= filterMax
}

function mergeStoreItemPreviews(entries, limit = 8) {
	const previews = []
	const seenImages = new Set()
	for ( const preview of entries.flatMap((entry) => entry.storeItemPreviews ?? [])) {
		if ( typeof preview?.icon !== 'string' || preview.icon === '' || seenImages.has(preview.icon) ) { continue }
		seenImages.add(preview.icon)
		previews.push(preview)
		if ( previews.length >= limit ) { break }
	}
	return previews
}

function fillCollectionSelect(select) {
	select.innerHTML = ''
	const placeholder = document.createElement('option')
	placeholder.value = ''
	placeholder.textContent = vaultCollections.length === 0 ? 'No collections found' : 'Choose collection...'
	select.appendChild(placeholder)

	for ( const collection of vaultCollections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}
}

function updateVaultSelectionControls() {
	const selectedCount = vaultSelectedHashes.size
	const bulkTarget = MA.byId('vaultBulkCopyTarget')
	const bulkButton = MA.byId('vaultBulkCopyButton')
	const selectionBar = MA.byId('vaultSelectionBar')
	MA.byIdText('vaultSelectedCount', `Selected Vault ZIPs: ${selectedCount}`)
	bulkButton.disabled = selectedCount === 0 || bulkTarget.value === ''
	selectionBar.classList.toggle('d-none', selectedCount === 0)
}

function refreshBulkCopyTarget() {
	const select = MA.byId('vaultBulkCopyTarget')
	const previousValue = select.value
	fillCollectionSelect(select)
	if ( vaultCollections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	}
	updateVaultSelectionControls()
}

function pruneVaultSelection() {
	const validHashes = new Set(vaultEntries.map((entry) => entry.hash).filter((hash) => typeof hash === 'string' && hash !== ''))
	vaultSelectedHashes = new Set([...vaultSelectedHashes].filter((hash) => validHashes.has(hash)))
	updateVaultSelectionControls()
}

function enableTooltips(parent) {
	for ( const element of parent.querySelectorAll('[data-bs-toggle="tooltip"]') ) {
		new bootstrap.Tooltip(element)
	}
}

function enableTooltipElements(elements) {
	for ( const element of elements ) {
		new bootstrap.Tooltip(element)
	}
}

function groupEntries(entries) {
	const groups = new Map()

	for ( const entry of entries ) {
		const modName = canonicalVaultModName(entry.modNames?.[0] ?? entry.fileName ?? '') || '-- unknown mod --'
		const groupKey = modName.toLocaleLowerCase()
		if ( !groups.has(groupKey) ) {
			groups.set(groupKey, {
				entries  : [],
				modName,
				searches : [],
			})
		}
		groups.get(groupKey).entries.push(entry)
	}

	return [...groups.values()].map((group) => {
		const sortedEntries = group.entries.toSorted(compareVaultEntries)
		const modIcon = sortedEntries.find((entry) => typeof entry.modIcon === 'string' && entry.modIcon !== '')?.modIcon ?? null
		const versions = uniqueValues(group.entries.flatMap((entry) => entry.versions ?? []))
		const collections = uniqueValues(group.entries.flatMap((entry) => entry.collections ?? []))
		const collectionFilterNames = uniqueValues(group.entries.flatMap((entry) => entry.collectionFilterNames ?? entry.collections ?? []))
		const categories = uniqueValues(group.entries.flatMap((entry) => entry.itemCategories ?? []))
		const authors = uniqueValues(group.entries.flatMap((entry) => entry.authors ?? []))
		const brands = uniqueValues(group.entries.flatMap((entry) => entry.itemBrands ?? []))
		const equipmentSpecs = mergeEquipmentSpecsFromEntries(group.entries)
		const gameVersions = uniqueValues(group.entries.flatMap((entry) => gameVersionsForEntry(entry)))
		const gameLabels = gameVersionLabels(gameVersions)
		const modHubCategories = uniqueValues(group.entries.flatMap((entry) => entry.modHubCategories ?? []))
		const modHubReleasedDates = uniqueValues(group.entries.flatMap((entry) => entry.modHubReleasedDates ?? []))
		const modTypes = uniqueValues(group.entries.flatMap((entry) => entry.modTypes ?? []))
		const sources = uniqueValues(group.entries.flatMap((entry) => entry.sources ?? []).map((source) => friendlySourceName(source)))
		const sourceTypes = sourceTypesForEntries(group.entries)
		const storeItemPreviews = mergeStoreItemPreviews(sortedEntries)
		const storeItemTypes = friendlyStoreItemTypes(group.entries.flatMap((entry) => entry.storeItemTypes ?? []))
		const note = vaultNotes[vaultNoteKey(group.modName)]?.note ?? ''
		const customTags = vaultTagsForMod(group.modName)
		const hasNote = note.trim() !== ''
		const hasRollback = group.entries.some((entry) => entry.isUsed === true || (entry.sources ?? []).some((source) => source === 'Rollback' || source === 'Rollback current'))
		const hasUpdate = group.entries.some((entry) => entry.modHubStatus === 'update-available')
		const hasCurrentModHubVersion = group.entries.some((entry) => entry.modHubStatus === 'current' || entry.modHubStatus === 'local-newer')
		const hasVaultUpdate = hasUpdate && !hasCurrentModHubVersion
		const searchText = normalValue([
			group.modName,
			note,
			customTags.join(' '),
			versions.join(' '),
			authors.join(' '),
			collections.join(' '),
			collectionFilterNames.join(' '),
			gameLabels.join(' '),
			gameVersions.join(' '),
			categories.join(' '),
			brands.join(' '),
			equipmentSpecText(equipmentSpecs),
			modHubCategories.join(' '),
			modHubReleasedDates.join(' '),
			modTypes.join(' '),
			sources.join(' '),
			storeItemTypes.join(' '),
			group.entries.map((entry) => entry.fileName).join(' '),
			group.entries.map((entry) => entry.sourceURL).join(' '),
			group.entries.map((entry) => `${entry.modHubLatestVersion ?? ''} ${entry.modHubStatus ?? ''}`).join(' '),
			group.entries.map((entry) => (entry.storeItemPreviews ?? []).map((preview) => preview.name).join(' ')).join(' '),
			group.entries.map((entry) => entry.hash).join(' '),
		].join(' '))
		return {
			...group,
			authors,
			brands,
			categories,
			collectionFilterNames,
			collections,
			createdTime : newestTime(group.entries, 'createdAt'),
			customTags,
			entries : sortedEntries,
			equipmentSpecs,
			gameLabels,
			gameVersions,
			hasNote,
			hasRollback,
			hasUpdate,
			hasVaultUpdate,
			modHubCategories,
			modHubReleasedDates,
			modIcon,
			modTypes,
			note,
			searchText,
			sources,
			sourceTypes,
			storeItemPreviews,
			storeItemTypes,
			totalSize : group.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
			updatedTime : newestTime(group.entries, 'updatedAt'),
			versions,
		}
	})
}

function updateHealthFilterButtons() {
	for ( const button of MA.byId('vaultHealthDashboard').querySelectorAll('button[data-health-filter]') ) {
		const isActive = button.dataset.healthFilter === vaultHealthFilter
		button.classList.toggle('active', isActive)
		button.setAttribute('aria-pressed', isActive.toString())
	}
	MA.byIdText(
		'vaultHealthActiveFilter',
		vaultHealthFilter === '' ? 'Showing all Vault records.' : `Health filter: ${healthFilterLabel(vaultHealthFilter)}.`
	)
}

function updateHealthDashboard() {
	const groups = groupEntries(vaultEntries)
	const stats = {
		cleanupCandidateEntries : vaultEntries.filter((entry) => entry.cleanupEligible === true).length,
		keptEntries            : vaultEntries.filter((entry) => entry.keepPinned === true).length,
		missingFileEntries     : vaultEntries.filter((entry) => entry.fileExists !== true).length,
		missingGameEntries     : vaultEntries.filter((entry) => (entry.gameVersions ?? []).length === 0).length,
		multiVersionGroups     : groups.filter((group) => group.entries.length > 1).length,
		noSourceEntries        : vaultEntries.filter((entry) => !hasKnownVaultSource(entry)).length,
		updateGroups           : groups.filter((group) => group.hasVaultUpdate).length,
	}
	const issueCount = stats.missingFileEntries + stats.missingGameEntries + stats.noSourceEntries + stats.updateGroups

	MA.byIdText('vaultHealthGroups', groups.length.toString())
	MA.byIdText('vaultHealthMissingFiles', stats.missingFileEntries.toString())
	MA.byIdText('vaultHealthMissingGame', stats.missingGameEntries.toString())
	MA.byIdText('vaultHealthNoSource', stats.noSourceEntries.toString())
	MA.byIdText('vaultHealthUpdates', stats.updateGroups.toString())
	MA.byIdText('vaultHealthCleanup', stats.cleanupCandidateEntries.toString())
	MA.byIdText('vaultHealthKept', stats.keptEntries.toString())
	MA.byIdText('vaultHealthMultiVersion', stats.multiVersionGroups.toString())
	MA.byIdText(
		'vaultHealthSummary',
		issueCount === 0 ?
			`No health issues found across ${groups.length} grouped mod${groups.length === 1 ? '' : 's'}.` :
			`${issueCount} health item${issueCount === 1 ? ' needs' : 's need'} review across ${groups.length} grouped mod${groups.length === 1 ? '' : 's'}.`
	)
	updateHealthFilterButtons()
}

function filterEntries() {
	const textFilter = normalValue(MA.byId('vaultTextFilter').value)
	const authorFilter = MA.byId('vaultAuthorFilter').value
	const typeFilter = MA.byId('vaultTypeFilter').value
	const categoryFilter = MA.byId('vaultCategoryFilter').value
	const modHubCategoryFilter = MA.byId('vaultModHubCategoryFilter').value
	const collectionFilter = MA.byId('vaultCollectionFilter').value
	const gameVersionFilter = MA.byId('vaultGameVersionFilter').value
	const tagFilter = MA.byId('vaultTagFilter').value
	const noteFilter = MA.byId('vaultNoteFilter').value
	const rollbackFilter = MA.byId('vaultRollbackFilter').value
	const brandFilter = MA.byId('vaultBrandFilter').value
	const horsepowerFilter = MA.byId('vaultHorsepowerFilter').value
	const priceFilter = MA.byId('vaultPriceFilter').value
	const storeItemTypeFilter = MA.byId('vaultStoreItemTypeFilter').value
	const updateFilter = MA.byId('vaultUpdateFilter').value
	const updatedFilter = MA.byId('vaultUpdatedFilter').value
	const sortMode = MA.byId('vaultSortFilter').value
	const groups = groupEntries(vaultEntries)
	// Each independent Vault filter contributes one simple predicate branch.
	// eslint-disable-next-line complexity
	return groups.filter((group) =>
		(textFilter === '' || group.searchText.includes(textFilter)) &&
		(authorFilter === '' || group.authors.includes(authorFilter)) &&
		(typeFilter === '' || group.modTypes.includes(typeFilter)) &&
		(categoryFilter === '' || group.categories.includes(categoryFilter)) &&
		(brandFilter === '' || group.brands.includes(brandFilter)) &&
		(storeItemTypeFilter === '' || group.storeItemTypes.includes(storeItemTypeFilter)) &&
		rangeMatches(group.equipmentSpecs, horsepowerFilter, 'horsepowerMin', 'horsepowerMax') &&
		rangeMatches(group.equipmentSpecs, priceFilter, 'priceMin', 'priceMax') &&
		(modHubCategoryFilter === '' || group.modHubCategories.includes(modHubCategoryFilter)) &&
		(collectionFilter === '' || group.collectionFilterNames.includes(collectionFilter)) &&
		(gameVersionFilter === '' || group.gameVersions.includes(gameVersionFilter)) &&
		(tagFilter === '' || group.customTags.includes(tagFilter)) &&
		(vaultSourceFilter === '' || group.sourceTypes.includes(vaultSourceFilter)) &&
		groupHasHealthIssue(group, vaultHealthFilter) &&
		(noteFilter === '' || (noteFilter === 'with' && group.hasNote) || (noteFilter === 'without' && !group.hasNote)) &&
		(rollbackFilter === '' || (rollbackFilter === 'with' && group.hasRollback) || (rollbackFilter === 'without' && !group.hasRollback)) &&
		(updateFilter === '' || (updateFilter === 'available' && group.hasVaultUpdate) || (updateFilter === 'none' && !group.hasVaultUpdate)) &&
		dateRangeMatches(group.updatedTime, updatedFilter)
	).sort((left, right) => compareVaultGroups(left, right, sortMode))
}

function displayedVaultGroups() {
	return vaultFilteredGroups.slice(0, Math.min(vaultVisibleGroupLimit, vaultFilteredGroups.length))
}

async function renderFilteredVault({ keepVisibleLimit = false } = {}) {
	if ( !keepVisibleLimit ) { vaultVisibleGroupLimit = VAULT_RENDER_BATCH_SIZE }
	await renderVault(filterEntries(), { keepVisibleLimit })
}

function scheduleFilteredVaultRender() {
	window.clearTimeout(vaultFilterRenderTimer)
	vaultFilterRenderTimer = window.setTimeout(() => {
		vaultFilterRenderTimer = null
		renderFilteredVault()
	}, 150)
}

async function showMoreVaultGroups() {
	const renderSequence = vaultRenderSequence
	const oldLimit = Math.min(vaultVisibleGroupLimit, vaultFilteredGroups.length)
	const button = MA.byId('vaultShowMore')
	button.disabled = true
	vaultVisibleGroupLimit += VAULT_RENDER_BATCH_SIZE
	try {
		const appended = await appendVaultGroups(oldLimit, Math.min(vaultVisibleGroupLimit, vaultFilteredGroups.length), renderSequence)
		if ( !appended ) { return }
		updateVaultDisplayStatus()
		updateVaultSelectionControls()
	} finally {
		button.disabled = displayedVaultGroups().length >= vaultFilteredGroups.length
	}
}

function setSourceFilter(sourceType, shouldRender = true) {
	vaultSourceFilter = sourceType
	for ( const button of MA.byId('vaultSourceFilter').querySelectorAll('button[data-source]') ) {
		const isActive = button.dataset.source === sourceType
		button.classList.toggle('active', isActive)
		button.setAttribute('aria-pressed', isActive.toString())
	}
	if ( shouldRender ) { renderFilteredVault() }
}

function clearQuickFilters(shouldRender = true) {
	MA.byId('vaultTextFilter').value = ''
	MA.byId('vaultCollectionFilter').value = ''
	MA.byId('vaultTagFilter').value = ''
	MA.byId('vaultNoteFilter').value = ''
	MA.byId('vaultRollbackFilter').value = ''
	MA.byId('vaultUpdateFilter').value = ''
	MA.byId('vaultSortFilter').value = 'name-asc'
	if ( shouldRender ) { renderFilteredVault() }
}

function clearAdvancedFilters(shouldRender = true) {
	MA.byId('vaultAuthorFilter').value = ''
	MA.byId('vaultTypeFilter').value = ''
	MA.byId('vaultBrandFilter').value = ''
	MA.byId('vaultCategoryFilter').value = ''
	MA.byId('vaultModHubCategoryFilter').value = ''
	MA.byId('vaultHorsepowerFilter').value = ''
	MA.byId('vaultPriceFilter').value = ''
	MA.byId('vaultStoreItemTypeFilter').value = ''
	MA.byId('vaultUpdatedFilter').value = ''
	setSourceFilter('', false)
	if ( shouldRender ) { renderFilteredVault() }
}

function clearAllFilters() {
	clearQuickFilters(false)
	clearAdvancedFilters(false)
	setHealthFilter('', false)
	renderFilteredVault()
}

function bindCollapseToggle(panelID, buttonID, focusID = null) {
	const panel = MA.byId(panelID)
	const button = MA.byId(buttonID)
	const setOpenState = (isOpen) => {
		button.classList.toggle('active', isOpen)
		button.setAttribute('aria-expanded', isOpen.toString())
		button.setAttribute('aria-pressed', isOpen.toString())
	}
	panel.addEventListener('shown.bs.collapse', () => {
		setOpenState(true)
		if ( focusID !== null ) { MA.byId(focusID)?.focus() }
	})
	panel.addEventListener('hidden.bs.collapse', () => { setOpenState(false) })
	setOpenState(panel.classList.contains('show'))
}

function versionLabel(entry) {
	const version = primaryVersion(entry)
	if ( version === '' ) { return 'Version unknown' }
	return `Version ${version}`
}

async function renderFileRows(entries, groupIndex, customTags = []) {
	// eslint-disable-next-line complexity
	const rows = await Promise.all(entries.map(async (entry, entryIndex) => {
		const size = await DATA.bytesToHR(entry.size ?? 0)
		const detailsId = `vaultDetails_${groupIndex}_${entryIndex}`
		const modHubDisplay = modHubStatusDisplay(entry)
		const canDelete = entry.fileExists === true && entry.retentionStatus === 'cleanable'
		const row = DATA.templateEngine('vault_file_row', {
			brandBadges      : makeBadges(entry.itemBrands ?? [], 'text-bg-dark', 'brand'),
			categoryBadges   : makeBadges(entry.itemCategories ?? [], 'text-bg-info', 'category'),
			collectionBadges : makeBadges(entry.collections ?? [], 'text-bg-secondary', 'collection'),
			customTagBadges  : makeBadges(customTags, 'text-bg-info', 'custom-tag'),
			deleteButton     : canDelete ? '<button class="btn btn-sm btn-outline-danger vault-delete-request" title="Permanently delete this cleanable ZIP from the Vault." type="button">Delete ZIP</button>' : '',
			deleteConfirmation : canDelete ? '<div class="alert alert-danger d-none mt-2 mb-0 vault-delete-confirmation"><div class="small mb-2">Permanently delete this ZIP from the Vault? This action is logged and cannot be undone.</div><div class="d-flex flex-wrap gap-2"><button class="btn btn-sm btn-danger vault-delete-confirm" type="button">Delete permanently</button><button class="btn btn-sm btn-outline-secondary vault-delete-cancel" type="button">Cancel</button></div></div>' : '',
			equipmentSpecLine : equipmentSpecHTML(entry.equipmentSpecs ?? {}),
			fileName         : DATA.escapeSpecial(entry.fileName ?? ''),
			filePath         : DATA.escapeSpecial(entry.filePath ?? ''),
			gameVersions     : DATA.escapeSpecial(gameVersionLabels(gameVersionsForEntry(entry)).join(', ')),
			hash             : DATA.escapeSpecial(entry.hash ?? ''),
			missingBadge     : entry.fileExists ? '' : '<span class="badge text-bg-danger ms-1" data-bs-placement="top" data-bs-toggle="tooltip" title="The vault record exists, but the ZIP file could not be found on disk.">missing file</span>',
			modHubCategories : DATA.escapeSpecial((entry.modHubCategories ?? []).join(', ') || 'none'),
			modHubCategoryBadges : makeBadges(entry.modHubCategories ?? [], 'text-bg-success', 'modhub-category'),
			modHubIDs        : DATA.escapeSpecial((entry.modHubIDs ?? []).join(', ') || 'none'),
			modHubMatch      : DATA.escapeSpecial(`${entry.modHubMatchMethod ?? 'unmatched'} (${entry.modHubMatchConfidence ?? 'none'} confidence)`),
			modHubReleasedDates : DATA.escapeSpecial((entry.modHubReleasedDates ?? []).join(', ') || 'none'),
			modHubStatusBadge : modHubDisplay.badge,
			modHubStatusLine : modHubDisplay.line,
			modHubVersions   : DATA.escapeSpecial((entry.modHubVersions ?? []).join(', ') || 'none'),
			retentionBadge   : retentionBadgeDisplay(entry),
			retentionReason  : DATA.escapeSpecial(entry.retentionReason ?? ''),
			size             : DATA.escapeSpecial(size),
			sourceBadges     : makeBadges(uniqueValues(entry.sources ?? []).map((source) => friendlySourceName(source)), 'text-bg-warning', 'source'),
			storeItemPreviews : storeItemPreviewHTML(entry.storeItemPreviews ?? [], 8),
			storeItemTypeBadges : makeBadges(friendlyStoreItemTypes(entry.storeItemTypes ?? []), 'text-bg-info', 'store-item-type'),
			typeBadges       : makeBadges(entry.modTypes ?? [], 'text-bg-primary', 'type'),
			updatedAt        : DATA.escapeSpecial(formatTimestamp(entry.updatedAt)),
			usedBadge        : entry.isUsed ?
				'<span class="badge text-bg-success" data-bs-placement="top" data-bs-toggle="tooltip" title="At least one collection history entry still points to this ZIP.">referenced by history</span>' :
				'<span class="badge text-bg-secondary" data-bs-placement="top" data-bs-toggle="tooltip" title="This ZIP is stored in the vault, but the current collection history does not point to it.">not referenced by history</span>',
			versionLabel      : DATA.escapeSpecial(versionLabel(entry)),
			versionLabels     : DATA.escapeSpecial(uniqueValues(entry.versions ?? []).join(', ') || 'unknown'),
		})
		const rowNode = row.querySelector('.vault-file-row')
		row.querySelector('.vault-details-toggle').setAttribute('data-bs-toggle', 'collapse')
		row.querySelector('.vault-details-toggle').setAttribute('data-bs-target', `#${detailsId}`)
		row.querySelector('.vault-technical-details').id = detailsId
		row.querySelector('.vault-copy-button').dataset.hash = entry.hash ?? ''
		const keepButton = row.querySelector('.vault-keep-button')
		keepButton.dataset.hash = entry.hash ?? ''
		keepButton.dataset.keepPinned = entry.keepPinned ? 'false' : 'true'
		keepButton.textContent = entry.keepPinned ? 'Unkeep ZIP' : 'Keep ZIP'
		keepButton.classList.toggle('btn-outline-warning', entry.keepPinned === true)
		keepButton.classList.toggle('btn-outline-secondary', entry.keepPinned !== true)
		for ( const deleteButton of row.querySelectorAll('.vault-delete-request, .vault-delete-confirm') ) {
			deleteButton.dataset.fileName = entry.fileName ?? ''
			deleteButton.dataset.hash = entry.hash ?? ''
		}
		const rowCheckbox = row.querySelector('.vault-copy-check')
		rowCheckbox.value = entry.hash ?? ''
		rowCheckbox.checked = vaultSelectedHashes.has(entry.hash ?? '')
		rowNode.dataset.collections = JSON.stringify(entry.collections ?? [])
		rowNode.dataset.fileName = entry.fileName ?? ''
		rowNode.dataset.hash = entry.hash ?? ''
		rowNode.dataset.modName = canonicalVaultModName(entry.modNames?.[0] ?? entry.fileName ?? '')
		fillCollectionSelect(row.querySelector('.vault-copy-target'))
		return fragmentToHTML(row)
	}))

	return rows.join('')
}

async function ensureVaultGroupRows(body) {
	if ( body.dataset.loaded === 'true' || body.dataset.loading === 'true' ) { return }
	const groupData = vaultGroupRows.get(body.id)
	if ( typeof groupData === 'undefined' ) { return }

	body.dataset.loading = 'true'
	body.innerHTML = '<div class="text-body-secondary p-3">Loading stored ZIP details...</div>'
	await nextFrame()
	const rows = await renderFileRows(groupData.entries, groupData.groupIndex, groupData.customTags)
	if ( !body.isConnected ) { return }
	body.innerHTML = rows
	body.dataset.loaded = 'true'
	delete body.dataset.loading
	enableTooltips(body)
	updateVaultSelectionControls()
}

function fillSelect(selectID, values, firstLabel) {
	const select = MA.byId(selectID)
	const currentValue = select.value
	select.innerHTML = `<option value="">${DATA.escapeSpecial(firstLabel)}</option>`
	for ( const value of values.toSorted((a, b) => a.localeCompare(b)) ) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = value
		select.appendChild(option)
	}
	if ( values.includes(currentValue) ) {
		select.value = currentValue
	}
}

function fillGameVersionSelect() {
	const select = MA.byId('vaultGameVersionFilter')
	const currentValue = select.value
	const activeVersion = activeVaultGameVersion()
	const values = uniqueValues([
		...supportedVaultGameVersions(),
		...vaultEntries.flatMap((entry) => gameVersionsForEntry(entry)),
	])
		.toSorted(compareGameVersions)
	select.innerHTML = '<option value="">All games</option>'
	for ( const value of values ) {
		const option = document.createElement('option')
		option.value = value
		option.textContent = gameVersionLabel(value)
		select.appendChild(option)
	}
	if ( vaultGameVersionUserSelected && (currentValue === '' || values.includes(currentValue)) ) {
		select.value = currentValue
	} else if ( values.includes(activeVersion) ) {
		select.value = activeVersion
	}
}

function vaultTagFilterValues() {
	return uniqueValues(groupEntries(vaultEntries).flatMap((group) => group.customTags))
}

function vaultCollectionFilterValues() {
	return uniqueValues([
		...vaultCollections.map((collection) => collection.name),
		...vaultEntries.flatMap((entry) => entry.collectionFilterNames ?? entry.collections ?? []),
	].filter((collectionName) => typeof collectionName === 'string' && collectionName !== ''))
}

function refreshFilterOptions() {
	fillSelect('vaultTypeFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.modTypes ?? [])), 'All mod types')
	fillSelect('vaultAuthorFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.authors ?? [])), 'All authors')
	fillSelect('vaultBrandFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.itemBrands ?? [])), 'All manufacturers/brands')
	fillSelect('vaultCategoryFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.itemCategories ?? [])), 'All internal categories')
	fillSelect('vaultModHubCategoryFilter', uniqueValues(vaultEntries.flatMap((entry) => entry.modHubCategories ?? [])), 'All ModHub categories')
	fillSelect('vaultCollectionFilter', vaultCollectionFilterValues(), 'All collections')
	fillGameVersionSelect()
	fillSelect('vaultTagFilter', vaultTagFilterValues(), 'All custom tags')
	fillSelect('vaultStoreItemTypeFilter', friendlyStoreItemTypes(vaultEntries.flatMap((entry) => entry.storeItemTypes ?? [])), 'All store-item types')
}

async function renderCleanupPanel() {
	const cleanupSize = await DATA.bytesToHR(vaultCleanup.totalSize ?? 0)
	const cleanupCount = vaultCleanup.count ?? 0
	MA.byIdText('vaultCleanupSize', cleanupSize)
	MA.byIdText(
		'vaultCleanupSummary',
		cleanupCount === 0 ?
			'No unused Vault ZIPs are safe to remove right now.' :
			`${cleanupCount} unused Vault ZIP${cleanupCount === 1 ? '' : 's'} can be removed to recover ${cleanupSize}.`
	)
	MA.byIdText(
		'vaultCleanupPreviewSummary',
		cleanupCount === 0 ?
			'Retention rules found no cleanup candidates.' :
			`Preview: ${cleanupCount} candidate file${cleanupCount === 1 ? '' : 's'} selected by retention rules, ${cleanupSize} recoverable.`
	)
	MA.byId('vaultDeleteUnused').disabled = cleanupCount === 0

	const list = MA.byId('vaultCleanupList')
	list.innerHTML = ''
	if ( cleanupCount === 0 ) {
		list.innerHTML = '<div class="list-group-item text-body-secondary">Nothing to clean. Protected rollback/history files are not shown here.</div>'
		await updateCleanupSelectionPreview()
		return
	}

	const rows = await Promise.all(vaultCleanup.entries.map(async (entry) => {
		const size = await DATA.bytesToHR(entry.size ?? 0)
		const row = DATA.templateEngine('vault_cleanup_row', {
			collections : DATA.escapeSpecial(cleanListText(entry.collections)),
			fileName    : DATA.escapeSpecial(entry.fileName ?? ''),
			modName     : DATA.escapeSpecial(entry.modName ?? entry.fileName ?? 'Unknown mod'),
			retentionReason : DATA.escapeSpecial(entry.retentionReason ?? 'Safe cleanup candidate because this ZIP is not protected.'),
			size        : DATA.escapeSpecial(size),
			sources     : DATA.escapeSpecial(cleanListText((entry.sources ?? []).map((source) => friendlySourceName(source)))),
			updatedAt   : DATA.escapeSpecial(formatTimestamp(entry.updatedAt)),
			versions    : DATA.escapeSpecial(cleanListText(entry.versions, 'unknown')),
		})
		row.querySelector('.vault-cleanup-check').value = entry.hash ?? ''
		return fragmentToHTML(row)
	}))
	list.innerHTML = rows.join('')
	await updateCleanupSelectionPreview()
}

async function updateCleanupSelectionPreview() {
	const selectedHashes = new Set([...MA.byId('vaultCleanupList').querySelectorAll('.vault-cleanup-check:checked')].map((checkbox) => checkbox.value))
	const selectedEntries = vaultCleanup.entries.filter((entry) => selectedHashes.has(entry.hash))
	const selectedSize = selectedEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
	const selectedSizeText = await DATA.bytesToHR(selectedSize)
	const selectedCount = selectedEntries.length

	MA.byIdText('vaultCleanupSelectionSummary', `Selected cleanup ZIPs: ${selectedCount}`)
	MA.byIdText('vaultCleanupRecoverableSummary', `Recoverable from selected ZIPs: ${selectedSizeText}`)
	MA.byId('vaultDeleteUnused').disabled = selectedCount === 0
}

async function updateVaultSummary(summary) {
	vaultEntries = summary.entries
	vaultCleanup = summary.cleanup ?? { count : 0, entries : [], totalSize : 0 }
	vaultActiveGameVersion = summary.activeGameVersion ?? vaultActiveGameVersion
	vaultGameVersions = summary.gameVersions ?? vaultGameVersions
	vaultNotes = summary.notes ?? vaultNotes
	vaultTags = summary.tags ?? vaultTags
	vaultRetentionPolicy = summary.retentionPolicy ?? vaultRetentionPolicy
	MA.byIdText('vaultCount', summary.totalCount.toString())
	MA.byIdText('vaultUsedCount', summary.usedCount.toString())
	MA.byIdText('vaultSize', await DATA.bytesToHR(summary.totalSize))
	MA.byIdText('vaultFolder', summary.folder)
	MA.byId('vaultRetentionCount').value = vaultRetentionPolicy.versionCount.toString()
	updateHealthDashboard()
	await renderCleanupPanel()
	refreshBulkCopyTarget()
	pruneVaultSelection()
}

async function updateVaultRetentionCount(event) {
	const select = event.currentTarget
	const count = Number.parseInt(select.value, 10)
	const viewState = captureVaultViewState()
	select.disabled = true
	try {
		const result = await window.vault_IPC.setRetentionCount({ count })
		if ( !result.ok ) {
			MA.byIdText('vaultStatus', `Retention policy update failed: ${result.error ?? 'Unknown error'}`)
			select.value = vaultRetentionPolicy.versionCount.toString()
			return
		}
		await loadVault()
		restoreVaultViewState(viewState)
		MA.byIdText('vaultStatus', `Retention policy updated: keeping the newest ${count} version${count === 1 ? '' : 's'} of each mod.`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Retention policy update failed: ${err.message}`)
		select.value = vaultRetentionPolicy.versionCount.toString()
	} finally {
		select.disabled = false
	}
}

async function renderVaultGroup(group, groupIndex) {
	const totalSize = await DATA.bytesToHR(group.totalSize)
	const groupBodyId = `vaultGroup_${groupIndex}`
	const noteBodyId = `vaultNote_${groupIndex}`
	const tagsBodyId = `vaultTags_${groupIndex}`
	const versionText = group.versions.length === 0 ?
		'No version metadata recorded' :
		`${group.versions.length} version label${group.versions.length === 1 ? '' : 's'} recorded`
	const gameText = group.gameLabels.length === 0 ?
		'Game: unknown' :
		`Game: ${group.gameLabels.join(', ')}`
	const lastUpdatedText = group.updatedTime === 0 ?
		'Last Vault updated: not recorded' :
		`Last Vault updated: ${formatTimestamp(group.updatedTime)}`
	const modHubReleased = newestDateLabel(group.modHubReleasedDates)
	const modHubReleasedText = modHubReleased === '' ?
		'ModHub released: not recorded' :
		`ModHub released: ${modHubReleased}`
	const node = DATA.templateEngine('vault_line', {
		fileCount      : DATA.escapeSpecial(`${group.entries.length} stored ZIP file${group.entries.length === 1 ? '' : 's'}`),
		fileRows       : '',
		gameSummary    : DATA.escapeSpecial(gameText),
		lastUpdated    : DATA.escapeSpecial(lastUpdatedText),
		modHubReleased : DATA.escapeSpecial(modHubReleasedText),
		modIcon        : modIconHTML(group.modIcon),
		modName        : DATA.escapeSpecial(group.modName),
		storeItemPreviews : storeItemPreviewHTML(group.storeItemPreviews, 6),
		totalSize      : DATA.escapeSpecial(totalSize),
		versionSummary : DATA.escapeSpecial(versionText),
	})
	const nodeRoot = node.querySelector('.vault-group-row')
	node.querySelector('.vault-group-toggle').setAttribute('data-bs-toggle', 'collapse')
	node.querySelector('.vault-group-toggle').setAttribute('data-bs-target', `#${groupBodyId}`)
	node.querySelector('.vault-group-body').id = groupBodyId
	vaultGroupRows.set(groupBodyId, { customTags : group.customTags, entries : group.entries, groupIndex })
	nodeRoot.dataset.collections = JSON.stringify(group.collections)
	nodeRoot.dataset.fileName = group.entries[0]?.fileName ?? ''
	nodeRoot.dataset.hash = group.entries[0]?.hash ?? ''
	nodeRoot.dataset.modName = group.modName
	nodeRoot.title = 'Right-click for mod actions.'
	const noteToggle = node.querySelector('.vault-note-toggle')
	const notePanel = node.querySelector('.vault-note-panel')
	const noteInput = node.querySelector('.vault-note-input')
	const notePreview = node.querySelector('.vault-note-preview')
	const noteBadge = node.querySelector('.vault-note-badge')
	const tagsToggle = node.querySelector('.vault-tags-toggle')
	const tagsPanel = node.querySelector('.vault-tags-panel')
	noteToggle.setAttribute('data-bs-toggle', 'collapse')
	noteToggle.setAttribute('data-bs-target', `#${noteBodyId}`)
	noteToggle.textContent = group.note === '' ? 'Add note' : 'Edit note'
	notePanel.id = noteBodyId
	noteInput.value = group.note
	notePreview.textContent = group.note
	for ( const button of node.querySelectorAll('.vault-note-save, .vault-note-clear') ) {
		button.dataset.modName = group.modName
	}
	tagsToggle.setAttribute('data-bs-toggle', 'collapse')
	tagsToggle.setAttribute('data-bs-target', `#${tagsBodyId}`)
	tagsPanel.id = tagsBodyId
	for ( const button of node.querySelectorAll('.vault-tags-save, .vault-tags-clear') ) {
		button.dataset.modName = group.modName
	}
	renderVaultTags(nodeRoot, group.customTags)
	if ( group.note !== '' ) {
		noteBadge.classList.remove('d-none')
		notePreview.classList.remove('d-none')
	} else {
		node.querySelector('.vault-note-clear').disabled = true
	}
	return node
}

function updateVaultDisplayStatus() {
	const visibleGroups = displayedVaultGroups()
	const shownFileCount = visibleGroups.reduce((sum, group) => sum + group.entries.length, 0)
	const totalFileCount = vaultFilteredGroups.reduce((sum, group) => sum + group.entries.length, 0)
	const hiddenGroupCount = vaultFilteredGroups.length - visibleGroups.length
	const hasHiddenGroups = hiddenGroupCount > 0
	MA.byIdText(
		'vaultStatus',
		hasHiddenGroups ?
			`${visibleGroups.length} of ${vaultFilteredGroups.length} matching mod${vaultFilteredGroups.length === 1 ? '' : 's'} shown, containing ${shownFileCount} of ${totalFileCount} stored ZIP file${totalFileCount === 1 ? '' : 's'}.` :
			`${vaultFilteredGroups.length} mod${vaultFilteredGroups.length === 1 ? '' : 's'} shown, containing ${shownFileCount} stored ZIP file${shownFileCount === 1 ? '' : 's'}.`
	)
	MA.byId('vaultShowMoreWrap').classList.toggle('d-none', !hasHiddenGroups)
	MA.byId('vaultShowMore').disabled = !hasHiddenGroups
	MA.byIdText('vaultShowMoreStatus', hasHiddenGroups ? `${hiddenGroupCount} matching mod${hiddenGroupCount === 1 ? '' : 's'} not displayed yet.` : '')
}

async function appendVaultGroups(startIndex, endIndex, expectedRenderSequence = null) {
	const groups = vaultFilteredGroups.slice(startIndex, endIndex)
	const nodes = await Promise.all(groups.map((group, offset) => renderVaultGroup(group, startIndex + offset)))
	if ( expectedRenderSequence !== null && expectedRenderSequence !== vaultRenderSequence ) { return false }
	const list = MA.byId('vaultList')
	const tooltipElements = []
	for ( const node of nodes ) {
		tooltipElements.push(...node.querySelectorAll('[data-bs-toggle="tooltip"]'))
		list.appendChild(node)
	}
	enableTooltipElements(tooltipElements)
	return true
}

async function renderVault(groups, { keepVisibleLimit = false } = {}) {
	const renderSequence = ++vaultRenderSequence
	vaultFilteredGroups = groups
	if ( !keepVisibleLimit ) { vaultVisibleGroupLimit = VAULT_RENDER_BATCH_SIZE }

	MA.byId('vaultList').innerHTML = ''
	vaultGroupRows = new Map()
	MA.byId('vaultShowMoreWrap').classList.add('d-none')
	MA.byId('vaultShowMore').disabled = true

	if ( groups.length === 0 ) {
		MA.byIdText('vaultStatus', vaultEntries.length === 0 ? 'No mod vault entries found.' : 'No matching vault entries found.')
		return
	}

	const appended = await appendVaultGroups(0, displayedVaultGroups().length, renderSequence)
	if ( !appended ) { return }
	updateVaultDisplayStatus()
	updateVaultSelectionControls()
}

async function loadVault() {
	beginVaultBusy('Loading vault...', null)
	try {
		const [vault, collections] = await Promise.all([
			window.vault_IPC.all({ gameVersion : requestedVaultGameVersion() }),
			window.vault_IPC.collections(),
		])
		vaultCollections = collections
		await updateVaultSummary(vault)
		refreshFilterOptions()
		await renderFilteredVault()
	} finally {
		endVaultBusy()
	}
}

async function loadVaultPreservingView() {
	const viewState = captureVaultViewState()
	await loadVault()
	restoreVaultViewState(viewState)
}

async function openVaultFolder() {
	try {
		const error = await window.vault_IPC.openFolder()
		if ( typeof error === 'string' && error !== '' ) {
			MA.byIdText('vaultStatus', `Vault folder could not be opened: ${error}`)
			return
		}
		MA.byIdText('vaultStatus', 'Opened the active Vault folder.')
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault folder could not be opened: ${err.message}`)
	}
}

async function moveVaultFolder() {
	const confirmed = MA.confirm([
		'Choose a new folder for the Mod Vault.',
		'',
		'The app will copy the managed Vault ZIPs to that folder, update stored Vault paths, and switch to the new folder only after the copy succeeds.',
		'After the switch succeeds, the old Vault folder will be deleted automatically.',
		'If a previous move was interrupted, you can choose that partial Vault folder again and existing matching files will be skipped.',
		'',
		'Continue?',
	].join('\n'))
	if ( !confirmed ) {
		MA.byIdText('vaultStatus', 'Vault move cancelled. Nothing was changed.')
		return
	}

	const button = MA.byId('vaultMoveFolder')
	const originalText = button.textContent
	setButtonState(button, true, 'Moving...')
	setVaultInteractionLocked(true)
	MA.byIdText('vaultStatus', 'Choose a folder for the Vault move...')
	beginVaultBusy('Moving Vault...', null)
	try {
		const result = await window.vault_IPC.moveFolder()
		if ( result.cancelled ) {
			MA.byIdText('vaultStatus', 'Vault move cancelled. Nothing was changed.')
			return
		}
		if ( !result.ok ) {
			MA.byIdText('vaultStatus', `Vault move failed: ${result.error ?? 'Unknown error'}`)
			return
		}

		await loadVault()
		const oldFolderText = result.oldFolderDeleted ?
			` Old folder deleted: ${result.oldFolder}` :
			` Old folder could not be deleted automatically: ${result.oldFolderDeleteError ?? 'Unknown error'}`
		const copyText = result.copyStats === null || typeof result.copyStats !== 'object' ?
			'' :
			` Copied ${result.copyStats.copiedFiles} file${result.copyStats.copiedFiles === 1 ? '' : 's'}, skipped ${result.copyStats.skippedFiles} existing file${result.copyStats.skippedFiles === 1 ? '' : 's'}, and recopied ${result.copyStats.recopiedFiles} partial file${result.copyStats.recopiedFiles === 1 ? '' : 's'}.`
		MA.byIdText(
			'vaultStatus',
			`Vault moved to ${result.folder}. Updated ${result.updatedRecords} record path${result.updatedRecords === 1 ? '' : 's'} and ${result.updatedHistoryPaths} history path${result.updatedHistoryPaths === 1 ? '' : 's'}.${copyText}${oldFolderText}`
		)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault move failed: ${err.message}`)
	} finally {
		endVaultBusy()
		setVaultInteractionLocked(false)
		setButtonState(button, false, originalText)
	}
}

async function wipeVaultForTesting() {
	const confirmed = MA.confirm([
		'Wipe the Mod Vault for testing?',
		'',
		'This deletes all managed Vault ZIP copies, Vault records, notes, custom tags, ModHub metadata, and cached update-check data.',
		'',
		'Your configured Vault folder location and monitored collections will not be removed.',
	].join('\n'))
	if ( !confirmed ) {
		MA.byIdText('vaultStatus', 'Vault wipe cancelled. Nothing was changed.')
		return
	}

	const finalConfirmed = MA.confirm([
		'Final confirmation.',
		'',
		'Click OK to wipe the Vault now.',
		'Click Cancel to leave every Vault file and record untouched.',
	].join('\n'))
	if ( !finalConfirmed ) {
		MA.byIdText('vaultStatus', 'Vault wipe cancelled. Nothing was changed.')
		return
	}

	const button = MA.byId('vaultWipeForTesting')
	const originalText = button.textContent
	setButtonState(button, true, 'Wiping...')
	setVaultInteractionLocked(true)
	MA.byIdText('vaultStatus', 'Wiping the Mod Vault for testing...')
	beginVaultBusy('Wiping Vault...', null)
	try {
		const result = await window.vault_IPC.wipeForTesting()
		if ( !result.ok ) {
			MA.byIdText('vaultStatus', `Vault wipe failed: ${result.error ?? 'Unknown error'}`)
			return
		}
		vaultSelectedHashes.clear()
		await loadVault()
		MA.byIdText('vaultStatus', `Vault wiped for testing. Removed ${result.records} Vault record${result.records === 1 ? '' : 's'} and cleared managed Vault files from ${result.filesFolder}.`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault wipe failed: ${err.message}`)
	} finally {
		endVaultBusy()
		setVaultInteractionLocked(false)
		setButtonState(button, false, originalText)
	}
}

async function openVaultDetail(event) {
	event.preventDefault()
	const interactiveTarget = event.target.closest('a, button, input, select, textarea, .vault-technical-details')
	const row = event.target.closest('.vault-file-row, .vault-group-row')
	if ( interactiveTarget !== null || row === null ) {
		window.vault_IPC.textContext()
		return
	}

	let collections = []
	try {
		collections = JSON.parse(row.dataset.collections ?? '[]')
	} catch { /* Invalid display-only metadata should not prevent opening details. */ }

	window.vault_IPC.context({
		collections,
		fileName : row.dataset.fileName ?? '',
		hash     : row.dataset.hash ?? '',
		modName  : row.dataset.modName ?? '',
	})
}

async function handleVaultContextResult(result) {
	if ( result?.action !== 'copy' ) { return }
	if ( result.cancelled ) {
		MA.byIdText('vaultStatus', 'Vault copy cancelled. Nothing was changed.')
		return
	}
	if ( !result.ok ) {
		MA.byIdText('vaultStatus', `Vault copy failed: ${result.error ?? 'Unknown error'}`)
		return
	}

	await loadVaultPreservingView()
	const backupText = result.replacedExisting ? ' The previous collection copy was backed up first.' : ''
	MA.byIdText('vaultStatus', `Copied ${result.fileName} to ${result.collectionName}.${backupText}`)
}

// eslint-disable-next-line complexity
async function saveVaultNote(button, shouldClear = false) {
	const group = button.closest('.vault-group-row')
	const input = group?.querySelector('.vault-note-input')
	const modName = button.dataset.modName ?? ''
	if ( group === null || input === null || modName === '' ) { return }

	if ( shouldClear && input.value.trim() !== '' && button.dataset.confirmClear !== 'true' ) {
		button.dataset.confirmClear = 'true'
		button.textContent = 'Confirm clear'
		group.querySelector('.vault-note-status').textContent = 'Click Confirm clear to permanently remove this note.'
		input.focus({ preventScroll : true })
		return
	}

	const note = shouldClear ? '' : input.value
	const buttonText = shouldClear ? 'Clear note' : 'Save note'
	let noteCleared = false
	delete button.dataset.confirmClear
	setButtonState(button, true, shouldClear ? 'Clearing...' : 'Saving...')

	try {
		const result = await window.vault_IPC.saveNote({ modName, note })
		if ( !result.ok ) {
			group.querySelector('.vault-note-status').textContent = `Note could not be saved: ${result.error ?? 'Unknown error'}`
			return
		}

		if ( result.record === null ) {
			delete vaultNotes[result.key]
		} else {
			vaultNotes[result.key] = result.record
		}

		const savedNote = result.record?.note ?? ''
		noteCleared = savedNote === ''
		const preview = group.querySelector('.vault-note-preview')
		const badge = group.querySelector('.vault-note-badge')
		const toggle = group.querySelector('.vault-note-toggle')
		const clearButton = group.querySelector('.vault-note-clear')
		const liveInput = group.querySelector('.vault-note-input')
		delete clearButton.dataset.confirmClear
		clearButton.textContent = 'Clear note'
		liveInput.value = savedNote
		preview.textContent = savedNote
		preview.classList.toggle('d-none', savedNote === '')
		badge.classList.toggle('d-none', savedNote === '')
		toggle.textContent = savedNote === '' ? 'Add note' : 'Edit note'
		clearButton.disabled = savedNote === ''
		group.querySelector('.vault-note-status').textContent = savedNote === '' ? 'Note cleared.' : 'Note saved.'
		MA.byIdText('vaultStatus', savedNote === '' ? `Cleared the note for ${modName}.` : `Saved the note for ${modName}.`)
		if ( MA.byId('vaultNoteFilter').value !== '' ) {
			await renderFilteredVault({ keepVisibleLimit : true })
		}
	} catch (err) {
		group.querySelector('.vault-note-status').textContent = `Note could not be saved: ${err.message}`
	} finally {
		setButtonState(button, shouldClear && noteCleared, buttonText)
		requestAnimationFrame(() => {
			window.focus()
			if ( input.isConnected ) {
				input.focus({ preventScroll : true })
			} else {
				focusVaultSearch()
			}
		})
	}
}

function addVaultTagsFromInput(button) {
	const group = button.closest('.vault-group-row')
	const input = group?.querySelector('.vault-tags-input')
	const status = group?.querySelector('.vault-tags-status')
	if ( group === null || input === null || status === null ) { return }

	const incomingTags = parseVaultTagInput(input.value)
	if ( incomingTags.length === 0 ) {
		status.textContent = 'Enter a tag first.'
		input.focus({ preventScroll : true })
		return
	}

	const tags = parseVaultTagInput([...vaultTagsFromRow(group), ...incomingTags].join(','))
	if ( tags.length > 20 ) {
		status.textContent = 'A mod cannot have more than 20 custom tags.'
		input.focus({ preventScroll : true })
		return
	}
	renderVaultTags(group, tags)
	updateVaultTagsUnsavedState(group)
	input.value = ''
	status.textContent = 'Tag added. Click Save tags to keep the change.'
	input.focus({ preventScroll : true })
}

function addVaultTagFromExisting(button) {
	const group = button.closest('.vault-group-row')
	const status = group?.querySelector('.vault-tags-status')
	if ( group === null || status === null ) { return }

	const incomingTags = selectedExistingVaultTagsFromRow(group)
	if ( incomingTags.length === 0 ) {
		status.textContent = 'Choose one or more existing tags first.'
		group.querySelector('.vault-tags-existing-button')?.focus({ preventScroll : true })
		return
	}

	const tags = parseVaultTagInput([...vaultTagsFromRow(group), ...incomingTags].join(','))
	if ( tags.length > 20 ) {
		status.textContent = 'A mod cannot have more than 20 custom tags.'
		group.querySelector('.vault-tags-existing-button')?.focus({ preventScroll : true })
		return
	}
	setSelectedExistingVaultTags(group, [])
	renderVaultTags(group, tags)
	updateVaultTagsUnsavedState(group)
	status.textContent = `${incomingTags.length} existing tag${incomingTags.length === 1 ? '' : 's'} added. Click Save tags to keep the change.`
	group.querySelector('.vault-tags-existing-button')?.focus({ preventScroll : true })
}

function removeVaultTag(button) {
	const group = button.closest('.vault-group-row')
	const status = group?.querySelector('.vault-tags-status')
	const tagIndex = Number.parseInt(button.dataset.tagIndex ?? '-1', 10)
	if ( group === null || status === null || !Number.isFinite(tagIndex) ) { return }
	const tags = vaultTagsFromRow(group).filter((_, index) => index !== tagIndex)
	renderVaultTags(group, tags)
	updateVaultTagsUnsavedState(group)
	status.textContent = 'Tag removed. Click Save tags to keep the change.'
}

// eslint-disable-next-line complexity
async function saveVaultTags(button, shouldClear = false) {
	const group = button.closest('.vault-group-row')
	const input = group?.querySelector('.vault-tags-input')
	const status = group?.querySelector('.vault-tags-status')
	const modName = button.dataset.modName ?? ''
	if ( group === null || input === null || status === null || modName === '' ) { return }

	const existingTags = vaultTagsFromRow(group)
	const selectedExistingTags = shouldClear ? [] : selectedExistingVaultTagsFromRow(group)
	const tagsToSave = shouldClear ? [] : parseVaultTagInput([...existingTags, ...selectedExistingTags].join(','))
	if ( !shouldClear && tagsToSave.length > 20 ) {
		status.textContent = 'A mod cannot have more than 20 custom tags.'
		input.focus({ preventScroll : true })
		return
	}
	if ( shouldClear && existingTags.length !== 0 && button.dataset.confirmClear !== 'true' ) {
		button.dataset.confirmClear = 'true'
		button.textContent = 'Confirm clear'
		status.textContent = 'Click Confirm clear to permanently remove these tags.'
		input.focus({ preventScroll : true })
		return
	}

	const tags = shouldClear ? [] : tagsToSave
	const buttonText = shouldClear ? 'Clear tags' : 'Save tags'
	let tagsCleared = false
	delete button.dataset.confirmClear
	setButtonState(button, true, shouldClear ? 'Clearing...' : 'Saving...')

	try {
		const result = await window.vault_IPC.saveTags({ modName, tags })
		if ( !result.ok ) {
			status.textContent = `Tags could not be saved: ${result.error ?? 'Unknown error'}`
			return
		}

		if ( result.record === null ) {
			delete vaultTags[result.key]
		} else {
			vaultTags[result.key] = result.record
		}

		const savedTags = result.record?.tags ?? []
		tagsCleared = savedTags.length === 0
		const clearButton = group.querySelector('.vault-tags-clear')
		setSelectedExistingVaultTags(group, [])
		delete clearButton.dataset.confirmClear
		clearButton.textContent = 'Clear tags'
		renderVaultTags(group, savedTags)
		setVaultTagsUnsaved(group, false)
		status.textContent = savedTags.length === 0 ? 'Tags cleared.' : 'Tags saved.'
		MA.byIdText('vaultStatus', savedTags.length === 0 ? `Cleared custom tags for ${modName}.` : `Saved custom tags for ${modName}.`)
		refreshFilterOptions()
		if ( MA.byId('vaultTextFilter').value.trim() !== '' || MA.byId('vaultTagFilter').value !== '' ) {
			await renderFilteredVault({ keepVisibleLimit : true })
		}
	} catch (err) {
		status.textContent = `Tags could not be saved: ${err.message}`
	} finally {
		setButtonState(button, shouldClear && tagsCleared, buttonText)
		requestAnimationFrame(() => {
			window.focus()
			if ( input.isConnected ) {
				input.focus({ preventScroll : true })
			} else {
				focusVaultSearch()
			}
		})
	}
}

function copyPreviewWarningLines(preview, limit = 8) {
	const lines = []
	for ( const item of preview.items ?? [] ) {
		const label = item.fileName ?? item.modName ?? 'Vault ZIP'
		for ( const warning of item.warnings ?? [] ) {
			lines.push(`${label}: ${warning}`)
		}
		for ( const dependency of item.dependencies ?? [] ) {
			lines.push(`${label}: depends on ${dependency}`)
		}
		if ( typeof item.conflictNote === 'string' && item.conflictNote !== '' ) {
			lines.push(`${label}: note mentions ${item.conflictNote.toLowerCase()}`)
		}
	}
	if ( lines.length <= limit ) { return lines }
	return [
		...lines.slice(0, limit),
		`...and ${lines.length - limit} more warning${lines.length - limit === 1 ? '' : 's'}.`,
	]
}

function copyPreviewStatusText(preview) {
	if ( preview.ok === false ) { return `Copy preview failed: ${preview.error ?? 'Unknown error'}` }
	const warnings = copyPreviewWarningLines(preview, 3)
	if ( warnings.length === 0 ) { return `Ready to copy to ${preview.collectionName ?? 'the selected collection'}.` }
	return `Review before copying: ${warnings.join(' | ')}`
}

async function confirmVaultCopyPreview(collectionKey, hashes) {
	const preview = await window.vault_IPC.copyPreview({ collectionKey, hashes })
	if ( preview.ok === false ) { return { confirmed : false, preview } }

	const warnings = copyPreviewWarningLines(preview)
	if ( warnings.length === 0 ) { return { confirmed : true, preview } }

	const confirmed = MA.confirm([
		`Before copying to ${preview.collectionName ?? 'the selected collection'}:`,
		'',
		...warnings,
		'',
		'Continue with the copy?',
	].join('\n'))

	return { confirmed, preview }
}

// eslint-disable-next-line complexity
async function copyVaultEntry(button) {
	const row = button.closest('.vault-file-row')
	const select = row?.querySelector('.vault-copy-target')
	const rowStatus = row?.querySelector('.vault-copy-result')
	const collectionKey = select?.value ?? ''
	if ( collectionKey === '' ) {
		const message = 'Choose a collection before copying from the vault.'
		MA.byIdText('vaultStatus', message)
		if ( rowStatus !== null ) { rowStatus.textContent = message }
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, 'Checking...')
	beginVaultBusy('Checking copy...', null)
	if ( rowStatus !== null ) { rowStatus.textContent = 'Checking this copy first...' }
	const hash = button.dataset.hash

	try {
		const { confirmed, preview } = await confirmVaultCopyPreview(collectionKey, [hash])
		const previewText = copyPreviewStatusText(preview)
		if ( rowStatus !== null ) { rowStatus.textContent = previewText }
		if ( preview.ok === false ) {
			MA.byIdText('vaultStatus', previewText)
			return
		}
		if ( !confirmed ) {
			const message = 'Copy cancelled. Nothing was changed.'
			MA.byIdText('vaultStatus', message)
			if ( rowStatus !== null ) { rowStatus.textContent = message }
			return
		}

		setButtonState(button, true, 'Copying...')
		const shouldOverwrite = (preview.items ?? []).some((item) => item.hash === hash && item.targetExists === true)
		let result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : shouldOverwrite })
		if ( result.needsOverwrite ) {
			const overwriteConfirmed = MA.confirm(`${result.fileName} already exists in ${result.collectionName}. Replace it and save a backup first?`)
			if ( !overwriteConfirmed ) {
				const message = 'Copy cancelled. Nothing was changed.'
				MA.byIdText('vaultStatus', message)
				if ( rowStatus !== null ) { rowStatus.textContent = message }
				return
			}
			result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : true })
		}

		if ( !result.ok ) {
			const message = `Vault copy failed: ${result.error ?? 'Unknown error'}`
			MA.byIdText('vaultStatus', message)
			if ( rowStatus !== null ) { rowStatus.textContent = message }
			return
		}

		const backupText = result.replacedExisting ? ' Existing copy was backed up first.' : ''
		const message = `Copied ${result.fileName} to ${result.collectionName}.${backupText}`
		await loadVaultPreservingView()
		MA.byIdText('vaultStatus', message)
		if ( rowStatus !== null ) {
			rowStatus.classList.add('text-success')
			rowStatus.textContent = message
		}
	} catch (err) {
		const message = `Vault copy failed: ${err.message}`
		MA.byIdText('vaultStatus', message)
		if ( rowStatus !== null ) { rowStatus.textContent = message }
	} finally {
		endVaultBusy()
		setButtonState(button, false, originalText)
	}
}

async function copyVaultHashToCollection(hash, collectionKey, overwrite = false) {
	let result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite })
	if ( result.needsOverwrite && !overwrite ) {
		const confirmed = MA.confirm(`${result.fileName} already exists in ${result.collectionName}. Replace it and save a backup first?`)
		if ( !confirmed ) { return { cancelled : true, result } }
		result = await window.vault_IPC.copyToCollection({ collectionKey, hash, overwrite : true })
	}
	return { cancelled : false, result }
}

async function setVaultKeepPinned(button) {
	const hash = button.dataset.hash ?? ''
	const keepPinned = button.dataset.keepPinned === 'true'
	if ( hash === '' ) {
		MA.byIdText('vaultStatus', 'Vault keep action failed: no ZIP was selected.')
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, keepPinned ? 'Keeping...' : 'Unkeeping...')
	beginVaultBusy(keepPinned ? 'Keeping ZIP...' : 'Unkeeping ZIP...', null)
	try {
		const result = await window.vault_IPC.setKeepPinned({ hash, keepPinned })
		if ( !result.ok ) {
			MA.byIdText('vaultStatus', `Vault keep action failed: ${result.error ?? 'Unknown error'}`)
			return
		}
		const viewState = captureVaultViewState()
		const entryIndex = vaultEntries.findIndex((entry) => entry.hash === hash)
		if ( entryIndex !== -1 && result.entry !== null ) {
			vaultEntries[entryIndex] = result.entry
		}
		vaultCleanup = result.cleanup ?? vaultCleanup
		await renderCleanupPanel()
		refreshFilterOptions()
		await renderFilteredVault({ keepVisibleLimit : true })
		restoreVaultViewState(viewState)
		const entryName = result.entry?.fileName ?? vaultEntries[entryIndex]?.fileName ?? 'Vault ZIP'
		MA.byIdText('vaultStatus', keepPinned ? `${entryName} is now kept and protected from cleanup.` : `${entryName} is no longer manually kept.`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault keep action failed: ${err.message}`)
	} finally {
		endVaultBusy()
		setButtonState(button, false, originalText)
	}
}

function showVaultDeleteConfirmation(button, shouldShow) {
	const row = button.closest('.vault-file-row')
	const confirmation = row?.querySelector('.vault-delete-confirmation')
	const requestButton = row?.querySelector('.vault-delete-request')
	if ( confirmation === null || typeof confirmation === 'undefined' || requestButton === null || typeof requestButton === 'undefined' ) { return }

	confirmation.classList.toggle('d-none', !shouldShow)
	requestButton.disabled = shouldShow
	const focusTarget = shouldShow ? confirmation.querySelector('.vault-delete-confirm') : requestButton
	focusTarget?.focus({ preventScroll : true })
}

async function deleteVaultEntry(button) {
	const hash = button.dataset.hash ?? ''
	const entry = vaultEntries.find((vaultEntry) => vaultEntry.hash === hash)
	if ( hash === '' || typeof entry === 'undefined' ) {
		MA.byIdText('vaultStatus', 'Vault deletion failed: the selected ZIP could not be found.')
		return
	}
	if ( entry.fileExists !== true || entry.retentionStatus !== 'cleanable' ) {
		MA.byIdText('vaultStatus', 'This Vault ZIP is protected or is no longer eligible for deletion.')
		await loadVaultPreservingView()
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, 'Deleting...')
	beginVaultBusy('Deleting Vault ZIP...', null)
	try {
		const result = await window.vault_IPC.cleanupUnused({ hashes : [hash] })
		const deletedEntry = result.deleted?.find((item) => item.hash === hash)
		if ( typeof deletedEntry === 'undefined' ) {
			const reason = result.skipped?.[0]?.reason ?? result.errors?.[0]?.error ?? result.error ?? 'The ZIP was not deleted.'
			MA.byIdText('vaultStatus', `Vault deletion failed: ${reason}`)
			await loadVaultPreservingView()
			return
		}

		vaultSelectedHashes.delete(hash)
		await loadVaultPreservingView()
		MA.byIdText('vaultStatus', `Deleted ${deletedEntry.fileName} from the Vault and recovered ${await DATA.bytesToHR(deletedEntry.size ?? 0)}.`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault deletion failed: ${err.message}`)
	} finally {
		endVaultBusy()
		if ( button.isConnected ) { setButtonState(button, false, originalText) }
		focusVaultSearch()
	}
}

// eslint-disable-next-line complexity
async function copySelectedVaultEntries() {
	const button = MA.byId('vaultBulkCopyButton')
	const select = MA.byId('vaultBulkCopyTarget')
	const status = MA.byId('vaultBulkCopyStatus')
	const collectionKey = select.value
	const hashes = [...vaultSelectedHashes]
	if ( collectionKey === '' ) {
		MA.byIdText('vaultStatus', 'Choose a collection before copying selected Vault ZIPs.')
		status.textContent = 'Choose a collection first.'
		return
	}
	if ( hashes.length === 0 ) {
		MA.byIdText('vaultStatus', 'Select one or more Vault ZIPs before copying.')
		status.textContent = 'Select one or more Vault ZIPs first.'
		return
	}

	const originalText = button.textContent
	setButtonState(button, true, 'Checking selected...')
	beginVaultBusy(`Checking ${hashes.length} selected...`, null)
	status.classList.remove('text-success', 'text-danger')
	status.textContent = `Checking ${hashes.length} selected Vault ZIP${hashes.length === 1 ? '' : 's'} before copying...`
	let copied = 0
	let replaced = 0
	let skipped = 0
	let processed = 0
	const errors = []

	try {
		const { confirmed, preview } = await confirmVaultCopyPreview(collectionKey, hashes)
		const previewText = copyPreviewStatusText(preview)
		status.textContent = previewText
		if ( preview.ok === false ) {
			status.classList.add('text-danger')
			MA.byIdText('vaultStatus', previewText)
			return
		}
		if ( !confirmed ) {
			const message = 'Bulk copy cancelled. Nothing was changed.'
			MA.byIdText('vaultStatus', message)
			status.textContent = message
			return
		}

		setButtonState(button, true, 'Copying selected...')
		status.textContent = `Copying ${hashes.length} selected Vault ZIP${hashes.length === 1 ? '' : 's'}...`
		setVaultBusy(`0 / ${hashes.length}`, 0)
		const overwriteHashes = new Set((preview.items ?? []).filter((item) => item.targetExists === true).map((item) => item.hash))
		for ( const hash of hashes ) {
			// eslint-disable-next-line no-await-in-loop -- Copies are kept one-at-a-time so each file operation can safely finish before the next starts.
			const { cancelled, result } = await copyVaultHashToCollection(hash, collectionKey, overwriteHashes.has(hash))
			processed++
			setVaultBusy(`${processed} / ${hashes.length}`, (processed / hashes.length) * 100)
			if ( cancelled ) {
				skipped++
				continue
			}
			if ( !result.ok ) {
				errors.push(result.error ?? 'Unknown error')
				continue
			}
			copied++
			if ( result.replacedExisting ) { replaced++ }
		}

		await loadVaultPreservingView()
		status.classList.toggle('text-danger', errors.length !== 0)
		status.classList.toggle('text-success', copied !== 0 && errors.length === 0)
		const replacedText = replaced === 0 ? '' : ` ${replaced} existing copy${replaced === 1 ? ' was' : 'ies were'} backed up first.`
		const skippedText = skipped === 0 ? '' : ` ${skipped} copy action${skipped === 1 ? '' : 's'} skipped.`
		const errorText = errors.length === 0 ? '' : ` ${errors.length} copy action${errors.length === 1 ? '' : 's'} failed.`
		const message = `Copied ${copied} selected Vault ZIP${copied === 1 ? '' : 's'}.${replacedText}${skippedText}${errorText}`
		MA.byIdText('vaultStatus', message)
		status.textContent = message
	} catch (err) {
		const message = `Vault bulk copy failed: ${err.message}`
		MA.byIdText('vaultStatus', message)
		status.classList.add('text-danger')
		status.textContent = message
	} finally {
		endVaultBusy()
		setButtonState(button, false, originalText)
		updateVaultSelectionControls()
	}
}

function setShownVaultSelection(shouldSelect) {
	const shownHashes = displayedVaultGroups().flatMap((group) => group.entries.map((entry) => entry.hash)).filter((hash) => typeof hash === 'string' && hash !== '')
	for ( const hash of shownHashes ) {
		if ( shouldSelect ) {
			vaultSelectedHashes.add(hash)
		} else {
			vaultSelectedHashes.delete(hash)
		}
	}
	for ( const checkbox of MA.byId('vaultList').querySelectorAll('.vault-copy-check') ) {
		checkbox.checked = vaultSelectedHashes.has(checkbox.value)
	}
	updateVaultSelectionControls()
}

async function importCollections() {
	const button = MA.byId('vaultImportCollections')
	button.disabled = true
	const originalText = button.textContent
	button.textContent = 'Scanning collections...'
	MA.byIdText('vaultStatus', 'Scanning collections and adding unique ZIPs to the vault...')
	beginVaultBusy('Scanning collections...', null)
	try {
		const result = await window.vault_IPC.importCollections()
		vaultCollections = await window.vault_IPC.collections()
		await loadVault()
		const errorText = result.errors.length === 0 ? '' : ` ${result.errors.length} item${result.errors.length === 1 ? '' : 's'} could not be added.`
		MA.byIdText('vaultStatus', `Scanned ${result.scanned} collection mod${result.scanned === 1 ? '' : 's'} and updated ${result.imported} vault record${result.imported === 1 ? '' : 's'}.${errorText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault scan failed: ${err.message}`)
	} finally {
		endVaultBusy()
		button.disabled = false
		button.textContent = originalText
	}
}

async function refreshModHubCategories() {
	const button = MA.byId('vaultRefreshModHub')
	button.disabled = true
	const originalText = button.textContent
	button.textContent = 'Refreshing ModHub...'
	MA.byIdText('vaultStatus', 'Reading ModHub category and version data for vaulted mods. This may take a little while...')
	beginVaultBusy('Refreshing ModHub information...', null)
	try {
		const result = await window.vault_IPC.refreshModHub()
		await loadVault()
		const errorText = result.errors.length === 0 ? '' : ` ${result.errors.length} ModHub page${result.errors.length === 1 ? '' : 's'} could not be read.`
		const emptyText = result.scanned === 0 ? ' No ModHub IDs were found in the vault yet; scan collections into the vault first, then refresh ModHub information.' : ''
		MA.byIdText('vaultStatus', `Checked ${result.scanned} ModHub-linked vault record${result.scanned === 1 ? '' : 's'} and refreshed ${result.refreshed} ModHub record${result.refreshed === 1 ? '' : 's'}.${errorText}${emptyText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `ModHub information refresh failed: ${err.message}`)
	} finally {
		endVaultBusy()
		button.disabled = false
		button.textContent = originalText
	}
}

async function deleteSelectedUnusedVaultFiles() {
	const selectedHashes = [...MA.byId('vaultCleanupList').querySelectorAll('.vault-cleanup-check:checked')].map((checkbox) => checkbox.value)
	if ( selectedHashes.length === 0 ) {
		MA.byIdText('vaultStatus', 'Choose at least one unused Vault ZIP before deleting.')
		return
	}
	const selectedEntries = vaultCleanup.entries.filter((entry) => selectedHashes.includes(entry.hash))
	if ( selectedEntries.length === 0 ) {
		MA.byIdText('vaultStatus', 'The selected cleanup rows could not be matched to Vault files. Refresh the Vault and try again.')
		return
	}
	const selectedSize = selectedEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
	const selectedSizeText = await DATA.bytesToHR(selectedSize)
	const confirmed = MA.confirm(`Delete ${selectedHashes.length} unused Vault ZIP${selectedHashes.length === 1 ? '' : 's'} and recover ${selectedSizeText}?\n\nRollback/history ZIPs are protected and will not be deleted.`)
	if ( !confirmed ) {
		MA.byIdText('vaultStatus', 'Vault cleanup cancelled. Nothing was deleted.')
		return
	}

	const button = MA.byId('vaultDeleteUnused')
	const originalText = button.textContent
	setButtonState(button, true, 'Deleting...')
	beginVaultBusy(`Deleting ${selectedHashes.length} ZIP${selectedHashes.length === 1 ? '' : 's'}...`, null)
	try {
		const result = await window.vault_IPC.cleanupUnused({ hashes : selectedHashes })
		if ( typeof result.summary !== 'undefined' ) {
			await loadVault()
		}
		if ( result.error ) {
			MA.byIdText('vaultStatus', `Vault cleanup failed: ${result.error}`)
			return
		}
		const recoveredText = await DATA.bytesToHR(result.recoveredSize ?? 0)
		const skippedText = result.skipped?.length > 0 ? ` ${result.skipped.length} item${result.skipped.length === 1 ? '' : 's'} were skipped because they are no longer eligible.` : ''
		const errorText = result.errors?.length > 0 ? ` ${result.errors.length} item${result.errors.length === 1 ? '' : 's'} could not be deleted.` : ''
		MA.byIdText('vaultStatus', `Deleted ${result.deleted.length} unused Vault ZIP${result.deleted.length === 1 ? '' : 's'} and recovered ${recoveredText}.${skippedText}${errorText}`)
	} catch (err) {
		MA.byIdText('vaultStatus', `Vault cleanup failed: ${err.message}`)
	} finally {
		endVaultBusy()
		setButtonState(button, (vaultCleanup.count ?? 0) === 0, originalText)
		focusVaultSearch()
	}
}

function updateVaultBackToTopVisibility() {
	MA.byId('vaultBackToTop').classList.toggle('d-none', window.scrollY < 600)
}

function scrollVaultToTop() {
	window.scrollTo({ behavior : 'smooth', top : 0 })
}

window.addEventListener('DOMContentLoaded', () => {
	window.vault_IPC.receive('vault:contextResult', handleVaultContextResult)
	window.vault_IPC.receive('vault:progress', handleVaultProgress)
	const previewDialog = MA.byId('vaultPreviewDialog')
	MA.byId('vaultPreviewClose').addEventListener('click', () => { previewDialog.close() })
	MA.byId('vaultPreviewPrevious').addEventListener('click', () => {
		if ( vaultPreviewIndex > 0 ) {
			vaultPreviewIndex -= 1
			renderVaultPreview()
		}
	})
	MA.byId('vaultPreviewNext').addEventListener('click', () => {
		if ( vaultPreviewIndex < vaultPreviewItems.length - 1 ) {
			vaultPreviewIndex += 1
			renderVaultPreview()
		}
	})
	previewDialog.addEventListener('click', (event) => {
		if ( event.target === previewDialog ) { previewDialog.close() }
	})
	bindCollapseToggle('vaultSearchPanel', 'vaultSearchToggle', 'vaultTextFilter')
	bindCollapseToggle('vaultAdvancedFilters', 'vaultAdvancedToggle')
	bindCollapseToggle('vaultHealthPanel', 'vaultHealthToggle')
	bindCollapseToggle('vaultCleanupPanel', 'vaultCleanupToggle')
	enableTooltips(document)
	MA.byId('vaultList').addEventListener('contextmenu', openVaultDetail)
	MA.byId('vaultList').addEventListener('show.bs.collapse', (event) => {
		if ( event.target.classList.contains('vault-group-body') ) { ensureVaultGroupRows(event.target) }
	})
	MA.byId('vaultList').addEventListener('click', (event) => {
		if ( openVaultPreview(event) ) { return }
		const copyButton = event.target.closest('.vault-copy-button')
		if ( copyButton !== null ) { copyVaultEntry(copyButton) }
		const keepButton = event.target.closest('.vault-keep-button')
		if ( keepButton !== null ) { setVaultKeepPinned(keepButton) }
		const deleteRequest = event.target.closest('.vault-delete-request')
		if ( deleteRequest !== null ) { showVaultDeleteConfirmation(deleteRequest, true) }
		const deleteConfirm = event.target.closest('.vault-delete-confirm')
		if ( deleteConfirm !== null ) { deleteVaultEntry(deleteConfirm) }
		const deleteCancel = event.target.closest('.vault-delete-cancel')
		if ( deleteCancel !== null ) {
			showVaultDeleteConfirmation(deleteCancel, false)
			MA.byIdText('vaultStatus', 'Vault deletion cancelled. Nothing was deleted.')
		}
		const saveNoteButton = event.target.closest('.vault-note-save')
		if ( saveNoteButton !== null ) { saveVaultNote(saveNoteButton) }
		const clearNoteButton = event.target.closest('.vault-note-clear')
		if ( clearNoteButton !== null ) { saveVaultNote(clearNoteButton, true) }
		const addTagButton = event.target.closest('.vault-tags-add')
		if ( addTagButton !== null ) { addVaultTagsFromInput(addTagButton) }
		const addExistingTagButton = event.target.closest('.vault-tags-existing-add')
		if ( addExistingTagButton !== null ) { addVaultTagFromExisting(addExistingTagButton) }
		const removeTagButton = event.target.closest('.vault-tag-remove')
		if ( removeTagButton !== null ) { removeVaultTag(removeTagButton) }
		const saveTagsButton = event.target.closest('.vault-tags-save')
		if ( saveTagsButton !== null ) { saveVaultTags(saveTagsButton) }
		const clearTagsButton = event.target.closest('.vault-tags-clear')
		if ( clearTagsButton !== null ) { saveVaultTags(clearTagsButton, true) }
	})
	MA.byId('vaultList').addEventListener('keydown', (event) => {
		if ( event.key !== 'Enter' ) { return }
		const tagInput = event.target.closest('.vault-tags-input')
		if ( tagInput === null ) { return }
		event.preventDefault()
		const addButton = tagInput.closest('.vault-group-row')?.querySelector('.vault-tags-add')
		if ( addButton !== null ) { addVaultTagsFromInput(addButton) }
	})
	MA.byId('vaultList').addEventListener('change', (event) => {
		const checkbox = event.target.closest('.vault-copy-check')
		if ( checkbox === null ) { return }
		if ( checkbox.checked ) {
			vaultSelectedHashes.add(checkbox.value)
		} else {
			vaultSelectedHashes.delete(checkbox.value)
		}
		updateVaultSelectionControls()
	})
	MA.byId('vaultTextFilter').addEventListener('input', scheduleFilteredVaultRender)
	MA.byId('vaultAuthorFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultTypeFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultBrandFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultCategoryFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultModHubCategoryFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultCollectionFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultTagFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultGameVersionFilter').addEventListener('change', () => {
		vaultGameVersionUserSelected = true
		loadVaultPreservingView()
	})
	MA.byId('vaultNoteFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultRollbackFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultHorsepowerFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultPriceFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultStoreItemTypeFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultUpdateFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultUpdatedFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultSortFilter').addEventListener('change', () => { renderFilteredVault() })
	MA.byId('vaultSourceFilter').addEventListener('click', (event) => {
		const sourceButton = event.target.closest('button[data-source]')
		if ( sourceButton !== null ) { setSourceFilter(sourceButton.dataset.source) }
	})
	MA.byId('vaultHealthDashboard').addEventListener('click', (event) => {
		const healthButton = event.target.closest('button[data-health-filter]')
		if ( healthButton !== null ) { setHealthFilter(healthButton.dataset.healthFilter) }
	})
	MA.byId('vaultClearQuickFilters').addEventListener('click', () => { clearQuickFilters() })
	MA.byId('vaultClearAdvancedFilters').addEventListener('click', () => { clearAdvancedFilters() })
	MA.byId('vaultClearFilters').addEventListener('click', clearAllFilters)
	MA.byId('vaultImportCollections').addEventListener('click', importCollections)
	MA.byId('vaultRefreshModHub').addEventListener('click', refreshModHubCategories)
	MA.byId('vaultOpenFolder').addEventListener('click', openVaultFolder)
	MA.byId('vaultMoveFolder').addEventListener('click', moveVaultFolder)
	MA.byId('vaultWipeForTesting').addEventListener('click', wipeVaultForTesting)
	MA.byId('vaultCleanupList').addEventListener('change', (event) => {
		if ( event.target.closest('.vault-cleanup-check') !== null ) { updateCleanupSelectionPreview() }
	})
	MA.byId('vaultDeleteUnused').addEventListener('click', deleteSelectedUnusedVaultFiles)
	MA.byId('vaultRetentionCount').addEventListener('change', updateVaultRetentionCount)
	MA.byId('vaultBulkCopyTarget').addEventListener('change', updateVaultSelectionControls)
	MA.byId('vaultBulkCopyButton').addEventListener('click', copySelectedVaultEntries)
	MA.byId('vaultSelectShown').addEventListener('click', () => { setShownVaultSelection(true) })
	MA.byId('vaultSelectNone').addEventListener('click', () => { setShownVaultSelection(false) })
	MA.byId('vaultShowMore').addEventListener('click', showMoreVaultGroups)
	MA.byId('vaultBackToTop').addEventListener('click', scrollVaultToTop)
	window.addEventListener('scroll', updateVaultBackToTopVisibility, { passive : true })
	MA.byId('vaultBackToUpdates').addEventListener('click', () => { window.vault_IPC.dispatchModManagement() })
	updateVaultBackToTopVisibility()
	loadVault()
})
