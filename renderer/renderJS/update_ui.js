/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: UPDATE UI

/* global MA, DATA, I18N, UpdateCandidateModel, bootstrap */

function doL10N(item, locale) {
	let returnText = item?.[locale]
	returnText ??= item?.en
	returnText ??= item?.de
	returnText ??= '--'
	return DATA.escapeSpecial(returnText)
}

const {
	buildCollectionCandidateMap,
	candidateStateCounts,
	candidateUpdateState,
	collectionRemoteDecision,
	isManualSourceType,
	isWebURL,
	modHubReleasedLabel,
	reviewReasonLabels,
	sourceTypeLabel,
	stateSummaryText,
} = UpdateCandidateModel

function manualSourceResult(entry) {
	return {
		assetName  : null,
		downloadURL : null,
		hasDownload : false,
		ok        : true,
		source    : entry.sourceType,
		url       : entry.sourceURL,
		version   : entry.remoteVersion ?? 'manual check',
	}
}

function modHubReleasedText(result) {
	if ( result.source !== 'modhub' ) { return '' }
	const released = modHubReleasedLabel(result.released)
	return `<div class="small text-body-secondary mb-2">ModHub released: ${DATA.escapeSpecial(released)}</div>`
}

function sourceBadgeText(entry, result) {
	if ( result.source === 'modhub' ) {
		return '<span class="badge text-bg-info">ModHub update</span>'
	}
	if ( entry.sourceType === 'github' ) {
		const label = result.downloadSource === 'repositoryFile' ? 'GitHub repository ZIP' : 'GitHub release'
		return `<span class="badge text-bg-info">${label}</span>`
	}
	if ( isManualSourceType(entry.sourceType) ) {
		return `<span class="badge text-bg-secondary">${sourceTypeLabel(entry.sourceType)} manual source</span>`
	}
	return `<span class="badge text-bg-secondary">${sourceTypeLabel(entry.sourceType)} source</span>`
}

function reviewNoteText(reasons) {
	if ( reasons.length === 0 ) { return '' }
	const labels = reviewReasonLabels(reasons)
	return `<div class="small text-warning mb-2">Needs review: ${DATA.escapeSpecial(labels.join(', '))}</div>`
}

function manualSourceMessage(sourceType) {
	return `${sourceTypeLabel(sourceType)} is a manual download source. Open the web page to check and install updates manually.`
}

function statusText(result) {
	if ( isManualSourceType(result.source) ) {
		return manualSourceMessage(result.source)
	}
	if ( result.ok ) {
		return I18N.defer('update_status_available', false)
	}
	if ( result.error === 'no_release_or_tag' ) {
		return I18N.defer('update_status_no_github_release', false)
	}
	return I18N.defer('update_status_failed', false)
}

function downloadStatusText(result) {
	if ( isManualSourceType(result.source) ) {
		return `<span class="badge text-bg-warning">${sourceTypeLabel(result.source)} manual download</span>`
	}
	if ( result.source === 'modhub' && !result.hasDownload ) {
		return '<span class="badge text-bg-secondary">Manual download from ModHub</span>'
	}
	if ( result.hasDownload ) {
		const downloadLabel = result.downloadSource === 'repositoryFile' ?
			I18N.defer('update_list_repo_zip_available', false) :
			I18N.defer('update_list_download_available', false)
		return `<span class="badge text-bg-success">${downloadLabel}</span> <span class="small">${DATA.escapeSpecial(result.assetName)}</span>`
	}
	if ( result.source === 'release' ) {
		return `<span class="badge text-bg-warning">${I18N.defer('update_list_no_zip_asset', false)}</span>`
	}
	return `<span class="badge text-bg-secondary">${I18N.defer('update_list_source_newer_manual', false)}</span>`
}

function vaultStatusText(availability) {
	if ( availability?.inVault === true ) {
		const fileName = typeof availability.vaultFileName === 'string' && availability.vaultFileName !== '' ? ` ${DATA.escapeSpecial(availability.vaultFileName)}` : ''
		return `<div class="small text-success mb-2">Already in Vault.${fileName}</div>`
	}
	return '<div class="small text-info mb-2">Will be stored in the Vault before the collection is updated.</div>'
}

function withTimeout(promise, timeoutMS = 15000) {
	return Promise.race([
		promise,
		new Promise((resolve) => {
			setTimeout(() => {
				resolve({ ok : false, error : 'timeout' })
			}, timeoutMS)
		}),
	])
}

async function mapWithConcurrency(entries, limit, mapper) {
	const results = new Array(entries.length)
	let nextIndex = 0
	const worker = async () => {
		const currentIndex = nextIndex++
		if ( currentIndex >= entries.length ) { return }
		results[currentIndex] = await mapper(entries[currentIndex])
		return worker()
	}
	await Promise.all(Array.from({ length : Math.min(limit, entries.length) }, () => worker()))
	return results
}

let activeRenderID = 0
let loadedInitialModList = false
let updateBusyDepth = 0

function showUpdateBusyProgress(label = '', value = null) {
	const wrapper = MA.byId('updateBusyProgress')
	const bar = MA.byId('updateBusyProgressBar')
	const readableLabel = MA.byId('updateBusyProgressLabel')
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

function beginUpdateBusy(label = '', value = null) {
	updateBusyDepth++
	showUpdateBusyProgress(label, value)
}

function setUpdateBusy(label = '', value = null) {
	if ( updateBusyDepth > 0 ) { showUpdateBusyProgress(label, value) }
}

function endUpdateBusy() {
	updateBusyDepth = Math.max(0, updateBusyDepth - 1)
	if ( updateBusyDepth !== 0 ) { return }
	const wrapper = MA.byId('updateBusyProgress')
	if ( wrapper === null ) { return }
	wrapper.classList.add('d-none')
	wrapper.setAttribute('aria-hidden', 'true')
}

function collectionContextText(modCollect) {
	const activeCollect   = modCollect.opts?.activeCollection ?? null
	const collectionName  = activeCollect === null ? null : modCollect.collectionToName?.[activeCollect]
	const collectionLabel = collectionName ?? 'All monitored collections'
	return `Checking updates for: ${DATA.escapeSpecial(collectionLabel)}`
}

function renderEmpty(messageKey) {
	MA.byIdHTML('modList', '')
	MA.byIdHTML('updateStatus', I18N.defer(messageKey, false))
	MA.byId('selectionControls').classList.add('d-none')
	updateSelectedCount()
}

function rowCandidateState(row) {
	return candidateUpdateState({
		downloadURL : row.dataset.hasDownload === 'true' ? 'available' : null,
		needsReview : row.dataset.needsReview === 'true',
		packageMismatch : null,
	})
}

function visibleUpdateRows() {
	const needsReviewOnly = MA.byId('needsReviewOnly')?.checked === true
	const stateFilter = MA.byId('updateStateFilter')?.value ?? ''
	const selectedReasons = selectedReviewReasons()
	return [...document.querySelectorAll('.update-candidate-row')].filter((row) => {
		if ( stateFilter !== '' && rowCandidateState(row) !== stateFilter ) { return false }
		if ( !needsReviewOnly ) { return true }
		const rowReasons = row.dataset.reviewReasons?.split(',').filter((reason) => reason !== '') ?? []
		const reasonMatches = selectedReasons.length === 0 || selectedReasons.some((reason) => rowReasons.includes(reason))
		return row.dataset.needsReview === 'true' && reasonMatches
	})
}

function getUpdateCheckboxes() {
	return [...document.querySelectorAll('.update-candidate-row:not(.d-none) .update-select-checkbox')]
}

function getAllUpdateCheckboxes() {
	return [...document.querySelectorAll('.update-candidate-row .update-select-checkbox')]
}

function updateSelectedCount() {
	const selectedCount = getSelectedCheckboxes().length
	const downloadableCount = getSelectedDownloadCandidates().length
	const visibleRows = visibleUpdateRows()
	const visibleRowSet = new Set(visibleRows)
	const selectedRows = getSelectedCheckboxes()
		.map((checkbox) => checkbox.closest('.update-candidate-row'))
		.filter((row) => row !== null && visibleRowSet.has(row))
	const selectedStateCounts = candidateStateCounts(selectedRows.map((row) => ({
		downloadURL : row.dataset.hasDownload === 'true' ? 'available' : null,
		needsReview : row.dataset.needsReview === 'true',
		packageMismatch : null,
	})))
	const stateSummary = MA.byId('updateStateSummary')
	if ( stateSummary !== null ) {
		stateSummary.textContent = stateSummaryText(visibleRows.map((row) => ({
			downloadURL : row.dataset.hasDownload === 'true' ? 'available' : null,
			needsReview : row.dataset.needsReview === 'true',
			packageMismatch : null,
		})))
	}
	MA.byIdHTML('selectedCount', `${I18N.defer('update_list_selected', false)} ${selectedCount}`)
	MA.byId('openSelectedButton').disabled = selectedCount === 0
	MA.byId('downloadSelectedButton').disabled = downloadableCount === 0
	MA.byId('selectAllButton').disabled = visibleRows.length === 0
	MA.byId('selectReadyButton').disabled = visibleRows.filter((row) => rowCandidateState(row) === 'ready').length === 0
	MA.byId('selectNoneButton').disabled = selectedCount === 0
	if ( selectedCount !== 0 ) {
		MA.byIdHTML('selectedCount', `${I18N.defer('update_list_selected', false)} ${selectedCount} (${selectedStateCounts.ready} ready, ${selectedStateCounts.review} review, ${selectedStateCounts.manual} manual)`)
	}
}

function setAllSelections(isChecked) {
	for ( const checkbox of getUpdateCheckboxes() ) {
		checkbox.checked = isChecked
	}
	updateSelectedCount()
}

function selectReadyUpdates() {
	for ( const checkbox of getUpdateCheckboxes() ) {
		const row = checkbox.closest('.update-candidate-row')
		checkbox.checked = row !== null && rowCandidateState(row) === 'ready'
	}
	updateSelectedCount()
}

function getSelectedCheckboxes() {
	return getUpdateCheckboxes().filter((checkbox) => checkbox.checked)
}

function selectedReviewReasons() {
	return [...document.querySelectorAll('.review-reason-filter:checked')].map((filter) => filter.value)
}

function applyNeedsReviewFilter() {
	const filter = MA.byId('needsReviewOnly')
	const needsReviewOnly = filter !== null && filter.checked
	const reasonFilters = MA.byId('reviewReasonFilters')
	const visibleRows = new Set(visibleUpdateRows())
	if ( reasonFilters !== null ) {
		reasonFilters.classList.toggle('d-none', !needsReviewOnly)
	}
	for ( const row of document.querySelectorAll('.update-candidate-row') ) {
		row.classList.toggle('d-none', !visibleRows.has(row))
	}
	updateSelectedCount()
}

function openSelectedSources() {
	for ( const checkbox of getSelectedCheckboxes() ) {
		if ( isWebURL(checkbox.dataset.sourceUrl) ) {
			window.update_IPC.openURL(checkbox.dataset.sourceUrl)
		}
	}
}

function getSelectedDownloadCandidates() {
	return getSelectedCheckboxes()
		.filter((checkbox) => typeof checkbox.dataset.downloadUrl === 'string')
		.map((checkbox) => ({
			collectionKey : checkbox.dataset.collectionKey,
			collectionName : checkbox.dataset.collectionName,
			fileName : checkbox.dataset.assetName,
			modHubID : checkbox.dataset.modHubId,
			modHubReleased : checkbox.dataset.modHubReleased,
			modName  : checkbox.dataset.modName,
			sourceType : checkbox.dataset.sourceType,
			sourceURL : checkbox.dataset.sourceUrl,
			url      : checkbox.dataset.downloadUrl,
			version  : checkbox.dataset.remoteVersion,
		}))
}

function candidateMatchKey(candidate) {
	return [
		candidate.collectionKey ?? '',
		candidate.modName ?? '',
		candidate.sourceType ?? '',
		candidate.version ?? '',
	].join('\u0001')
}

function checkboxMatchKey(checkbox) {
	return candidateMatchKey({
		collectionKey : checkbox.dataset.collectionKey,
		modName       : checkbox.dataset.modName,
		sourceType    : checkbox.dataset.sourceType,
		version       : checkbox.dataset.remoteVersion,
	})
}

function removeAppliedUpdateRows(downloads) {
	const appliedKeys = new Set(downloads.map((download) => candidateMatchKey(download)))
	for ( const checkbox of getAllUpdateCheckboxes() ) {
		if ( !appliedKeys.has(checkboxMatchKey(checkbox)) ) { continue }
		checkbox.closest('.update-candidate-row')?.remove()
	}
	MA.byId('selectionControls').classList.toggle('d-none', getAllUpdateCheckboxes().length === 0)
	updateSelectedCount()
}

async function downloadSelectedZIPs() {
	const downloads = getSelectedDownloadCandidates()
	if ( downloads.length === 0 ) { return }

	MA.byId('downloadSelectedButton').disabled = true
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_updating', false)} Updates are stored in the Vault first, then copied to the collection.`)
	beginUpdateBusy(`0 / ${downloads.length}`, 0)
	try {
		const result = await window.update_IPC.downloadApplySelected(downloads)
		window.UpdateRunReport.show('updateStatus', 'Collection update report', (result.results ?? []).map((item) => ({ detail : item.error ?? `Version ${item.version ?? ''}${item.vaultFileName ? ` from Vault ZIP ${item.vaultFileName}` : ''}`, name : item.modName, source : item.collectionName ?? item.sourceType, status : item.skipped ? 'Not attempted' : item.ok ? 'Updated from Vault' : 'Failed' })), result.error ?? '')
		removeAppliedUpdateRows(downloads.filter((_item, index) => result.results?.[index]?.ok))
		setUpdateBusy(`${downloads.length} / ${downloads.length}`, 100)
		if ( result.ok ) {
			removeAppliedUpdateRows(downloads)
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_update_complete', false)} ${result.count} / ${downloads.length}. Updates were stored in the Vault first, then copied to the collection. Use Refresh update checks to rescan all sources.`)
		} else {
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_update_failed', false)} ${result.error}`)
		}
	} catch (err) {
		window.UpdateRunReport.show('updateStatus', 'Collection update report', downloads.map((item) => ({ name : item.modName, status : 'Unconfirmed', detail : err.message })))
	} finally {
		endUpdateBusy()
	}
	updateSelectedCount()
}

async function displayCandidates(candidates, renderID, forceRemoteRefresh = false) {
	const listDiv = MA.byId('modList')
	const candidateEntries = Object.entries(candidates).sort((a, b) => Intl.Collator().compare(a[0], b[0]))
	let completeCount = 0
	const reportRows = []

	listDiv.innerHTML = ''

	if ( candidateEntries.length === 0 ) {
		renderEmpty('update_list_no_sources')
		window.UpdateRunReport.show('updateStatus', 'Collection check report', [], 'No eligible update sources in the selected collections.')
		return
	}

	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} 0 / ${candidateEntries.length}`)
	setUpdateBusy(`0 / ${candidateEntries.length}`, 0)

	const updateRows = (await mapWithConcurrency(candidateEntries, 6, async ([, entry]) => {
		let result
		if ( entry.sourceType === 'github' ) {
			result = await withTimeout(window.update_IPC.getGitHub(entry.sourceURL, forceRemoteRefresh))
		} else if ( entry.sourceType === 'modhub' && entry.modHubID !== null ) {
			result = await withTimeout(window.update_IPC.getModHub(entry.modHubID, forceRemoteRefresh))
		} else {
			result = manualSourceResult(entry)
		}
		completeCount++
		if ( renderID === activeRenderID ) {
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${completeCount} / ${candidateEntries.length}`)
			setUpdateBusy(`${completeCount} / ${candidateEntries.length}`, (completeCount / candidateEntries.length) * 100)
		}

		const decision = collectionRemoteDecision(entry, result, {
			versionCompare : DATA.versionCompare,
			versionDifferent : DATA.versionDifferent,
		})
		reportRows.push({ detail : !result.ok ? window.UpdateRunReport.error(result.error) : `Local: ${[...entry.local].join(', ')}; online: ${result.version ?? 'unknown'}`, name : entry.modName, source : `${entry.sourceType}: ${entry.collections.join(', ')}`, status : !result.ok ? 'Failed' : isManualSourceType(entry.sourceType) ? 'Manual check required' : decision.available ? 'Update available' : 'No newer version' })
		if ( !result.ok ) { return null }
		if ( !decision.includeCandidate ) { return null }
	
		const collectionList = entry.collections
			.sort((a, b) => Intl.Collator().compare(a, b))
			.map((collection) => `<li><span class="fw-bold">${DATA.escapeSpecial(collection)}</span></li>`)
		const assetName = result.assetName ?? null
		const collectionKey = entry.collectionKeys[0] ?? null
		const collectionName = entry.collections[0] ?? 'updates'
		const review = decision.reviewReasons
		return {
			assetName      : assetName,
			collectionKey  : collectionKey,
			collectionName : collectionName,
			downloadURL    : result.downloadURL ?? null,
			modHubID       : entry.modHubID,
			modHubReleased : result.released ?? null,
			modName        : entry.modName,
			needsReview    : review.length !== 0,
			node           : DATA.templateEngine('update_line', {
				collections   : collectionList.join(''),
				downloadStatus : downloadStatusText(result),
				iconImage     : `<img class="img-fluid" src="${DATA.iconMaker(entry.icon)}" />`,
				localVersion  : DATA.escapeSpecial([...entry.local].sort().join(', ')),
				modHubReleased : modHubReleasedText(result),
				realName      : entry.title,
				remoteVersion : DATA.escapeSpecial(result.version),
				reviewNote    : reviewNoteText(review),
				shortName     : DATA.escapeSpecial(entry.modName),
				sourceBadge   : sourceBadgeText(entry, result),
				sourceName    : DATA.escapeSpecial(entry.sourceLabel),
				statusText    : statusText(result),
				vaultStatus   : '<div class="small mb-2 update-vault-status"></div>',
			}),
			review,
			sourceType : entry.sourceType,
			sourceURL : entry.sourceURL,
			version   : result.version,
		}
	})).filter((x) => x !== null)

	if ( renderID !== activeRenderID ) { return }
	window.UpdateRunReport.show('updateStatus', 'Collection check report', reportRows, 'Checks cover eligible mod sources in the selected collections; frozen collections, other game versions and folder mods are excluded.')
	const vaultAvailability = await window.update_IPC.vaultAvailability(updateRows.map((row) => ({
		modName   : row.modName,
		sourceType : row.sourceType,
		sourceURL  : row.sourceURL,
		version    : row.version,
	})))
	const availabilityRows = Array.isArray(vaultAvailability) ? vaultAvailability : []

	for ( const [index, { assetName, collectionKey, collectionName, downloadURL, modHubID, modHubReleased, modName, needsReview, node, review, sourceType, sourceURL, version }] of updateRows.entries() ) {
		const row = node.firstElementChild
		const vaultStatus = node.querySelector('.update-vault-status')
		if ( vaultStatus !== null ) { vaultStatus.innerHTML = vaultStatusText(availabilityRows[index]) }
		row.classList.add('bg-warning-subtle', 'update-candidate-row')
		row.dataset.hasDownload = downloadURL !== null ? 'true' : 'false'
		row.dataset.inVault = availabilityRows[index]?.inVault === true ? 'true' : 'false'
		row.dataset.needsReview = needsReview ? 'true' : 'false'
		row.dataset.reviewReasons = review.join(',')
		row.dataset.updateState = rowCandidateState(row)
		const selectCheckbox = node.querySelector('.update-select-checkbox')
		if ( assetName !== null ) {
			selectCheckbox.dataset.assetName = assetName
			selectCheckbox.dataset.collectionName = collectionName
			selectCheckbox.dataset.collectionKey = collectionKey
			selectCheckbox.dataset.modHubId = modHubID ?? ''
			selectCheckbox.dataset.modHubReleased = modHubReleased ?? ''
			selectCheckbox.dataset.modName = modName
		}
		if ( downloadURL !== null ) { selectCheckbox.dataset.downloadUrl = downloadURL }
		selectCheckbox.dataset.remoteVersion = version
		selectCheckbox.dataset.sourceUrl = sourceURL
		selectCheckbox.dataset.sourceType = sourceType
		selectCheckbox.addEventListener('change', updateSelectedCount)
		const sourceButton = node.querySelector('.update-source-button')
		sourceButton.dataset.sourceUrl = sourceURL
		sourceButton.addEventListener('click', (event) => {
			const buttonURL = event.currentTarget.dataset.sourceUrl
			if ( isWebURL(buttonURL) ) {
				window.update_IPC.openURL(buttonURL)
			}
		})
		listDiv.appendChild(node)
	}

	MA.byId('selectionControls').classList.toggle('d-none', updateRows.length === 0)
	applyNeedsReviewFilter()
	updateSelectedCount()

	const reviewCount = updateRows.filter((row) => row.needsReview).length
	MA.byIdHTML(
		'updateStatus',
		updateRows.length === 0 ? I18N.defer('update_list_none_found', false) : `${updateRows.length} ${I18N.defer('update_list_found', false)}${reviewCount === 0 ? '' : `; ${reviewCount} need review`}`
	)
}

async function startFromModList(modCollect, forceRemoteRefresh = false) {
	const renderID = ++activeRenderID

	if ( modCollect === null ) {
		renderEmpty('update_list_load_failed')
		return
	}
	try {
		MA.byIdHTML('updateCollectionContext', collectionContextText(modCollect))
		MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
		beginUpdateBusy(I18N.defer('update_list_loading', false), null)
		MA.byIdHTML('modList', '')
		MA.byId('selectionControls').classList.add('d-none')
		if ( MA.byId('needsReviewOnly') !== null ) { MA.byId('needsReviewOnly').checked = false }
		if ( MA.byId('updateStateFilter') !== null ) { MA.byId('updateStateFilter').value = '' }
		for ( const filter of document.querySelectorAll('.review-reason-filter') ) { filter.checked = false }
		updateSelectedCount()
		await displayCandidates(buildCollectionCandidateMap(modCollect, {
			titleResolver : (thisMod, currentModCollect) => doL10N(thisMod.l10n.title, currentModCollect.appSettings.force_lang),
		}), renderID, forceRemoteRefresh)
	} catch (err) {
		MA.byIdText('updateStatus', `Update list error: ${err.message}`)
		window.UpdateRunReport.show('updateStatus', 'Collection check report', [{ name : 'Scan', status : 'Failed', detail : err.message }])
	} finally {
		if ( renderID === activeRenderID ) { endUpdateBusy() }
	}
}

async function refreshUpdateCandidates() {
	const button = MA.byId('refreshUpdatesButton')
	button.disabled = true
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
	beginUpdateBusy(I18N.defer('update_list_loading', false), null)
	try {
		const modCollect = await window.update_IPC.get()
		await startFromModList(modCollect, true)
	} finally {
		endUpdateBusy()
		button.disabled = false
	}
}

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	for ( const item of document.querySelectorAll('[data-bs-toggle="tooltip"]') ) {
		bootstrap.Tooltip.getOrCreateInstance(item)
	}
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
	MA.byIdEventIfExists('selectAllButton', () => { setAllSelections(true) })
	MA.byIdEventIfExists('selectReadyButton', selectReadyUpdates)
	MA.byIdEventIfExists('selectNoneButton', () => { setAllSelections(false) })
	MA.byIdEventIfExists('openSelectedButton', openSelectedSources)
	MA.byIdEventIfExists('downloadSelectedButton', downloadSelectedZIPs)
	MA.byIdEventIfExists('refreshUpdatesButton', refreshUpdateCandidates)
	MA.byIdEventIfExists('updateMenuButton', () => { window.operations.close() })
	MA.byIdEventIfExists('needsReviewOnly', applyNeedsReviewFilter)
	MA.byIdEventIfExists('updateStateFilter', applyNeedsReviewFilter)
	for ( const filter of document.querySelectorAll('.review-reason-filter') ) {
		filter.addEventListener('change', applyNeedsReviewFilter)
	}

	window.update_IPC.receive('mods:list', (modCollect) => {
		if ( loadedInitialModList ) { return }
		loadedInitialModList = true
		startFromModList(modCollect)
	})

})
