/* global DATA, bootstrap */

let candidates = []
let noSourceRecords = []
let selectedKeys = new Set()
let isBusy = false
let isRemoteCheckRunning = false
let isUpdateCheckPaused = false
let isUpdateCheckStopped = false
let pendingProfileReviewFilters = null
let pauseWaiters = []
let lastSkippedCount = 0
const selectedAutoTagKeys = new Set()
const selectedCustomTags = new Set()
const autoTagLabels = new Map()
const REMOTE_CHECK_CONCURRENCY = 12
const UPDATE_IGNORE_TAG = 'ignore updates'
const PACKAGE_MISMATCH_STORAGE_KEY = 'fsg.vaultUpdatePackageMismatches.v1'
const UPDATE_PROFILE_STORAGE_KEY = 'fsg.vaultUpdateProfiles.v1'

const byID = (id) => document.getElementById(id)

function versionParts(value) {
	return String(value ?? '')
		.replace(/^v/iu, '')
		.split(/[^0-9]+/u)
		.filter((part) => part.length !== 0)
		.map(Number)
}

function compareVersions(left, right) {
	const leftParts = versionParts(left)
	const rightParts = versionParts(right)
	const length = Math.max(leftParts.length, rightParts.length)

	for ( let index = 0; index < length; index++ ) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
		if ( difference !== 0 ) { return difference }
	}
	return 0
}

function newestVersion(versions) {
	return [...new Set((versions ?? []).filter((value) => typeof value === 'string' && value.length !== 0))]
		.sort((left, right) => compareVersions(right, left))[0] ?? 'unknown'
}

function sourceLabel(sourceType) {
	return sourceType === 'modhub' ? 'ModHub' : 'GitHub'
}

function modHubReleasedLabel(value) {
	const released = typeof value === 'string' ? value.trim() : ''
	return released === '' ? 'not recorded' : released
}

function sourceBadgeLabel(candidate) {
	if ( candidate.sourceType === 'modhub' ) { return 'ModHub update' }
	if ( candidate.sourceType === 'github' && candidate.downloadSource === 'repositoryFile' ) { return 'GitHub repository ZIP' }
	if ( candidate.sourceType === 'github' ) { return 'GitHub release' }
	return `${sourceLabel(candidate.sourceType)} source`
}

const REVIEW_REASON_LABELS = {
	manualOnly       : 'manual download only',
	missingModHubDate : 'ModHub release date not recorded',
	packageMismatch  : 'downloaded package version does not match source version',
	repositoryZip    : 'repository ZIP instead of release asset',
	sourceMismatch   : 'source mismatch risk',
	versionUnclear   : 'version comparison unclear',
}

function packageMismatchStates() {
	try {
		const records = JSON.parse(localStorage.getItem(PACKAGE_MISMATCH_STORAGE_KEY) ?? '{}')
		return typeof records === 'object' && records !== null && !Array.isArray(records) ? records : {}
	} catch {
		return {}
	}
}

function writePackageMismatchStates(records) {
	localStorage.setItem(PACKAGE_MISMATCH_STORAGE_KEY, JSON.stringify(records))
}

function packageMismatchKey(candidate) {
	if ( typeof candidate?.key !== 'string' || typeof candidate?.remoteVersion !== 'string' ) { return '' }
	return `${candidate.key}:${candidate.remoteVersion}`
}

function applyPackageMismatchState(candidate) {
	const key = packageMismatchKey(candidate)
	candidate.packageMismatch = key === '' ? null : packageMismatchStates()[key] ?? null
	return candidate
}

function updateCandidateReviewState(candidate) {
	candidate.reviewReasons = reviewReasons(candidate)
	candidate.needsReview = candidate.reviewReasons.length !== 0
}

function sourceMismatchRisk(candidate) {
	const assetName = canonicalVaultModName(candidate.assetName ?? candidate.fileName ?? '')
	const modName = canonicalVaultModName(candidate.modName ?? '')
	if ( assetName === '' || modName === '' ) { return false }
	return !assetName.toLocaleLowerCase().includes(modName.toLocaleLowerCase()) &&
		!modName.toLocaleLowerCase().includes(assetName.toLocaleLowerCase())
}

function reviewReasons(candidate) {
	const reasons = []
	if ( candidate.packageMismatch !== null && typeof candidate.packageMismatch === 'object' ) {
		reasons.push('packageMismatch')
	}
	if ( candidate.downloadURL === null ) {
		reasons.push('manualOnly')
	}
	if ( candidate.sourceType === 'modhub' && modHubReleasedLabel(candidate.modHubReleased) === 'not recorded' ) {
		reasons.push('missingModHubDate')
	}
	if ( candidate.sourceType === 'github' && candidate.downloadSource === 'repositoryFile' ) {
		reasons.push('repositoryZip')
	}
	if ( candidate.localVersion === 'unknown' || compareVersions(candidate.remoteVersion, candidate.localVersion) === 0 ) {
		reasons.push('versionUnclear')
	}
	if ( sourceMismatchRisk(candidate) ) {
		reasons.push('sourceMismatch')
	}
	return reasons
}

function reviewNoteText(reasons) {
	if ( reasons.length === 0 ) { return '' }
	return `Needs review: ${reasons.map((reason) => REVIEW_REASON_LABELS[reason] ?? reason).join(', ')}`
}

function candidateUpdateState(candidate) {
	if ( candidate.packageMismatch !== null && typeof candidate.packageMismatch === 'object' ) { return 'packageMismatch' }
	if ( candidate.downloadURL === null ) { return 'manual' }
	if ( candidate.needsReview === true ) { return 'review' }
	return 'ready'
}

function candidateStateCounts(items) {
	const counts = {
		manual          : 0,
		packageMismatch : 0,
		ready           : 0,
		review          : 0,
	}
	for ( const candidate of items ) {
		counts[candidateUpdateState(candidate)] += 1
	}
	return counts
}

function stateSummaryText(items) {
	const counts = candidateStateCounts(items)
	const parts = [
		`Visible updates: ${items.length}`,
		`ready: ${counts.ready}`,
		`needs review: ${counts.review}`,
		`manual only: ${counts.manual}`,
		`package mismatch: ${counts.packageMismatch}`,
	]
	return `${parts.join(' | ')}.`
}

function packageMismatchMessage(mismatch, fallbackExpectedVersion = 'unknown') {
	return `Remote package mismatch: the source site says version ${mismatch?.expectedVersion ?? fallbackExpectedVersion}, but its downloaded ZIP reports ${mismatch?.downloadedVersion ?? 'unknown'}. This is a remote package/version-label problem, not an issue with your local Vault mod.`
}

function dateTimeValue(value) {
	const time = Date.parse(value ?? '')
	return Number.isFinite(time) ? time : 0
}

const UPDATE_CANDIDATE_SORTERS = {
	'name-asc'     : (left, right) => left.modName.localeCompare(right.modName),
	'name-desc'    : (left, right) => right.modName.localeCompare(left.modName),
	'size-asc'     : (left, right) => (left.totalSize ?? 0) - (right.totalSize ?? 0) || left.modName.localeCompare(right.modName),
	'size-desc'    : (left, right) => (right.totalSize ?? 0) - (left.totalSize ?? 0) || left.modName.localeCompare(right.modName),
	'updated-asc'  : (left, right) => (left.updatedTime ?? 0) - (right.updatedTime ?? 0) || left.modName.localeCompare(right.modName),
	'updated-desc' : (left, right) => (right.updatedTime ?? 0) - (left.updatedTime ?? 0) || left.modName.localeCompare(right.modName),
}

function compareUpdateCandidates(left, right, sortMode = byID('vaultUpdateSortFilter')?.value ?? 'name-asc') {
	return (UPDATE_CANDIDATE_SORTERS[sortMode] ?? UPDATE_CANDIDATE_SORTERS['name-asc'])(left, right)
}

function sortedCandidates() {
	return candidates.toSorted((left, right) => compareUpdateCandidates(left, right))
}

function selectedReviewReasons() {
	return [...document.querySelectorAll('.vault-review-reason-filter:checked')].map((filter) => filter.value)
}

function updateProfiles() {
	try {
		const profiles = JSON.parse(localStorage.getItem(UPDATE_PROFILE_STORAGE_KEY) ?? '{}')
		return typeof profiles === 'object' && profiles !== null && !Array.isArray(profiles) ? profiles : {}
	} catch {
		return {}
	}
}

function writeUpdateProfiles(profiles) {
	localStorage.setItem(UPDATE_PROFILE_STORAGE_KEY, JSON.stringify(profiles))
}

function cleanProfileName(value) {
	return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 60)
}

function updateProfileControls() {
	const select = byID('vaultUpdateProfileSelect')
	const input = byID('vaultUpdateProfileName')
	const saveButton = byID('vaultUpdateProfileSave')
	const deleteButton = byID('vaultUpdateProfileDelete')
	if ( select === null || input === null || saveButton === null || deleteButton === null ) { return }
	const name = cleanProfileName(input.value)
	const selectedName = select.value
	saveButton.disabled = isBusy || name === ''
	deleteButton.disabled = isBusy || selectedName === ''
	saveButton.textContent = selectedName !== '' && selectedName === name ? 'Update profile' : 'Save profile'
}

function selectedFilterValues(values, fallbackValue = '') {
	if ( Array.isArray(values) ) { return values.filter((value) => typeof value === 'string' && value !== '') }
	if ( typeof fallbackValue === 'string' && fallbackValue !== '' ) { return [fallbackValue] }
	return []
}

function filterMatchMode(name) {
	return document.querySelector(`input[name="${name}"]:checked`)?.value === 'all' ? 'all' : 'any'
}

function setFilterMatchMode(name, value) {
	const normalized = value === 'all' ? 'all' : 'any'
	const input = document.querySelector(`input[name="${name}"][value="${normalized}"]`)
	if ( input !== null ) { input.checked = true }
}

function currentProfileSettings() {
	return {
		autoTagMode : filterMatchMode('vaultUpdateAutoTagMode'),
		autoTags    : [...selectedAutoTagKeys],
		collection  : byID('vaultUpdateCollectionFilter')?.value ?? '',
		customTagMode : filterMatchMode('vaultUpdateCustomTagMode'),
		customTags  : [...selectedCustomTags],
		includeIgnored : byID('vaultIncludeIgnoredUpdates')?.checked === true,
		needsReviewOnly : byID('vaultNeedsReviewOnly')?.checked === true,
		reviewReasons : selectedReviewReasons(),
		sortMode : byID('vaultUpdateSortFilter')?.value ?? 'name-asc',
		stateFilter : byID('vaultUpdateStateFilter')?.value ?? '',
	}
}

function fillUpdateProfileSelect(selectedName = byID('vaultUpdateProfileSelect')?.value ?? '') {
	const select = byID('vaultUpdateProfileSelect')
	const nameInput = byID('vaultUpdateProfileName')
	const profiles = updateProfiles()
	select.replaceChildren()
	const option = document.createElement('option')
	option.value = ''
	option.textContent = 'No saved profile'
	select.append(option)
	for ( const name of Object.keys(profiles).toSorted((left, right) => left.localeCompare(right)) ) {
		const profileOption = document.createElement('option')
		profileOption.value = name
		profileOption.textContent = name
		select.append(profileOption)
	}
	if ( Object.hasOwn(profiles, selectedName) ) {
		select.value = selectedName
		if ( nameInput !== null ) { nameInput.value = selectedName }
	} else if ( nameInput !== null && selectedName === '' ) {
		nameInput.value = ''
	}
	updateProfileControls()
}

function applyReviewProfileSettings(settings = {}) {
	byID('vaultNeedsReviewOnly').checked = settings.needsReviewOnly === true
	if ( byID('vaultUpdateStateFilter') !== null ) {
		byID('vaultUpdateStateFilter').value = settings.stateFilter ?? ''
	}
	const reasons = new Set(Array.isArray(settings.reviewReasons) ? settings.reviewReasons : [])
	for ( const filter of document.querySelectorAll('.vault-review-reason-filter') ) {
		filter.checked = reasons.has(filter.value)
	}
	applyNeedsReviewFilter()
}

function applyPendingProfileReviewFilters() {
	if ( pendingProfileReviewFilters === null ) { return }
	applyReviewProfileSettings(pendingProfileReviewFilters)
	pendingProfileReviewFilters = null
}

function applyUpdateProfile(name) {
	const profile = updateProfiles()[name]
	if ( typeof profile !== 'object' || profile === null ) { return }
	byID('vaultUpdateProfileName').value = name
	byID('vaultUpdateProfileSelect').value = name
	selectedCustomTags.clear()
	for ( const tag of selectedFilterValues(profile.customTags, profile.customTag) ) { selectedCustomTags.add(tag) }
	selectedAutoTagKeys.clear()
	for ( const tag of selectedFilterValues(profile.autoTags, profile.autoTag) ) { selectedAutoTagKeys.add(tag) }
	setFilterMatchMode('vaultUpdateCustomTagMode', profile.customTagMode)
	setFilterMatchMode('vaultUpdateAutoTagMode', profile.autoTagMode)
	if ( byID('vaultUpdateCollectionFilter') !== null ) { byID('vaultUpdateCollectionFilter').value = profile.collection ?? '' }
	if ( byID('vaultUpdateSortFilter') !== null ) { byID('vaultUpdateSortFilter').value = profile.sortMode ?? 'name-asc' }
	byID('vaultIncludeIgnoredUpdates').checked = profile.includeIgnored === true
	pendingProfileReviewFilters = profile
	updateProfileControls()
	loadCandidates(false, false)
}

function saveUpdateProfile() {
	const name = cleanProfileName(byID('vaultUpdateProfileName')?.value ?? '')
	if ( name === '' ) {
		setStatus('Type a profile name before saving.', 'warning')
		byID('vaultUpdateProfileName')?.focus()
		return
	}

	const profiles = updateProfiles()
	profiles[name] = currentProfileSettings()
	writeUpdateProfiles(profiles)
	fillUpdateProfileSelect(name)
	setStatus(`Saved update profile "${name}".`, 'success')
	updateProfileControls()
}

function deleteUpdateProfile() {
	const name = byID('vaultUpdateProfileSelect')?.value ?? ''
	if ( name === '' ) {
		setStatus('Choose an update profile to delete.', 'secondary')
		return
	}
	if ( !confirm(`Delete update profile "${name}"?`) ) { return }
	const profiles = updateProfiles()
	delete profiles[name]
	writeUpdateProfiles(profiles)
	fillUpdateProfileSelect('')
	byID('vaultUpdateProfileName').value = ''
	setStatus(`Deleted update profile "${name}".`, 'success')
	updateProfileControls()
}

function clearVaultUpdateFilters() {
	selectedCustomTags.clear()
	selectedAutoTagKeys.clear()
	setFilterMatchMode('vaultUpdateCustomTagMode', 'any')
	setFilterMatchMode('vaultUpdateAutoTagMode', 'any')
	byID('vaultUpdateCollectionFilter').value = ''
	byID('vaultUpdateSortFilter').value = 'name-asc'
	byID('vaultUpdateStateFilter').value = ''
	byID('vaultIncludeIgnoredUpdates').checked = false
	byID('vaultNeedsReviewOnly').checked = false
	for ( const filter of document.querySelectorAll('.vault-review-reason-filter') ) {
		filter.checked = false
	}
	byID('vaultUpdateProfileSelect').value = ''
	byID('vaultUpdateProfileName').value = ''
	updateTagFilterSummaries()
	updateProfileControls()
	loadCandidates(false, false)
}

function visibleCandidates() {
	const needsReviewOnly = byID('vaultNeedsReviewOnly')?.checked === true
	const stateFilter = byID('vaultUpdateStateFilter')?.value ?? ''
	const selectedReasons = selectedReviewReasons()
	return candidates.filter((candidate) => {
		if ( stateFilter !== '' && candidateUpdateState(candidate) !== stateFilter ) { return false }
		if ( !needsReviewOnly ) { return true }
		if ( candidate.needsReview !== true ) { return false }
		return selectedReasons.length === 0 || selectedReasons.some((reason) => candidate.reviewReasons.includes(reason))
	})
}

function selectedCandidates() {
	const visibleKeys = new Set(visibleCandidates().map((candidate) => candidate.key))
	return candidates.filter((candidate) => visibleKeys.has(candidate.key) && selectedKeys.has(candidate.key))
}

function syncSelectionCheckboxes() {
	for ( const checkbox of document.querySelectorAll('.vault-update-select-checkbox') ) {
		checkbox.checked = selectedKeys.has(checkbox.dataset.candidateKey ?? '')
		checkbox.disabled = isBusy
	}
}

function applyNeedsReviewFilter() {
	const needsReviewOnly = byID('vaultNeedsReviewOnly')?.checked === true
	const reasonFilters = byID('vaultReviewReasonFilters')
	const visibleKeys = new Set(visibleCandidates().map((candidate) => candidate.key))
	if ( reasonFilters !== null ) {
		reasonFilters.classList.toggle('d-none', !needsReviewOnly)
	}
	for ( const card of document.querySelectorAll('.vault-update-card') ) {
		card.classList.toggle('d-none', !visibleKeys.has(card.dataset.candidateKey ?? ''))
	}
	updateSelectionText()
}

function setBusy(value, label = '') {
	isBusy = value
	for ( const element of document.querySelectorAll('button') ) {
		if ( element.id === 'vaultUpdatesPause' || element.id === 'vaultUpdatesStop' ) { continue }
		element.disabled = value
	}
	byID('vaultUpdateProfileSelect').disabled = value
	byID('vaultUpdateProfileName').disabled = value
	byID('vaultUpdateSortFilter').disabled = value
	byID('vaultIncludeIgnoredUpdates').disabled = value
	for ( const element of document.querySelectorAll('.vault-update-filter-input') ) {
		element.disabled = value
	}
	updateProfileControls()
	syncSelectionCheckboxes()
	byID('vaultUpdatesProgressWrap').classList.toggle('d-none', !value)
	byID('vaultUpdatesProgress').style.width = value ? '8%' : '0%'
	byID('vaultUpdatesProgress').textContent = ''
	byID('vaultUpdatesProgressLabel').textContent = label
	updatePauseButton()
	updateStopButton()
}

function setProgress(percent, label) {
	byID('vaultUpdatesProgress').style.width = `${Math.max(0, Math.min(100, percent))}%`
	byID('vaultUpdatesProgress').textContent = ''
	byID('vaultUpdatesProgressLabel').textContent = label
}

function setStatus(message, kind = 'secondary') {
	const status = byID('vaultUpdateStatus')
	status.textContent = message
	status.className = `alert alert-${kind} mb-3`
}

function updatePauseButton() {
	const button = byID('vaultUpdatesPause')
	button.disabled = !isRemoteCheckRunning
	button.textContent = isUpdateCheckPaused ? 'Resume checks' : 'Pause checks'
	button.classList.toggle('btn-warning', isUpdateCheckPaused)
	button.classList.toggle('btn-outline-warning', !isUpdateCheckPaused)
}

function updateStopButton() {
	const button = byID('vaultUpdatesStop')
	button.disabled = !isRemoteCheckRunning || isUpdateCheckStopped
	button.textContent = isUpdateCheckStopped ? 'Stopping...' : 'Stop scan'
}

function resumeUpdateChecks() {
	const waiters = pauseWaiters
	pauseWaiters = []
	for ( const resume of waiters ) { resume() }
}

function setUpdateCheckPaused(paused) {
	if ( !isRemoteCheckRunning && paused ) { return }
	isUpdateCheckPaused = paused
	updatePauseButton()
	if ( !paused ) { resumeUpdateChecks() }
}

function stopUpdateChecks() {
	if ( !isRemoteCheckRunning ) { return }
	isUpdateCheckStopped = true
	setUpdateCheckPaused(false)
	updateStopButton()
	setProgress(
		Number.parseFloat(byID('vaultUpdatesProgress').style.width) || 8,
		'Stopping after current checks finish...'
	)
}

async function waitWhileUpdateCheckPaused() {
	while ( isUpdateCheckPaused ) {
		// eslint-disable-next-line no-await-in-loop
		await new Promise((resolve) => { pauseWaiters.push(resolve) })
	}
}

function setCandidateCounts({
	filteredCandidates = 0,
	filterSkipped = 0,
	noSourceSkipped = 0,
	totalMods = 0,
} = {}) {
	byID('vaultUpdateCandidateCounts').classList.remove('d-none')
	byID('vaultUpdateTotalMods').textContent = totalMods.toString()
	byID('vaultUpdateFilteredCandidates').textContent = filteredCandidates.toString()
	byID('vaultUpdateFilterSkipped').textContent = filterSkipped.toString()
	byID('vaultUpdateNoSourceSkipped').textContent = noSourceSkipped.toString()
	const reviewButton = byID('vaultUpdateReviewNoSource')
	if ( reviewButton !== null ) {
		reviewButton.disabled = isBusy || noSourceSkipped === 0
		reviewButton.textContent = noSourceSkipped === 0 ? 'Review' : `Review ${noSourceSkipped}`
	}
}

function getSources(record) {
	const sources = []
	const seen = new Set()
	const addSource = (source) => {
		const sourceKey = `${source.sourceType}:${source.modHubID ?? source.sourceURL}`
		if ( seen.has(sourceKey) ) { return }
		seen.add(sourceKey)
		sources.push(source)
	}

	for ( const rawModHubID of record.modHubIDs ?? [] ) {
		const modHubID = Number(rawModHubID)
		if ( Number.isInteger(modHubID) && modHubID > 0 ) {
			addSource({
				modHubID,
				sourceType : 'modhub',
				sourceURL  : record.modHubURL ?? `https://www.farming-simulator.com/mod.php?mod_id=${modHubID}&title=fs2025`,
			})
		}
	}

	const sourceURL = record.sourceURL ?? ''
	if ( /^https:\/\/github\.com\//iu.test(sourceURL) ) {
		addSource({ modHubID : null, sourceType : 'github', sourceURL })
	}

	return sources
}

function makeGroupKey(modName, source) {
	return `${source.sourceType}:${source.modHubID ?? source.sourceURL}:${canonicalVaultModName(modName).toLocaleLowerCase()}`
}

function canonicalVaultModName(value) {
	const raw = String(value ?? '').trim()
	const withoutPath = raw.split(/[\\/]/u).at(-1) ?? ''
	const baseName = withoutPath.replace(/\.zip$/iu, '')
	return baseName.replace(/^(?:\d{10,}-)+(?=FS(?:19|22|25)_)/iu, '')
}

function vaultRecordModName(record) {
	return canonicalVaultModName(record?.modNames?.[0] ?? record?.fileName ?? '') || '-- unknown mod --'
}

function vaultTagKey(modName) {
	return String(modName ?? '').trim().toLocaleLowerCase()
}

function tagsForVaultRecord(record, vaultTags = {}) {
	const modName = vaultRecordModName(record)
	const tags = vaultTags[vaultTagKey(modName)]?.tags
	return Array.isArray(tags) ? tags : []
}

function noSourceReviewRecord(record, customTags = [], autoTags = []) {
	const modName = vaultRecordModName(record)
	return {
		autoTags,
		collections : collectionNamesForRecord(record),
		fileName    : record.fileName ?? '',
		hash        : record.hash ?? '',
		localVersion : newestVersion(record.versions ?? []),
		modIcon     : typeof record.modIcon === 'string' && record.modIcon !== '' ? record.modIcon : null,
		modName,
		sourceURL   : record.sourceURL ?? '',
		tags        : customTags,
		totalSize   : record.size ?? 0,
		updatedTime : dateTimeValue(record.updatedAt),
	}
}

function hasIgnoreUpdateTag(tags) {
	return tags.some((tag) => String(tag ?? '').trim().toLocaleLowerCase() === UPDATE_IGNORE_TAG)
}

function uniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))]
}

function autoTag(key, label, group) {
	return { group, key : `${group}:${key}`, label }
}

function autoTagsForVaultRecord(record) {
	const sources = getSources(record).map((source) => autoTag(source.sourceType, sourceLabel(source.sourceType), 'source'))
	return [
		...uniqueStrings(record.modHubCategories ?? []).map((value) => autoTag(value, value, 'modhub')),
		...uniqueStrings(record.itemCategories ?? []).map((value) => autoTag(value, value, 'category')),
		...uniqueStrings(record.itemBrands ?? []).map((value) => autoTag(value, value, 'brand')),
		...uniqueStrings(record.modTypes ?? []).map((value) => autoTag(value, value, 'type')),
		...uniqueStrings(record.storeItemTypes ?? []).map((value) => autoTag(value, value, 'storeItem')),
		...sources,
	]
}

function checkboxID(prefix, value, index) {
	return `${prefix}-${index}-${String(value).replace(/[^a-z0-9_-]+/giu, '-').slice(0, 40)}`
}

function makeFilterCheckbox({
	checked,
	id,
	label,
	onChange,
	value,
}) {
	const wrapper = document.createElement('div')
	wrapper.className = 'form-check dropdown-item m-0'

	const input = document.createElement('input')
	input.className = 'form-check-input vault-update-filter-input'
	input.checked = checked
	input.id = id
	input.type = 'checkbox'
	input.value = value
	input.addEventListener('change', onChange)
	wrapper.append(input)

	const checkboxLabel = document.createElement('label')
	checkboxLabel.className = 'form-check-label w-100'
	checkboxLabel.htmlFor = id
	checkboxLabel.textContent = label
	wrapper.append(checkboxLabel)
	return wrapper
}

function updateFilterSummary({
	buttonID,
	chipsID,
	emptyLabel,
	selectedItems,
}) {
	const button = byID(buttonID)
	const chips = byID(chipsID)
	chips.replaceChildren()
	if ( selectedItems.length === 0 ) {
		button.textContent = emptyLabel
		return
	}

	button.textContent = `${selectedItems.length} selected`
	for ( const item of selectedItems ) {
		chips.append(removableFilterChip(item))
	}
}

function removableFilterChip({ label, onRemove }) {
	const chip = document.createElement('button')
	chip.className = 'badge text-bg-info border-0 d-inline-flex align-items-center gap-1'
	chip.type = 'button'
	chip.title = `Remove ${label}`
	chip.textContent = label
	chip.disabled = isBusy
	chip.addEventListener('click', onRemove)

	const remove = document.createElement('span')
	remove.setAttribute('aria-hidden', 'true')
	remove.textContent = 'x'
	chip.append(remove)

	const srOnly = document.createElement('span')
	srOnly.className = 'visually-hidden'
	srOnly.textContent = `Remove ${label}`
	chip.append(srOnly)
	return chip
}

function fillTagFilter(vaultTags = {}) {
	const menu = byID('vaultUpdateTagFilterMenu')
	const tagValues = uniqueStrings(Object.values(vaultTags)
		.flatMap((record) => Array.isArray(record?.tags) ? record.tags : [])
	)
		.toSorted((left, right) => left.localeCompare(right))
	const validTags = new Set(tagValues)
	for ( const tag of selectedCustomTags ) {
		if ( !validTags.has(tag) ) { selectedCustomTags.delete(tag) }
	}
	menu.replaceChildren()
	if ( tagValues.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'dropdown-item-text text-body-secondary small'
		empty.textContent = 'No custom tags found'
		menu.append(empty)
	}
	for ( const [index, tag] of tagValues.entries() ) {
		menu.append(makeFilterCheckbox({
			checked : selectedCustomTags.has(tag),
			id      : checkboxID('vault-update-custom-tag', tag, index),
			label   : tag,
			onChange : (event) => {
				if ( event.currentTarget.checked ) { selectedCustomTags.add(tag) } else { selectedCustomTags.delete(tag) }
				updateTagFilterSummaries()
				loadCandidates(false, false)
			},
			value   : tag,
		}))
	}
	updateTagFilterSummaries()
}

function autoTagGroupLabel(group) {
	return {
		brand     : 'Manufacturer / brand',
		category  : 'Internal store category',
		modhub    : 'ModHub category',
		source    : 'Update source',
		storeItem : 'Store-item type',
		type      : 'Internal mod type',
	}[group] ?? group
}

function fillAutoTagFilter(vaultEntries = []) {
	const menu = byID('vaultUpdateAutoTagFilterMenu')
	const tagsByGroup = new Map()
	autoTagLabels.clear()
	for ( const tag of vaultEntries.flatMap((record) => autoTagsForVaultRecord(record)) ) {
		if ( !tagsByGroup.has(tag.group) ) { tagsByGroup.set(tag.group, new Map()) }
		tagsByGroup.get(tag.group).set(tag.key, tag)
		autoTagLabels.set(tag.key, tag.label)
	}
	for ( const key of selectedAutoTagKeys ) {
		if ( !autoTagLabels.has(key) ) { selectedAutoTagKeys.delete(key) }
	}

	menu.replaceChildren()
	if ( tagsByGroup.size === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'dropdown-item-text text-body-secondary small'
		empty.textContent = 'No auto tags found'
		menu.append(empty)
	}
	for ( const group of [...tagsByGroup.keys()].toSorted((left, right) => autoTagGroupLabel(left).localeCompare(autoTagGroupLabel(right))) ) {
		const header = document.createElement('h6')
		header.className = 'dropdown-header'
		header.textContent = autoTagGroupLabel(group)
		menu.append(header)
		for ( const [index, tag] of [...tagsByGroup.get(group).values()].toSorted((left, right) => left.label.localeCompare(right.label)).entries() ) {
			menu.append(makeFilterCheckbox({
				checked : selectedAutoTagKeys.has(tag.key),
				id      : checkboxID('vault-update-auto-tag', tag.key, index),
				label   : tag.label,
				onChange : (event) => {
					if ( event.currentTarget.checked ) { selectedAutoTagKeys.add(tag.key) } else { selectedAutoTagKeys.delete(tag.key) }
					updateTagFilterSummaries()
					loadCandidates(false, false)
				},
				value   : tag.key,
			}))
		}
	}
	updateTagFilterSummaries()
}

function updateTagFilterSummaries() {
	updateFilterSummary({
		buttonID : 'vaultUpdateTagFilterButton',
		chipsID  : 'vaultUpdateTagChips',
		emptyLabel : 'All custom tags',
		selectedItems : [...selectedCustomTags].map((tag) => ({
			label : tag,
			onRemove : () => {
				selectedCustomTags.delete(tag)
				updateTagFilterSummaries()
				loadCandidates(false, false)
			},
		})),
	})
	updateFilterSummary({
		buttonID : 'vaultUpdateAutoTagFilterButton',
		chipsID  : 'vaultUpdateAutoTagChips',
		emptyLabel : 'All auto tags',
		selectedItems : [...selectedAutoTagKeys].map((key) => ({
			label : autoTagLabels.get(key) ?? key,
			onRemove : () => {
				selectedAutoTagKeys.delete(key)
				updateTagFilterSummaries()
				loadCandidates(false, false)
			},
		})),
	})
}

function collectionNamesForRecord(record) {
	return uniqueStrings([
		...(Array.isArray(record.collectionFilterNames) ? record.collectionFilterNames : []),
		...(Array.isArray(record.collections) ? record.collections : []),
	])
}

function fillCollectionFilter(vaultEntries = []) {
	const select = byID('vaultUpdateCollectionFilter')
	const currentValue = select?.value ?? ''
	const collectionNames = uniqueStrings(vaultEntries.flatMap((record) => collectionNamesForRecord(record)))
		.toSorted((left, right) => left.localeCompare(right))

	select.replaceChildren()
	const allOption = document.createElement('option')
	allOption.value = ''
	allOption.textContent = 'All collections'
	select.append(allOption)
	for ( const collectionName of collectionNames ) {
		const option = document.createElement('option')
		option.value = collectionName
		option.textContent = collectionName
		select.append(option)
	}
	select.value = collectionNames.includes(currentValue) ? currentValue : ''
}

function matchesSelectedValues(values, selectedValues, mode) {
	if ( selectedValues.size === 0 ) { return true }
	const available = new Set(values)
	if ( mode === 'all' ) {
		return [...selectedValues].every((value) => available.has(value))
	}
	return [...selectedValues].some((value) => available.has(value))
}

function addBadge(parent, text, className) {
	const badge = document.createElement('span')
	badge.className = `badge ${className}`
	badge.textContent = text
	parent.append(badge)
}

function formatBytes(value) {
	const bytes = Number(value)
	if ( !Number.isFinite(bytes) || bytes <= 0 ) { return '0 B' }
	const units = ['B', 'KB', 'MB', 'GB']
	let size = bytes
	let unitIndex = 0
	while ( size >= 1024 && unitIndex < units.length - 1 ) {
		size /= 1024
		unitIndex++
	}
	return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

async function openNoSourceDetail(record) {
	if ( typeof record?.hash !== 'string' || record.hash === '' ) {
		setStatus('Could not open details because this Vault record has no hash.', 'danger')
		return
	}
	const result = await window.vault_update_IPC.openDetail({
		collections : record.collections,
		fileName    : record.fileName,
		hash        : record.hash,
		modName     : record.modName,
	})
	if ( result?.ok === false ) {
		setStatus(`Could not open Vault details: ${result.error ?? 'Unknown error'}`, 'danger')
	}
}

function noSourceReviewRow(record) {
	const row = document.createElement('button')
	row.className = 'list-group-item list-group-item-action bg-dark text-body border-secondary vault-no-source-row'
	row.type = 'button'
	row.title = 'Right-click to open this mod in the details window.'
	row.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		openNoSourceDetail(record)
	})
	row.addEventListener('dblclick', () => openNoSourceDetail(record))

	const wrapper = document.createElement('div')
	wrapper.className = 'd-flex gap-3 align-items-center'
	row.append(wrapper)

	if ( record.modIcon ) {
		const icon = document.createElement('img')
		icon.className = 'vault-update-icon rounded border border-secondary bg-body flex-shrink-0'
		icon.src = DATA.iconMaker(record.modIcon)
		icon.alt = ''
		wrapper.append(icon)
	}

	const content = document.createElement('div')
	content.className = 'flex-grow-1'
	wrapper.append(content)

	const title = document.createElement('div')
	title.className = 'fw-bold'
	title.textContent = record.modName
	content.append(title)

	const filename = document.createElement('div')
	filename.className = 'small text-body-secondary'
	filename.textContent = record.fileName === '' ? 'Filename not recorded' : record.fileName
	content.append(filename)

	const meta = document.createElement('div')
	meta.className = 'small text-body-secondary'
	meta.textContent = `Vault ${record.localVersion} | ${formatBytes(record.totalSize)}${record.collections.length === 0 ? '' : ` | ${record.collections.join(', ')}`}`
	content.append(meta)

	const source = document.createElement('div')
	source.className = record.sourceURL === '' ? 'small text-warning' : 'small text-info'
	source.textContent = record.sourceURL === ''
		? 'No source URL recorded.'
		: `Unsupported source URL: ${record.sourceURL}`
	content.append(source)

	const tags = document.createElement('div')
	tags.className = 'd-flex flex-wrap gap-1 mt-2'
	for ( const tag of (record.autoTags ?? []).slice(0, 4) ) { addBadge(tags, tag.label, 'text-bg-secondary') }
	for ( const tag of record.tags ?? [] ) { addBadge(tags, tag, 'text-bg-info') }
	if ( tags.childElementCount !== 0 ) { content.append(tags) }

	return row
}

function reviewNoSourceRecords() {
	const dialog = byID('vaultNoSourceDialog')
	const list = byID('vaultNoSourceList')
	const summary = byID('vaultNoSourceSummary')
	list.replaceChildren()
	const records = noSourceRecords.toSorted((left, right) => compareUpdateCandidates(left, right))
	summary.textContent = `${records.length} Vault mod${records.length === 1 ? '' : 's'} matched the current filters but have no supported update source.`
	if ( records.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'list-group-item bg-dark text-body-secondary border-secondary'
		empty.textContent = 'No matching unsupported-source Vault mods to review.'
		list.append(empty)
	} else {
		for ( const record of records ) { list.append(noSourceReviewRow(record)) }
	}
	if ( !dialog.open ) { dialog.showModal() }
}

function cardFor(candidate) {
	const card = document.createElement('div')
	card.className = 'card mb-3 bg-dark border-secondary vault-update-card'
	card.dataset.candidateKey = candidate.key

	const body = document.createElement('div')
	body.className = 'card-body'
	card.append(body)

	const row = document.createElement('div')
	row.className = 'row g-3 align-items-center'
	body.append(row)

	const selectColumn = document.createElement('div')
	selectColumn.className = 'col-auto'
	row.append(selectColumn)

	const check = document.createElement('input')
	check.type = 'checkbox'
	check.className = 'form-check-input m-0 vault-update-select-checkbox'
	check.dataset.candidateKey = candidate.key
	check.checked = selectedKeys.has(candidate.key)
	check.disabled = isBusy
	check.addEventListener('change', () => {
		if ( check.checked ) { selectedKeys.add(candidate.key) } else { selectedKeys.delete(candidate.key) }
		updateSelectionText()
	})
	selectColumn.append(check)

	if ( candidate.modIcon ) {
		const iconColumn = document.createElement('div')
		iconColumn.className = 'col-auto'
		const icon = document.createElement('img')
		icon.className = 'vault-update-icon rounded border border-secondary bg-body'
		icon.src = DATA.iconMaker(candidate.modIcon)
		icon.alt = ''
		iconColumn.append(icon)
		row.append(iconColumn)
	}

	const contentColumn = document.createElement('div')
	contentColumn.className = 'col'
	row.append(contentColumn)

	const title = document.createElement('h4')
	title.className = 'mb-1'
	title.textContent = candidate.modName
	contentColumn.append(title)

	const detail = document.createElement('div')
	detail.className = 'text-body-secondary'
	detail.textContent = `${sourceLabel(candidate.sourceType)} | Vault ${candidate.localVersion} -> Latest ${candidate.remoteVersion}`
	contentColumn.append(detail)

	const actionColumn = document.createElement('div')
	actionColumn.className = 'col-12 col-md-4 text-md-end'
	row.append(actionColumn)

	const versionBadges = document.createElement('div')
	versionBadges.className = 'mb-2'
	addBadge(versionBadges, `Vault ${candidate.localVersion}`, 'text-bg-secondary me-2')
	addBadge(versionBadges, `${sourceLabel(candidate.sourceType)} ${candidate.remoteVersion}`, 'text-bg-warning')
	actionColumn.append(versionBadges)

	const sourceBadges = document.createElement('div')
	sourceBadges.className = 'mb-2'
	addBadge(sourceBadges, sourceBadgeLabel(candidate), 'text-bg-info')
	if ( candidate.packageMismatch !== null && typeof candidate.packageMismatch === 'object' ) {
		addBadge(sourceBadges, 'Package mismatch', 'text-bg-danger')
	}
	for ( const tag of (candidate.autoTags ?? []).slice(0, 6) ) {
		addBadge(sourceBadges, tag.label, 'text-bg-secondary')
	}
	for ( const tag of candidate.tags ?? [] ) {
		addBadge(sourceBadges, tag, 'text-bg-info')
	}
	actionColumn.append(sourceBadges)

	if ( candidate.needsReview ) {
		const review = document.createElement('div')
		review.className = 'small text-warning mb-2'
		review.textContent = reviewNoteText(candidate.reviewReasons)
		actionColumn.append(review)
	}

	if ( candidate.sourceType === 'modhub' ) {
		const released = document.createElement('div')
		released.className = 'small text-body-secondary mb-2'
		released.textContent = `ModHub released: ${modHubReleasedLabel(candidate.modHubReleased)}`
		actionColumn.append(released)
	}

	const updateStatus = document.createElement('div')
	updateStatus.className = candidate.packageMismatch === null ? 'text-warning mb-3' : 'text-danger mb-3'
	updateStatus.textContent = candidate.packageMismatch === null
		? 'Update may be available'
		: packageMismatchMessage(candidate.packageMismatch, candidate.remoteVersion)
	actionColumn.append(updateStatus)

	const availability = document.createElement('div')
	availability.className = 'small mb-3'
	addBadge(availability, candidate.downloadURL ? 'ZIP download available' : 'Manual download only', candidate.downloadURL ? 'text-bg-success me-2' : 'text-bg-secondary me-2')
	if ( candidate.downloadURL ) {
		availability.append(document.createTextNode(candidate.assetName ?? candidate.fileName))
	}
	actionColumn.append(availability)

	const openButton = document.createElement('button')
	openButton.className = 'btn btn-primary w-100'
	openButton.textContent = 'Open Web Page'
	openButton.addEventListener('click', () => window.vault_update_IPC.openURL(candidate.pageURL))
	actionColumn.append(openButton)

	if ( !candidate.downloadURL ) {
		const help = document.createElement('div')
		help.className = 'small text-body-secondary mt-3'
		help.textContent = 'This source does not provide a direct ZIP download. Open its web page and add the ZIP to a collection or scan it into the Vault afterwards.'
		body.append(help)
	}

	return card
}

function setAllSelections(selected) {
	const visibleKeys = new Set(visibleCandidates().map((candidate) => candidate.key))
	if ( selected ) {
		for ( const key of visibleKeys ) { selectedKeys.add(key) }
	} else {
		selectedKeys = new Set([...selectedKeys].filter((key) => !visibleKeys.has(key)))
	}
	syncSelectionCheckboxes()
	updateSelectionText()
}

function selectReadyUpdates() {
	for ( const candidate of visibleCandidates() ) {
		if ( candidateUpdateState(candidate) === 'ready' ) { selectedKeys.add(candidate.key) }
	}
	syncSelectionCheckboxes()
	updateSelectionText()
}

function updateSelectionText() {
	const candidateKeys = new Set(candidates.map((candidate) => candidate.key))
	selectedKeys = new Set([...selectedKeys].filter((key) => candidateKeys.has(key)))
	syncSelectionCheckboxes()
	const visible = visibleCandidates()
	const selected = selectedCandidates()
	const visibleCount = visible.length
	const selectedCount = selected.length
	const selectedDownloadableCount = selected.filter((candidate) => candidate.downloadURL).length
	const selectedStateCounts = candidateStateCounts(selected)
	const stateSummary = byID('vaultUpdateStateSummary')

	byID('vaultUpdateSelectionControls').classList.toggle('d-none', candidates.length === 0)
	if ( stateSummary !== null ) {
		stateSummary.textContent = stateSummaryText(visible)
	}
	byID('vaultUpdatesSelectedCount').textContent = `Selected: ${selectedCount}`
	if ( selectedCount === 0 ) {
		byID('vaultUpdateSelection').textContent = '0 updates selected. Downloads are stored in the Vault only.'
	} else {
		const parts = [`${selectedCount} selected`, `${selectedDownloadableCount} downloadable`]
		if ( selectedStateCounts.ready > 0 ) { parts.push(`${selectedStateCounts.ready} ready`) }
		if ( selectedStateCounts.review > 0 ) { parts.push(`${selectedStateCounts.review} need review`) }
		if ( selectedStateCounts.manual > 0 ) { parts.push(`${selectedStateCounts.manual} manual only`) }
		if ( selectedStateCounts.packageMismatch > 0 ) { parts.push(`${selectedStateCounts.packageMismatch} package mismatch`) }
		byID('vaultUpdateSelection').textContent = `${parts.join(' | ')}. Downloads are stored in the Vault only.`
	}
	byID('vaultUpdatesDownloadSelected').disabled = isBusy || selectedDownloadableCount === 0
	byID('vaultUpdatesOpenSelected').disabled = isBusy || selectedCount === 0
	byID('vaultUpdatesSelectAll').disabled = isBusy || visibleCount === 0
	byID('vaultUpdatesSelectReady').disabled = isBusy || visible.filter((candidate) => candidateUpdateState(candidate) === 'ready').length === 0
	byID('vaultUpdatesSelectNone').disabled = isBusy || selectedCount === 0
}

function renderCandidates(skipped = lastSkippedCount) {
	lastSkippedCount = skipped
	const list = byID('vaultUpdateList')
	list.replaceChildren()
	selectedKeys = new Set([...selectedKeys].filter((key) => candidates.some((candidate) => candidate.key === key)))

	if ( candidates.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'alert alert-success'
		empty.textContent = 'No newer supported Vault updates were found.'
		list.append(empty)
	} else {
		for ( const candidate of sortedCandidates() ) { list.append(cardFor(candidate)) }
	}

	applyNeedsReviewFilter()
	const reviewCount = candidates.filter((candidate) => candidate.needsReview).length
	setStatus(`${candidates.length} Vault update(s) found.${reviewCount === 0 ? '' : ` ${reviewCount} need review.`}${skipped > 0 ? ` ${skipped} item(s) skipped because they have no supported update source.` : ''}`, candidates.length !== 0 ? 'warning' : 'success')
	updateSelectionText()
}

function renderReadyToScan(sourceGroupsLength) {
	const list = byID('vaultUpdateList')
	list.replaceChildren()
	const prompt = document.createElement('div')
	prompt.className = 'alert alert-info'
	prompt.textContent = `Ready to scan ${sourceGroupsLength} filtered Vault update candidate${sourceGroupsLength === 1 ? '' : 's'}. Press Start update scan when you want remote checks to begin.`
	list.append(prompt)
}

function clearDownloadResults() {
	byID('vaultDownloadResults').replaceChildren()
	byID('vaultDownloadResults').classList.add('d-none')
}

function downloadResultCandidate(result) {
	if ( typeof result?.candidateKey === 'string' ) {
		const candidate = candidates.find((item) => item.key === result.candidateKey)
		if ( candidate !== undefined ) { return candidate }
	}
	return candidates.find((candidate) =>
		canonicalVaultModName(candidate.modName).toLocaleLowerCase() ===
		canonicalVaultModName(result?.modName ?? '').toLocaleLowerCase()
	) ?? null
}

// eslint-disable-next-line complexity
function appendDownloadResultItem(parent, result, statusClass) {
	const candidate = downloadResultCandidate(result)
	const item = document.createElement('li')
	item.className = 'mb-2'
	const title = document.createElement('div')
	title.className = 'fw-bold'
	title.textContent = result?.modName || candidate?.modName || 'Unknown mod'
	item.append(title)

	const detail = document.createElement('div')
	detail.className = 'small text-body-secondary'
	const sourceText = sourceLabel(result?.sourceType ?? candidate?.sourceType ?? '')
	const version = result?.version || candidate?.remoteVersion || ''
	const fileName = result?.fileName || candidate?.assetName || candidate?.fileName || ''
	detail.textContent = `${sourceText}${version === '' ? '' : ` ${version}`}${fileName === '' ? '' : ` | ${fileName}`}`
	item.append(detail)

	if ( result?.error ) {
		const error = document.createElement('div')
		error.className = statusClass
		error.textContent = result.errorCode === 'package-mismatch'
			? packageMismatchMessage(result, result.expectedVersion ?? candidate?.remoteVersion ?? 'unknown')
			: result.error
		item.append(error)
	}
	parent.append(item)
}

function renderDownloadResults(results = []) {
	const panel = byID('vaultDownloadResults')
	panel.replaceChildren()
	const failures = results.filter((result) => !result?.ok)
	const successes = results.filter((result) => result?.ok)
	if ( failures.length === 0 && successes.length === 0 ) {
		panel.classList.add('d-none')
		return
	}
	panel.className = `mx-2 mb-3 alert ${failures.length === 0 ? 'alert-success' : 'alert-danger'}`

	const heading = document.createElement('div')
	heading.className = 'fw-bold mb-2'
	heading.textContent = failures.length === 0
		? `Vault download complete: ${successes.length} stored.`
		: `Vault download issues: ${failures.length} failed, ${successes.length} stored.`
	panel.append(heading)

	if ( failures.length !== 0 ) {
		const failedTitle = document.createElement('div')
		failedTitle.className = 'fw-bold'
		failedTitle.textContent = 'Failed downloads'
		panel.append(failedTitle)
		const failedList = document.createElement('ul')
		failedList.className = 'mb-2'
		for ( const result of failures ) { appendDownloadResultItem(failedList, result, 'small text-warning') }
		panel.append(failedList)
	}

	if ( successes.length !== 0 ) {
		const successTitle = document.createElement('div')
		successTitle.className = 'fw-bold'
		successTitle.textContent = 'Stored downloads'
		panel.append(successTitle)
		const successList = document.createElement('ul')
		successList.className = 'mb-0'
		for ( const result of successes ) { appendDownloadResultItem(successList, result, 'small text-success') }
		panel.append(successList)
	}
	panel.classList.remove('d-none')
}

function updatePackageMismatchStatesFromResults(results = []) {
	const records = packageMismatchStates()
	let changed = false
	for ( const result of results ) {
		const candidate = downloadResultCandidate(result)
		const key = packageMismatchKey(candidate)
		if ( key === '' ) { continue }
		if ( result?.ok ) {
			if ( Object.hasOwn(records, key) ) {
				delete records[key]
				changed = true
			}
			candidate.packageMismatch = null
			updateCandidateReviewState(candidate)
			continue
		}
		if ( result?.errorCode !== 'package-mismatch' ) { continue }
		const mismatch = {
			downloadedVersion : result.downloadedVersion ?? 'unknown',
			error             : result.error ?? '',
			expectedVersion   : result.expectedVersion ?? candidate.remoteVersion,
			fileName          : result.fileName ?? candidate.fileName,
			message           : packageMismatchMessage(result, result.expectedVersion ?? candidate.remoteVersion),
			modName           : result.modName ?? candidate.modName,
			updatedAt         : new Date().toISOString(),
		}
		records[key] = mismatch
		candidate.packageMismatch = mismatch
		updateCandidateReviewState(candidate)
		changed = true
	}
	if ( changed ) { writePackageMismatchStates(records) }
}

function removeStoredCandidates(storedResults) {
	const storedKeys = new Set()
	for ( const result of storedResults ?? [] ) {
		if ( !result?.ok ) { continue }
		for ( const candidate of candidates ) {
			const sameMod = canonicalVaultModName(candidate.modName).toLocaleLowerCase() ===
				canonicalVaultModName(result.modName).toLocaleLowerCase()
			const sameVersion = compareVersions(candidate.remoteVersion, result.version) === 0
			if ( sameMod && sameVersion ) { storedKeys.add(candidate.key) }
		}
	}

	if ( storedKeys.size === 0 ) { return }
	candidates = candidates.filter((candidate) => !storedKeys.has(candidate.key))
	selectedKeys = new Set([...selectedKeys].filter((key) => !storedKeys.has(key)))
	renderCandidates(0)
}

async function mapWithConcurrency(items, concurrency, worker) {
	const results = new Array(items.length)
	let nextIndex = 0
	const workers = Array.from({ length : Math.min(concurrency, items.length) }, async () => {
		while ( nextIndex < items.length && !isUpdateCheckStopped ) {
			// eslint-disable-next-line no-await-in-loop
			await waitWhileUpdateCheckPaused()
			if ( isUpdateCheckStopped ) { return }
			const index = nextIndex
			nextIndex++
			// eslint-disable-next-line no-await-in-loop
			results[index] = await worker(items[index], index)
		}
	})
	await Promise.all(workers)
	return results
}

// eslint-disable-next-line complexity
async function loadCandidates(force = false, runRemoteChecks = false) {
	if ( isBusy ) { return }
	setBusy(true, 'Loading Vault...')
	clearDownloadResults()
	const checkStartedAt = performance.now()
	// A fresh update check must never inherit selection from an older result
	// set. Only the visible ticked rows may be downloaded.
	selectedKeys.clear()
	if ( byID('vaultNeedsReviewOnly') !== null ) { byID('vaultNeedsReviewOnly').checked = false }
	for ( const filter of document.querySelectorAll('.vault-review-reason-filter') ) { filter.checked = false }
	syncSelectionCheckboxes()
	try {
		const vault = await window.vault_update_IPC.getVault()
		const groups = new Map()
		noSourceRecords = []
		let collectionSkipped = 0
		let ignoredSkipped = 0
		let skipped = 0
		let tagSkipped = 0

		const vaultEntries = Array.isArray(vault.entries)
			? vault.entries
			: (Array.isArray(vault.records) ? vault.records : [])
		fillTagFilter(vault.tags ?? {})
		fillAutoTagFilter(vaultEntries)
		fillCollectionFilter(vaultEntries)
		const includeIgnored = byID('vaultIncludeIgnoredUpdates')?.checked === true
		const collectionFilter = byID('vaultUpdateCollectionFilter')?.value ?? ''
		const selectedCustomTagValues = [...selectedCustomTags]
		const selectedAutoTagValues = [...selectedAutoTagKeys]
		const customTagMode = filterMatchMode('vaultUpdateCustomTagMode')
		const autoTagMode = filterMatchMode('vaultUpdateAutoTagMode')

		for ( const record of vaultEntries ) {
			const customTags = tagsForVaultRecord(record, vault.tags ?? {})
			if ( !includeIgnored && hasIgnoreUpdateTag(customTags) ) {
				ignoredSkipped++
				continue
			}
			if ( collectionFilter !== '' && !collectionNamesForRecord(record).includes(collectionFilter) ) {
				collectionSkipped++
				continue
			}
			const autoTags = autoTagsForVaultRecord(record)
			if (
				!matchesSelectedValues(customTags, selectedCustomTags, customTagMode) ||
				!matchesSelectedValues(autoTags.map((tag) => tag.key), selectedAutoTagKeys, autoTagMode)
			) {
				tagSkipped++
				continue
			}
			const sources = getSources(record)
			if ( sources.length === 0 ) {
				skipped++
				noSourceRecords.push(noSourceReviewRecord(record, customTags, autoTags))
				continue
			}
			const modName = vaultRecordModName(record)
			for ( const source of sources ) {
				const key = makeGroupKey(modName, source)
				const existing = groups.get(key) ?? {
					autoTags      : [],
					fileName      : record.fileName,
					gameVersions  : [],
					hashes        : [],
					key,
					localVersions : [],
					modHubID      : source.modHubID,
					modIcon       : typeof record.modIcon === 'string' && record.modIcon !== '' ? record.modIcon : null,
					modName,
					sourceType    : source.sourceType,
					sourceURL     : source.sourceURL,
					tags          : customTags,
					totalSize     : 0,
					updatedTime   : 0,
				}
				existing.gameVersions.push(...(record.gameVersions ?? []))
				if ( typeof record.hash === 'string' && record.hash !== '' ) { existing.hashes.push(record.hash) }
				existing.localVersions.push(...(record.versions ?? []))
				existing.tags.push(...customTags.filter((tag) => !existing.tags.includes(tag)))
				existing.totalSize += record.size ?? 0
				existing.updatedTime = Math.max(existing.updatedTime, dateTimeValue(record.updatedAt))
				for ( const autoTagRecord of autoTags ) {
					if ( !existing.autoTags.some((tag) => tag.key === autoTagRecord.key) ) {
						existing.autoTags.push(autoTagRecord)
					}
				}
				if ( existing.modIcon === null && typeof record.modIcon === 'string' && record.modIcon !== '' ) {
					existing.modIcon = record.modIcon
				}
				groups.set(key, existing)
			}
		}

		const sourceGroups = [...groups.values()]
		setCandidateCounts({
			filteredCandidates : sourceGroups.length,
			filterSkipped : ignoredSkipped + tagSkipped + collectionSkipped,
			noSourceSkipped : skipped,
			totalMods : vaultEntries.length,
		})
		setStatus(`Checking ${sourceGroups.length} filtered Vault update candidate${sourceGroups.length === 1 ? '' : 's'} from ${vaultEntries.length} Vault mod${vaultEntries.length === 1 ? '' : 's'}.`, 'secondary')
		candidates = []
		if ( !runRemoteChecks ) {
			renderReadyToScan(sourceGroups.length)
			setStatus(`Ready to scan ${sourceGroups.length} filtered Vault update candidate${sourceGroups.length === 1 ? '' : 's'} from ${vaultEntries.length} Vault mod${vaultEntries.length === 1 ? '' : 's'}.`, 'secondary')
			return
		}
		let checked = 0
		isUpdateCheckStopped = false
		isRemoteCheckRunning = true
		updatePauseButton()
		updateStopButton()
		const remoteResults = await mapWithConcurrency(sourceGroups, REMOTE_CHECK_CONCURRENCY, async (group) => {
			const remote = await (group.sourceType === 'modhub'
				? window.vault_update_IPC.getModHub(group.modHubID, force)
				: window.vault_update_IPC.getGitHub(group.sourceURL, force))
			checked++
			setProgress(Math.round((checked / Math.max(sourceGroups.length, 1)) * 90), `Checking ${checked} of ${sourceGroups.length}`)
			return { group, remote }
		})
		const wasStopped = isUpdateCheckStopped
		isRemoteCheckRunning = false
		setUpdateCheckPaused(false)
		updateStopButton()
		await window.vault_update_IPC.updateScanMetadata({
			updates : remoteResults
				.filter((result) => result !== undefined)
				.map(({ group, remote }) => ({
					hashes     : [...new Set(group.hashes)],
					modHubID   : group.modHubID,
					remote,
					sourceType : group.sourceType,
					sourceURL  : group.sourceURL,
				})),
		})

		for ( const result of remoteResults ) {
			if ( result === undefined ) { continue }
			const { group, remote } = result
			if ( !remote?.ok || typeof remote.version !== 'string' ) { continue }
			const localVersion = newestVersion(group.localVersions)
			if ( compareVersions(remote.version, localVersion) <= 0 ) { continue }
			const candidate = {
				assetName     : remote.assetName ?? group.fileName,
				autoTags      : group.autoTags,
				downloadSource : remote.downloadSource ?? null,
				downloadURL   : remote.hasDownload ? remote.downloadURL : null,
				fileName      : group.fileName,
				gameVersion   : group.gameVersions.find((value) => Number.isInteger(value)) ?? null,
				key           : group.key,
				localVersion,
				modHubID      : group.modHubID,
				modHubReleased : remote.released ?? null,
				modIcon       : group.modIcon,
				modName       : group.modName,
				pageURL       : remote.url ?? group.sourceURL,
				remoteVersion : remote.version,
				sourceType    : group.sourceType,
				sourceURL     : group.sourceURL,
				tags          : group.tags,
				totalSize     : group.totalSize,
				updatedTime   : group.updatedTime,
			}
			applyPackageMismatchState(candidate)
			updateCandidateReviewState(candidate)
			candidates.push(candidate)
		}

		setProgress(wasStopped ? Math.round((checked / Math.max(sourceGroups.length, 1)) * 90) : 100, wasStopped ? 'Update check stopped' : 'Update check complete')
		renderCandidates(skipped)
		applyPendingProfileReviewFilters()
		if ( wasStopped ) {
			setStatus(`Vault update scan stopped after ${checked} of ${sourceGroups.length} remote check${sourceGroups.length === 1 ? '' : 's'}. Showing ${candidates.length} update${candidates.length === 1 ? '' : 's'} found before stopping.`, candidates.length !== 0 ? 'warning' : 'secondary')
		}
		if ( !wasStopped && (collectionFilter !== '' || selectedCustomTagValues.length !== 0 || selectedAutoTagValues.length !== 0 || ignoredSkipped !== 0) ) {
			const filterParts = [
				collectionFilter === '' ? '' : `collection "${collectionFilter}"`,
				selectedCustomTagValues.length === 0 ? '' : `${customTagMode} custom tags "${selectedCustomTagValues.join(', ')}"`,
				selectedAutoTagValues.length === 0 ? '' : `${autoTagMode} auto tags "${selectedAutoTagValues.map((key) => autoTagLabels.get(key) ?? key).join(', ')}"`,
			].filter((part) => part !== '')
			const filterText = filterParts.length === 0 ? '' : ` for ${filterParts.join(' and ')}`
			const ignoredText = ignoredSkipped === 0 ? '' : ` ${ignoredSkipped} item(s) hidden by Ignore Updates.`
			const tagText = tagSkipped + collectionSkipped === 0 ? '' : ` ${tagSkipped + collectionSkipped} Vault item(s) skipped by filter.`
			setStatus(`${candidates.length} Vault update(s) found${filterText}.${ignoredText}${tagText}${skipped > 0 ? ` ${skipped} matching item(s) skipped because they have no supported update source.` : ''}`, candidates.length !== 0 ? 'warning' : 'success')
		}
		void window.vault_update_IPC.logPerformance({
			candidates : candidates.length,
			durationMS : performance.now() - checkStartedAt,
			force,
			groups : sourceGroups.length,
			skipped : skipped + tagSkipped + ignoredSkipped + collectionSkipped,
		})
	} catch (err) {
		setStatus(`Vault update check failed: ${err.message}`, 'danger')
	} finally {
		isRemoteCheckRunning = false
		setUpdateCheckPaused(false)
		// eslint-disable-next-line require-atomic-updates
		isUpdateCheckStopped = false
		setBusy(false)
		updateSelectionText()
	}
}

async function downloadSelected() {
	const downloadableCandidates = candidates
		.filter((candidate) => selectedKeys.has(candidate.key) && candidate.downloadURL)
	const downloads = downloadableCandidates
		.map((candidate) => ({
			candidateKey : candidate.key,
			fileName   : candidate.assetName,
			gameVersion : candidate.gameVersion,
			modHubID   : candidate.modHubID,
			modHubReleased : candidate.modHubReleased,
			modName    : candidate.modName,
			sourceType : candidate.sourceType,
			sourceURL  : candidate.sourceURL,
			url        : candidate.downloadURL,
			version    : candidate.remoteVersion,
		}))

	if ( downloads.length === 0 ) { return }
	const manualCount = selectedKeys.size - downloads.length
	let refreshAfterDownload = false
	setBusy(true, 'Saving update(s) to Vault...')
	clearDownloadResults()
	try {
		const result = await window.vault_update_IPC.downloadToVaultSelected(downloads)
		const results = Array.isArray(result?.results) ? result.results : []
		updatePackageMismatchStatesFromResults(results)
		renderCandidates(lastSkippedCount)
		renderDownloadResults(results)
		const manualMessage = manualCount > 0
			? ` ${manualCount} selected update(s) require manual download and were not changed.`
			: ''
		removeStoredCandidates(results)
		if ( !result?.ok ) {
			setStatus(`Vault download completed with issues: ${result?.error ?? 'one or more downloads failed'}${manualMessage}`, 'danger')
			return
		}
		setStatus(`Stored ${result.count} update(s) in the Vault.${manualMessage} Matching collection updates will reuse these cached ZIPs when available. Use Refresh Vault update checks to rescan all sources.`, 'success')
		refreshAfterDownload = true
	} catch (err) {
		setStatus(`Vault download failed: ${err.message}`, 'danger')
	} finally {
		setBusy(false)
		updateSelectionText()
		if ( refreshAfterDownload ) { await loadCandidates(false, false) }
	}
}

window.addEventListener('DOMContentLoaded', () => {
	for ( const trigger of document.querySelectorAll('[data-bs-toggle="tooltip"]') ) {
		bootstrap.Tooltip.getOrCreateInstance(trigger)
	}
	fillUpdateProfileSelect()
	byID('vaultUpdatesStart').addEventListener('click', () => loadCandidates(false, true))
	byID('vaultUpdatesPause').addEventListener('click', () => {
		setUpdateCheckPaused(!isUpdateCheckPaused)
	})
	byID('vaultUpdatesStop').addEventListener('click', stopUpdateChecks)
	byID('vaultIncludeIgnoredUpdates').addEventListener('change', () => loadCandidates(false, false))
	byID('vaultUpdateCollectionFilter').addEventListener('change', () => loadCandidates(false, false))
	for ( const modeInput of document.querySelectorAll('input[name="vaultUpdateCustomTagMode"], input[name="vaultUpdateAutoTagMode"]') ) {
		modeInput.addEventListener('change', () => loadCandidates(false, false))
	}
	byID('vaultUpdateProfileSelect').addEventListener('change', (event) => {
		const profileName = event.target.value
		if ( profileName !== '' ) { applyUpdateProfile(profileName) }
		updateProfileControls()
	})
	byID('vaultUpdateProfileName').addEventListener('input', updateProfileControls)
	byID('vaultUpdateProfileSave').addEventListener('click', saveUpdateProfile)
	byID('vaultUpdateProfileDelete').addEventListener('click', deleteUpdateProfile)
	byID('vaultUpdateClearFilters').addEventListener('click', clearVaultUpdateFilters)
	byID('vaultUpdateSortFilter').addEventListener('change', () => {
		if ( candidates.length !== 0 ) { renderCandidates() }
		if ( byID('vaultNoSourceDialog')?.open ) { reviewNoSourceRecords() }
	})
	byID('vaultUpdateStateFilter').addEventListener('change', applyNeedsReviewFilter)
	byID('vaultUpdateReviewNoSource').addEventListener('click', reviewNoSourceRecords)
	byID('vaultNoSourceClose').addEventListener('click', () => { byID('vaultNoSourceDialog').close() })
	byID('vaultUpdatesDownloadSelected').addEventListener('click', downloadSelected)
	byID('vaultUpdatesSelectAll').addEventListener('click', () => setAllSelections(true))
	byID('vaultUpdatesSelectReady').addEventListener('click', selectReadyUpdates)
	byID('vaultUpdatesSelectNone').addEventListener('click', () => setAllSelections(false))
	byID('vaultUpdatesOpenSelected').addEventListener('click', () => {
		for ( const candidate of selectedCandidates() ) {
			window.vault_update_IPC.openURL(candidate.pageURL)
		}
	})
	byID('vaultNeedsReviewOnly').addEventListener('change', applyNeedsReviewFilter)
	for ( const filter of document.querySelectorAll('.vault-review-reason-filter') ) {
		filter.addEventListener('change', applyNeedsReviewFilter)
	}
	byID('vaultUpdatesBack').addEventListener('click', () => window.vault_update_IPC.dispatchModManagement())
	loadCandidates(false, false)
})
