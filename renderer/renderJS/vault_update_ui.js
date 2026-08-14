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

function selectedCandidates() {
	return candidates.filter((candidate) => selectedKeys.has(candidate.key))
}

function syncSelectionCheckboxes() {
	for ( const checkbox of document.querySelectorAll('.vault-update-select-checkbox') ) {
		checkbox.checked = selectedKeys.has(checkbox.dataset.candidateKey ?? '')
		checkbox.disabled = isBusy
	}
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

function getSource(record) {
	const modHubID = Number(record.modHubIDs?.[0])
	if ( Number.isInteger(modHubID) && modHubID > 0 ) {
		return {
			modHubID,
			sourceType : 'modhub',
			sourceURL  : record.modHubURL ?? `https://www.farming-simulator.com/mod.php?mod_id=${modHubID}&title=fs2025`,
		}
	}

	const sourceURL = record.sourceURL ?? ''
	if ( /^https:\/\/github\.com\//iu.test(sourceURL) ) {
		return { modHubID : null, sourceType : 'github', sourceURL }
	}

	return null
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
	card.className = 'card mb-3 bg-dark border-secondary'

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
	if ( selected ) {
		selectedKeys = new Set(candidates.map((candidate) => candidate.key))
	} else {
		selectedKeys.clear()
	}
	syncSelectionCheckboxes()
	updateSelectionText()
}

function updateSelectionText() {
	const candidateKeys = new Set(candidates.map((candidate) => candidate.key))
	selectedKeys = new Set([...selectedKeys].filter((key) => candidateKeys.has(key)))
	syncSelectionCheckboxes()
	const selectedCount = selectedKeys.size
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
	byID('vaultUpdatesSelectAll').disabled = isBusy || candidates.length === 0
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

	setStatus(`${candidates.length} Vault update(s) found.${skipped > 0 ? ` ${skipped} item(s) skipped because they have no supported update source.` : ''}`, candidates.length !== 0 ? 'warning' : 'success')
	updateSelectionText()
}

// eslint-disable-next-line complexity
async function loadCandidates(force = false) {
	setBusy(true, 'Loading Vault...')
	// A fresh update check must never inherit selection from an older result
	// set. Only the visible ticked rows may be downloaded.
	selectedKeys.clear()
	syncSelectionCheckboxes()
	try {
		const vault = await window.vault_update_IPC.getVault()
		const groups = new Map()
		let skipped = 0

		const vaultEntries = Array.isArray(vault.entries)
			? vault.entries
			: (Array.isArray(vault.records) ? vault.records : [])

		for ( const record of vaultEntries ) {
			const source = getSource(record)
			if ( source === null ) { skipped++; continue }
			const modName = vaultRecordModName(record)
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
			candidates.push({
				assetName     : remote.assetName ?? group.fileName,
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
			})
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
		for ( const candidate of candidates.filter((item) => selectedKeys.has(item.key)) ) {
			window.vault_update_IPC.openURL(candidate.pageURL)
		}
	})
	byID('vaultUpdatesBack').addEventListener('click', () => window.vault_update_IPC.dispatchModManagement())
	loadCandidates(false)
})
