/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: UPDATE UI

/* global MA, DATA, I18N */

function doL10N(item, locale) {
	let returnText = item?.[locale]
	returnText ??= item?.en
	returnText ??= item?.de
	returnText ??= '--'
	return DATA.escapeSpecial(returnText)
}

function updateSourceInfo(sourceURL) {
	try {
		const url = new URL(sourceURL)
		if ( url.protocol !== 'https:' ) { return { label : 'Manual web page', type : 'manual' } }
		const host = url.hostname.toLowerCase().replace(/^www\./u, '')
		if ( host === 'github.com' ) { return { label : 'GitHub', type : 'github' } }
		if ( host === 'kingmods.net' ) { return { label : 'KingMods', type : 'kingmods' } }
		if ( host === 'itch.io' || host.endsWith('.itch.io') ) { return { label : 'itch.io', type : 'itch' } }
		if ( host === 'farming-simulator.com' && url.searchParams.has('mod_id') ) { return { label : 'ModHub', type : 'modhub' } }
		return { label : 'Manual web page', type : 'manual' }
	} catch {
		return { label : 'Manual web page', type : 'manual' }
	}
}

function isWebURL(sourceURL) {
	try {
		return new URL(sourceURL).protocol === 'https:'
	} catch {
		return false
	}
}

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

function isManualSourceType(sourceType) {
	return ['itch', 'kingmods', 'manual'].includes(sourceType)
}

function sourceTypeLabel(sourceType) {
	if ( sourceType === 'modhub' ) { return 'ModHub' }
	if ( sourceType === 'github' ) { return 'GitHub' }
	if ( sourceType === 'kingmods' ) { return 'KingMods' }
	if ( sourceType === 'itch' ) { return 'itch.io' }
	return 'Manual web page'
}

function modHubReleasedText(result) {
	if ( result.source !== 'modhub' ) { return '' }
	const released = typeof result.released === 'string' && result.released.trim() !== '' ? result.released.trim() : 'not recorded'
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

const REVIEW_REASON_LABELS = {
	manualSource     : 'manual source',
	missingModHubDate : 'ModHub release date not recorded',
	noDirectZip      : 'no direct ZIP',
	repositoryZip    : 'repository ZIP instead of release asset',
	versionUnclear   : 'version comparison unclear',
}

function reviewReasons(entry, result) {
	const reasons = []
	if ( isManualSourceType(entry.sourceType) ) {
		reasons.push('manualSource')
	}
	if ( result.hasDownload !== true ) {
		reasons.push('noDirectZip')
	}
	if ( result.source === 'modhub' && (typeof result.released !== 'string' || result.released.trim() === '') ) {
		reasons.push('missingModHubDate')
	}
	if ( entry.sourceType === 'github' && result.downloadSource === 'repositoryFile' ) {
		reasons.push('repositoryZip')
	}
	if ( typeof result.version !== 'string' || ![...entry.local].some((version) => !Number.isNaN(DATA.versionCompare(version, result.version))) ) {
		reasons.push('versionUnclear')
	}
	return reasons
}

function reviewNoteText(reasons) {
	if ( reasons.length === 0 ) { return '' }
	const labels = reasons.map((reason) => REVIEW_REASON_LABELS[reason] ?? reason)
	return `<div class="small text-warning mb-2">Needs review: ${DATA.escapeSpecial(labels.join(', '))}</div>`
}

function manualSourceMessage(sourceType) {
	return `${sourceTypeLabel(sourceType)} is a manual download source. Open the web page to check and install updates manually.`
}

// eslint-disable-next-line complexity
function makeCandidateMap(modCollect) {
	const thisVersion    = modCollect.appSettings.game_version
	const candidates     = {}
	const collectKeyName = {}
	const activeCollect  = modCollect.opts?.activeCollection ?? null
	const modSites       = modCollect.opts?.modSites ?? {}
	const collectionKeys = [...modCollect.set_Collections]
	const collectKeys    = activeCollect !== null && collectionKeys.includes(activeCollect) ?
		[activeCollect] :
		collectionKeys

	for ( const collectKey of collectKeys ) {
		const theseNotes = modCollect?.collectionNotes?.[collectKey]

		if ( theseNotes?.notes_frozen === true ) { continue }
		if ( theseNotes?.notes_version !== thisVersion ) { continue }

		collectKeyName[collectKey] = modCollect.collectionToName[collectKey]

		for ( const modKey of modCollect.modList[collectKey].modSet ) {
			const thisMod  = modCollect.modList[collectKey].mods[modKey]
			const modName  = thisMod.fileDetail.shortName
			const sourceURL = modSites[modName] ?? ''
			const sourceInfo = updateSourceInfo(sourceURL)

			if ( thisMod.fileDetail.isFolder ) { continue }

			const addCandidate = (sourceType, sourceLink, remoteVersion = null, modHubID = null) => {
				const candidateKey = `${modName}::${sourceType}`
				candidates[candidateKey] ??= {
					collectionKeys : [],
					collections : [],
					icon        : thisMod.modDesc.iconImage,
					local       : new Set(),
					modHubID,
					modName,
					remoteVersion,
					sourceLabel : sourceTypeLabel(sourceType),
					sourceType,
					sourceURL   : sourceLink,
					title       : doL10N(thisMod.l10n.title, modCollect.appSettings.force_lang),
				}
				if ( !candidates[candidateKey].collectionKeys.includes(collectKey) ) {
					candidates[candidateKey].collectionKeys.push(collectKey)
					candidates[candidateKey].collections.push(collectKeyName[collectKey])
				}
				candidates[candidateKey].local.add(thisMod.modDesc.version)
			}

			if ( sourceInfo.type === 'github' ) {
				addCandidate('github', sourceURL)
			} else if ( ['itch', 'kingmods', 'manual'].includes(sourceInfo.type) && isWebURL(sourceURL) ) {
				addCandidate(sourceInfo.type, sourceURL)
			} else if ( sourceInfo.type === 'modhub' && thisMod.modHub.id === null && isWebURL(sourceURL) ) {
				addCandidate('modhub', sourceURL)
			}
			if ( thisMod.modHub.id !== null && typeof thisMod.modHub.version === 'string' && thisMod.modHub.version !== '' ) {
				addCandidate('modhub', `https://www.farming-simulator.com/mod.php?mod_id=${thisMod.modHub.id}`, thisMod.modHub.version, thisMod.modHub.id)
			}
		}
	}

	return candidates
}

function isUpdateAvailable(localVersions, remoteVersion, allowUnknownDifference = false) {
	for ( const localVersion of localVersions ) {
		const compare = DATA.versionCompare(localVersion, remoteVersion)
		if ( compare < 0 || (allowUnknownDifference && Number.isNaN(compare) && DATA.versionDifferent(localVersion, remoteVersion)) ) {
			return true
		}
	}
	return false
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
let updateBusyDepth = 0

function showUpdateBusyProgress(label = '', value = null) {
	const wrapper = MA.byId('updateBusyProgress')
	const bar = MA.byId('updateBusyProgressBar')
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
	bar.textContent = label
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

function getUpdateCheckboxes() {
	return [...document.querySelectorAll('.update-candidate-row:not(.d-none) .update-select-checkbox')]
}

function getAllUpdateCheckboxes() {
	return [...document.querySelectorAll('.update-candidate-row .update-select-checkbox')]
}

function updateSelectedCount() {
	const selectedCount = getSelectedCheckboxes().length
	const downloadableCount = getSelectedDownloadCandidates().length
	MA.byIdHTML('selectedCount', `${I18N.defer('update_list_selected', false)} ${selectedCount}`)
	MA.byId('openSelectedButton').disabled = selectedCount === 0
	MA.byId('downloadSelectedButton').disabled = downloadableCount === 0
}

function setAllSelections(isChecked) {
	for ( const checkbox of getUpdateCheckboxes() ) {
		checkbox.checked = isChecked
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
	const selectedReasons = selectedReviewReasons()
	if ( reasonFilters !== null ) {
		reasonFilters.classList.toggle('d-none', !needsReviewOnly)
	}
	for ( const row of document.querySelectorAll('.update-candidate-row') ) {
		const rowReasons = row.dataset.reviewReasons?.split(',').filter((reason) => reason !== '') ?? []
		const reasonMatches = selectedReasons.length === 0 || selectedReasons.some((reason) => rowReasons.includes(reason))
		row.classList.toggle('d-none', needsReviewOnly && (row.dataset.needsReview !== 'true' || !reasonMatches))
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
	MA.byIdHTML('updateStatus', I18N.defer('update_list_updating', false))
	beginUpdateBusy(`0 / ${downloads.length}`, 0)
	try {
		const result = await window.update_IPC.downloadApplySelected(downloads)
		setUpdateBusy(`${downloads.length} / ${downloads.length}`, 100)
		if ( result.ok ) {
			removeAppliedUpdateRows(downloads)
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_update_complete', false)} ${result.count} / ${downloads.length}. Use Refresh update checks to rescan all sources.`)
		} else {
			MA.byIdHTML('updateStatus', `${I18N.defer('update_list_update_failed', false)} ${result.error}`)
		}
	} finally {
		endUpdateBusy()
	}
	updateSelectedCount()
}

async function displayCandidates(candidates, renderID, forceRemoteRefresh = false) {
	const listDiv = MA.byId('modList')
	const candidateEntries = Object.entries(candidates).sort((a, b) => Intl.Collator().compare(a[0], b[0]))
	let completeCount = 0

	listDiv.innerHTML = ''

	if ( candidateEntries.length === 0 ) {
		renderEmpty('update_list_no_sources')
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

		if ( !result.ok ) { return null }
		if ( !['itch', 'kingmods', 'manual'].includes(entry.sourceType) && !isUpdateAvailable(entry.local, result.version, entry.sourceType === 'github') ) { return null }
	
		const collectionList = entry.collections
			.sort((a, b) => Intl.Collator().compare(a, b))
			.map((collection) => `<li><span class="fw-bold">${DATA.escapeSpecial(collection)}</span></li>`)
		const assetName = result.assetName ?? null
		const collectionKey = entry.collectionKeys[0] ?? null
		const collectionName = entry.collections[0] ?? 'updates'
		const review = reviewReasons(entry, result)
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
			}),
			review,
			sourceType : entry.sourceType,
			sourceURL : entry.sourceURL,
			version   : result.version,
		}
	})).filter((x) => x !== null)

	if ( renderID !== activeRenderID ) { return }

	for ( const { assetName, collectionKey, collectionName, downloadURL, modHubID, modHubReleased, modName, needsReview, node, review, sourceType, sourceURL, version } of updateRows ) {
		const row = node.firstElementChild
		row.classList.add('bg-warning-subtle', 'update-candidate-row')
		row.dataset.needsReview = needsReview ? 'true' : 'false'
		row.dataset.reviewReasons = review.join(',')
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
		for ( const filter of document.querySelectorAll('.review-reason-filter') ) { filter.checked = false }
		updateSelectedCount()
		await displayCandidates(makeCandidateMap(modCollect), renderID, forceRemoteRefresh)
	} catch (err) {
		MA.byIdText('updateStatus', `Update list error: ${err.message}`)
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
	MA.byIdHTML('updateStatus', `${I18N.defer('update_list_checking', false)} ${I18N.defer('update_list_loading', false)}`)
	MA.byIdEventIfExists('selectAllButton', () => { setAllSelections(true) })
	MA.byIdEventIfExists('selectNoneButton', () => { setAllSelections(false) })
	MA.byIdEventIfExists('openSelectedButton', openSelectedSources)
	MA.byIdEventIfExists('downloadSelectedButton', downloadSelectedZIPs)
	MA.byIdEventIfExists('refreshUpdatesButton', refreshUpdateCandidates)
	MA.byIdEventIfExists('updateMenuButton', () => window.update_IPC.dispatchModManagement())
	MA.byIdEventIfExists('needsReviewOnly', applyNeedsReviewFilter)
	for ( const filter of document.querySelectorAll('.review-reason-filter') ) {
		filter.addEventListener('change', applyNeedsReviewFilter)
	}

	window.update_IPC.receive('mods:list', (modCollect) => {
		startFromModList(modCollect)
	})

})
