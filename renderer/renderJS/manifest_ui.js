/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: COLLECTION MANIFEST UI

/* global DATA, MA, bootstrap */

let manifestResolvedMods = []
let manifestViewFilter = 'all'
let manifestBusyDepth = 0
let googleDriveOpenURL = null

function isWebURL(sourceURL) {
	return typeof sourceURL === 'string' && /^https?:\/\//iu.test(sourceURL)
}

function sourceTypeLabel(sourceType) {
	if ( sourceType === 'modhub' ) { return 'ModHub' }
	if ( sourceType === 'github' ) { return 'GitHub' }
	if ( sourceType === 'kingmods' ) { return 'KingMods' }
	if ( sourceType === 'itch' ) { return 'itch.io' }
	return 'manual source'
}

function manualSourceMessage(sourceType) {
	return `${sourceTypeLabel(sourceType)} is a manual download source. Open the web page to check and install updates manually.`
}

function selectedManifestCollectionKey() {
	return MA.byId('manifestCollection')?.value ?? ''
}

function setManifestBusy(label = 'Working...', value = null) {
	const wrapper = MA.byId('manifestBusyProgress')
	const bar = MA.byId('manifestBusyProgressBar')
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

function beginManifestBusy(label = 'Working...', value = null) {
	manifestBusyDepth++
	setManifestBusy(label, value)
}

function endManifestBusy() {
	manifestBusyDepth = Math.max(0, manifestBusyDepth - 1)
	if ( manifestBusyDepth !== 0 ) { return }
	const wrapper = MA.byId('manifestBusyProgress')
	if ( wrapper === null ) { return }
	wrapper.classList.add('d-none')
	wrapper.setAttribute('aria-hidden', 'true')
}

function initManifestTooltips(root = document) {
	for ( const tooltip of root.querySelectorAll('[data-bs-toggle="tooltip"]') ) {
		bootstrap.Tooltip.getOrCreateInstance(tooltip)
	}
}

function manifestTooltipBadge(label, className, tooltip) {
	return `<span class="badge ${className}" data-bs-placement="top" data-bs-toggle="tooltip" tabindex="0" title="${DATA.escapeSpecial(tooltip)}">${DATA.escapeSpecial(label)}</span>`
}

function manifestStateBadge(state) {
	if ( state === 'downloadable' ) { return manifestTooltipBadge('Latest ZIP available', 'text-bg-success', 'The source has a ZIP file FSG Mod Assistant can download and install automatically.') }
	if ( state === 'manual' ) { return manifestTooltipBadge('Manual download required', 'text-bg-warning', 'This source must be opened and downloaded manually.') }
	return manifestTooltipBadge('Source missing', 'text-bg-danger', 'The shared manifest does not include a usable download or web page source for this mod.')
}

function manifestStateDetail(mod) {
	if ( mod.state === 'downloadable' ) { return `${DATA.escapeSpecial(sourceTypeLabel(mod.sourceType))} has a ZIP the manager can download and install.` }
	if ( mod.state === 'manual' ) { return DATA.escapeSpecial(manualSourceMessage(mod.sourceType)) }
	return 'Missing source. No GitHub, ModHub, KingMods, itch.io, or manual web page link was included for this mod.'
}

function manifestTargetCollectionName() {
	const select = MA.byId('manifestCollection')
	return select?.selectedOptions?.[0]?.textContent ?? 'the selected collection'
}

function manifestTargetInstallState(mod) {
	const collectionKey = selectedManifestCollectionKey()
	if ( collectionKey === '' ) { return mod.installState ?? 'not_installed' }
	const records = Array.isArray(mod.localRecords) ? mod.localRecords.filter((record) => record.collectionKey === collectionKey) : []
	const versions = records.map((record) => record.version).filter((version) => typeof version === 'string' && version !== '')
	if ( versions.length === 0 ) { return 'not_installed' }
	if ( typeof mod.remoteVersion !== 'string' || mod.remoteVersion === '' ) { return 'installed_unknown' }
	if ( versions.some((version) => version === mod.remoteVersion || DATA.versionCompare(version, mod.remoteVersion) === 0) ) { return 'current' }
	if ( versions.some((version) => DATA.versionCompare(version, mod.remoteVersion) < 0) ) { return 'update_available' }
	return 'installed_different'
}

function manifestInstallBadge(installState) {
	if ( installState === 'current' ) { return manifestTooltipBadge('Already current', 'text-bg-success', 'The target collection already has the same version as the latest resolved source.') }
	if ( installState === 'update_available' ) { return manifestTooltipBadge('Update needed', 'text-bg-info', 'The target collection has an older local version than the latest resolved source.') }
	if ( installState === 'not_installed' ) { return manifestTooltipBadge('Not installed', 'text-bg-danger', 'The target collection does not currently contain this mod.') }
	if ( installState === 'installed_different' ) { return manifestTooltipBadge('Different installed version', 'text-bg-warning', 'The target collection has this mod, but its version differs from the latest resolved source.') }
	return manifestTooltipBadge('Installed version unknown', 'text-bg-secondary', 'The target collection has this mod, but the latest source version could not be confirmed.')
}

function manifestInstallDetail(mod) {
	const installState = manifestTargetInstallState(mod)
	const collectionName = DATA.escapeSpecial(manifestTargetCollectionName())
	const collectionKey = selectedManifestCollectionKey()
	const records = Array.isArray(mod.localRecords) ? mod.localRecords.filter((record) => collectionKey === '' || record.collectionKey === collectionKey) : []
	const localVersions = [...new Set(records.map((record) => record.version).filter((version) => typeof version === 'string' && version !== ''))]
	const remoteText = mod.remoteVersion === null ? `shared version ${mod.requestedVersion ?? 'unknown'}` : `latest version ${mod.remoteVersion}`
	const localText = localVersions.length === 0 ? 'no local version' : `local version ${localVersions.join(', ')}`
	const summary = `${DATA.escapeSpecial(localText)}; ${DATA.escapeSpecial(remoteText)}`
	if ( installState === 'current' ) { return `${manifestInstallBadge(installState)} ${summary}. ${collectionName} already has this version.` }
	if ( installState === 'update_available' ) { return `${manifestInstallBadge(installState)} ${summary}. ${collectionName} has an older version.` }
	if ( installState === 'not_installed' ) { return `${manifestInstallBadge(installState)} ${summary}. ${collectionName} does not have this mod yet.` }
	if ( installState === 'installed_different' ) { return `${manifestInstallBadge(installState)} ${summary}. ${collectionName} has a different version.` }
	return `${manifestInstallBadge(installState)} ${summary}. ${collectionName} has this mod, but the latest version is unknown.`
}

function manifestMayDownloadNewerThanShared(mod) {
	if ( mod.state !== 'downloadable' ) { return false }
	if ( typeof mod.requestedVersion !== 'string' || mod.requestedVersion === '' ) { return false }
	if ( typeof mod.remoteVersion !== 'string' || mod.remoteVersion === '' ) { return false }
	return DATA.versionCompare(mod.requestedVersion, mod.remoteVersion) < 0
}

function manifestVersionWarning(mod) {
	if ( !manifestMayDownloadNewerThanShared(mod) ) { return '' }
	return `<div class="alert alert-warning py-2 mb-0">Shared version ${DATA.escapeSpecial(mod.requestedVersion)} is older than the latest downloadable version ${DATA.escapeSpecial(mod.remoteVersion)}. Installing from this source may download the newer file and cause a server mod mismatch.</div>`
}

function manifestSelectionChanged() {
	const selected = [...document.querySelectorAll('.manifest-select:checked')].length
	const installButton = MA.byId('manifestInstall')
	const selectedCount = MA.byId('manifestSelectedCount')
	if ( selectedCount !== null ) { selectedCount.textContent = `Selected: ${selected}` }
	if ( installButton !== null ) { installButton.disabled = selected === 0 || selectedManifestCollectionKey() === '' }
}

function setManifestSelections(checked) {
	for ( const checkbox of document.querySelectorAll('.manifest-select:not(:disabled)') ) {
		const row = checkbox.closest('.manifest-row')
		checkbox.checked = checked && row?.classList.contains('d-none') !== true
	}
	manifestSelectionChanged()
}

function manifestRowShouldShow(row) {
	if ( manifestViewFilter === 'attention' ) { return row.dataset.state === 'manual' || row.dataset.state === 'missing' }
	if ( manifestViewFilter === 'downloadable' ) { return row.dataset.state === 'downloadable' }
	if ( manifestViewFilter === 'needsUpdate' ) { return row.dataset.installState === 'not_installed' || row.dataset.installState === 'update_available' }
	if ( manifestViewFilter === 'current' ) { return row.dataset.installState === 'current' }
	return true
}

function setManifestFilterButton(id, active, activeClass) {
	const button = MA.byId(id)
	if ( button === null ) { return }
	button.classList.toggle('active', active)
	button.classList.toggle(activeClass, active)
	button.classList.toggle(`btn-outline-${activeClass.replace('btn-', '')}`, !active)
}

function applyManifestViewFilter(filter) {
	manifestViewFilter = filter
	for ( const row of document.querySelectorAll('.manifest-row') ) {
		row.classList.toggle('d-none', !manifestRowShouldShow(row))
	}
	setManifestFilterButton('manifestShowAll', filter === 'all', 'btn-secondary')
	setManifestFilterButton('manifestShowAttention', filter === 'attention', 'btn-danger')
	setManifestFilterButton('manifestShowDownloadable', filter === 'downloadable', 'btn-success')
	setManifestFilterButton('manifestShowNeedsUpdate', filter === 'needsUpdate', 'btn-info')
	setManifestFilterButton('manifestShowCurrent', filter === 'current', 'btn-secondary')
	manifestSelectionChanged()
}

function incrementCount(counts, key) {
	counts[key] = (counts[key] ?? 0) + 1
}

function manifestSummaryText(counts, installCounts, newerDownloadCount) {
	return `${counts.downloadable} downloadable, ${counts.manual} manual, ${counts.missing} missing. ${installCounts.current} current, ${installCounts.update_available} update needed, ${installCounts.not_installed} not installed in ${manifestTargetCollectionName()}.${newerDownloadCount === 0 ? '' : ` ${newerDownloadCount} downloadable mod(s) may install newer files than the shared manifest version.`}`
}

function renderManifestPreview(result) {
	manifestResolvedMods = result.mods
	const list = MA.byId('manifestList')
	list.innerHTML = ''
	const counts = { downloadable : 0, manual : 0, missing : 0 }
	const installCounts = { current : 0, installed_different : 0, installed_unknown : 0, not_installed : 0, update_available : 0 }
	let newerDownloadCount = 0

	for ( const [index, mod] of result.mods.entries() ) {
		incrementCount(counts, mod.state)
		const installState = manifestTargetInstallState(mod)
		incrementCount(installCounts, installState)
		if ( manifestMayDownloadNewerThanShared(mod) ) { newerDownloadCount++ }
		const localVersions = Array.isArray(mod.localVersions) ? mod.localVersions : []
		const localText = localVersions.length === 0 ? 'not currently stored locally' : `local: ${localVersions.join(', ')}`
		const remoteText = mod.remoteVersion === null ? `shared version: ${mod.requestedVersion ?? 'unknown'}` : `latest: ${mod.remoteVersion}`
		const node = DATA.templateEngine('manifest_line', {
			detail        : manifestStateDetail(mod),
			installDetail : manifestInstallDetail(mod),
			modName       : DATA.escapeSpecial(mod.modName),
			stateBadge    : manifestStateBadge(mod.state),
			versions      : `${DATA.escapeSpecial(remoteText)}; ${DATA.escapeSpecial(localText)}`,
			versionWarning : manifestVersionWarning(mod),
		})
		const row = node.firstElementChild
		row.dataset.index = index
		row.dataset.state = mod.state
		row.dataset.installState = installState
		if ( mod.state === 'missing' ) { row.classList.add('bg-danger-subtle', 'border-danger') }
		if ( mod.state === 'manual' ) { row.classList.add('bg-warning-subtle', 'border-warning') }
		const checkbox = node.querySelector('.manifest-select')
		checkbox.dataset.index = index
		checkbox.disabled = mod.state !== 'downloadable'
		checkbox.addEventListener('change', manifestSelectionChanged)
		const sourceButton = node.querySelector('.manifest-source-button')
		if ( isWebURL(mod.sourceURL) ) {
			sourceButton.classList.remove('d-none')
			sourceButton.addEventListener('click', () => window.manifest_IPC.openURL(mod.sourceURL))
		}
		list.appendChild(node)
	}

	MA.byIdText('manifestTitle', `${result.manifest.collection.name} - ${result.mods.length} mods`)
	MA.byIdText(
		'manifestSummary',
		manifestSummaryText(counts, installCounts, newerDownloadCount)
	)
	MA.byId('manifestPreview').classList.remove('d-none')
	initManifestTooltips(list)
	applyManifestViewFilter('all')
	setManifestSelections(false)
}

function refreshManifestTargetStatus() {
	const installCounts = { current : 0, installed_different : 0, installed_unknown : 0, not_installed : 0, update_available : 0 }
	const counts = { downloadable : 0, manual : 0, missing : 0 }
	let newerDownloadCount = 0
	for ( const row of document.querySelectorAll('.manifest-row') ) {
		const index = Number.parseInt(row.dataset.index, 10)
		const mod = manifestResolvedMods[index]
		if ( mod === undefined ) { continue }
		incrementCount(counts, mod.state)
		if ( manifestMayDownloadNewerThanShared(mod) ) { newerDownloadCount++ }
		const installState = manifestTargetInstallState(mod)
		incrementCount(installCounts, installState)
		row.dataset.installState = installState
		const detail = row.querySelector('.manifest-install-detail')
		if ( detail !== null ) { detail.innerHTML = manifestInstallDetail(mod) }
	}
	if ( manifestResolvedMods.length !== 0 ) {
		MA.byIdText(
			'manifestSummary',
			manifestSummaryText(counts, installCounts, newerDownloadCount)
		)
	}
	initManifestTooltips(MA.byId('manifestList') ?? document)
	applyManifestViewFilter(manifestViewFilter)
	manifestSelectionChanged()
}

async function loadManifestCollections() {
	const collections = await window.manifest_IPC.collectionManifestCollections()
	const select = MA.byId('manifestCollection')
	if ( select === null ) { return }
	const previousValue = select.value
	select.innerHTML = '<option value="">Choose a collection...</option>'
	for ( const collection of collections ) {
		const option = document.createElement('option')
		option.value = collection.key
		option.textContent = collection.name
		select.appendChild(option)
	}
	if ( collections.some((collection) => collection.key === previousValue) ) {
		select.value = previousValue
	}
	refreshManifestTargetStatus()
}

async function exportManifest(mode) {
	const collectionKey = selectedManifestCollectionKey()
	if ( collectionKey === '' ) {
		MA.byIdText('manifestStatus', 'Choose the collection you want to share first.')
		return
	}
	MA.byIdText('manifestStatus', 'Preparing collection manifest...')
	const result = await window.manifest_IPC.exportCollectionManifest({ collectionKey, mode })
	if ( result.ok ) {
		let detail = `Manifest saved to ${result.filePath}`
		if ( mode === 'clipboard' ) {
			detail = result.shareMode === 'drive' ?
				`Short Google Drive share link copied (${result.length.toLocaleString()} characters).` :
				`Embedded share link copied (${result.length.toLocaleString()} characters). Link Google Drive to create a much shorter link.`
			if ( typeof result.link === 'string' && result.link !== '' ) {
				MA.byIdValue('manifestImportLinkText', result.link)
			}
		}
		MA.byIdText('manifestStatus', `${detail} ${result.count} mods included.`)
	} else if ( !result.canceled ) {
		MA.byIdText('manifestStatus', `Manifest export failed: ${result.error}`)
	}
	await refreshGoogleDriveStatus()
}

async function importManifest(mode) {
	MA.byIdText('manifestStatus', 'Reading manifest and checking the latest supported sources...')
	MA.byId('manifestPreview').classList.add('d-none')
	beginManifestBusy('Reading manifest...', null)
	try {
		let result
		if ( mode === 'clipboard' ) {
			const rawText = MA.byId('manifestImportLinkText')?.value?.trim() ?? ''
			result = rawText === '' ?
				await window.manifest_IPC.importCollectionManifestClipboard() :
				await window.manifest_IPC.importCollectionManifestText(rawText)
		} else {
			result = await window.manifest_IPC.importCollectionManifestFile()
		}
		if ( result.ok ) {
			renderManifestPreview(result)
			MA.byIdText('manifestStatus', 'Manifest resolved. Review the results before installing anything.')
		} else if ( !result.canceled ) {
			MA.byIdText('manifestStatus', `Manifest import failed: ${result.error}`)
		}
	} finally {
		endManifestBusy()
	}
}

function importLinkTextKey(event) {
	if ( event.key !== 'Enter' ) { return }
	event.preventDefault()
	importManifest('clipboard')
}

async function installManifestSelection() {
	const collectionKey = selectedManifestCollectionKey()
	const downloads = [...document.querySelectorAll('.manifest-select:checked')]
		.map((checkbox) => manifestResolvedMods[Number.parseInt(checkbox.dataset.index, 10)])
	if ( collectionKey === '' || downloads.length === 0 ) { return }

	MA.byId('manifestInstall').disabled = true
	MA.byIdText('manifestStatus', `Installing ${downloads.length} selected mod(s)...`)
	beginManifestBusy(`0 / ${downloads.length}`, 0)
	try {
		const result = await window.manifest_IPC.installCollectionManifest({ collectionKey, downloads })
		setManifestBusy(`${downloads.length} / ${downloads.length}`, 100)
		if ( result.ok ) {
			const failedNames = result.results.filter((entry) => entry.ok === false).map((entry) => entry.modName)
			const failedText = result.failed === 0 ? '' : ` ${result.failed} failed: ${failedNames.join(', ')}.`
			MA.byIdText('manifestStatus', `Collection import complete: ${result.installed} installed, ${result.skipped} already current.${failedText}`)
			setManifestSelections(false)
			await loadManifestCollections()
			refreshManifestTargetStatus()
		} else {
			MA.byIdText('manifestStatus', `Collection import failed: ${result.error}`)
			manifestSelectionChanged()
		}
	} finally {
		endManifestBusy()
	}
}

async function refreshGoogleDriveStatus() {
	const status = await window.manifest_IPC.googleDriveStatus()
	const statusText = MA.byId('manifestDriveStatus')
	const linkButton = MA.byId('manifestDriveLink')
	const panelLinkButton = MA.byId('manifestDrivePanelLink')
	const edgeButton = MA.byId('manifestDriveOpenEdge')
	const disconnectButton = MA.byId('manifestDriveDisconnect')
	if ( statusText !== null ) {
		statusText.textContent = status.message
	}
	for ( const button of [linkButton, panelLinkButton] ) {
		if ( button === null ) { continue }
		button.disabled = status.linked === true || status.configured === false
		button.classList.toggle('btn-success', status.linked === true)
		button.classList.toggle('btn-outline-success', status.linked !== true)
		const label = button.querySelector('span')
		if ( label !== null ) {
			label.textContent = status.linked === true ? 'Drive linked' : 'Link Drive'
		} else {
			button.textContent = status.linked === true ? 'Google Drive linked' : 'Link Google Drive'
		}
	}
	if ( disconnectButton !== null ) {
		disconnectButton.disabled = status.linked !== true
		disconnectButton.classList.toggle('d-none', status.linked !== true)
	}
	if ( edgeButton !== null ) {
		edgeButton.disabled = googleDriveOpenURL === null || status.linked === true
		edgeButton.classList.toggle('d-none', googleDriveOpenURL === null || status.linked === true)
	}
	return status
}

async function linkGoogleDrive() {
	googleDriveOpenURL = null
	await refreshGoogleDriveStatus()
	MA.byIdText('manifestStatus', 'Opening Google Drive sign-in...')
	const result = await window.manifest_IPC.linkGoogleDrive()
	await refreshGoogleDriveStatus()
	if ( result.ok ) {
		googleDriveOpenURL = null
		await refreshGoogleDriveStatus()
		MA.byIdText('manifestStatus', result.message)
	} else {
		MA.byIdText('manifestStatus', `Google Drive link failed: ${result.error ?? result.message}`)
	}
}

function showGoogleDriveAuthURL(payload) {
	if ( typeof payload?.authURL !== 'string' || payload.authURL === '' ) { return }
	googleDriveOpenURL = payload.authURL
	MA.byIdText('manifestStatus', 'Google Drive sign-in opened in your browser. Firefox may block or break Google sign-in on some systems. If you see a Google error, click Open sign-in in Edge.')
	refreshGoogleDriveStatus()
}

function showGoogleDriveDeviceCode(payload) {
	if ( typeof payload?.userCode !== 'string' || typeof payload?.verificationURL !== 'string' ) { return }
	googleDriveOpenURL = typeof payload.openURL === 'string' && payload.openURL !== '' ? payload.openURL : payload.verificationURL
	MA.byIdText(
		'manifestStatus',
		`Google Drive code copied: ${payload.userCode}. Approve access in the browser. If Google shows an error, use Open sign-in in Edge or open ${payload.verificationURL} on your phone and enter the copied code.`
	)
	refreshGoogleDriveStatus()
}

async function openGoogleDriveInEdge() {
	if ( googleDriveOpenURL === null ) { return }
	const result = await window.manifest_IPC.openGoogleDriveInEdge(googleDriveOpenURL)
	if ( result.ok ) {
		MA.byIdText('manifestStatus', 'Google Drive sign-in opened in Edge. Complete sign-in there, then return here.')
	} else {
		MA.byIdText('manifestStatus', `Could not open Edge sign-in: ${result.error ?? 'unknown error'}`)
	}
}

async function disconnectGoogleDrive() {
	const result = await window.manifest_IPC.disconnectGoogleDrive()
	googleDriveOpenURL = null
	await refreshGoogleDriveStatus()
	MA.byIdText('manifestStatus', result.message)
}

window.addEventListener('DOMContentLoaded', () => {
	initManifestTooltips()
	MA.byIdEventIfExists('manifestMenuButton', () => window.manifest_IPC.dispatchModManagement())
	MA.byIdEventIfExists('manifestExportFile', () => exportManifest('file'))
	MA.byIdEventIfExists('manifestCopyLink', () => exportManifest('clipboard'))
	MA.byIdEventIfExists('manifestDriveLink', linkGoogleDrive)
	MA.byIdEventIfExists('manifestDrivePanelLink', linkGoogleDrive)
	MA.byIdEventIfExists('manifestDriveOpenEdge', openGoogleDriveInEdge)
	MA.byIdEventIfExists('manifestDriveDisconnect', disconnectGoogleDrive)
	window.manifest_IPC.receive('manifest:driveAuthURL', showGoogleDriveAuthURL)
	window.manifest_IPC.receive('manifest:driveDeviceCode', showGoogleDriveDeviceCode)
	MA.byIdEventIfExists('manifestImportFile', () => importManifest('file'))
	MA.byIdEventIfExists('manifestImportLink', () => importManifest('clipboard'))
	MA.byIdEventIfExists('manifestImportLinkTextButton', () => importManifest('clipboard'))
	MA.byIdEventIfExists('manifestImportLinkText', importLinkTextKey, 'keydown')
	MA.byIdEventIfExists('manifestSelectAll', () => setManifestSelections(true))
	MA.byIdEventIfExists('manifestSelectNone', () => setManifestSelections(false))
	MA.byIdEventIfExists('manifestShowAll', () => applyManifestViewFilter('all'))
	MA.byIdEventIfExists('manifestShowAttention', () => applyManifestViewFilter('attention'))
	MA.byIdEventIfExists('manifestShowDownloadable', () => applyManifestViewFilter('downloadable'))
	MA.byIdEventIfExists('manifestShowNeedsUpdate', () => applyManifestViewFilter('needsUpdate'))
	MA.byIdEventIfExists('manifestShowCurrent', () => applyManifestViewFilter('current'))
	MA.byIdEventIfExists('manifestInstall', installManifestSelection)
	MA.byIdEventIfExists('manifestCollection', refreshManifestTargetStatus, 'change')
	loadManifestCollections()
	refreshGoogleDriveStatus()
})
