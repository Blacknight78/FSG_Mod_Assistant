/* global DATA, UpdateCandidateModel, bootstrap */

let candidates = []
let noSourceRecords = []
let selectedNoSourceRecord = null
let noSourceSaveFeedbackTimer = null
let updateIgnoreMods = []
let updaterTaskStartedAt = 0
let localSourceSaveModName = null
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
const autoTagParentKeys = new Map()
const REMOTE_CHECK_CONCURRENCY = 12
const UPDATE_IGNORE_TAG = 'ignore updates'
const PACKAGE_MISMATCH_STORAGE_KEY = 'fsg.vaultUpdatePackageMismatches.v1'
const UPDATE_PROFILE_STORAGE_KEY = 'fsg.vaultUpdateProfiles.v1'

const byID = (id) => document.getElementById(id)

async function checkVaultUpdateSource(group, force, catalogueVersions, cachedPageVersions) {
	if ( group.sourceType === 'modhub' && group.isModHubPrefab ) {
		return {
			catalogueDetailLookup : false,
			remote : {
				category : group.modHubCategory ?? 'Prefab',
				checkDiagnostics : { cache : 'prefab', durationMS : 0, http403or429 : 0, httpErrors : 0, parseMS : 0, requestMS : 0, requests : 0, requestTimeouts : 0 },
				hasDownload : false,
				modHubID : group.modHubID,
				ok : true,
				source : 'modhub',
				url : group.sourceURL,
				version : null,
			},
		}
	}
	if ( group.sourceType === 'modhub' && !force ) {
		const catalogueVersion = catalogueVersions[group.modHubID]
		const cachedPageVersion = cachedPageVersions[group.modHubID]
		const knownModHubVersion = newestVersion([catalogueVersion, cachedPageVersion])
		const catalogueComparison = compareCatalogueVersion(group.localVersions, knownModHubVersion)
		if ( catalogueComparison !== null && !catalogueComparison.needsDetails ) {
			return {
				catalogueDetailLookup : false,
				remote : {
					checkDiagnostics : { cache : 'catalogue', durationMS : 0, http403or429 : 0, httpErrors : 0, parseMS : 0, requestMS : 0, requests : 0, requestTimeouts : 0 },
					hasDownload : false,
					modHubID : group.modHubID,
					ok : true,
					source : 'modhub',
					url : group.sourceURL,
					version : knownModHubVersion,
				},
			}
		}
		if ( catalogueComparison !== null ) {
			let details
			try {
				details = await window.vault_update_IPC.getModHub(group.modHubID, true)
			} catch (err) {
				details = { error : err.message, ok : false }
			}
			if ( details.ok === true ) {
				const latestKnownVersion = newestVersion([catalogueVersion, cachedPageVersion, details.version])
				const cachedOrCatalogueIsNewer = typeof details.version === 'string' &&
					compareVersions(latestKnownVersion, details.version) > 0
				return {
					catalogueDetailLookup : true,
					remote : cachedOrCatalogueIsNewer
						? { ...details, catalogueVersion, pageVersion : details.version, version : latestKnownVersion }
						: details,
				}
			}
			return {
				catalogueDetailLookup : true,
				remote : {
					checkDiagnostics : { ...details.checkDiagnostics, cache : 'catalogue-fallback' },
					detailError : details.error ?? 'ModHub page details were unavailable.',
					detailsUnavailable : true,
					hasDownload : false,
					modHubID : group.modHubID,
					ok : true,
					source : 'modhub',
					url : group.sourceURL,
					version : knownModHubVersion,
				},
			}
		}
	}

	const remote = await (group.sourceType === 'modhub'
		? window.vault_update_IPC.getModHub(group.modHubID, force)
		: window.vault_update_IPC.getGitHub(group.sourceURL, force))
	return { catalogueDetailLookup : false, remote }
}

const {
	applyVaultReviewState,
	candidateStateCounts,
	candidateGroupKey,
	candidateUpdateState,
	compareCatalogueVersion,
	compareVersions,
	modHubReleasedLabel,
	newestVersion,
	packageMismatchMessage,
	reviewReasonLabels,
	sourcesForVaultRecord,
	sourceTypeLabel : sourceLabel,
	stateSummaryText,
	vaultRemoteDecision,
} = UpdateCandidateModel

function sourceBadgeLabel(candidate) {
	if ( candidate.isModHubPrefab ) { return 'ModHub prefab' }
	if ( candidate.sourceType === 'modhub' ) { return 'ModHub update' }
	if ( candidate.sourceType === 'github' && candidate.downloadSource === 'repositoryFile' ) { return 'GitHub repository ZIP' }
	if ( candidate.sourceType === 'github' ) { return 'GitHub release' }
	return `${sourceLabel(candidate.sourceType)} source`
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
	if ( candidate.isModHubPrefab ) {
		candidate.packageMismatch = null
		return candidate
	}
	const key = packageMismatchKey(candidate)
	candidate.packageMismatch = key === '' ? null : packageMismatchStates()[key] ?? null
	return candidate
}

function updateCandidateReviewState(candidate) {
	applyVaultReviewState(candidate, { normalizeModName : canonicalVaultModName })
}

function reviewNoteText(reasons) {
	if ( reasons.length === 0 ) { return '' }
	return `Needs review: ${reviewReasonLabels(reasons).join(', ')}`
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
	byID('vaultUpdateSearch').value = ''
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
	const searchText = byID('vaultUpdateSearch')?.value.trim().toLocaleLowerCase() ?? ''
	const selectedReasons = selectedReviewReasons()
	return candidates.filter((candidate) => {
		if ( searchText !== '' && !candidateSearchText(candidate).includes(searchText) ) { return false }
		if ( stateFilter !== '' && candidateUpdateState(candidate) !== stateFilter ) { return false }
		if ( needsReviewOnly ) {
			if ( candidate.needsReview !== true ) { return false }
			if ( selectedReasons.length !== 0 && !selectedReasons.some((reason) => candidate.reviewReasons.includes(reason)) ) { return false }
		}
		return true
	})
}

function candidateSearchText(candidate) {
	return [
		candidate.assetName,
		candidate.autoTags?.map((tag) => tag.label).join(' '),
		candidate.fileName,
		candidate.localVersion,
		candidate.modHubCategory,
		candidate.modName,
		candidate.pageURL,
		candidate.remoteVersion,
		candidate.sourceType,
		candidate.sourceURL,
		candidate.tags?.join(' '),
	].filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase()
}

function selectedCandidates() {
	const visibleKeys = new Set(visibleCandidates().map((candidate) => candidate.key))
	return candidates.filter((candidate) => visibleKeys.has(candidate.key) && selectedKeys.has(candidate.key))
}

function syncSelectionCheckboxes() {
	for ( const checkbox of document.querySelectorAll('.vault-update-select-checkbox') ) {
		checkbox.checked = selectedKeys.has(checkbox.dataset.candidateKey ?? '')
		const candidate = candidates.find((item) => item.key === checkbox.dataset.candidateKey)
		checkbox.disabled = isBusy || candidate?.isModHubPrefab === true
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
	byID('vaultUpdateSearchNoMatches').classList.toggle('d-none', candidates.length === 0 || visibleKeys.size !== 0)
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
	byID('vaultUpdateSearch').disabled = value
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

function formatTaskDuration(milliseconds) {
	const seconds = Math.max(0, Math.round(milliseconds / 1000))
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const remainder = seconds % 60
	return hours > 0
		? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
		: `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function showUpdaterProgress(title, message, total) {
	updaterTaskStartedAt = performance.now()
	byID('vaultUpdateTaskTitle').textContent = title
	byID('vaultUpdateTaskMessage').textContent = message
	byID('vaultUpdateTaskCurrent').textContent = 'Preparing...'
	byID('vaultUpdateTaskCount').textContent = `0 of ${total} complete`
	byID('vaultUpdateTaskTiming').textContent = 'Elapsed 0:00 · Remaining time calculating…'
	byID('vaultUpdateTaskBar').style.width = '0%'
	byID('vaultUpdateTaskPercent').textContent = '0%'
	if ( !byID('vaultUpdateTaskDialog').open ) { byID('vaultUpdateTaskDialog').showModal() }
}

function updaterProgressCurrentLabel(phase, currentName, state) {
	const operation = phase === 'downloading' ? 'Downloading' : 'Checking'
	if ( state === 'starting' ) { return `${operation}${currentName === '' ? '' : ` ${currentName}`}...` }
	if ( state === 'failed' ) { return `Finished ${currentName} with an issue` }
	if ( state === 'working' ) { return `${phase === 'checking' ? 'Checking updates' : 'Working'}: ${currentName || 'in progress'}` }
	if ( state === 'finalizing' ) { return 'Saving update check results...' }
	return currentName !== '' ? `Finished ${currentName}` : `${phase === 'checking' ? 'Checking updates' : 'Working'}...`
}

function updaterProgressTiming(phase, done, total, elapsed, remaining) {
	const finishing = phase === 'checking' && done >= total && total > 0
	const estimate = remaining === null ? (finishing ? 'Finishing up…' : 'Remaining time calculating…') : `About ${formatTaskDuration(remaining)} remaining`
	return `Elapsed ${formatTaskDuration(elapsed)} · ${estimate}`
}

function updateUpdaterProgress({ current = 0, total = 0, currentName = '', phase = '', elapsedMS = null, state = '' } = {}) {
	const safeTotal = Math.max(0, total)
	const done = Math.max(0, Math.min(current, safeTotal))
	const percent = safeTotal === 0 ? 0 : Math.round((done / safeTotal) * 100)
	const elapsed = elapsedMS ?? (performance.now() - updaterTaskStartedAt)
	const remaining = done > 0 && safeTotal > done ? (elapsed / done) * (safeTotal - done) : null
	const visiblePercent = phase === 'checking' && done >= safeTotal && safeTotal > 0 ? 96 : percent
	byID('vaultUpdateTaskBar').style.width = `${visiblePercent}%`
	byID('vaultUpdateTaskPercent').textContent = `${visiblePercent}%`
	byID('vaultUpdateTaskCount').textContent = `${done} of ${safeTotal} complete`
	byID('vaultUpdateTaskTiming').textContent = updaterProgressTiming(phase, done, safeTotal, elapsed, remaining)
	byID('vaultUpdateTaskCurrent').textContent = updaterProgressCurrentLabel(phase, currentName, state)
}

function hideUpdaterProgress() {
	const dialog = byID('vaultUpdateTaskDialog')
	if ( dialog.open ) { dialog.close() }
}

function receiveUpdaterProgress(progress) {
	if ( !byID('vaultUpdateTaskDialog').open ) {
		showUpdaterProgress('Saving updates to the Vault', 'Downloading and checking selected mod files.', progress.total ?? 0)
	}
	if ( typeof progress.message === 'string' && progress.message !== '' ) {
		byID('vaultUpdateTaskMessage').textContent = progress.message
	}
	updateUpdaterProgress({ ...progress, currentName : progress.modName })
}

function setStatus(message, kind = 'secondary') {
	const status = byID('vaultUpdateStatus')
	status.textContent = message
	status.className = `alert alert-${kind} mb-3`
}

function updatePauseButton() {
	const button = byID('vaultUpdatesPause')
	const label = button.querySelector('span')
	button.disabled = !isRemoteCheckRunning
	if ( label !== null ) { label.textContent = isUpdateCheckPaused ? 'Resume checks' : 'Pause checks' }
	button.classList.toggle('btn-warning', isUpdateCheckPaused)
	button.classList.toggle('btn-outline-warning', !isUpdateCheckPaused)
}

function updateStopButton() {
	const button = byID('vaultUpdatesStop')
	const label = button.querySelector('span')
	button.disabled = !isRemoteCheckRunning || isUpdateCheckStopped
	if ( label !== null ) { label.textContent = isUpdateCheckStopped ? 'Stopping...' : 'Stop scan' }
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

function makeGroupKey(modName, source) {
	return candidateGroupKey(modName, source, canonicalVaultModName)
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

async function loadUpdateIgnoreMods() {
	const vault = await window.vault_update_IPC.getVault()
	const entries = Array.isArray(vault.entries) ? vault.entries : (Array.isArray(vault.records) ? vault.records : [])
	const byName = new Map()
	for ( const record of entries ) {
		const modName = vaultRecordModName(record)
		const key = vaultTagKey(modName)
		if ( key === '' ) { continue }
		const item = byName.get(key) ?? { collections : new Set(), files : new Set(), modName, tags : tagsForVaultRecord(record, vault.tags ?? {}) }
		for ( const collection of collectionNamesForRecord(record) ) { item.collections.add(collection) }
		if ( record.fileName ) { item.files.add(record.fileName) }
		byName.set(key, item)
	}
	updateIgnoreMods = [...byName.values()].map((item) => ({
		...item,
		collections : [...item.collections],
		files : [...item.files],
		ignored : hasIgnoreUpdateTag(item.tags),
	})).sort((a, b) => a.modName.localeCompare(b.modName))
	return updateIgnoreMods
}

function renderUpdateIgnoreList() {
	const query = byID('vaultUpdateIgnoreSearch').value.trim().toLocaleLowerCase()
	const ignored = updateIgnoreMods.filter((item) => item.ignored)
	const matches = (query === '' ? ignored : updateIgnoreMods.filter((item) =>
		[item.modName, ...item.files, ...item.collections].some((value) => value.toLocaleLowerCase().includes(query))))
	const shown = matches.slice(0, 150)
	byID('vaultUpdateIgnoreSummary').textContent = `${ignored.length} mod${ignored.length === 1 ? '' : 's'} ignored; ${updateIgnoreMods.length} Vault mods available to manage.`
	const list = byID('vaultUpdateIgnoreRows')
	list.replaceChildren()
	if ( shown.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'list-group-item bg-dark text-body-secondary'
		empty.textContent = query === '' ? 'No mods are currently ignored.' : 'No Vault mods match that search.'
		list.append(empty)
		return
	}
	for ( const item of shown ) {
		const row = document.createElement('div')
		row.className = 'list-group-item bg-dark text-body'
		const header = document.createElement('div')
		header.className = 'd-flex justify-content-between align-items-start gap-3'
		const info = document.createElement('div')
		const name = document.createElement('div')
		name.className = 'fw-semibold'
		name.textContent = item.modName
		info.append(name)
		const meta = document.createElement('div')
		meta.className = 'small text-body-secondary'
		meta.textContent = [...item.files, ...item.collections].join(' · ') || 'Vault mod'
		info.append(meta)
		header.append(info)
		const action = document.createElement('button')
		action.type = 'button'
		action.className = item.ignored ? 'btn btn-sm btn-outline-secondary flex-shrink-0' : 'btn btn-sm btn-outline-warning flex-shrink-0'
		action.textContent = item.ignored ? 'Remove from ignore list' : 'Ignore future checks'
		action.disabled = isBusy
		action.addEventListener('click', () => { void setUpdateIgnored(item, !item.ignored) })
		header.append(action)
		row.append(header)
		list.append(row)
	}
	if ( matches.length > shown.length ) {
		const more = document.createElement('div')
		more.className = 'small text-body-secondary mt-2'
		more.textContent = `Showing the first ${shown.length} of ${matches.length} matches. Refine your search to see a specific mod.`
		list.append(more)
	}
}

async function setUpdateIgnored(item, shouldIgnore) {
	const feedback = byID('vaultUpdateIgnoreFeedback')
	feedback.textContent = ''
	try {
		const vault = await window.vault_update_IPC.getVault()
		const current = vault.tags?.[vaultTagKey(item.modName)]?.tags
		const tags = Array.isArray(current) ? current.filter((tag) => String(tag ?? '').trim().toLocaleLowerCase() !== UPDATE_IGNORE_TAG) : []
		if ( shouldIgnore ) { tags.push('Ignore Updates') }
		const result = await window.vault_update_IPC.saveTags({ modName : item.modName, tags })
		if ( result?.ok !== true ) { throw new Error(result?.error ?? 'Could not save the update ignore list.') }
		feedback.textContent = shouldIgnore ? `${item.modName} will be skipped by future update scans.` : `${item.modName} will be included in future update scans.`
		await loadUpdateIgnoreMods()
		renderUpdateIgnoreList()
		await loadCandidates(false, false)
	} catch (err) {
		feedback.textContent = `Could not update the ignore list: ${err.message}`
	}
}

function openUpdateIgnoreList() {
	byID('vaultUpdateIgnoreFeedback').textContent = ''
	byID('vaultUpdateIgnoreSearch').value = ''
	void loadUpdateIgnoreMods().then(() => {
		renderUpdateIgnoreList()
		byID('vaultUpdateIgnoreDialog').showModal()
	}).catch((err) => {
		byID('vaultUpdateIgnoreFeedback').textContent = `Could not load the ignore list: ${err.message}`
		byID('vaultUpdateIgnoreDialog').showModal()
	})
}

function uniqueStrings(values) {
	return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))]
}

function autoTag(key, label, group) {
	return { group, key : `${group}:${key}`, label }
}

function modHubCategoryPathsForRecord(record) {
	const paths = new Map()
	for ( const value of [...(record.modHubCategoryPaths ?? []), ...(record.modHubCategories ?? [])] ) {
		const parts = (Array.isArray(value) ? value : [value])
			.filter((part) => typeof part === 'string' && part.trim() !== '')
			.flatMap((part) => part.split(/\s+(?:>|-)\s+/u).map((segment) => segment.trim()).filter(Boolean))
		if ( parts.length !== 0 ) { paths.set(parts.map((part) => part.toLocaleLowerCase()).join('/'), parts) }
	}
	return [...paths.values()]
}

function autoTagsForVaultRecord(record) {
	const sources = sourcesForVaultRecord(record).map((source) => autoTag(source.sourceType, sourceLabel(source.sourceType), 'source'))
	const modHubCategoryTags = new Map()
	for ( const categoryPath of modHubCategoryPathsForRecord(record) ) {
		const parent = categoryPath[0]
		const parentTag = autoTag(parent, parent, 'modhub')
		modHubCategoryTags.set(parentTag.key, parentTag)
		if ( categoryPath.length > 1 ) {
			const child = categoryPath[1]
			const childTag = autoTag(`${parent}/${child}`, child, 'modhubChild')
			childTag.parentKey = parentTag.key
			childTag.parentLabel = parent
			modHubCategoryTags.set(childTag.key, childTag)
		}
	}
	return [
		...modHubCategoryTags.values(),
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
		modhubChild : 'ModHub subcategories',
		source    : 'Update source',
		storeItem : 'Store-item type',
		type      : 'Internal mod type',
	}[group] ?? group
}

function fillAutoTagFilter(vaultEntries = []) {
	const menu = byID('vaultUpdateAutoTagFilterMenu')
	const tagsByGroup = new Map()
	autoTagLabels.clear()
	autoTagParentKeys.clear()
	for ( const tag of vaultEntries.flatMap((record) => autoTagsForVaultRecord(record)) ) {
		if ( !tagsByGroup.has(tag.group) ) { tagsByGroup.set(tag.group, new Map()) }
		tagsByGroup.get(tag.group).set(tag.key, tag)
		autoTagLabels.set(tag.key, tag.group === 'modhubChild' ? `${tag.parentLabel} › ${tag.label}` : tag.label)
		if ( typeof tag.parentKey === 'string' ) { autoTagParentKeys.set(tag.key, tag.parentKey) }
	}
	for ( const key of selectedAutoTagKeys ) {
		if ( !autoTagLabels.has(key) ) { selectedAutoTagKeys.delete(key) }
	}
	const selectedModHubParents = new Set([...selectedAutoTagKeys].filter((key) => key.startsWith('modhub:')))
	for ( const [key, parentKey] of autoTagParentKeys ) {
		if ( !selectedModHubParents.has(parentKey) ) { selectedAutoTagKeys.delete(key) }
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
			if ( tag.group === 'modhubChild' && !selectedModHubParents.has(tag.parentKey) ) { continue }
			menu.append(makeFilterCheckbox({
				checked : selectedAutoTagKeys.has(tag.key),
				id      : checkboxID('vault-update-auto-tag', tag.key, index),
				label   : tag.group === 'modhubChild' ? `↳ ${tag.label}` : tag.label,
				onChange : (event) => {
					if ( event.currentTarget.checked ) {
						selectedAutoTagKeys.add(tag.key)
						if ( tag.group === 'modhubChild' && selectedAutoTagKeys.has(tag.parentKey) ) {
							setFilterMatchMode('vaultUpdateAutoTagMode', 'all')
						}
					} else { selectedAutoTagKeys.delete(tag.key) }
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

async function updateNoSourceEditorHint(sourceURL) {
	const hint = byID('vaultNoSourceEditHint')
	if ( hint === null ) { return }
	const cleanSourceURL = String(sourceURL ?? '').trim()
	if ( cleanSourceURL === '' ) {
		hint.className = 'small mt-2 text-body-secondary'
		hint.textContent = 'No Source URL is saved for this mod.'
		return
	}
	try {
		const sourceInfo = await window.vault_update_IPC.getSourceInfo(cleanSourceURL)
		const supported = sourceInfo?.type === 'github' || sourceInfo?.type === 'modhub'
		hint.className = `small mt-2 ${supported ? 'text-success' : 'text-warning'}`
		hint.textContent = supported
			? `${sourceInfo.label} source saved here can be checked by the Vault updater.`
			: `${sourceInfo?.label ?? 'Manual'} source can be recorded, but it will not be checked automatically.`
	} catch {
		hint.className = 'small mt-2 text-warning'
		hint.textContent = 'Source URL can be saved, but it could not be classified right now.'
	}
}

function setNoSourceSaveFeedback(message, kind = 'success') {
	const feedback = byID('vaultNoSourceSaveFeedback')
	if ( feedback === null ) { return }
	clearTimeout(noSourceSaveFeedbackTimer)
	feedback.className = `alert alert-${kind} py-2`
	feedback.textContent = message
	noSourceSaveFeedbackTimer = setTimeout(() => hideNoSourceSaveFeedback(), 10000)
}

function hideNoSourceSaveFeedback() {
	clearTimeout(noSourceSaveFeedbackTimer)
	noSourceSaveFeedbackTimer = null
	const feedback = byID('vaultNoSourceSaveFeedback')
	if ( feedback === null ) { return }
	feedback.className = 'alert py-2 d-none'
	feedback.textContent = ''
}

function selectNoSourceRecord(record, { focus = false } = {}) {
	if ( selectedNoSourceRecord?.hash !== record.hash || selectedNoSourceRecord?.modName !== record.modName ) {
		hideNoSourceSaveFeedback()
	}
	selectedNoSourceRecord = record
	const editor = byID('vaultNoSourceEditor')
	const name = byID('vaultNoSourceEditName')
	const input = byID('vaultNoSourceEditURL')
	if ( editor === null || name === null || input === null ) { return }
	editor.classList.remove('d-none')
	name.textContent = record.modName
	input.value = record.sourceURL ?? ''
	updateNoSourceEditorHint(input.value)
	for ( const row of document.querySelectorAll('.vault-no-source-row') ) {
		row.classList.toggle('active', row.dataset.hash === record.hash && row.dataset.modName === record.modName)
	}
	if ( focus ) {
		input.focus()
		input.select()
	}
}

async function saveNoSourceURL(sourceURL) {
	if ( selectedNoSourceRecord === null ) {
		setStatus('Choose a no-source Vault mod first.', 'warning')
		return
	}
	const record = selectedNoSourceRecord
	let result = null
	try {
		localSourceSaveModName = record.modName
		result = await window.vault_update_IPC.saveSourceURL({
			hash      : record.hash,
			modName   : record.modName,
			sourceURL,
		})
		if ( result?.ok === false ) {
			throw new Error(result.error ?? 'Unknown error')
		}
	} catch (err) {
		localSourceSaveModName = null
		setStatus(`Could not save Source URL: ${err.message}`, 'danger')
		return
	}
	setTimeout(() => {
		if ( localSourceSaveModName === record.modName ) { localSourceSaveModName = null }
	}, 2000)
	const sourceInfo = result.sourceInfo ?? {}
	const supported = sourceInfo.type === 'github' || sourceInfo.type === 'modhub'
	const feedbackKind = supported || result.sourceURL === '' ? 'success' : 'warning'
	const feedbackMessage = result.sourceURL === ''
		? `Source URL cleared for ${result.modName}.`
		: `Saved ${sourceInfo.label ?? 'source'} link for ${result.modName}.${supported ? ' The Vault updater can now check it automatically.' : ' This link is recorded, but it is not an automatic update source.'}`
	setNoSourceSaveFeedback(feedbackMessage, feedbackKind)
	const hint = byID('vaultNoSourceEditHint')
	if ( hint !== null ) {
		hint.className = `small mt-2 text-${feedbackKind}`
		hint.textContent = feedbackMessage
	}
	setStatus(
		result.sourceURL === ''
			? `Cleared Source URL for ${result.modName}.`
			: `Saved ${sourceInfo.label ?? 'source'} URL for ${result.modName}.${supported ? ' It can now be checked by the Vault updater.' : ' This source is recorded as manual only.'}`,
		feedbackKind
	)
	await loadCandidates(false, false)
	if ( byID('vaultNoSourceDialog')?.open ) { reviewNoSourceRecords() }
}

async function refreshNoSourceAfterSourceChange(payload = {}) {
	const changedModName = String(payload.modName ?? '').trim()
	if ( localSourceSaveModName !== null && changedModName.toLocaleLowerCase() === localSourceSaveModName.toLocaleLowerCase() ) {
		localSourceSaveModName = null
		return
	}
	if ( !byID('vaultNoSourceDialog')?.open || isBusy ) { return }
	await loadCandidates(false, false)
	if ( byID('vaultNoSourceDialog')?.open ) { reviewNoSourceRecords() }
}

function noSourceReviewRow(record) {
	const row = document.createElement('button')
	row.className = 'list-group-item list-group-item-action bg-dark text-body border-secondary vault-no-source-row'
	row.type = 'button'
	row.dataset.hash = record.hash
	row.dataset.modName = record.modName
	row.title = 'Double-click to edit the Source URL. Right-click opens full details.'
	row.addEventListener('click', () => selectNoSourceRecord(record))
	row.addEventListener('contextmenu', (event) => {
		event.preventDefault()
		openNoSourceDetail(record)
	})
	row.addEventListener('dblclick', () => selectNoSourceRecord(record, { focus : true }))

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
	if ( selectedNoSourceRecord !== null ) {
		selectedNoSourceRecord = records.find((record) => record.hash === selectedNoSourceRecord.hash && record.modName === selectedNoSourceRecord.modName) ?? null
	}
	if ( selectedNoSourceRecord === null ) { byID('vaultNoSourceEditor')?.classList.add('d-none') }
	if ( records.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'list-group-item bg-dark text-body-secondary border-secondary'
		empty.textContent = 'No matching unsupported-source Vault mods to review.'
		list.append(empty)
	} else {
		for ( const record of records ) { list.append(noSourceReviewRow(record)) }
		if ( selectedNoSourceRecord !== null ) { selectNoSourceRecord(selectedNoSourceRecord) }
	}
	if ( !dialog.open ) { dialog.showModal() }
}

// eslint-disable-next-line complexity
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
	check.disabled = isBusy || candidate.isModHubPrefab === true
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
	detail.textContent = candidate.isModHubPrefab
		? 'ModHub Prefab | Manual check only'
		: `${sourceLabel(candidate.sourceType)} | Vault ${candidate.localVersion} -> Latest ${candidate.remoteVersion}`
	contentColumn.append(detail)

	const actionColumn = document.createElement('div')
	actionColumn.className = 'col-12 col-md-4 text-md-end'
	row.append(actionColumn)

	const versionBadges = document.createElement('div')
	versionBadges.className = 'mb-2'
	if ( candidate.isModHubPrefab ) {
		addBadge(versionBadges, 'Manual check only', 'text-bg-secondary')
	} else {
		addBadge(versionBadges, `Vault ${candidate.localVersion}`, 'text-bg-secondary me-2')
		addBadge(versionBadges, `${sourceLabel(candidate.sourceType)} ${candidate.remoteVersion}`, 'text-bg-warning')
	}
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
	updateStatus.className = candidate.isModHubPrefab ? 'text-body-secondary mb-3' : candidate.packageMismatch === null ? 'text-warning mb-3' : 'text-danger mb-3'
	updateStatus.textContent = candidate.isModHubPrefab
		? 'This is a prefab asset for map makers, not a playable mod. Its ZIP has no modDesc version, so the updater cannot compare, install, or update it automatically.'
		: candidate.packageMismatch === null
			? 'Update may be available'
			: packageMismatchMessage(candidate.packageMismatch, candidate.remoteVersion)
	actionColumn.append(updateStatus)

	const availability = document.createElement('div')
	availability.className = 'small mb-3'
	addBadge(availability, candidate.isModHubPrefab ? 'Prefab download on ModHub' : candidate.downloadURL ? 'ZIP download available' : 'Manual download only', candidate.downloadURL ? 'text-bg-success me-2' : 'text-bg-secondary me-2')
	if ( candidate.downloadURL ) {
		availability.append(document.createTextNode(candidate.assetName ?? candidate.fileName))
	}
	actionColumn.append(availability)

	const openButton = document.createElement('button')
	openButton.className = 'btn btn-primary w-100'
	openButton.textContent = candidate.isModHubPrefab ? 'Open ModHub page' : 'Open Web Page'
	openButton.addEventListener('click', () => window.vault_update_IPC.openURL(candidate.pageURL))
	actionColumn.append(openButton)
	const ignoreButton = document.createElement('button')
	ignoreButton.type = 'button'
	ignoreButton.className = 'btn btn-outline-warning w-100 mt-2'
	ignoreButton.textContent = candidate.isUpdateIgnored ? 'Remove from ignore list' : 'Ignore future checks'
	ignoreButton.disabled = isBusy
	ignoreButton.addEventListener('click', () => { void setUpdateIgnored({ modName : candidate.modName }, !candidate.isUpdateIgnored) })
	actionColumn.append(ignoreButton)

	if ( !candidate.downloadURL ) {
		const help = document.createElement('div')
		help.className = 'small text-body-secondary mt-3'
		help.textContent = candidate.isModHubPrefab
			? 'Prefab assets are kept in the Vault for reference. Open the ModHub page to check the listing and download the asset manually if needed.'
			: 'This source does not provide a direct ZIP download. Open its web page and add the ZIP to a collection or scan it into the Vault afterwards.'
		body.append(help)
	}

	return card
}

function setAllSelections(selected) {
	const visibleKeys = new Set(visibleCandidates().map((candidate) => candidate.key))
	if ( selected ) {
		for ( const candidate of visibleCandidates() ) {
			if ( !candidate.isModHubPrefab ) { selectedKeys.add(candidate.key) }
		}
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
	byID('vaultUpdateSelectAllVisible').classList.toggle('d-none', candidates.length === 0)
	byID('vaultUpdateSelectAllVisible').disabled = isBusy || visibleCount === 0
	if ( stateSummary !== null ) {
		stateSummary.textContent = stateSummaryText(visible)
	}
	byID('vaultUpdatesSelectedCount').textContent = `Selected: ${selectedCount}`
	if ( selectedCount === 0 ) {
		byID('vaultUpdateSelectionText').textContent = '0 updates selected. Downloads are stored in the Vault only.'
	} else {
		const parts = [`${selectedCount} selected`, `${selectedDownloadableCount} downloadable`]
		if ( selectedStateCounts.ready > 0 ) { parts.push(`${selectedStateCounts.ready} ready`) }
		if ( selectedStateCounts.review > 0 ) { parts.push(`${selectedStateCounts.review} need review`) }
		if ( selectedStateCounts.manual > 0 ) { parts.push(`${selectedStateCounts.manual} manual only`) }
		if ( selectedStateCounts.packageMismatch > 0 ) { parts.push(`${selectedStateCounts.packageMismatch} package mismatch`) }
		byID('vaultUpdateSelectionText').textContent = `${parts.join(' | ')}. Downloads are stored in the Vault only.`
	}
	byID('vaultUpdatesDownloadSelected').disabled = isBusy || selectedDownloadableCount === 0
	byID('vaultUpdatesOpenSelected').disabled = isBusy || selectedCount === 0
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
			if ( isUpdateCheckStopped || nextIndex >= items.length ) { return }
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
	if ( runRemoteChecks ) { showUpdaterProgress('Checking Vault updates', 'Preparing the list of mods and update sources to check.', 0) }
	clearDownloadResults()
	const checkStartedAt = performance.now()
	let collectionRefreshResult = null
	// A fresh update check must never inherit selection from an older result
	// set. Only the visible ticked rows may be downloaded.
	selectedKeys.clear()
	if ( byID('vaultNeedsReviewOnly') !== null ) { byID('vaultNeedsReviewOnly').checked = false }
	for ( const filter of document.querySelectorAll('.vault-review-reason-filter') ) { filter.checked = false }
	syncSelectionCheckboxes()
	try {
		if ( runRemoteChecks ) {
			collectionRefreshResult = await window.vault_update_IPC.prepareCollectionsForUpdateScan()
		}
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
			const sources = sourcesForVaultRecord(record)
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
					modHubCategories : [],
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
				existing.modHubCategories.push(...(record.modHubCategories ?? []), ...(record.modHubCategoryPaths ?? []))
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
		let active = 0
		byID('vaultUpdateTaskMessage').textContent = `Checking ${sourceGroups.length} update sources. This window will show progress and estimated time remaining.`
		const sources = Object.fromEntries(['modhub', 'github'].map((source) => [source, {
			cacheHits : 0, catalogueDetailFailures : 0, catalogueDetailLookups : 0, catalogueMatches : 0, failures : 0, fresh : 0, freshMS : 0,
			http403or429 : 0, httpErrors : 0, maxMS : 0, parseMS : 0, requestMS : 0, requests : 0, requestTimeouts : 0, shared : 0, timeouts : 0,
		}]))
		let modHubCatalogueVersions = {}
		let modHubCachedPageVersions = {}
		let modHubCatalogueCategories = {}
		if ( !force ) {
			const modHubIDs = [...new Set(sourceGroups
				.filter((group) => group.sourceType === 'modhub')
				.map((group) => group.modHubID)
				.filter((modHubID) => Number.isSafeInteger(modHubID) && modHubID > 0))]
			if ( modHubIDs.length !== 0 ) {
				try {
					const catalogue = await window.vault_update_IPC.getModHubCatalogue(modHubIDs)
					if ( catalogue?.fresh === true && typeof catalogue.versions === 'object' && catalogue.versions !== null ) {
						modHubCatalogueVersions = catalogue.versions
						modHubCachedPageVersions = catalogue.pageVersions ?? {}
						modHubCatalogueCategories = catalogue.categories ?? {}
					}
				} catch (err) {
					window.log.warning('Unable to use the ModHub version catalogue; checking ModHub pages instead.', err.message)
				}
			}
		}
		const updateCheckProgress = () => {
			const percent = Math.round((checked / Math.max(sourceGroups.length, 1)) * 90)
			const progressLabel = `Checked ${checked} of ${sourceGroups.length} - ${active} active`
			setProgress(percent, progressLabel)
			updateUpdaterProgress({ current : checked, currentName : active > 0 ? `${active} checks active` : '', phase : 'checking', state : checked === sourceGroups.length && active === 0 ? 'finalizing' : 'working', total : sourceGroups.length })
		}
		isUpdateCheckStopped = false
		isRemoteCheckRunning = true
		updatePauseButton()
		updateStopButton()
		for ( const group of sourceGroups ) {
			group.modHubCategory = group.modHubCategories.find((category) => /prefab/iu.test(category)) ?? modHubCatalogueCategories[group.modHubID] ?? null
			group.isModHubPrefab = group.sourceType === 'modhub' && typeof group.modHubCategory === 'string' && /prefab/iu.test(group.modHubCategory)
		}
		const remoteResults = await mapWithConcurrency(sourceGroups, REMOTE_CHECK_CONCURRENCY, async (group) => {
			active++
			updateCheckProgress()
			const startedAt = performance.now()
			try {
				const { catalogueDetailLookup, remote } = await checkVaultUpdateSource(group, force, modHubCatalogueVersions, modHubCachedPageVersions)
				const stats = sources[group.sourceType]
				const diagnostics = remote.checkDiagnostics
				for ( const key of ['requests', 'requestMS', 'requestTimeouts', 'httpErrors', 'http403or429', 'parseMS'] ) {
					stats[key] += diagnostics?.[key] ?? 0
				}
				const durationMS = diagnostics?.durationMS ?? performance.now() - startedAt
				if ( diagnostics?.cache === 'catalogue' ) { stats.catalogueMatches++ }
				else if ( diagnostics?.cache === 'catalogue-fallback' ) {
					stats.catalogueDetailFailures++
				} else if ( diagnostics?.cache === 'hit' ) { stats.cacheHits++ }
				else if ( diagnostics?.cache === 'shared' ) { stats.shared++ }
				else { stats.fresh++; stats.freshMS += durationMS }
				if ( catalogueDetailLookup ) {
					stats.catalogueMatches++
					stats.catalogueDetailLookups++
				}
				stats.maxMS = Math.max(stats.maxMS, durationMS)
				if ( remote.ok !== true ) { stats.failures++ }
				if ( /timed?\s*out|timeout/iu.test(remote.error ?? '') ) { stats.timeouts++ }
				return { group, remote }
			} finally {
				active--
				checked++
				updateCheckProgress()
			}
		})
		const wasStopped = isUpdateCheckStopped
		for ( const result of remoteResults ) {
			if ( result === undefined ) { continue }
			const { group, remote } = result
			if ( group.sourceType === 'modhub' && typeof remote.category === 'string' && /prefab/iu.test(remote.category) ) {
				group.modHubCategory = remote.category
				group.isModHubPrefab = true
			}
		}
		const reportRows = sourceGroups.map((group, index) => {
			const remote = remoteResults[index]?.remote
			const status = group.isModHubPrefab ? 'Manual check only' : remote === undefined ? 'Not checked' : remote.ok !== true ? 'Failed' : compareVersions(remote.version, newestVersion(group.localVersions)) > 0 ? 'Update available' : 'No newer version'
			const detail = group.isModHubPrefab
				? 'ModHub identifies this as a prefab asset for map makers. It is not a playable mod and cannot be version-checked or updated automatically.'
				: remote === undefined ? 'Scan stopped before this check.' : remote.ok !== true ? window.UpdateRunReport.error(remote.error) : `Local: ${group.localVersions.join(', ')}; online: ${remote.version}${remote.detailsUnavailable ? ` (ModHub page details unavailable: ${remote.detailError})` : ''}`
			return { detail, name : group.modName, source : group.sourceType, status }
		})
		if ( collectionRefreshResult?.changed === true ) {
			reportRows.unshift({
				detail : `Rescanned ${collectionRefreshResult.collections} tracked collections and checked ${collectionRefreshResult.scanned} collection entries. ${collectionRefreshResult.imported} Vault records were processed; ${collectionRefreshResult.skipped} entries were skipped; ${collectionRefreshResult.errors} errors occurred.`,
				name : 'Collection refresh',
				source : 'Tracked collections',
				status : collectionRefreshResult.errors === 0 ? 'Completed before scan' : 'Completed with issues',
			})
		}
		for ( const record of noSourceRecords ) { reportRows.push({ detail : 'No supported update source.', name : record.modName ?? record.fileName, source : '', status : 'Skipped' }) }
		window.UpdateRunReport.show('vaultUpdateStatus', wasStopped ? 'Vault check report (stopped)' : 'Vault check report', reportRows, `${ignoredSkipped + tagSkipped + collectionSkipped} Vault records excluded by filters or Ignore Updates.`)
		isRemoteCheckRunning = false
		setUpdateCheckPaused(false)
		updateStopButton()
		await window.vault_update_IPC.updateScanMetadata({
			updates : remoteResults
				.filter((result) => result !== undefined)
				.filter(({ group }) => !group.isModHubPrefab)
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
			if ( group.isModHubPrefab ) {
				const candidate = {
					assetName : group.fileName,
					autoTags : group.autoTags,
					downloadSource : null,
					downloadURL : null,
					fileName : group.fileName,
					gameVersion : group.gameVersions.find((value) => Number.isInteger(value)) ?? null,
					isModHubPrefab : true,
					isUpdateIgnored : hasIgnoreUpdateTag(group.tags),
					key : group.key,
					localVersion : newestVersion(group.localVersions) ?? 'Unknown',
					modHubCategory : group.modHubCategory,
					modHubID : group.modHubID,
					modHubReleased : null,
					modHubScreenshots : [],
					modIcon : group.modIcon,
					modName : group.modName,
					pageURL : remote.url ?? group.sourceURL,
					remoteVersion : 'Manual check only',
					sourceType : group.sourceType,
					sourceURL : group.sourceURL,
					tags : group.tags,
					totalSize : group.totalSize,
					updatedTime : group.updatedTime,
				}
				applyPackageMismatchState(candidate)
				candidates.push(candidate)
				continue
			}
			const decision = vaultRemoteDecision(group, remote)
			if ( !decision.available ) { continue }
			const candidate = {
				assetName     : remote.assetName ?? group.fileName,
				autoTags      : group.autoTags,
				downloadSource : remote.downloadSource ?? null,
				downloadURL   : remote.hasDownload ? remote.downloadURL : null,
				fileName      : group.fileName,
				gameVersion   : group.gameVersions.find((value) => Number.isInteger(value)) ?? null,
				isUpdateIgnored : hasIgnoreUpdateTag(group.tags),
				key           : group.key,
				localVersion  : decision.localVersion,
				modHubID      : group.modHubID,
				modHubReleased : remote.released ?? null,
				modHubScreenshots : Array.isArray(remote.screenshots) ? remote.screenshots : [],
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
			const failedChecks = sources.modhub.failures + sources.github.failures
			const failureText = failedChecks === 0 ? '' : ` ${failedChecks} source checks failed; update results are incomplete. Run another scan after 5 minutes to retry temporary failures.`
			setStatus(`${candidates.length} Vault update(s) found${filterText}.${ignoredText}${tagText}${skipped > 0 ? ` ${skipped} matching item(s) skipped because they have no supported update source.` : ''}${failureText}`, candidates.length !== 0 || failedChecks !== 0 ? 'warning' : 'success')
		}
		void window.vault_update_IPC.logPerformance({
			candidates : candidates.length,
			durationMS : performance.now() - checkStartedAt,
			force,
			groups : sourceGroups.length,
			skipped : skipped + tagSkipped + ignoredSkipped + collectionSkipped,
			sources,
		})
		if ( !wasStopped ) { window.taskCompletion.play({ failed : sources.modhub.failures + sources.github.failures }) }
	} catch (err) {
		setStatus(`Vault update check failed: ${err.message}`, 'danger')
		window.UpdateRunReport.show('vaultUpdateStatus', 'Vault check report', [{ name : 'Scan', status : 'Failed', detail : err.message }])
	} finally {
		isRemoteCheckRunning = false
		setUpdateCheckPaused(false)
		// eslint-disable-next-line require-atomic-updates
		isUpdateCheckStopped = false
		setBusy(false)
		hideUpdaterProgress()
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
			modHubScreenshots : candidate.modHubScreenshots ?? [],
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
	showUpdaterProgress('Saving updates to the Vault', `Downloading and checking ${downloads.length} selected mod file${downloads.length === 1 ? '' : 's'}.`, downloads.length)
	updateUpdaterProgress({ current : 0, phase : 'downloading', total : downloads.length })
	clearDownloadResults()
	try {
		const result = await window.vault_update_IPC.downloadToVaultSelected(downloads)
		const results = Array.isArray(result?.results) ? result.results : []
		window.UpdateRunReport.show('vaultUpdateStatus', 'Vault update report', results.map((item) => ({ detail : item.ok ? `Version ${item.version ?? ''}` : window.UpdateRunReport.error(item.error), name : item.modName, source : item.sourceType, status : item.ok ? 'Stored in Vault' : 'Failed' })), `${manualCount} selected items require manual download.${result?.error ? ` ${result.error}` : ''}`)
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
		window.taskCompletion.play(result)
	} catch (err) {
		setStatus(`Vault download failed: ${err.message}`, 'danger')
		window.UpdateRunReport.show('vaultUpdateStatus', 'Vault update report', downloads.map((item) => ({ detail : err.message, name : item.modName, source : item.sourceType, status : 'Unconfirmed' })))
	} finally {
		setBusy(false)
		hideUpdaterProgress()
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
	byID('vaultUpdateTaskDialog').addEventListener('cancel', (event) => event.preventDefault())
	window.vault_update_IPC.receive('vault:updateTaskProgress', receiveUpdaterProgress)
	byID('vaultIncludeIgnoredUpdates').addEventListener('change', () => loadCandidates(false, false))
	byID('vaultUpdateManageIgnoreList').addEventListener('click', openUpdateIgnoreList)
	byID('vaultUpdateIgnoreClose').addEventListener('click', () => byID('vaultUpdateIgnoreDialog').close())
	byID('vaultUpdateIgnoreSearch').addEventListener('input', renderUpdateIgnoreList)
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
	byID('vaultUpdateSearch').addEventListener('input', applyNeedsReviewFilter)
	byID('vaultUpdateSearchClear').addEventListener('click', () => {
		byID('vaultUpdateSearch').value = ''
		applyNeedsReviewFilter()
		byID('vaultUpdateSearch').focus()
	})
	byID('vaultUpdateReviewNoSource').addEventListener('click', reviewNoSourceRecords)
	byID('vaultNoSourceClose').addEventListener('click', () => {
		selectedNoSourceRecord = null
		hideNoSourceSaveFeedback()
		byID('vaultNoSourceDialog').close()
	})
	byID('vaultNoSourceEditURL').addEventListener('input', (event) => updateNoSourceEditorHint(event.target.value))
	byID('vaultNoSourceSaveURL').addEventListener('click', () => saveNoSourceURL(byID('vaultNoSourceEditURL').value))
	byID('vaultNoSourceClearURL').addEventListener('click', () => saveNoSourceURL(''))
	byID('vaultNoSourceOpenDetail').addEventListener('click', () => {
		if ( selectedNoSourceRecord !== null ) { openNoSourceDetail(selectedNoSourceRecord) }
	})
	byID('vaultUpdatesDownloadSelected').addEventListener('click', downloadSelected)
	byID('vaultUpdateSelectAllVisible').addEventListener('click', () => setAllSelections(true))
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
	window.vault_update_IPC.receive('settings:sourceChanged', (payload) => { refreshNoSourceAfterSourceChange(payload) })
	loadCandidates(false, false)
})
