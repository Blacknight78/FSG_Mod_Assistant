/* global DATA */

let candidates = []
let selectedKeys = new Set()
let isBusy = false

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
	repositoryZip    : 'repository ZIP instead of release asset',
	sourceMismatch   : 'source mismatch risk',
	versionUnclear   : 'version comparison unclear',
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

function selectedReviewReasons() {
	return [...document.querySelectorAll('.vault-review-reason-filter:checked')].map((filter) => filter.value)
}

function visibleCandidates() {
	const needsReviewOnly = byID('vaultNeedsReviewOnly')?.checked === true
	const selectedReasons = selectedReviewReasons()
	return candidates.filter((candidate) => {
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
		element.disabled = value
	}
	syncSelectionCheckboxes()
	byID('vaultUpdatesProgressWrap').classList.toggle('d-none', !value)
	byID('vaultUpdatesProgress').style.width = value ? '8%' : '0%'
	byID('vaultUpdatesProgress').textContent = label
}

function setProgress(percent, label) {
	byID('vaultUpdatesProgress').style.width = `${Math.max(0, Math.min(100, percent))}%`
	byID('vaultUpdatesProgress').textContent = label
}

function setStatus(message, kind = 'secondary') {
	const status = byID('vaultUpdateStatus')
	status.textContent = message
	status.className = `alert alert-${kind} mb-3`
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

function addBadge(parent, text, className) {
	const badge = document.createElement('span')
	badge.className = `badge ${className}`
	badge.textContent = text
	parent.append(badge)
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
	updateStatus.className = 'text-warning mb-3'
	updateStatus.textContent = 'Update may be available'
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

function updateSelectionText() {
	const candidateKeys = new Set(candidates.map((candidate) => candidate.key))
	selectedKeys = new Set([...selectedKeys].filter((key) => candidateKeys.has(key)))
	syncSelectionCheckboxes()
	const visibleCount = visibleCandidates().length
	const selectedCount = selectedCandidates().length
	const selectedDownloadableCount = selectedCandidates().filter((candidate) => candidate.downloadURL).length
	const manualCount = selectedCount - selectedDownloadableCount

	byID('vaultUpdateSelectionControls').classList.toggle('d-none', candidates.length === 0)
	byID('vaultUpdatesSelectedCount').textContent = `Selected: ${selectedCount}`
	if ( selectedCount === 0 ) {
		byID('vaultUpdateSelection').textContent = '0 updates selected. Downloads are stored in the Vault only.'
	} else if ( manualCount === 0 ) {
		byID('vaultUpdateSelection').textContent = `${selectedCount} update(s) selected. ${selectedDownloadableCount} can be downloaded to the Vault.`
	} else {
		byID('vaultUpdateSelection').textContent = `${selectedCount} update(s) selected. ${selectedDownloadableCount} can be downloaded to the Vault; ${manualCount} require manual download.`
	}
	byID('vaultUpdatesDownloadSelected').disabled = isBusy || selectedDownloadableCount === 0
	byID('vaultUpdatesOpenSelected').disabled = isBusy || selectedCount === 0
	byID('vaultUpdatesSelectAll').disabled = isBusy || visibleCount === 0
	byID('vaultUpdatesSelectNone').disabled = isBusy || selectedCount === 0
}

function renderCandidates(skipped) {
	const list = byID('vaultUpdateList')
	list.replaceChildren()
	selectedKeys = new Set([...selectedKeys].filter((key) => candidates.some((candidate) => candidate.key === key)))

	if ( candidates.length === 0 ) {
		const empty = document.createElement('div')
		empty.className = 'alert alert-success'
		empty.textContent = 'No newer supported Vault updates were found.'
		list.append(empty)
	} else {
		for ( const candidate of candidates ) { list.append(cardFor(candidate)) }
	}

	applyNeedsReviewFilter()
	const reviewCount = candidates.filter((candidate) => candidate.needsReview).length
	setStatus(`${candidates.length} Vault update(s) found.${reviewCount === 0 ? '' : ` ${reviewCount} need review.`}${skipped > 0 ? ` ${skipped} item(s) skipped because they have no supported update source.` : ''}`, candidates.length !== 0 ? 'warning' : 'success')
	updateSelectionText()
}

// eslint-disable-next-line complexity
async function loadCandidates(force = false) {
	setBusy(true, 'Loading Vault...')
	// A fresh update check must never inherit selection from an older result
	// set. Only the visible ticked rows may be downloaded.
	selectedKeys.clear()
	if ( byID('vaultNeedsReviewOnly') !== null ) { byID('vaultNeedsReviewOnly').checked = false }
	for ( const filter of document.querySelectorAll('.vault-review-reason-filter') ) { filter.checked = false }
	syncSelectionCheckboxes()
	try {
		const vault = await window.vault_update_IPC.getVault()
		const groups = new Map()
		let skipped = 0

		const vaultEntries = Array.isArray(vault.entries)
			? vault.entries
			: (Array.isArray(vault.records) ? vault.records : [])

		for ( const record of vaultEntries ) {
			const sources = getSources(record)
			if ( sources.length === 0 ) { skipped++; continue }
			const modName = vaultRecordModName(record)
			for ( const source of sources ) {
				const key = makeGroupKey(modName, source)
				const existing = groups.get(key) ?? {
					fileName      : record.fileName,
					key,
					localVersions : [],
					modHubID      : source.modHubID,
					modIcon       : typeof record.modIcon === 'string' && record.modIcon !== '' ? record.modIcon : null,
					modName,
					sourceType    : source.sourceType,
					sourceURL     : source.sourceURL,
				}
				existing.localVersions.push(...(record.versions ?? []))
				if ( existing.modIcon === null && typeof record.modIcon === 'string' && record.modIcon !== '' ) {
					existing.modIcon = record.modIcon
				}
				groups.set(key, existing)
			}
		}

		const sourceGroups = [...groups.values()]
		candidates = []
		for ( const [index, group] of sourceGroups.entries() ) {
			setProgress(Math.round(((index + 1) / Math.max(sourceGroups.length, 1)) * 90), `Checking ${index + 1} of ${sourceGroups.length}`)
			// Vault update checks are deliberately sequential to avoid hammering source sites.
			// eslint-disable-next-line no-await-in-loop
			const remote = await (group.sourceType === 'modhub'
				? window.vault_update_IPC.getModHub(group.modHubID, force)
				: window.vault_update_IPC.getGitHub(group.sourceURL, force))

			if ( !remote?.ok || typeof remote.version !== 'string' ) { continue }
			const localVersion = newestVersion(group.localVersions)
			if ( compareVersions(remote.version, localVersion) <= 0 ) { continue }
			const candidate = {
				assetName     : remote.assetName ?? group.fileName,
				downloadSource : remote.downloadSource ?? null,
				downloadURL   : remote.hasDownload ? remote.downloadURL : null,
				fileName      : group.fileName,
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
			}
			candidate.reviewReasons = reviewReasons(candidate)
			candidate.needsReview = candidate.reviewReasons.length !== 0
			candidates.push(candidate)
		}

		candidates.sort((left, right) => left.modName.localeCompare(right.modName))
		setProgress(100, 'Update check complete')
		renderCandidates(skipped)
	} catch (err) {
		setStatus(`Vault update check failed: ${err.message}`, 'danger')
	} finally {
		setBusy(false)
		updateSelectionText()
	}
}

async function downloadSelected() {
	const downloadableCandidates = candidates
		.filter((candidate) => selectedKeys.has(candidate.key) && candidate.downloadURL)
	const downloads = downloadableCandidates
		.map((candidate) => ({
			fileName   : candidate.assetName,
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
	setBusy(true, 'Saving update(s) to Vault...')
	try {
		const result = await window.vault_update_IPC.downloadToVaultSelected(downloads)
		if ( !result?.ok ) { throw new Error(result?.error ?? 'Vault download failed') }
		const manualMessage = manualCount > 0
			? ` ${manualCount} selected update(s) require manual download and were not changed.`
			: ''
		setStatus(`Stored ${result.count} update(s) in the Vault.${manualMessage} Matching collection updates will reuse these cached ZIPs when available.`, 'success')
		selectedKeys.clear()
		// Re-read the Vault and its update state after storing files so completed
		// downloads disappear from the update list immediately.
		await loadCandidates(true)
	} catch (err) {
		setStatus(`Vault download failed: ${err.message}`, 'danger')
	} finally {
		setBusy(false)
		updateSelectionText()
	}
}

window.addEventListener('DOMContentLoaded', () => {
	byID('vaultUpdatesRefresh').addEventListener('click', () => loadCandidates(true))
	byID('vaultUpdatesDownloadSelected').addEventListener('click', downloadSelected)
	byID('vaultUpdatesSelectAll').addEventListener('click', () => setAllSelections(true))
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
	loadCandidates(false)
})
