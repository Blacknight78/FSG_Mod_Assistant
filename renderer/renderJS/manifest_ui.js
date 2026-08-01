/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: COLLECTION MANIFEST UI

/* global DATA, MA */

let manifestResolvedMods = []
let manifestViewFilter = 'all'
let manifestBusyDepth = 0

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

function manifestStateBadge(state) {
	if ( state === 'downloadable' ) { return '<span class="badge text-bg-success">Latest ZIP available</span>' }
	if ( state === 'manual' ) { return '<span class="badge text-bg-warning">Manual download required</span>' }
	return '<span class="badge text-bg-danger">Source missing</span>'
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
	if ( installState === 'current' ) { return '<span class="badge text-bg-success">Already current</span>' }
	if ( installState === 'update_available' ) { return '<span class="badge text-bg-info">Update needed</span>' }
	if ( installState === 'not_installed' ) { return '<span class="badge text-bg-danger">Not installed</span>' }
	if ( installState === 'installed_different' ) { return '<span class="badge text-bg-warning">Different installed version</span>' }
	return '<span class="badge text-bg-secondary">Installed version unknown</span>'
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

function renderManifestPreview(result) {
	manifestResolvedMods = result.mods
	const list = MA.byId('manifestList')
	list.innerHTML = ''
	const counts = { downloadable : 0, manual : 0, missing : 0 }
	const installCounts = { current : 0, installed_different : 0, installed_unknown : 0, not_installed : 0, update_available : 0 }

	for ( const [index, mod] of result.mods.entries() ) {
		incrementCount(counts, mod.state)
		const installState = manifestTargetInstallState(mod)
		incrementCount(installCounts, installState)
		const localVersions = Array.isArray(mod.localVersions) ? mod.localVersions : []
		const localText = localVersions.length === 0 ? 'not currently stored locally' : `local: ${localVersions.join(', ')}`
		const remoteText = mod.remoteVersion === null ? `shared version: ${mod.requestedVersion ?? 'unknown'}` : `latest: ${mod.remoteVersion}`
		const node = DATA.templateEngine('manifest_line', {
			detail        : manifestStateDetail(mod),
			installDetail : manifestInstallDetail(mod),
			modName       : DATA.escapeSpecial(mod.modName),
			stateBadge    : manifestStateBadge(mod.state),
			versions      : `${DATA.escapeSpecial(remoteText)}; ${DATA.escapeSpecial(localText)}`,
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
		`${counts.downloadable} downloadable, ${counts.manual} manual, ${counts.missing} missing. ${installCounts.current} current, ${installCounts.update_available} update needed, ${installCounts.not_installed} not installed in ${manifestTargetCollectionName()}.`
	)
	MA.byId('manifestPreview').classList.remove('d-none')
	applyManifestViewFilter('all')
	setManifestSelections(false)
}

function refreshManifestTargetStatus() {
	const installCounts = { current : 0, installed_different : 0, installed_unknown : 0, not_installed : 0, update_available : 0 }
	const counts = { downloadable : 0, manual : 0, missing : 0 }
	for ( const row of document.querySelectorAll('.manifest-row') ) {
		const index = Number.parseInt(row.dataset.index, 10)
		const mod = manifestResolvedMods[index]
		if ( mod === undefined ) { continue }
		incrementCount(counts, mod.state)
		const installState = manifestTargetInstallState(mod)
		incrementCount(installCounts, installState)
		row.dataset.installState = installState
		const detail = row.querySelector('.manifest-install-detail')
		if ( detail !== null ) { detail.innerHTML = manifestInstallDetail(mod) }
	}
	if ( manifestResolvedMods.length !== 0 ) {
		MA.byIdText(
			'manifestSummary',
			`${counts.downloadable} downloadable, ${counts.manual} manual, ${counts.missing} missing. ${installCounts.current} current, ${installCounts.update_available} update needed, ${installCounts.not_installed} not installed in ${manifestTargetCollectionName()}.`
		)
	}
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
		const detail = mode === 'clipboard' ? `Share link copied (${result.length.toLocaleString()} characters).` : `Manifest saved to ${result.filePath}`
		MA.byIdText('manifestStatus', `${detail} ${result.count} mods included.`)
	} else if ( !result.canceled ) {
		MA.byIdText('manifestStatus', `Manifest export failed: ${result.error}`)
	}
}

async function importManifest(mode) {
	MA.byIdText('manifestStatus', 'Reading manifest and checking the latest supported sources...')
	MA.byId('manifestPreview').classList.add('d-none')
	beginManifestBusy('Reading manifest...', null)
	try {
		const result = mode === 'clipboard' ?
			await window.manifest_IPC.importCollectionManifestClipboard() :
			await window.manifest_IPC.importCollectionManifestFile()
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

window.addEventListener('DOMContentLoaded', () => {
	MA.byIdEventIfExists('manifestMenuButton', () => window.manifest_IPC.dispatchModManagement())
	MA.byIdEventIfExists('manifestExportFile', () => exportManifest('file'))
	MA.byIdEventIfExists('manifestCopyLink', () => exportManifest('clipboard'))
	MA.byIdEventIfExists('manifestImportFile', () => importManifest('file'))
	MA.byIdEventIfExists('manifestImportLink', () => importManifest('clipboard'))
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
})
