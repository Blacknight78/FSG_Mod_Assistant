/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Main Window UI

/* global MA, DATA, I18N, bootstrap*/

// eslint-disable-next-line no-unused-vars
class StateManager {
	selectClass     = 'bg-mod-selected'
	malwareSkip     = []
	malwareSuppress = []

	flag = {
		activeCollect  : null,
		currentLocale  : 'en',
		currentVersion : 22,
		debugMode      : false,
		folderDirty    : false,
		folderEdit     : false,
		gameRunning    : false,
		launchEnable   : false,
		miniMode       : false,
		updateReady    : false,
		versionTool    : false,
	}
	track = {
		altClick       : null,
		disabledOnly   : false,
		filter_must    : new Set(),
		filter_must_any : false,
		filter_not     : new Set(),
		lastID         : null,
		lastIndex      : null,
		lastPayload    : null,
		newFolder      : null,
		openCollection : null,
		pendingLaunchCollection : null,
		pendingSearchFocus : false,
		scrollPosition : 0,
		searchString   : '',
		searchType     : 'find_all',
		selected       : new Set(),
		selectedOnly   : false,
		sortOrder      : 'sort_name',
	}
	orderMap = { keys : [], keyToNum : {}, max : 0, numToKey : {} }

	collections = {}
	mods        = {}
	verList     = {}
	extSites    = {}
	updateCheckCache = new Map()
	rollbackCheckCache = new Map()
	backgroundDisplayRefreshTimer = null
	scrollJankLastFrame = null
	scrollJankLastLog = 0
	scrollJankLastScroll = 0
	scrollJankLastScrollEvent = 0
	scrollJankLastScrollModeLog = 0
	scrollJankLastScrollTop = 0
	scrollJankLastWheel = 0
	scrollJankLastWheelDelta = 0
	scrollJankLastWheelLatencyLog = 0
	scrollJankPendingWheel = false
	scrollJankScrollEndTimer = null
	userActivityLastSent = 0
	displayLastAt = 0
	modIconObserver = null
	modIconLoadQueue = []
	modIconLoadTimer = null
	dataRevision = 0
	lastDisplaySignature = ''
	lastDisplayAt = 0
	virtualModList = {
		active        : false,
		bufferRows    : 36,
		collectionKey : null,
		lastLog       : 0,
		prewarmIndex  : 0,
		prewarmTimer  : null,
		renderedEnd   : -1,
		renderedStart : -1,
		rerenderMargin : 12,
		rowHeight     : 88,
		rowIDs        : [],
		scheduled     : false,
		table         : null,
	}

	loader = null

	modal = {
		disabled  : null,
		gameLogIssues : null,
		mismatch  : null,
		modInfo   : null,
		readiness : null,
	}
	disabledMods = {
		collectionKey : null,
		entries       : [],
	}
	gameLogIssues = {
		candidates    : [],
		collectionKey : null,
	}

	searchTagList = new Set()

	mapCollectionDropdown = new Map()
	mapCollectionFiles    = new Map()

	// MARK: constructor
	constructor() {
		this.dragDrop = new DragDropLib()
		this.loader   = new LoaderLib()
		this.files    = new FileLib()
		this.prefs    = new PrefLib()
		this.modal.disabled = new ModalOverlay('#disabled_mods_modal')
		this.modal.gameLogIssues = new ModalOverlay('#game_log_issues_modal')
		this.modal.mismatch = new ModalOverlay('#open_game_modal')
		this.modal.modInfo  = new ModalOverlay('#open_mod_info_modal')
		this.modal.readiness = new ModalOverlay('#collection_readiness_modal')

		window.main_IPC.receive('status:all', () => this.updateState() )
		window.main_IPC.receive('files:deleteTrigger', () => {
			if ( this.track.selected.size !== 0 ) {
				this.startFile('delete')
			} else if ( this.track.openCollection !== null ) {
				window.main_IPC.folder.remove(this.track.openCollection)
			}
		})
		this.#startScrollJankMonitor()
	}

	#updateTracking(data) {
		const lastColSet = this.track.lastPayload?.set_Collections || null

		if ( lastColSet !== null ) {
			const newFolderSet = data.set_Collections.difference(lastColSet)
			if ( newFolderSet.size === 1 ) {
				this.track.newFolder = [...newFolderSet][0]
			} else {
				this.track.newFolder = null
			}
		} else {
			this.track.newFolder = null
		}

		this.track.lastPayload   = data
		this.flag.activeCollect  = data.opts.activeCollection
		this.flag.currentLocale  = data.opts.currentLocale
		this.flag.currentVersion = data.appSettings.game_version
		this.flag.debugMode      = data.opts.isDev
		this.flag.folderDirty    = data.opts.foldersDirty
		this.flag.folderEdit     = data.opts.foldersEdit
		this.flag.gameRunning    = data.opts.gameRunning
		this.flag.launchEnable   = data.opts.gameRunningEnable
		this.flag.miniMode       = data.opts.showMini
		this.flag.updateReady    = data.updateReady
		this.flag.versionTool    = false

		this.extSites            = data.opts.modSites
		this.malwareSkip         = data.dangerModsSkip
		this.malwareSuppress     = data.appSettings.suppress_malware

		this.searchTagList       = new Set()
		this.collections         = {}
		this.mods                = {}
		this.orderMap            = { keys : [], keyToNum : {}, max : 0, numToKey : {} }
		this.rollbackCheckCache.clear()

		this.mapCollectionFiles    = new Map()
		this.mapCollectionDropdown = new Map()
		this.mapCollectionDropdown.set(0, `--${data.opts.l10n.disable}--`)
	}

	#collectionName(collectionKey) {
		return this.mapCollectionDropdown.get(collectionKey) ?? collectionKey ?? '--'
	}

	#readinessShortList(items, limit = 8) {
		const safeItems = items.filter((item) => typeof item === 'string' && item !== '')
		const visible = safeItems.slice(0, limit)
		const hiddenCount = safeItems.length - visible.length
		return hiddenCount > 0 ? [...visible, `and ${hiddenCount} more`] : visible
	}

	#addReadinessIssue(issues, key, label, detail, severity = 'warning', examples = []) {
		if ( examples.length === 0 ) { return }
		issues.push({
			detail,
			examples : this.#readinessShortList([...new Set(examples)]),
			key,
			label,
			severity,
			total : examples.length,
		})
	}

	#collectionReadinessMods(collectionKey) {
		const collection = this.track.lastPayload?.modList?.[collectionKey]
		if ( typeof collection?.mods !== 'object' ) { return [] }
		return Object.values(collection.mods).filter((modRecord) => {
			const fileDetail = modRecord?.fileDetail ?? {}
			if ( fileDetail.isFolder === true || fileDetail.isSaveGame === true ) { return false }
			return typeof fileDetail.fullPath === 'string' && fileDetail.fullPath.toLowerCase().endsWith('.zip')
		})
	}

	#missingDependenciesForMod(collection, modRecord) {
		if ( !Array.isArray(modRecord.modDesc?.depend) || modRecord.modDesc.depend.length === 0 ) { return [] }
		return modRecord.modDesc.depend.filter((dependency) => !collection.dependSet.has(dependency))
	}

	#collectionReadinessMissingDependencyItems(collectionKey, mods) {
		const collection = this.track.lastPayload?.modList?.[collectionKey]
		const items = []
		if ( typeof collection?.dependSet !== 'object' ) { return items }
		for ( const modRecord of mods ) {
			const missing = this.#missingDependenciesForMod(collection, modRecord)
			if ( missing.length === 0 ) { continue }
			items.push({
				example   : `${modRecord.fileDetail.shortName} needs ${missing.join(', ')}`,
				missing,
				modID     : modRecord.colUUID,
				modName   : modRecord.fileDetail.shortName,
			})
		}
		return items
	}

	#collectionReadinessDuplicateVersions(mods) {
		const versionsByMod = new Map()
		for ( const modRecord of mods ) {
			const shortName = modRecord.fileDetail?.shortName
			if ( typeof shortName !== 'string' || shortName === '' ) { continue }
			if ( !versionsByMod.has(shortName) ) { versionsByMod.set(shortName, new Set()) }
			versionsByMod.get(shortName).add(modRecord.modDesc?.version ?? '--')
		}
		return [...versionsByMod.entries()]
			.filter(([, versions]) => versions.size > 1)
			.map(([shortName, versions]) => `${shortName} (${[...versions].join(', ')})`)
	}

	#collectionReadinessUpdateExamples(collectionKey, mods) {
		return mods
			.filter((modRecord) => {
				const modRec = this.mods?.[collectionKey]?.[modRecord.uuid]
				return modRecord.badgeArray?.includes('update') || modRec?.updateCheck?.hasGitHubUpdate === true
			})
			.map((modRecord) => modRecord.fileDetail.shortName)
	}

	#collectionReadinessMetadataExamples(mods) {
		const problemBadges = new Set(['broken', 'fs0', 'malware', 'notmod', 'problem'])
		return mods
			.filter((modRecord) => {
				const badges = modRecord.badgeArray ?? []
				const hasProblemBadge = badges.some((badge) => problemBadges.has(badge))
				const missingCoreMetadata = typeof modRecord.modDesc?.version !== 'string' ||
					modRecord.modDesc.version.trim() === '' ||
					Number.isNaN(Number.parseInt(modRecord.modDesc?.descVersion, 10))
				return modRecord.canNotUse === true || hasProblemBadge || missingCoreMetadata
			})
			.map((modRecord) => modRecord.fileDetail.shortName)
	}

	#collectionReadinessVersionMismatchExamples(mods) {
		return mods
			.filter((modRecord) => Number.isInteger(modRecord.gameVersion) &&
				modRecord.gameVersion !== 0 &&
				modRecord.gameVersion !== this.flag.currentVersion)
			.map((modRecord) => `${modRecord.fileDetail.shortName} is FS${modRecord.gameVersion}`)
	}

	#collectionReadinessIssues(collectionKey) {
		const collection = this.track.lastPayload?.modList?.[collectionKey]
		if ( typeof collection?.mods !== 'object' ) {
			return [{
				detail   : 'The selected collection is not currently loaded.',
				examples : [],
				key      : 'missing-collection',
				label    : 'Collection not loaded',
				severity : 'danger',
				total    : 1,
			}]
		}

		const mods = this.#collectionReadinessMods(collectionKey)
		const issues = []
		const missingDependencyItems = this.#collectionReadinessMissingDependencyItems(collectionKey, mods)
		const missingDependencies = missingDependencyItems.map((item) => item.example)

		this.#addReadinessIssue(issues, 'missing-dependencies', 'Missing dependencies', 'Required mods are not present in this collection.', 'danger', missingDependencies)
		this.#addReadinessIssue(issues, 'duplicate-versions', 'Duplicate versions', 'The same mod appears with more than one version.', 'warning', this.#collectionReadinessDuplicateVersions(mods))
		this.#addReadinessIssue(issues, 'fs-mismatch', 'FS version mismatch', `Mods do not match the active FS${this.flag.currentVersion} game version.`, 'danger', this.#collectionReadinessVersionMismatchExamples(mods))
		this.#addReadinessIssue(issues, 'updates', 'Update available', 'One or more mods has a newer ModHub or saved GitHub version.', 'info', this.#collectionReadinessUpdateExamples(collectionKey, mods))
		this.#addReadinessIssue(issues, 'metadata', 'Suspicious or broken metadata', 'These mods have broken, unreadable, unsupported, or incomplete metadata.', 'warning', this.#collectionReadinessMetadataExamples(mods))

		return issues
	}

	#renderReadinessIssues(collectionKey, issues) {
		const list = MA.byId('collectionReadinessIssues')
		list.innerHTML = ''
		MA.byIdText('collectionReadinessCollection', this.#collectionName(collectionKey))
		MA.byIdText('collectionReadinessSummary', `${issues.reduce((sum, issue) => sum + issue.total, 0)} warning item${issues.length === 1 ? '' : 's'} found before launch.`)
		MA.byId('collectionReadinessSelectMissingDependencies').clsShow(this.#collectionReadinessMissingDependencyItems(collectionKey, this.#collectionReadinessMods(collectionKey)).length !== 0)

		for ( const issue of issues ) {
			const node = document.createElement('div')
			node.className = `list-group-item border-${issue.severity}`
			const examples = issue.examples.length === 0 ?
				'' :
				`<ul class="mb-0 mt-1 small">${issue.examples.map((item) => `<li>${DATA.escapeSpecial(item)}</li>`).join('')}</ul>`
			node.innerHTML = [
				'<div class="d-flex justify-content-between gap-2">',
				`<div class="fw-bold">${DATA.escapeSpecial(issue.label)}</div>`,
				`<span class="badge text-bg-${issue.severity}">${issue.total}</span>`,
				'</div>',
				`<div class="small text-body-secondary">${DATA.escapeSpecial(issue.detail)}</div>`,
				examples,
			].join('')
			list.appendChild(node)
		}
	}

	#dispatchGameLaunch() {
		LEDLib.spinLED()
		window.main_IPC.dispatch('game')
	}

	#selectedCollectionKey() {
		if ( this.track.openCollection !== null ) { return this.track.openCollection }
		const selected = MA.byIdValue('collectionSelect')?.replace('collection--', '') ?? ''
		return selected !== '' && selected !== '0' && selected !== '999' ? selected : null
	}

	#selectedGameLogIssueModIDs() {
		return [...document.querySelectorAll('.game-log-issue-select:checked')].map((checkbox) => checkbox.value)
	}

	#selectModIDsInCollection(collectionKey, modIDs) {
		if ( collectionKey === null || modIDs.length === 0 ) { return }
		if ( this.track.openCollection !== collectionKey ) {
			this.colToggle(collectionKey, true)
		}
		this.track.selected = new Set(modIDs)
		this.forceSelectOnly(true)
		this.doDisplay('selectModIDsInCollection')
		this.colScroll(collectionKey)
	}

	#renderGameLogIssues(result) {
		this.gameLogIssues.candidates = result.candidates ?? []
		MA.byIdText('gameLogIssuesCollection', result.collectionName ?? this.#collectionName(this.gameLogIssues.collectionKey))
		MA.byIdText('gameLogIssuesPath', result.logPath ?? '--')
		MA.byIdText('gameLogIssuesStatus', result.status ?? 'Game log scan completed.')

		const list = MA.byId('gameLogIssuesList')
		list.innerHTML = ''
		for ( const candidate of this.gameLogIssues.candidates ) {
			const node = document.createElement('label')
			node.className = `list-group-item border-${candidate.severity === 'danger' ? 'danger' : 'warning'}`
			const reasons = (candidate.lines ?? []).map((entry) => [
				'<li>',
				`<span class="badge text-bg-${entry.severity === 'danger' ? 'danger' : 'warning'} me-2">${DATA.escapeSpecial(entry.confidence)}</span>`,
				`<span class="text-body-secondary">Line ${DATA.escapeSpecial(entry.lineNumber)}:</span> `,
				DATA.escapeSpecial(entry.line),
				'</li>',
			].join('')).join('')
			node.innerHTML = [
				'<div class="d-flex gap-3 align-items-start">',
				`<input class="form-check-input game-log-issue-select mt-1" type="checkbox" value="${DATA.escapeSpecial(candidate.modID)}">`,
				'<div class="flex-grow-1">',
				'<div class="d-flex justify-content-between gap-2">',
				`<div class="fw-bold">${DATA.escapeSpecial(candidate.modName)}</div>`,
				`<span class="badge text-bg-${candidate.severity === 'danger' ? 'danger' : 'warning'}">score ${DATA.escapeSpecial(candidate.score)}</span>`,
				'</div>',
				`<div class="small text-body-secondary">${DATA.escapeSpecial(candidate.fileName)}</div>`,
				`<ul class="mb-0 mt-2 small">${reasons}</ul>`,
				'</div>',
				'</div>',
			].join('')
			list.append(node)
		}
		MA.byId('gameLogIssuesSelect').disabled = this.gameLogIssues.candidates.length === 0
		MA.byId('gameLogIssuesDisable').disabled = this.gameLogIssues.candidates.length === 0
	}

	async #openGameLogIssues(collectionKey) {
		if ( collectionKey === null ) { return }
		this.gameLogIssues.collectionKey = collectionKey
		MA.byIdText('gameLogIssuesCollection', this.#collectionName(collectionKey))
		MA.byIdText('gameLogIssuesPath', '--')
		MA.byIdText('gameLogIssuesStatus', 'Scanning game log...')
		MA.byIdHTML('gameLogIssuesList', '')
		MA.byId('gameLogIssuesSelect').disabled = true
		MA.byId('gameLogIssuesDisable').disabled = true
		this.modal.gameLogIssues.show()
		try {
			const result = await window.main_IPC.gameLog.scanCollection(collectionKey)
			this.#renderGameLogIssues(result)
		} catch (err) {
			MA.byIdText('gameLogIssuesStatus', `Game log scan failed: ${err.message}`)
		}
	}

	#renderDisabledMods(result) {
		this.disabledMods.entries = result.entries ?? []
		MA.byIdText('disabledModsCollection', result.collectionName ?? this.#collectionName(this.disabledMods.collectionKey))
		MA.byIdText(
			'disabledModsStatus',
			this.disabledMods.entries.length === 0 ?
				'No disabled ZIP mods were found for this collection.' :
				`${this.disabledMods.entries.length} disabled ZIP mod(s) found.`
		)

		const list = MA.byId('disabledModsList')
		list.innerHTML = ''
		for ( const entry of this.disabledMods.entries ) {
			const node = document.createElement('label')
			node.className = 'list-group-item d-flex gap-3 align-items-center'
			node.innerHTML = [
				`<input class="form-check-input disabled-mod-select" type="checkbox" value="${DATA.escapeSpecial(entry.fileName)}">`,
				'<div class="flex-grow-1">',
				`<div class="fw-bold">${DATA.escapeSpecial(entry.modName)}</div>`,
				`<div class="small text-body-secondary">${DATA.escapeSpecial(entry.fileName)}</div>`,
				'</div>',
				`<div class="small text-body-secondary text-end">${this.#bytesToHR(entry.size)}<br>${DATA.dateToString(entry.modified)}</div>`,
			].join('')
			list.append(node)
		}
		MA.byId('disabledModsRestoreSelected').disabled = this.disabledMods.entries.length === 0
	}

	async #openDisabledMods(collectionKey) {
		if ( collectionKey === null ) { return }
		this.disabledMods.collectionKey = collectionKey
		MA.byIdText('disabledModsCollection', this.#collectionName(collectionKey))
		MA.byIdText('disabledModsStatus', 'Loading disabled mods...')
		MA.byIdHTML('disabledModsList', '')
		MA.byId('disabledModsRestoreSelected').disabled = true
		this.modal.disabled.show()
		try {
			const result = await window.main_IPC.files.disabledList(collectionKey)
			this.#renderDisabledMods(result)
		} catch (err) {
			MA.byIdText('disabledModsStatus', `Could not load disabled mods: ${err.message}`)
		}
	}

	#launchWithReadiness(collectionKey) {
		const issues = this.#collectionReadinessIssues(collectionKey)
		if ( issues.length === 0 ) {
			this.#dispatchGameLaunch()
			return
		}
		this.track.pendingLaunchCollection = collectionKey
		this.#renderReadinessIssues(collectionKey, issues)
		LEDLib.fastBlinkLED()
		this.modal.readiness.show()
	}
	doL10N(item, lowerCase = false) {
		let returnText = item?.[this.track.currentLocale]
		returnText ??= item?.en
		returnText ??= item?.de
		returnText ??= '--'
		return lowerCase ? DATA.escapeSpecial(returnText).toLowerCase() : DATA.escapeSpecial(returnText)
	}

	emptySort(text) {
		return text || 'ZZZZ'
	}

	#logPerformance(label, startedAt, extraDetail = '') {
		const detailText = extraDetail === '' ? '' : ` ${extraDetail}`
		window.main_IPC.performance(`${label} took ${(performance.now() - startedAt).toFixed(1)} ms${detailText}`)
	}

	#logInstantPerformance(label, extraDetail = '') {
		const detailText = extraDetail === '' ? '' : ` ${extraDetail}`
		window.main_IPC.performance(`${label}${detailText}`)
	}

	#markUserActivity(reason) {
		const now = performance.now()
		if ( now - this.userActivityLastSent < 750 ) { return }
		this.userActivityLastSent = now
		window.main_IPC.userActivity(reason)
	}

	#startScrollJankMonitor() {
		const frameLimitMS = 120
		const logThrottleMS = 2000
		const scrollingNode = MA.byId('mod-collections')?.parentElement

		scrollingNode?.addEventListener('wheel', (event) => {
			this.scrollJankLastWheel = performance.now()
			this.scrollJankLastWheelDelta = event.deltaY
			this.scrollJankPendingWheel = true
			this.#markUserActivity('main-list-wheel')
		}, { passive : true })

		scrollingNode?.addEventListener('scroll', () => {
			const now = performance.now()
			this.#markUserActivity('main-list-scroll')
			const wheelLatency = this.scrollJankPendingWheel ? now - this.scrollJankLastWheel : 0
			const lastScrollAt = this.scrollJankLastScroll
			const lastScrollTop = this.scrollJankLastScrollTop
			const scrollDelta = Math.abs(scrollingNode.scrollTop - lastScrollTop)
			const scrollDeltaTime = lastScrollAt === 0 ? 0 : now - lastScrollAt
			const scrollSpeed = scrollDeltaTime <= 0 ? 0 : scrollDelta / scrollDeltaTime
			const fastScroll = scrollDelta > 1800 || scrollSpeed > 12 || Math.abs(this.scrollJankLastWheelDelta) > 2400
			this.scrollJankLastScroll = now
			this.scrollJankLastScrollEvent = now
			this.scrollJankLastScrollTop = scrollingNode.scrollTop
			this.scrollJankPendingWheel = false
			scrollingNode.classList.toggle('main-list-scrolling', fastScroll)
			if ( this.scrollJankScrollEndTimer !== null ) { clearTimeout(this.scrollJankScrollEndTimer) }
			this.scrollJankScrollEndTimer = setTimeout(() => {
				scrollingNode.classList.remove('main-list-scrolling')
				this.scrollJankScrollEndTimer = null
				this.#observeVisibleModIcons(scrollingNode)
			}, 180)
			if ( fastScroll && now - this.scrollJankLastScrollModeLog > 1000 ) {
				this.scrollJankLastScrollModeLog = now
				this.#logInstantPerformance('Main renderer fast scroll mode', [
					`delta=${scrollDelta.toFixed(0)}`,
					`speed=${scrollSpeed.toFixed(2)} px/ms`,
					`wheelDelta=${this.scrollJankLastWheelDelta.toFixed(1)}`,
					`displayedRows=${scrollingNode.querySelectorAll('.mod-row').length.toString()}`,
					`scrollTop=${scrollingNode.scrollTop.toFixed(0)}`,
				].join(' '))
			}
			if ( wheelLatency > 80 && now - this.scrollJankLastWheelLatencyLog > 1000 ) {
				this.scrollJankLastWheelLatencyLog = now
				this.#logInstantPerformance('Main renderer wheel scroll latency', [
					`latency=${wheelLatency.toFixed(1)} ms`,
					`deltaY=${this.scrollJankLastWheelDelta.toFixed(1)}`,
					`openCollection=${JSON.stringify(this.track.openCollection)}`,
					`displayedRows=${scrollingNode.querySelectorAll('.mod-row').length.toString()}`,
					`scrollTop=${scrollingNode.scrollTop.toFixed(0)}`,
				].join(' '))
			}
			this.#scheduleVirtualModRender()
		}, { passive : true })

		const monitor = (now) => {
			if ( this.scrollJankLastFrame !== null ) {
				const gap = now - this.scrollJankLastFrame
				const recentScroll = now - this.scrollJankLastScroll < 2000
				const recentDisplay = now - this.displayLastAt < 500
				if (
					gap > frameLimitMS &&
					scrollingNode !== null &&
					document.visibilityState === 'visible' &&
					(recentScroll || recentDisplay) &&
					now - this.scrollJankLastLog > logThrottleMS
				) {
					this.scrollJankLastLog = now
					this.#logInstantPerformance('Main renderer frame delay', [
						`gap=${gap.toFixed(1)} ms`,
						`openCollection=${JSON.stringify(this.track.openCollection)}`,
						`displayedRows=${scrollingNode.querySelectorAll('.mod-row').length.toString()}`,
						`scrollTop=${scrollingNode.scrollTop.toFixed(0)}`,
						`lastScrollTop=${this.scrollJankLastScrollTop.toFixed(0)}`,
						`recentScroll=${recentScroll ? 'true' : 'false'}`,
						`recentDisplay=${recentDisplay ? 'true' : 'false'}`,
					].join(' '))
				}
			}
			this.scrollJankLastFrame = now
			window.requestAnimationFrame(monitor)
		}
		window.requestAnimationFrame(monitor)
	}

	#lazyModIconHTML(iconImage) {
		const source = DATA.escapeSpecial(DATA.iconMaker(iconImage))
		return `<img alt="" class="main-mod-icon" decoding="async" fetchpriority="low" height="64" loading="lazy" src="${source}" width="64">`
	}

	#ensureModIconObserver() {
		if ( this.modIconObserver !== null ) { return this.modIconObserver }
		if ( typeof IntersectionObserver === 'undefined' ) { return null }

		this.modIconObserver = new IntersectionObserver((entries) => {
			for ( const entry of entries ) {
				if ( !entry.isIntersecting ) { continue }
				const image = entry.target
				this.modIconLoadQueue.push(image)
				this.#scheduleModIconLoads()
				this.modIconObserver.unobserve(image)
			}
		}, {
			root       : MA.byId('mod-collections')?.parentElement ?? null,
			rootMargin : '120px 0px',
			threshold  : 0.01,
		})
		return this.modIconObserver
	}

	#scheduleModIconLoads() {
		if ( this.modIconLoadTimer !== null ) { return }

		const loadBatch = () => {
			this.modIconLoadTimer = null
			if ( performance.now() - this.scrollJankLastScroll < 220 ) {
				this.modIconLoadTimer = setTimeout(loadBatch, 220)
				return
			}
			let loaded = 0
			while ( this.modIconLoadQueue.length !== 0 && loaded < 4 ) {
				const image = this.modIconLoadQueue.shift()
				if ( image?.isConnected !== true ) { continue }
				const source = image.dataset.src
				if ( typeof source !== 'string' || source === '' ) { continue }
				image.src = source
				delete image.dataset.src
				image.classList.remove('main-mod-icon-lazy')
				loaded++
			}
			if ( this.modIconLoadQueue.length !== 0 ) {
				this.modIconLoadTimer = setTimeout(loadBatch, 80)
			}
		}

		this.modIconLoadTimer = setTimeout(loadBatch, 120)
	}

	#observeVisibleModIcons(rootNode) {
		const icons = rootNode.querySelectorAll('img.main-mod-icon-lazy[data-src]')
		if ( icons.length === 0 ) { return }

		const observer = this.#ensureModIconObserver()
		if ( observer === null ) {
			for ( const image of icons ) {
				image.src = image.dataset.src
				delete image.dataset.src
				image.classList.remove('main-mod-icon-lazy')
			}
			return
		}

		for ( const image of icons ) { observer.observe(image) }
	}

	#makeVirtualSpacer(height) {
		const spacer = document.createElement('tr')
		spacer.classList.add('main-virtual-spacer')
		spacer.setAttribute('aria-hidden', 'true')
		spacer.innerHTML = `<td colspan="4" style="height: ${Math.max(0, height).toFixed(0)}px; padding: 0; border: 0;"></td>`
		return spacer
	}

	#scheduleVirtualModRender() {
		if ( !this.virtualModList.active || this.virtualModList.scheduled ) { return }
		this.virtualModList.scheduled = true
		requestAnimationFrame(() => {
			this.virtualModList.scheduled = false
			this.#renderVirtualModRows(false)
		})
	}

	#appendVirtualModRow(frag, rowID, rowIndex) {
		const [CKey, MKey] = rowID.split('--')
		const modRec = this.mods[CKey]?.[MKey]
		if ( modRec === undefined ) { return }
		this.#ensureModRowNode(modRec)
		modRec.node.dataset.rowIndex = rowIndex.toString()
		modRec.node.classList.toggle(this.selectClass, this.track.selected.has(rowID))
		frag.appendChild(modRec.node)
	}

	#renderStaticModRows(table, rowIDs) {
		const frag = document.createDocumentFragment()
		for ( const [rowIndex, rowID] of rowIDs.entries() ) {
			this.#appendVirtualModRow(frag, rowID, rowIndex)
		}
		table.replaceChildren(frag)
	}

	#renderVirtualModRows(force = false) {
		const renderStartedAt = performance.now()
		const table = this.virtualModList.table
		const rowIDs = this.virtualModList.rowIDs
		const scrollParent = MA.byId('mod-collections')?.parentElement ?? null
		if ( table === null || scrollParent === null ) { return }

		const visibleStart = Math.max(0, Math.floor(scrollParent.scrollTop / this.virtualModList.rowHeight))
		const visibleEnd = Math.min(rowIDs.length, visibleStart + Math.ceil(scrollParent.clientHeight / this.virtualModList.rowHeight) + 1)
		if (
			!force &&
			visibleStart >= this.virtualModList.renderedStart + this.virtualModList.rerenderMargin &&
			visibleEnd <= this.virtualModList.renderedEnd - this.virtualModList.rerenderMargin
		) {
			return
		}

		const start = Math.max(0, visibleStart - this.virtualModList.bufferRows)
		const end = Math.min(rowIDs.length, visibleEnd + this.virtualModList.bufferRows)
		if ( !force && start === this.virtualModList.renderedStart && end === this.virtualModList.renderedEnd ) { return }

		const frag = document.createDocumentFragment()
		const topHeight = start * this.virtualModList.rowHeight
		const bottomHeight = (rowIDs.length - end) * this.virtualModList.rowHeight
		if ( topHeight > 0 ) { frag.appendChild(this.#makeVirtualSpacer(topHeight)) }
		for ( let i = start; i < end; i++ ) { this.#appendVirtualModRow(frag, rowIDs[i], i) }
		if ( bottomHeight > 0 ) { frag.appendChild(this.#makeVirtualSpacer(bottomHeight)) }

		table.replaceChildren(frag)
		this.virtualModList.renderedStart = start
		this.virtualModList.renderedEnd = end

		const firstRow = table.querySelector('.mod-row')
		if ( firstRow !== null ) {
			const measuredHeight = firstRow.getBoundingClientRect().height
			if ( measuredHeight > 20 ) { this.virtualModList.rowHeight = measuredHeight }
		}
		this.#observeVisibleModIcons(table)
		const renderMS = performance.now() - renderStartedAt
		if ( renderMS > 24 && performance.now() - this.virtualModList.lastLog > 1000 ) {
			this.virtualModList.lastLog = performance.now()
			this.#logPerformance('Main renderer virtual rows', renderStartedAt, [
				`visible=${visibleStart.toString()}-${visibleEnd.toString()}`,
				`rendered=${start.toString()}-${end.toString()}`,
				`rows=${(end - start).toString()}`,
				`scrollTop=${scrollParent.scrollTop.toFixed(0)}`,
			].join(' '))
		}
	}

	#stopVirtualPrewarm() {
		if ( this.virtualModList.prewarmTimer === null ) { return }
		if ( typeof cancelIdleCallback === 'function' ) {
			cancelIdleCallback(this.virtualModList.prewarmTimer)
		} else {
			clearTimeout(this.virtualModList.prewarmTimer)
		}
		this.virtualModList.prewarmTimer = null
	}

	#scheduleVirtualPrewarm() {
		this.#stopVirtualPrewarm()
		if ( !this.virtualModList.active || this.virtualModList.rowIDs.length === 0 ) { return }

		const runPrewarm = (deadline = null) => {
			this.virtualModList.prewarmTimer = null
			if ( !this.virtualModList.active ) { return }
			if ( performance.now() - this.scrollJankLastScroll < 400 ) {
				this.virtualModList.prewarmTimer = setTimeout(() => runPrewarm(), 450)
				return
			}

			const startedAt = performance.now()
			let warmed = 0
			while ( this.virtualModList.prewarmIndex < this.virtualModList.rowIDs.length ) {
				const rowID = this.virtualModList.rowIDs[this.virtualModList.prewarmIndex]
				this.virtualModList.prewarmIndex++
				const [CKey, MKey] = rowID.split('--')
				const modRec = this.mods[CKey]?.[MKey]
				if ( modRec !== undefined && modRec.node === null ) {
					this.#ensureModRowNode(modRec)
					warmed++
				}
				const timeRemaining = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0
				if ( warmed >= 8 || performance.now() - startedAt > 12 || timeRemaining < 4 ) { break }
			}

			if ( this.virtualModList.prewarmIndex < this.virtualModList.rowIDs.length ) {
				if ( typeof requestIdleCallback === 'function' ) {
					this.virtualModList.prewarmTimer = requestIdleCallback(runPrewarm, { timeout : 700 })
				} else {
					this.virtualModList.prewarmTimer = setTimeout(() => runPrewarm(), 80)
				}
			}
		}

		if ( typeof requestIdleCallback === 'function' ) {
			this.virtualModList.prewarmTimer = requestIdleCallback(runPrewarm, { timeout : 700 })
		} else {
			this.virtualModList.prewarmTimer = setTimeout(() => runPrewarm(), 120)
		}
	}

	#renderModRowSet(table, collectionKey, rowIDs) {
		this.#stopVirtualPrewarm()
		this.virtualModList.collectionKey = collectionKey
		this.virtualModList.rowIDs = rowIDs
		this.virtualModList.table = table
		this.virtualModList.prewarmIndex = 0
		this.virtualModList.renderedStart = -1
		this.virtualModList.renderedEnd = -1
		this.virtualModList.scheduled = false
		if ( rowIDs.length <= 120 ) {
			this.virtualModList.active = false
			this.#renderStaticModRows(table, rowIDs)
			return
		}
		this.virtualModList.active = true
		this.#renderVirtualModRows(true)
		this.#scheduleVirtualPrewarm()
	}

	#ensureOpenCollection() {
		if ( this.flag.folderEdit ) { return }
		if ( this.track.openCollection !== null && typeof this.collections[this.track.openCollection] !== 'undefined' ) { return }
		this.track.openCollection = this.flag.activeCollect !== null && typeof this.collections[this.flag.activeCollect] !== 'undefined' ?
			this.flag.activeCollect :
			this.orderMap.keys.find((CKey) => typeof this.collections[CKey] !== 'undefined') ?? null
	}

	// MARK: process data
	async updateFromData(data) {
		const updateStartedAt = performance.now()
		this.#markUserActivity('main-updateFromData')
		this.dataRevision++
		const updateStats = {
			addCollectionsMS    : 0,
			addModsMS           : 0,
			collectionsRendered : 0,
			finalDisplayMS      : 0,
			finalFixSortsMS     : 0,
			finalPrefsMS        : 0,
			finalUpdateUIMS     : 0,
			finalUpdateVerMS    : 0,
			modsRendered        : 0,
			processCollectionMS : 0,
		}
		window.data = data
		const trackingStartedAt = performance.now()
		this.#updateTracking(data)
		const trackingMS = performance.now() - trackingStartedAt
	
		const collectionLoopStartedAt = performance.now()
		for ( const [CIndex, CKey] of Object.entries([...data.set_Collections]) ) {
			if ( !data.collectionNotes[CKey].notes_holding && data.collectionNotes[CKey].notes_version !== this.flag.currentVersion ) { continue }
			updateStats.collectionsRendered++

			this.orderMap.keys.push(CKey)
			this.orderMap.keyToNum[CKey]   = parseInt(CIndex)
			this.orderMap.numToKey[CIndex] = CKey
			this.orderMap.max              = Math.max(this.orderMap.max, parseInt(CIndex))
			
			this.mapCollectionDropdown.set(CKey, data.modList[CKey].fullName)
			this.mapCollectionFiles.set(CKey, {
				color  : data.collectionNotes[CKey].notes_color,
				folder : data.collectionToFolderRelative[CKey],
				name   : data.modList[CKey].name,
				tag    : data.collectionNotes[CKey].notes_tagline,
			})

			const addCollectionStartedAt = performance.now()
			const thisCol = this.#addCollection(CKey, data.modList[CKey], data.collectionNotes[CKey], data.collectionToStatus[CKey])
			updateStats.addCollectionsMS += performance.now() - addCollectionStartedAt
			this.collections[CKey] = thisCol

			if ( !this.flag.folderEdit ) {
				this.mods[CKey] = {}

				for ( const [MKey, thisMod] of Object.entries(data.modList[CKey].mods) ) {
					const thisModName = thisMod.fileDetail.shortName

					const addModStartedAt = performance.now()
					const thisModRec  = this.#addMod(thisMod, this.getSaveBadges(CKey, thisMod), data.collectionNotes[CKey].notes_holding)
					updateStats.addModsMS += performance.now() - addModStartedAt
					updateStats.modsRendered++

					for ( const tag of thisModRec.filters ) { this.searchTagList.add(tag) }

					thisCol.sorter.push([
						/* 0 */ MKey,
						/* 1 */ thisModRec.search.find_name,
						/* 2 */ thisModRec.search.find_author,
						/* 3 */ thisModRec.search.find_title,
						/* 4 */ thisModRec.search.find_version,
						/* 5 */ thisMod.fileDetail.fileDate,
						/* 6 */ thisMod.fileDetail.fileSize,
						/* 7 */ this.emptySort(thisModRec.search.find_brand),
						/* 8 */ this.emptySort(thisModRec.search.find_cats)
					])

					this.mods[CKey][MKey] = thisModRec

					if ( thisModRec.filters.has('map') ) {
						thisCol.mapList.push({
							icon  : thisMod.modDesc.iconImage,
							key   : thisMod.colUUID,
							title : thisMod.fileDetail.shortName,
						})
					}

					if ( thisCol.notes.notes_frozen ) { continue }
					if ( this.flag.versionTool ) { continue }
					if ( typeof this.verList[thisModName] !== 'undefined' && this.verList[thisModName] !== thisMod.modDesc.version ) {
						this.flag.versionTool = true
						continue
					}
					this.verList[thisModName] = thisMod.modDesc.version
				}
				const processCollectionStartedAt = performance.now()
				this.#processCollection_std(CKey)
				updateStats.processCollectionMS += performance.now() - processCollectionStartedAt
			}
		}
		const collectionLoopMS = performance.now() - collectionLoopStartedAt
		this.mapCollectionDropdown.set(999, `--${data.opts.l10n.unknown}--`)

		const editLoopStartedAt = performance.now()
		if ( this.flag.folderEdit ) {
			for ( const CKey of Object.keys(this.collections) ) {
				this.#processCollection_edit(CKey)
			}
		}
		const editLoopMS = performance.now() - editLoopStartedAt

		const finalUiStartedAt = performance.now()
		this.#ensureOpenCollection()
		const finalUpdateVerStartedAt = performance.now()
		this.updateVerPick(data)
		updateStats.finalUpdateVerMS = performance.now() - finalUpdateVerStartedAt
		const finalUpdateUIStartedAt = performance.now()
		this.updateUI()
		updateStats.finalUpdateUIMS = performance.now() - finalUpdateUIStartedAt
		const finalFixSortsStartedAt = performance.now()
		this.fixSorts()
		updateStats.finalFixSortsMS = performance.now() - finalFixSortsStartedAt
		if ( this.track.openCollection !== null ) {
			this.collections[this.track.openCollection]?.modNode?.classList?.remove?.('d-none')
		}
		const finalPrefsStartedAt = performance.now()
		this.prefs.forceUpdate()
		updateStats.finalPrefsMS = performance.now() - finalPrefsStartedAt
		const finalDisplayStartedAt = performance.now()
		this.doDisplay('updateFromData')
		updateStats.finalDisplayMS = performance.now() - finalDisplayStartedAt
		const finalUiMS = performance.now() - finalUiStartedAt

		if ( this.track.newFolder !== null ) {
			this.colScroll(this.track.newFolder)
		}
		this.#restorePendingSearchFocus()
		this.#logPerformance('Main renderer updateFromData', updateStartedAt, [
			`collections=${updateStats.collectionsRendered.toString()}`,
			`mods=${updateStats.modsRendered.toString()}`,
			`tracking=${trackingMS.toFixed(1)} ms`,
			`collectionLoop=${collectionLoopMS.toFixed(1)} ms`,
			`addCollections=${updateStats.addCollectionsMS.toFixed(1)} ms`,
			`addMods=${updateStats.addModsMS.toFixed(1)} ms`,
			`processCollections=${updateStats.processCollectionMS.toFixed(1)} ms`,
			`editLoop=${editLoopMS.toFixed(1)} ms`,
			`finalUI=${finalUiMS.toFixed(1)} ms`,
			`finalUpdateVer=${updateStats.finalUpdateVerMS.toFixed(1)} ms`,
			`finalUpdateUI=${updateStats.finalUpdateUIMS.toFixed(1)} ms`,
			`finalFixSorts=${updateStats.finalFixSortsMS.toFixed(1)} ms`,
			`finalPrefs=${updateStats.finalPrefsMS.toFixed(1)} ms`,
			`finalDisplay=${updateStats.finalDisplayMS.toFixed(1)} ms`,
		].join(' '))
	}

	#restorePendingSearchFocus() {
		if ( !this.track.pendingSearchFocus ) { return }
		this.track.pendingSearchFocus = false
		this.#focusSearchBox()
	}

	#focusSearchBox() {
		const searchBox = MA.byId('filter_input')
		if ( searchBox === null ) { return }
		MA.restoreInputFocus(searchBox)
		setTimeout(() => { MA.restoreInputFocus(searchBox) }, 120)
	}

	updateVerPick(data) {
		const versionPicker = MA.byId('farm_sim_versions')
		versionPicker.innerHTML = ''
		for ( const ver of [25, 22, 19, 17, 15, 13] ) {
			const verNode = this.doVersionChanger(ver, data.appSettings, data)
			if ( verNode !== null ) { versionPicker.appendChild(verNode) }
		}
	}

	getSaveBadges(CKey, mod) {
		if ( this.track.lastPayload.opts?.cacheGameSave?.collectKey !== CKey ) { return null }
		return this.track.lastPayload.opts?.cacheGameSave?.modList?.[mod.fileDetail.shortName] ?? null
	}

	// MARK: finish sort trees
	fixSorts() {
		const collator = Intl.Collator()
		const compareText = (left, right) => collator.compare(left, right)

		for ( const CKey of this.orderMap.keys ) {
			const thisCol = this.collections[CKey]
			thisCol.sorter       = thisCol.sorter.sort((a, b) => compareText(a[1], b[1]))
			thisCol.sort_name    = thisCol.sorter.map((x) => x[0])
			thisCol.sort_author  = thisCol.sorter.sort((a, b) => compareText(a[2], b[2])).map((x) => x[0])
			thisCol.sort_title   = thisCol.sorter.sort((a, b) => compareText(a[3], b[3])).map((x) => x[0])
			thisCol.sort_version = thisCol.sorter.sort((a, b) => compareText(a[4], b[4])).map((x) => x[0])
			thisCol.sort_date    = thisCol.sorter.sort((a, b) => compareText(b[5], a[5])).map((x) => x[0])
			thisCol.sort_size    = thisCol.sorter.sort((a, b) => a[6] - b[6]).map((x) => x[0])
			thisCol.sort_brand   = thisCol.sorter.sort((a, b) => compareText(a[7], b[7])).map((x) => x[0])
			thisCol.sort_cat     = thisCol.sorter.sort((a, b) => compareText(a[8], b[8])).map((x) => x[0])
		}
	}

	// MARK: update state
	updateState() {
		window.main_IPC.updateState().then((status) => {
			MA.byId('debug_danger_bubble').clsShow(status.dangerDebug)
			MA.byId('prefcanvas_error').clsShow(status.prefDanger)
			MA.byId('topBar-preferences').clsOrGate(status.prefDanger, 'pref-danger', null)
			MA.byId('topBar-update').clsShow(status.updateReady)
			this.flag.folderDirty  = status.foldersDirty
			this.flag.gameRunning  = status.gameRunning
			this.flag.launchEnable = status.gameRunningEnabled
			MA.byId('dirty_folders').clsShow(this.flag.folderDirty)
			MA.byId('gameRunningBubble')
				.clsShow(this.flag.launchEnable)
				.clsOrGate(this.flag.gameRunning, 'text-success', 'text-danger')

			
			if ( Object.keys(status.botStatus.response).length === 0 ) { return }

			if ( !status.keepLoaderModal && MA.byId('loadOverlay').checkVisibility() ) {
				this.loader.hide()
			}
				
			for ( const [CKey, IDs] of Object.entries(status.botStatus.requestMap) ) {
				const thisBotDiv = this.collections?.[CKey]?.nodeBot ?? null

				if ( thisBotDiv === null ) { continue }
				thisBotDiv.innerHTML = ''

				for ( const thisID of IDs ) {
					thisBotDiv.appendChild(this.#botEntry(
						thisID,
						status.botStatus.response[thisID],
						status.botStatus.response[thisID].status === 'Good',
						status.botStatus.l10nMap
					))
				}
			}
		})
	}

	#botEntry(id, response, isGood, l10n) {
		const thisStatus = !isGood ? 'broken' : response.online ? 'online' : 'offline'
		const thisTitle  = !isGood ?
			`${id} ${l10n.unknown}` :
			response.online ?
				`${response.name} :: ${response.playersOnline} / ${response.slotCount} ${l10n.online}` :
				`${response.name} ${l10n.offline}`
		const thisText = isGood && response.online ? response.playersOnline : '-'
		const node = document.createElement('a')
		node.setAttribute('title', thisTitle)
		node.innerHTML = `<span class="bot-status bot-${thisStatus}">${thisText}</span>`
		node.addEventListener('click', (e) => {
			e.stopPropagation()
			window.operations.url(`https://www.farmsimgame.com/Server/${id}`)
		})
		return node
	}

	// MARK: update UI
	updateUI() {
		const todayIS = new Date()
		if ( this.flag.debugMode ) {
			MA.byId('background_target', 'fsg-back-3')
		} else if ( todayIS.getMonth() === 3 && todayIS.getDate() === 1 ) {
			MA.byId('background_target', 'fsg-back-2')
		}

		MA.queryF('[data-key="game_icon_lg"]').setAttribute('refresh', 'true')
		MA.queryF('[data-key="game_icon"]').setAttribute('refresh', 'true')

		document.body.setAttribute('data-version', this.flag.currentVersion)

		MA.byId('topBar-mini').clsOrGate(this.flag.miniMode, 'text-info', null)
		MA.byId('topBar-update').clsShow(this.flag.updateReady)
		MA.byId('dirty_folders').clsShow(this.flag.folderDirty)
		MA.byId('folderEditButton').clsOrGate(this.flag.folderEdit, 'btn-primary', 'btn-outline-primary')

		const optList = []
		for (const [value, text] of this.mapCollectionDropdown) {
			optList.push(DATA.optionFromArray([value, text], this.flag.activeCollect))
		}
		MA.byIdHTML('collectionSelect', optList.join(''))
		this.#renderRailCollections()

		this.updateI18NDrops()
	}

	#renderRailCollections() {
		const list = MA.byId('railCollectionList')
		const count = MA.byId('railCollectionCount')
		if ( list === null || count === null ) { return }

		const collectionKeys = this.orderMap.keys.filter((CKey) => typeof this.collections[CKey] !== 'undefined')
		count.textContent = collectionKeys.length.toString()
		if ( collectionKeys.length === 0 ) {
			list.innerHTML = '<div class="small text-body-secondary">No collections loaded.</div>'
			return
		}

		const fragment = document.createDocumentFragment()
		for ( const CKey of collectionKeys ) {
			const collection = this.collections[CKey]
			const modCount = collection.data?.alphaSort?.length ?? 0
			const sizeText = collection.online ? this.#bytesToHR(collection.data?.folderSize ?? 0) : I18N.defer('removable_offline', false)
			const row = document.createElement('button')
			row.type = 'button'
			row.classList.add('rail-collection-row')
			row.classList.toggle('collection-selected', this.track.openCollection === CKey)
			row.dataset.collectionKey = CKey
			row.dataset.active = (this.flag.activeCollect === CKey).toString()
			row.dataset.selected = (this.track.openCollection === CKey).toString()
			row.title = `Show mods in ${collection.data?.name ?? CKey}`
			row.innerHTML = [
				`<span class="collection-icon" aria-hidden="true">${this.#railCollectionIconHTML(CKey)}</span>`,
				'<div>',
				`<div class="collection-name">${DATA.escapeSpecial(collection.data?.name ?? CKey)}</div>`,
				`<div class="collection-meta">${modCount.toLocaleString()} mod${modCount === 1 ? '' : 's'} · ${DATA.escapeSpecial(sizeText)}</div>`,
				'</div>',
				this.flag.activeCollect === CKey ? '<span class="badge text-bg-success rail-active-badge">Active</span>' : ''
			].join('')
			row.addEventListener('click', () => { this.colToggle(CKey, true) })
			row.addEventListener('contextmenu', (event) => {
				event.preventDefault()
				this.colContext(CKey)
			})
			fragment.appendChild(row)
		}

		list.innerHTML = ''
		list.appendChild(fragment)
	}

	#railCollectionIconHTML(CKey) {
		const collection = this.collections[CKey]
		if ( typeof collection === 'undefined' ) { return '' }
		return DATA.makeFolderIcon(
			this.track.openCollection === CKey,
			collection.notes.notes_favorite,
			this.flag.activeCollect === CKey,
			collection.notes.notes_holding,
			collection.notes.notes_color
		)
	}

	#syncRailCollectionState() {
		const list = MA.byId('railCollectionList')
		if ( list === null ) { return }
		for ( const row of list.querySelectorAll('.rail-collection-row') ) {
			const CKey = row.dataset.collectionKey
			const selected = (this.track.openCollection === CKey).toString()
			const active = (this.flag.activeCollect === CKey).toString()
			row.classList.toggle('collection-selected', selected === 'true')
			if ( row.dataset.selected !== selected || row.dataset.active !== active ) {
				row.dataset.selected = selected
				row.dataset.active = active
				const icon = row.querySelector('.collection-icon')
				if ( icon !== null ) { icon.innerHTML = this.#railCollectionIconHTML(CKey) }
				const activeBadge = row.querySelector('.rail-active-badge')
				if ( active === 'true' && activeBadge === null ) {
					row.insertAdjacentHTML('beforeend', '<span class="badge text-bg-success rail-active-badge">Active</span>')
				} else if ( active === 'false' && activeBadge !== null ) {
					activeBadge.remove()
				}
			}
		}
	}

	// MARK: translated UI selects
	async updateI18NDrops() {
		const finds = ['find_all', 'find_author', 'find_brand', 'find_cats', 'find_title', 'find_name']
		const sorts = ['sort_name', 'sort_title', 'sort_brand', 'sort_author', 'sort_cat', 'sort_date', 'sort_version', 'sort_size']

		const findOptions = finds.map((x) =>
			window.i18n.get(x).then((r) => DATA.optionFromArray([x, r.entry], this.track.searchType))
		)
		const sortOptions = sorts.map((x) =>
			window.i18n.get(x).then((r) => DATA.optionFromArray([x, r.entry], this.track.sortOrder))
		)
		Promise.all(findOptions).then((r) => {
			MA.byIdHTML('modFindType', r.join(''))
		})
		Promise.all(sortOptions).then((r) => {
			MA.byIdHTML('modSortOrder', r.join(''))
		})
	}

	// MARK: update sideBar
	doSideBar() {
		this.#updateBatchModButtons()
		this.#updateDisabledOnlyButton()
		this.select.count()
	}

	#updateDisabledOnlyButton() {
		const button = MA.byId('disabledOnlyToggle')
		button.classList.toggle('active', this.track.disabledOnly)
		button.classList.toggle('btn-info', this.track.disabledOnly)
		button.classList.toggle('btn-outline-info', !this.track.disabledOnly)
		button.setAttribute('aria-pressed', this.track.disabledOnly ? 'true' : 'false')
	}

	#selectedModRecords() {
		const records = []
		for ( const modID of this.track.selected ) {
			const [collectionKey, modKey] = modID.split('--')
			const mod = this.mods?.[collectionKey]?.[modKey]
			if ( typeof mod === 'undefined' ) { continue }
			records.push({ collectionKey, mod, modID })
		}
		return records
	}

	#isZipModRecord(mod) {
		const fullPath = mod?.fileDetail?.fullPath
		return mod?.fileDetail?.isFolder !== true &&
			typeof fullPath === 'string' &&
			fullPath.toLowerCase().endsWith('.zip')
	}

	#selectedEnabledZipModRecords() {
		return this.#selectedModRecords()
			.filter(({ mod }) => this.#isZipModRecord(mod) && mod.fileDetail?.isDisabled !== true)
	}

	#selectedEnabledZipModIDs() {
		return this.#selectedEnabledZipModRecords()
			.map(({ modID }) => modID)
	}

	#selectedDisabledZipModRecords() {
		return this.#selectedModRecords()
			.filter(({ mod }) => this.#isZipModRecord(mod) && mod.fileDetail?.isDisabled === true)
	}

	#selectedDisabledZipFilesByCollection() {
		const filesByCollection = new Map()
		for ( const { collectionKey, mod } of this.#selectedDisabledZipModRecords() ) {
			const fileName = mod.fileDetail.fullPath.split(/[/\\]/u).pop()
			if ( typeof fileName !== 'string' || fileName === '' ) { continue }
			if ( !filesByCollection.has(collectionKey) ) { filesByCollection.set(collectionKey, []) }
			filesByCollection.get(collectionKey).push(fileName)
		}
		return filesByCollection
	}

	#modStatusLabel(mod) {
		const title = this.doL10N(mod?.l10n?.title)
		if ( title !== '--' ) { return title }
		return mod?.fileDetail?.shortName ?? mod?.fileDetail?.fullPath?.split(/[/\\]/u).pop() ?? 'Selected mod'
	}

	#updateBatchModButtons() {
		const disableCount = this.#selectedEnabledZipModIDs().length
		const enableCount = [...this.#selectedDisabledZipFilesByCollection().values()].reduce((total, files) => total + files.length, 0)
		const disableButton = MA.byId('batchDisableSelected')
		const enableButton = MA.byId('batchEnableSelected')
		disableButton.disabled = disableCount === 0
		enableButton.disabled = enableCount === 0
		disableButton.title = disableCount === 0 ?
			'Check one or more enabled ZIP mods to disable them.' :
			`Disable ${disableCount} checked ZIP mod${disableCount === 1 ? '' : 's'}.`
		enableButton.title = enableCount === 0 ?
			'Check one or more disabled ZIP mods to re-enable them.' :
			`Re-enable ${enableCount} checked disabled ZIP mod${enableCount === 1 ? '' : 's'}.`
	}

	// MARK: update display
	doDisplay(source = 'unspecified') {
		const displayStartedAt = performance.now()
		const displaySignature = [
			this.dataRevision,
			this.track.openCollection,
			this.flag.folderEdit,
			this.track.disabledOnly,
			this.track.selectedOnly,
			this.track.searchString,
			this.track.searchType,
			this.track.sortOrder,
			[...this.track.filter_must].sort().join(','),
			this.track.filter_must_any,
			[...this.track.filter_not].sort().join(','),
			this.track.selected.size,
		].join('|')
		if ( displaySignature === this.lastDisplaySignature && displayStartedAt - this.lastDisplayAt < 250 ) {
			this.#logInstantPerformance('Main renderer doDisplay skipped', `source=${source} reason=duplicate signature=${JSON.stringify(displaySignature)}`)
			return
		}
		this.lastDisplaySignature = displaySignature
		this.lastDisplayAt = displayStartedAt
		this.displayLastAt = displayStartedAt
		let filterBuildMS = 0
		let collectionLoopMS = 0
		let domCommitMS = 0
		let sideBarMS = 0
		let refreshSelectedMS = 0
		let railCollectionsMS = 0
		const scrollFrag = document.createDocumentFragment()
		const docFrag    = document.createDocumentFragment()
		let displayedMods = 0
		this.modIconObserver?.disconnect()
		this.modIconObserver = null
		this.modIconLoadQueue = []

		if ( this.flag.folderEdit ) {
			const editNode = document.createElement('tr')
			editNode.classList.add('mod-table-folder', 'border-bottom')
			editNode.innerHTML = '<td colspan="3" class="py-2"><i18n-text type="button" class="w-75 mx-auto d-block btn btn-sm btn-primary" data-key="folder_alpha"></i18n-text></td>'
			editNode.querySelector('i18n-text').addEventListener('click', () => {
				window.main_IPC.folder.alpha()
			})
			docFrag.appendChild(editNode)
		} else {
			const filterBuildStartedAt = performance.now()
			this.filter.build()
			filterBuildMS = performance.now() - filterBuildStartedAt
		}

		const collectionLoopStartedAt = performance.now()
		for ( const CKey of this.orderMap.keys ) {
			const thisCol = this.collections[CKey]

			if ( this.flag.folderEdit ) {
				thisCol.nodeIcon.innerHTML = DATA.makeFolderIcon(
					this.track.openCollection === CKey,
					thisCol.notes.notes_favorite,
					this.flag.activeCollect === CKey,
					thisCol.notes.notes_holding,
					thisCol.notes.notes_color
				)
				scrollFrag.appendChild(thisCol.scroll)
				docFrag.appendChild(thisCol.node)
			}

			if ( ! this.flag.folderEdit && this.track.openCollection === CKey ) {
				thisCol.modNode.classList.remove('d-none')
				const displayRowIDs = []
				for ( const MKey of thisCol[this.track.sortOrder] ) {
					const modRec = this.mods[CKey][MKey]
					const modKey = `${CKey}--${MKey}`
					if ( this.track.disabledOnly && modRec.fileDetail?.isDisabled !== true ) { continue }
					if ( ! this.track.selected.has(modKey) ) {
						if ( this.doesSearchExclude(modRec) ) { continue }
						if ( this.doesTagExclude(modRec)    ) { continue }
						if ( this.track.selectedOnly        ) { continue }
					}

					this.#applyModUpdateBadge(modRec)
					scrollFrag.appendChild(modRec.scroll)
					displayRowIDs.push(modKey)
					displayedMods++
				}
				this.#renderModRowSet(thisCol.modNodePoint, CKey, displayRowIDs)
				docFrag.appendChild(thisCol.modNode)
			}

			if ( this.flag.folderEdit ) {
				docFrag.appendChild(thisCol.modNode)
			}
		}
		collectionLoopMS = performance.now() - collectionLoopStartedAt
		const domCommitStartedAt = performance.now()
		MA.byId('mod-collections').innerHTML = ''
		MA.byId('mod-collections').appendChild(docFrag)
		this.#observeVisibleModIcons(MA.byId('mod-collections'))
		MA.byId('scroll-bar-fake').innerHTML = ''
		MA.byId('scroll-bar-fake').appendChild(scrollFrag)
		domCommitMS = performance.now() - domCommitStartedAt
		const sideBarStartedAt = performance.now()
		this.doSideBar()
		sideBarMS = performance.now() - sideBarStartedAt
		const refreshSelectedStartedAt = performance.now()
		this.refreshSelected()
		refreshSelectedMS = performance.now() - refreshSelectedStartedAt
		const railCollectionsStartedAt = performance.now()
		this.#syncRailCollectionState()
		railCollectionsMS = performance.now() - railCollectionsStartedAt
		this.#logPerformance('Main renderer doDisplay', displayStartedAt, [
			`collections=${this.orderMap.keys.length.toString()}`,
			`source=${source}`,
			`openCollection=${JSON.stringify(this.track.openCollection)}`,
			`displayedMods=${displayedMods.toString()}`,
			`selected=${this.track.selected.size.toString()}`,
			`folderEdit=${this.flag.folderEdit.toString()}`,
			`filterBuild=${filterBuildMS.toFixed(1)} ms`,
			`collectionLoop=${collectionLoopMS.toFixed(1)} ms`,
			`domCommit=${domCommitMS.toFixed(1)} ms`,
			`sideBar=${sideBarMS.toFixed(1)} ms`,
			`refreshSelected=${refreshSelectedMS.toFixed(1)} ms`,
			`railCollections=${railCollectionsMS.toFixed(1)} ms`,
		].join(' '))
	}

	#scheduleBackgroundDisplayRefresh(reason = 'background', changedFilter = null) {
		const filterDependsOnChange = changedFilter !== null && (
			this.track.filter_must.has(changedFilter) ||
			this.track.filter_not.has(changedFilter) ||
			(this.track.searchString.length >= 2 && changedFilter.includes(this.track.searchString))
		)
		if ( changedFilter !== null && !filterDependsOnChange ) {
			this.#logInstantPerformance('Main renderer background refresh skipped', `reason=${reason} changedFilter=${changedFilter}`)
			return
		}
		if ( this.backgroundDisplayRefreshTimer !== null ) { return }
		this.backgroundDisplayRefreshTimer = setTimeout(() => {
			this.backgroundDisplayRefreshTimer = null
			this.doDisplay(`background:${reason}`)
		}, 100)
	}

	doVersionChanger(version, options, modCollect) {
		const counts = { collect : 0, mods : 0 }
		
		if ( !options[`game_enabled_${version}`] && version !== this.flag.currentVersion ) { return null }
		
		for ( const collectKey of modCollect.set_Collections ) {
			if ( modCollect.collectionNotes[collectKey].notes_version === version ) {
				counts.collect++
				counts.mods += modCollect.modList[collectKey].alphaSort.length
			}
		}

		const node = DATA.templateEngine('version_row', {
			collections     : counts.collect,
			mods            : counts.mods,
			version         : version,
		}, {}, {
			'.versionIcon' : `fsico-ver-${version}`,
		})

		node.firstElementChild.classList.add(version === this.flag.currentVersion ? 'bg-success' : 'bg-primary')
		node.firstElementChild.addEventListener('click', () => {
			window.settings.set('game_version', version).then(() => {
				window.main_IPC.folder.reload()
			})
		})
		return node
	}

	doesSearchExclude(mod) {
		// reversed condition! false if OK!
		if ( this.track.searchString.length < 2 ) { return false }

		const termNotFound = mod.search[this.track.searchType].indexOf(this.track.searchString) === -1

		return ( this.track.searchString.startsWith('!') ) ? !termNotFound : termNotFound
	}

	doesTagExclude(mod) {
		if ( this.track.filter_must.size === 0 && this.track.filter_not.size === 0 ) { return false }

		for ( const excludeTag of this.track.filter_not ) {
			if ( mod.filters.has(excludeTag) ) { return true }
		}

		if ( this.track.filter_must.size === 0 ) { return false }

		if ( this.track.filter_must_any ) {
			for ( const mustTag of this.track.filter_must ) {
				if ( mod.filters.has(mustTag) ) { return false }
			}
			return true
		}

		for ( const mustTag of this.track.filter_must ) {
			if ( ! mod.filters.has(mustTag) ) { return true }
		}
		return false
	}

	// MARK: addCollection
	#addCollection(CKey, collection, notes, online) {
		const colRec = {
			data         : collection,
			mapList      : [],
			modNode      : document.createElement('tr'),
			modNodePoint : null,
			node         : document.createElement('tr'),
			nodeBot      : null,
			nodeIcon     : null,
			notes        : notes,
			online       : online,
			scroll       : document.createElement('scroller-item'),
			sorter       : [],

			sort_author   : [],
			sort_date     : [],
			sort_name     : [],
			sort_title    : [],
			sort_version  : [],
		}

		colRec.scroll.id = `${CKey}--scroller`
		colRec.node.id   = CKey
		colRec.node.classList.add('mod-table-folder', 'border-bottom')
		colRec.node.addEventListener('contextmenu', () => { this.colContext(CKey)} )
		

		if ( ! this.flag.folderEdit ) {
			colRec.node.appendChild(DATA.templateEngine('item_collect', {
				folderSize : colRec.online ? this.#bytesToHR(collection.folderSize) : I18N.defer('removable_offline', false),
				name       : collection.name,
				tagLine    : notes.notes_tagline,
				totalCount : collection.alphaSort.length > 999 ? '999+' : collection.alphaSort.length,
			}))

			colRec.node.children[0].addEventListener('click',       () => { this.colToggle(CKey)} )
			colRec.node.children[1].addEventListener('click',       () => { this.colToggle(CKey)} )

			colRec.nodeBot  = colRec.node.querySelector('.botInfo')
			colRec.nodeIcon = colRec.node.querySelector('.folder-icon-svg')

			colRec.modNode.id = `${CKey}--mods`
			colRec.modNode.classList.add('mod-table-folder-detail', 'd-none')
			colRec.modNode.innerHTML = [
				'<td class="mod-table-folder-details px-0 ps-4" colspan="3">',
				'<i18n-text class="no-mods-found d-block fst-italic small text-center d-none" data-key="empty_or_filtered"></i18n-text>',
				'<table class="w-100 py-0 my-0 table table-sm table-hover table-striped"></table>',
				'</td>'
			].join('')

			colRec.modNodePoint = colRec.modNode.querySelector('table')
		} else {
			colRec.node.appendChild(DATA.templateEngine('item_collect_edit', {
				dateAdd    : DATA.dateToString(notes.notes_add_date),
				dateUsed   : DATA.dateToString(notes.notes_last),
				folderSize : colRec.online ? this.#bytesToHR(collection.folderSize) : I18N.defer('removable_offline', false),
				name       : collection.name,
				tagLine    : notes.notes_tagline,
				totalCount : collection.alphaSort.length > 999 ? '999+' : collection.alphaSort.length,
			}))
			colRec.nodeIcon = colRec.node.querySelector('.folder-icon-svg')
		}
		return colRec
	}

	// MARK: collect buttons
	#buttonMaker(text, color, callback, disabled = false) {
		const node = document.createElement('i18n-text')
		node.classList.add('btn', `btn-${color}`, 'btn-sm')
		node.setAttribute('data-key', text)
		node.addEventListener('click', callback)
		if ( disabled ) { node.clsDisable() }
		return node
	}

	#processCollection_edit(CKey) {
		const col     = this.collections[CKey]
		const btnNode = col.node.querySelector('.collect-line-buttons')

		btnNode.innerHTML = ''
		btnNode.appendChild(this.#buttonMaker(
			'folder_top_button',
			'secondary',
			() => { this.order.set(CKey, true, true) },
			this.order.prev(CKey) === null
		))
		btnNode.appendChild(this.#buttonMaker(
			'folder_up_button',
			'secondary',
			() => { this.order.set(CKey, true, false) },
			this.order.prev(CKey) === null
		))
		btnNode.appendChild(this.#buttonMaker(
			'folder_down_button',
			'secondary',
			() => { this.order.set(CKey, false, false) },
			this.order.next(CKey) === null
		))
		btnNode.appendChild(this.#buttonMaker(
			'folder_bot_button',
			'secondary',
			() => { this.order.set(CKey, false, true) },
			this.order.next(CKey) === null
		))
		btnNode.appendChild(this.#buttonMaker(
			'remove_folder',
			'danger',
			() => { window.main_IPC.folder.remove(CKey) }
		))
		btnNode.appendChild(this.#buttonMaker(
			'basegame_button_folder',
			'success',
			() => { window.main_IPC.folder.open(CKey) }
		))
	}
	#processCollection_std(CKey) {
		const col     = this.collections[CKey]
		const note    = col.notes
		const btnNode = col.node.querySelector('.collect-line-buttons')

		btnNode.innerHTML = ''

		if ( col.mapList.length === 1 ) {
			const map = col.mapList[0]
			const node = document.createElement('div')
			node.classList.add('btn', 'btn-outline-primary', 'btn-sm', 'p-0')
			node.setAttribute('title', map.title)
			node.innerHTML = `<img src="${DATA.iconMaker(map.icon)}" alt="" class="img-fluid rounded" style="width: 27px; height: 27px;">`
			node.addEventListener('click', () => { window.main_IPC.dispatchDetail(map.key) })
			btnNode.appendChild(node)
		} else if ( col.mapList.length > 1 ) {
			const maps = col.mapList.sort((a, b) => Intl.Collator().compare(a.title, b.title))
			const node = document.createElement('div')
			node.classList.add('dropdown', 'd-inline-block')
			node.innerHTML = [
				'<button class="btn btn-outline-primary btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">',
				'<i18n-text data-key="map_multi_button"></i18n-text>',
				'</button>',
				'<ul class="dropdown-menu dropdown-menu-end" style="min-width: 30vw; max-width: 50vw;">',
				'</ul></div>',
			].join('')

			const mapNodeP = node.querySelector('ul')
			for ( const map of maps ) {
				const mNode = document.createElement('li')
				mNode.innerHTML = [
					`<a class="dropdown-item" title="${map.title}">`,
					`<img alt="" class="img-fluid rounded me-2" style="width: 27px; height: 27px;" src="${DATA.iconMaker(map.icon)}">`,
					map.title,
					'</a>'
				].join('')
				mNode.querySelector('a').addEventListener('click', () => { window.main_IPC.dispatchDetail(map.key) })
				mapNodeP.appendChild(mNode)
			}
			btnNode.appendChild(node)
		}

		if ( note.notes_removable ) {
			btnNode.appendChild(this.#buttonMaker('removable_button', 'outline-secondary', () => { return }))
		}
		if ( note.notes_websiteDL ) {
			btnNode.appendChild(this.#buttonMaker('download_button', 'outline-warning', () => { window.main_IPC.folder.download(CKey) }))
		}
		if ( note.notes_game_admin !== null ) {
			btnNode.appendChild(this.#buttonMaker('game_admin_pass_button', 'outline-success', () => { window.operations.clip(note.notes_game_admin) }))
		}
		if ( note.notes_admin !== null ) {
			btnNode.appendChild(this.#buttonMaker('admin_pass_button', 'outline-info', () => { window.operations.clip(note.notes_admin) }))
		}
		if ( note.notes_website !== null ) {
			btnNode.appendChild(this.#buttonMaker('admin_button', 'outline-info', () => { window.operations.url(note.notes_website) }))
		}
		const colTime = typeof note.notes_add_date === 'string' ?
			new Date(note.notes_add_date).getTime() :
			note.notes_add_date !== null ?
				note.notes_add_date.getTime() :
				0
		const recTime = (new Date().getTime()) - (1000*60*60)
		if ( colTime > recTime ) {
			col.node.classList.add('bg-info-subtle')
		} else {
			col.node.classList.remove('bg-info-subtle')
		}

		btnNode.appendChild(this.#buttonMaker('export_button', 'outline-info', () => { window.main_IPC.folder.export(CKey) }))
		btnNode.appendChild(this.#buttonMaker('notes_button', 'primary', () => { window.main_IPC.dispatchNotes(CKey) }))
		btnNode.appendChild(this.#buttonMaker('check_save', 'primary', () => { window.main_IPC.dispatchSave(CKey) }))
	}

	#addExtraInfo(item) {
		return item.length !== 0 ? DATA.escapeSpecial(item.join(', ')) : null
	}
	#findExtraInfo(item) {
		return item.map((x) => x.toLowerCase()).join(' ')
	}
	#bytesToHR(inBytes, { forceMB = false, showSuffix = true } = {}) {
		let bytes = inBytes

		if (Math.abs(bytes) < 1024) { return '0 kB' }

		const units = ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
		let u = -1
		const r = 10**2

		if ( !forceMB ) {
			do {
				bytes /= 1024
				++u
			} while (Math.round(Math.abs(bytes) * r) / r >= 1024 && u < units.length - 1)
		} else {
			bytes = Math.round((bytes / ( 1024 * 1024) * 100 )) / 100
		}

		return [
			bytes.toLocaleString( this.flag.currentLocale ?? 'en', { minimumFractionDigits : 2, maximumFractionDigits : 2 } ),
			showSuffix ? (forceMB ? 'MB' : units[u]) : null
		].filter((x) => x !== null).join(' ')
	}
	#renderModRow({
		authorCat,
		brandTitle,
		fileSize,
		folderIcon,
		iconImage,
		modName,
		rowActionLabel,
		version,
	}) {
		const brandLine = brandTitle === '' ? '' : `<br><small class="ps-2">${brandTitle}</small>`
		return [
			'<td style="width: 4.6rem; height: 4.6rem; white-space: nowrap">',
			iconImage,
			folderIcon,
			'</td>',
			'<td><div class="d-flex flex-row"><div>',
			`<span class="mod-short-name">${modName}</span>`,
			brandLine,
			'<br>',
			`<small class="text-body-tertiary ps-2">${authorCat}</small>`,
			'</div><div class="issue_badges fs-5 flex-grow-1 text-end"></div></div></td>',
			'<td class="text-end" style="width: 100px; line-height: 1.25;">',
			`${version}<br><em class="small px-0">${fileSize}</em>`,
			'</td>',
			'<td class="main-mod-row-actions text-end">',
			'<div class="d-inline-flex gap-2" role="group" aria-label="Mod actions">',
			'<button type="button" class="btn btn-sm mod-detail-row">Details</button>',
			`<button type="button" class="btn btn-sm mod-disable-row">${rowActionLabel}</button>`,
			'</div>',
			'</td>'
		].join('')
	}

	#isVisibleRowBadge(badge) {
		const name = badge?.name ?? ''
		if ( name === `fs${this.flag.currentVersion}` ) { return false }
		if ( name.startsWith('fs') ) { return true }
		return [
			'broken',
			'depend',
			'keys_bad',
			'malware',
			'problem',
			'update',
		].includes(name)
	}

	// MARK: addMod
	#addMod(thisMod, overBadges = null, _isHolding = false) {
		const isDisabledMod = thisMod.fileDetail?.isDisabled === true
		const mod = {
			currentCollection : thisMod.currentCollection,
			fileDetail : thisMod.fileDetail,
			filters : new Set([
				...(thisMod?.displayBadges?.map?.((x) => x.name) || []),
				...(isDisabledMod ? ['disabled'] : []),
			]),
			modDesc : thisMod.modDesc,
			node    : null,
			overBadges,
			raw     : thisMod,
			rollbackCheck : {
				hasRollback : false,
				isComplete  : false,
			},
			scroll  : document.createElement('scroller-item'),
			search  : {
				find_author  : DATA.escapeSpecial(thisMod.modDesc.author).toLowerCase(),
				find_brand   : this.#findExtraInfo(thisMod.has_brands),
				find_cats    : this.#findExtraInfo(thisMod.has_cats),
				find_name    : thisMod.fileDetail.shortName.toLowerCase(),
				find_title   : this.doL10N(thisMod.l10n.title, true),
				find_version : this.doL10N(thisMod.modDesc.version, true),
			},
			updateCheck : {
				hasGitHubUpdate : false,
				hasModHubUpdate : thisMod.badgeArray.includes('update'),
				isComplete      : false,
			},
		}
		mod.search.find_all = Object.values(mod.search).join(' ')

		mod.scroll.id  = `${thisMod.colUUID}--scroller`
		this.#refreshModUpdateBadge(thisMod, mod)
		this.#refreshModRollbackBadge(thisMod, mod)

		return mod
	}

	/* eslint-disable-next-line complexity */
	#ensureModRowNode(mod) {
		if ( mod.node !== null ) { return }
		const thisMod = mod.raw
		const isDisabledMod = thisMod.fileDetail?.isDisabled === true
		mod.node = document.createElement('tr')
		mod.node.classList.add(...[
			'mod-row',
			'border-bottom',
			this.extSites[thisMod.fileDetail.shortName] ? 'has-ext-site' : null,
			thisMod.modHub.id ? 'has-hash' : null,
			...( isDisabledMod || thisMod.canNotUse === true || this.flag.currentVersion !== thisMod.gameVersion ) ?
				['mod-disabled', 'bg-secondary-subtle', 'bg-opacity-25'] :
				[]
		].filter((x) => x !== null))
	
		mod.node.id = thisMod.colUUID
		// mod.node.setAttribute('draggable', true)
	
		mod.node.addEventListener('contextmenu', () => {
			this.#markUserActivity('main-list-context')
			this.modContext(thisMod.colUUID)
		})
		// mod.node.addEventListener('dragstart',   (e) => { this.modDrag(e, thisMod.colUUID) })
		mod.node.addEventListener('click',       (e) => { this.modClick(e, thisMod.colUUID) })

		if ( !thisMod.badgeArray.includes('notmod') && !thisMod.badgeArray.includes('savegame') ) {
			mod.node.addEventListener('dblclick',  () => {
				const detailStartedAt = performance.now()
				this.#markUserActivity('main-detail-doubleClick')
				this.#logInstantPerformance('Main renderer detail open request', `source=doubleClick id=${JSON.stringify(thisMod.colUUID)} shortName=${JSON.stringify(thisMod.fileDetail.shortName)}`)
				if ( thisMod.badgeArray.includes('log') ) {
					window.main_IPC.dispatchLog(thisMod.fileDetail.fullPath)
				} else {
					window.main_IPC.dispatchDetail(thisMod.colUUID)
				}
				this.#logPerformance('Main renderer detail dispatch', detailStartedAt, `source=doubleClick id=${JSON.stringify(thisMod.colUUID)}`)
			})
		}

		const fixCat   = [...new Set(thisMod.has_cats.map((x) => x.split(' ')).flat())].sort()
		const fixBrand = [...new Set(thisMod.has_brands.map((x) => x.split(' ')).flat())].sort()
		const modTitle = this.doL10N(thisMod.l10n.title)

		const brandTitle = [
			fixBrand.length !== 0 ? `<strong>${this.#addExtraInfo(fixBrand)}</strong>` : null,
		]
		const authorCat = [
			DATA.escapeSpecial(thisMod.modDesc.author),
			fixCat.length !== 0 ? '--' : null,
			fixCat.length !== 0 ? `<em>${this.#addExtraInfo(fixCat)}</em>` : null,
		]

		mod.node.innerHTML = this.#renderModRow({
			authorCat  : authorCat.filter((x) => x !== null).join(' '),
			brandTitle : brandTitle.filter((x) => x !== null).join(' '),
			fileSize   : this.#bytesToHR(thisMod.fileDetail.fileSize),
			folderIcon : thisMod.badgeArray.includes('folder') ? '<i class="bi bi-folder2-open mod-folder-overlay"></i>' : '',
			iconImage  : this.#lazyModIconHTML(thisMod.modDesc.iconImage),
			modName    : modTitle !== '--' ? modTitle : DATA.escapeSpecial(thisMod.fileDetail.shortName),
			rowActionLabel : isDisabledMod ? 'Enable' : 'Disable',
			version    : DATA.escapeSpecial(thisMod.modDesc.version),
		})

		const badgeContain = mod.node.querySelector('.issue_badges')

		if ( mod.overBadges !== null ) {
			badgeContain.innerHTML = mod.overBadges
		} else {
			for ( const badge of thisMod?.displayBadges?.filter?.((x) => this.#isVisibleRowBadge(x)) || [] ) {
				badgeContain.appendChild(I18N.buildBadgeMod(badge))
			}
		}
		if ( isDisabledMod ) { badgeContain.appendChild(this.#buildDisabledBadge()) }
		this.#wireModRowActions(mod.node, thisMod, isDisabledMod)
		const modHubUpdateBadge = badgeContain.querySelector('.badge-mod-update')
		if ( modHubUpdateBadge !== null ) {
			modHubUpdateBadge.removeAttribute('data-key')
			modHubUpdateBadge.textContent = 'ModHub update'
			modHubUpdateBadge.title = 'A newer version is available from the official ModHub catalogue'
		}
		this.#applyModUpdateBadge(mod)
		this.#applyModRollbackBadge(mod)
	}

	#wireModRowActions(node, thisMod, isDisabledMod) {
		const stopAndRun = (selector, callback) => {
			const button = node.querySelector(selector)
			if ( button === null ) { return }
			button.addEventListener('click', (event) => {
				event.preventDefault()
				event.stopPropagation()
				callback(button)
			})
		}

		stopAndRun('.mod-detail-row', () => {
			const detailStartedAt = performance.now()
			this.#markUserActivity('main-detail-button')
			this.#logInstantPerformance('Main renderer detail open request', `source=button id=${JSON.stringify(thisMod.colUUID)} shortName=${JSON.stringify(thisMod.fileDetail.shortName)}`)
			window.main_IPC.dispatchDetail(thisMod.colUUID)
			this.#logPerformance('Main renderer detail dispatch', detailStartedAt, `source=button id=${JSON.stringify(thisMod.colUUID)}`)
		})
		stopAndRun('.mod-disable-row', (button) => {
			if ( isDisabledMod ) {
				void this.action.enableSingleMod(thisMod, button)
			} else {
				void this.action.disableSingleMod(thisMod.colUUID, button)
			}
		})
	}

	#refreshModRollbackBadge(thisMod, modRec) {
		if ( thisMod.badgeArray.includes('notmod') || thisMod.badgeArray.includes('savegame') ) { return }

		const cacheKey = `${thisMod.currentCollection}::${thisMod.fileDetail.shortName}`
		if ( !this.rollbackCheckCache.has(cacheKey) ) {
			this.rollbackCheckCache.set(cacheKey, window.main_IPC.hasRollbackBackup({
				collectionKey : thisMod.currentCollection,
				modName       : thisMod.fileDetail.shortName,
			}).catch((err) => {
				window.log.warning('rollback-check', thisMod.fileDetail.shortName, err.message)
				return false
			}))
		}

		this.rollbackCheckCache.get(cacheKey).then((hasRollback) => {
			const hadRollback = modRec.filters.has('rollback_available')

			modRec.rollbackCheck.hasRollback = hasRollback
			modRec.rollbackCheck.isComplete  = true

			if ( hasRollback ) {
				modRec.filters.add('rollback_available')
				this.searchTagList.add('rollback_available')
			} else {
				modRec.filters.delete('rollback_available')
			}

			this.#applyModRollbackBadge(modRec)

			if ( hadRollback !== hasRollback ) { this.#scheduleBackgroundDisplayRefresh('rollbackCheck', 'rollback_available') }
		})
	}

	#refreshModUpdateBadge(thisMod, modRec) {
		if ( thisMod.badgeArray.includes('notmod') || thisMod.badgeArray.includes('savegame') ) { return }

		const localVersion = thisMod.modDesc.version
		const sourceURL    = this.extSites[thisMod.fileDetail.shortName] || ''
		if ( !this.#isGitHubURL(sourceURL) ) { return }

		const cacheKey = `${sourceURL}::${localVersion}`
		if ( !this.updateCheckCache.has(cacheKey) ) {
			this.updateCheckCache.set(cacheKey, window.main_IPC.getGitHub(sourceURL).then((result) => {
				if ( !result.ok ) { return false }
				const compareResult = DATA.versionCompare(localVersion, result.version)
				return compareResult < 0 || (Number.isNaN(compareResult) && DATA.versionDifferent(localVersion, result.version))
			}).catch((err) => {
				window.log.warning('github-update-check', thisMod.fileDetail.shortName, err.message)
				return false
			}))
		}

		this.updateCheckCache.get(cacheKey).then((hasUpdate) => {
			const hadUpdate = modRec.filters.has('github_update')

			modRec.updateCheck.hasGitHubUpdate = hasUpdate
			modRec.updateCheck.isComplete      = true

			if ( hasUpdate ) {
				modRec.filters.add('github_update')
				this.searchTagList.add('github_update')
			} else {
				modRec.filters.delete('github_update')
			}

			this.#applyModUpdateBadge(modRec)

			if ( hadUpdate !== hasUpdate ) { this.#scheduleBackgroundDisplayRefresh('githubUpdateCheck', 'github_update') }
		})
	}

	#applyModUpdateBadge(modRec) {
		if ( modRec.node === null ) { return }
		const badgeContain = modRec.node.querySelector('.issue_badges')
		if ( badgeContain === null ) { return }

		const oldBadge = badgeContain.querySelector('.badge-mod-github_update')
		if ( oldBadge !== null ) { oldBadge.remove() }

		if ( !modRec.updateCheck.hasGitHubUpdate ) { return }

		badgeContain.appendChild(this.#buildGitHubUpdateBadge())
	}

	#applyModRollbackBadge(modRec) {
		if ( modRec.node === null ) { return }
		const badgeContain = modRec.node.querySelector('.issue_badges')
		if ( badgeContain === null ) { return }

		const oldBadge = badgeContain.querySelector('.badge-mod-rollback_available')
		if ( oldBadge !== null ) { oldBadge.remove() }

		if ( !modRec.rollbackCheck.hasRollback ) { return }

		badgeContain.appendChild(this.#buildRollbackBadge())
	}

	#buildGitHubUpdateBadge() {
		const badgeNode = document.createElement('span')
		badgeNode.classList.add('badge', 'border', 'border-2', 'text-bg-warning', 'border-warning', 'badge-mod-github_update')
		badgeNode.title = 'A newer version may be available from the saved GitHub source'
		badgeNode.textContent = 'GitHub update'
		return badgeNode
	}

	#buildRollbackBadge() {
		const badgeNode = document.createElement('span')
		badgeNode.classList.add('badge', 'border', 'border-2', 'text-bg-info', 'border-info', 'badge-mod-rollback_available')
		badgeNode.title = 'A backup is available for rollback'
		badgeNode.textContent = 'rollback'
		return badgeNode
	}

	#buildDisabledBadge() {
		const badgeNode = document.createElement('span')
		badgeNode.classList.add('badge', 'border', 'border-2', 'text-bg-secondary', 'border-secondary', 'badge-mod-disabled')
		badgeNode.title = 'This mod is disabled in the collection'
		badgeNode.textContent = 'Disabled'
		return badgeNode
	}

	#isGitHubURL(sourceURL) {
		try {
			return new URL(sourceURL).hostname.toLowerCase() === 'github.com'
		} catch {
			return false
		}
	}

	// MARK: col actions
	colToggle(id, stayOpen = false) {
		const toggleStartedAt = performance.now()
		this.#markUserActivity('collection-toggle')
		const previousCollection = this.track.openCollection
		const selectedBefore = this.track.selected.size
		this.track.lastID    = null
		this.track.lastIndex = null
		this.track.altClick  = null

		const clearSelectionStartedAt = performance.now()
		for ( const selected of this.track.selected ) {
			this.modToggle(selected, false)
		}
		const clearSelectionMS = performance.now() - clearSelectionStartedAt

		if ( stayOpen && this.track.openCollection === id ) {
			const refreshStartedAt = performance.now()
			this.refreshSelected()
			const refreshMS = performance.now() - refreshStartedAt
			const sideBarStartedAt = performance.now()
			this.doSideBar()
			const sideBarMS = performance.now() - sideBarStartedAt
			const railStartedAt = performance.now()
			this.#syncRailCollectionState()
			const railMS = performance.now() - railStartedAt
			this.#logPerformance('Main renderer collection toggle', toggleStartedAt, [
				`from=${JSON.stringify(previousCollection)}`,
				`to=${JSON.stringify(this.track.openCollection)}`,
				`clicked=${JSON.stringify(id)}`,
				`stayOpen=${stayOpen.toString()}`,
				`selectedBefore=${selectedBefore.toString()}`,
				`selectedAfter=${this.track.selected.size.toString()}`,
				`clearSelection=${clearSelectionMS.toFixed(1)} ms`,
				`refreshSelected=${refreshMS.toFixed(1)} ms`,
				`sideBar=${sideBarMS.toFixed(1)} ms`,
				`railCollections=${railMS.toFixed(1)} ms`,
				'display=skipped',
			].join(' '))
			return
		}

		if ( this.track.openCollection !== null ) {
			if ( typeof this.collections[this.track.openCollection] === 'undefined' ) {
				this.track.openCollection = null
			} else {
				this.collections[this.track.openCollection].modNode.classList.add('d-none')
			}
		}

		if ( this.track.openCollection === id && !stayOpen ) {
			this.forceSelectOnly(false)
			this.track.openCollection = null
		} else {
			this.track.openCollection = id
			this.collections[id].modNode.classList.remove('d-none')
		}
		const displayStartedAt = performance.now()
		this.doDisplay('collectionToggle')
		this.#logPerformance('Main renderer collection toggle', toggleStartedAt, [
			`from=${JSON.stringify(previousCollection)}`,
			`to=${JSON.stringify(this.track.openCollection)}`,
			`clicked=${JSON.stringify(id)}`,
			`stayOpen=${stayOpen.toString()}`,
			`selectedBefore=${selectedBefore.toString()}`,
			`selectedAfter=${this.track.selected.size.toString()}`,
			`clearSelection=${clearSelectionMS.toFixed(1)} ms`,
			`display=${(performance.now() - displayStartedAt).toFixed(1)} ms`,
		].join(' '))
	}

	colScroll(id) {
		const top = MA.byId(id)?.offsetTop ?? 0
		MA.byId('mod-collections').parentElement.scrollTo({top : top, behavior : 'instant'})
	}

	colContext(id) { window.main_IPC.contextCol(id) }


	// MARK: mod actions
	modContext(id) {
		window.main_IPC.contextMod(id, [...this.track.selected])
	}

	modClick(e, id) {
		const clickStartedAt = performance.now()
		this.#markUserActivity('main-mod-click')
		const selectedBefore = this.track.selected.size
		const thisRow   = e.target.closest('.mod-row')
		const theTable  = thisRow.closest('table')
		const rowIndexFromDataset = Number.parseInt(thisRow.dataset.rowIndex ?? '', 10)
		const thisIndex = Number.isNaN(rowIndexFromDataset) ? [...theTable.children].indexOf(thisRow) : rowIndexFromDataset
		const visibleRowIDs = this.virtualModList.collectionKey === this.track.openCollection ? this.virtualModList.rowIDs : []

		if ( e.altKey ) {
			const refreshStartedAt = performance.now()
			this.track.altClick = id
			this.track.lastIndex = thisIndex
			this.track.lastID    = id
			this.track.selected.clear()
			this.track.selected.add(id)
			this.refreshSelected()
			const refreshMS = performance.now() - refreshStartedAt
			const sideBarStartedAt = performance.now()
			this.doSideBar()
			this.#logPerformance('Main renderer mod click selection', clickStartedAt, [
				'mode=alt',
				`id=${JSON.stringify(id)}`,
				`rowIndex=${thisIndex.toString()}`,
				`selectedBefore=${selectedBefore.toString()}`,
				`selectedAfter=${this.track.selected.size.toString()}`,
				`refreshSelected=${refreshMS.toFixed(1)} ms`,
				`sideBar=${(performance.now() - sideBarStartedAt).toFixed(1)} ms`,
			].join(' '))
			return
		}

		this.track.altClick = null
		if ( !e.ctrlKey && !e.shiftKey ) {
			this.#logPerformance('Main renderer mod click selection', clickStartedAt, [
				'mode=plain',
				`id=${JSON.stringify(id)}`,
				`rowIndex=${thisIndex.toString()}`,
				`selectedBefore=${selectedBefore.toString()}`,
				`selectedAfter=${this.track.selected.size.toString()}`,
			].join(' '))
			return
		}

		if ( e.ctrlKey || this.track.lastIndex === null || thisIndex === this.track.lastIndex ) {
			this.track.lastIndex = thisIndex
			this.track.lastID    = id
			this.modToggle(id)
			const sideBarStartedAt = performance.now()
			this.doSideBar()
			this.#logPerformance('Main renderer mod click selection', clickStartedAt, [
				`mode=${e.ctrlKey ? 'ctrl' : 'shift-single'}`,
				`id=${JSON.stringify(id)}`,
				`rowIndex=${thisIndex.toString()}`,
				`selectedBefore=${selectedBefore.toString()}`,
				`selectedAfter=${this.track.selected.size.toString()}`,
				`sideBar=${(performance.now() - sideBarStartedAt).toFixed(1)} ms`,
			].join(' '))
			return
		}

		const index_start = Math.min(thisIndex, this.track.lastIndex)
		const index_end   = Math.max(thisIndex, this.track.lastIndex)
		const rangeSize = index_end - index_start + 1

		for ( let i = index_start; i <= index_end; i++ ) {
			const rowID = visibleRowIDs[i] ?? theTable.children[i]?.id ?? null
			if ( rowID !== null ) { this.modToggle(rowID, true) }
		}

		this.track.lastIndex = thisIndex
		this.track.lastID    = id
		const sideBarStartedAt = performance.now()
		this.doSideBar()
		this.#logPerformance('Main renderer mod click selection', clickStartedAt, [
			'mode=shift-range',
			`id=${JSON.stringify(id)}`,
			`rowIndex=${thisIndex.toString()}`,
			`rangeSize=${rangeSize.toString()}`,
			`selectedBefore=${selectedBefore.toString()}`,
			`selectedAfter=${this.track.selected.size.toString()}`,
			`sideBar=${(performance.now() - sideBarStartedAt).toFixed(1)} ms`,
		].join(' '))
	}

	modToggle(id, force = null) {
		let doAdd = !this.track.selected.has(id)

		if ( force === false ) {
			doAdd = false
		} else if ( force === true ) {
			doAdd = true
		}

		if ( doAdd ) {
			this.track.selected.add(id)
			MA.safeClsAdd(id, this.selectClass)
			MA.safeClsAdd(`${id}--scroller`, 'bg-success')
		} else {
			this.track.selected.delete(id)
			MA.safeClsRem(id, this.selectClass)
			MA.safeClsRem(`${id}--scroller`, 'bg-success')
		}
		
	}

	modDrag(e, id) {
		e.preventDefault()
		e.stopPropagation()

		if ( this.dragDrop.flags.preventRun ) { return }
		window.main_IPC.drag.out(id)
	}

	// MARK: safe refresh
	refreshSelected() {
		const refreshStartedAt = performance.now()
		const selectedBefore = this.track.selected.size
		let visibleSelectedRows = 0
		let visibleScrollerRows = 0
		let staleSelection = 0
		for ( const element of MA.query(`.mod-row.${this.selectClass}`) ) {
			visibleSelectedRows++
			element.classList.remove(this.selectClass)
		}
		for ( const element of MA.query('scroller-item.bg-success') ) {
			visibleScrollerRows++
			element.classList.remove('bg-success')
		}

		for ( const id of this.track.selected ) {
			if ( !id.startsWith(this.track.openCollection) ) {
				staleSelection++
				this.track.selected.delete(id)
			} else {
				MA.safeClsAdd(id, this.selectClass)
				MA.safeClsAdd(`${id}--scroller`, 'bg-success')
			}
		}
		this.select.count()
		this.#logPerformance('Main renderer refreshSelected', refreshStartedAt, [
			`openCollection=${JSON.stringify(this.track.openCollection)}`,
			`selectedBefore=${selectedBefore.toString()}`,
			`selectedAfter=${this.track.selected.size.toString()}`,
			`visibleSelectedRows=${visibleSelectedRows.toString()}`,
			`visibleScrollerRows=${visibleScrollerRows.toString()}`,
			`staleSelection=${staleSelection.toString()}`,
		].join(' '))
	}

	// MARK: selection toggles
	forceSelectOnly(nv = true) {
		const selectedOnlyToggle = MA.byId('modFilter_selected')
		if ( selectedOnlyToggle !== null ) { selectedOnlyToggle.checked = nv }
		this.track.selectedOnly = nv
	}

	toggleSelectOnly() {
		this.track.selectedOnly = MA.byIdCheck('modFilter_selected')
		this.doDisplay('toggleSelectOnly')
	}

	toggleDisabledOnly() {
		this.track.disabledOnly = !this.track.disabledOnly
		this.doDisplay('toggleDisabledOnly')
	}

	toggleAdvancedFilters(force = null) {
		const panel = MA.byId('advancedFilterPanel')
		const button = MA.byId('advancedFilterToggle')
		if ( panel === null || button === null ) { return }
		const show = force === null ? panel.classList.contains('d-none') : force === true
		panel.clsShow(show)
		button.classList.toggle('btn-secondary', show)
		button.classList.toggle('btn-outline-secondary', !show)
		button.setAttribute('aria-expanded', show ? 'true' : 'false')
	}

	toggleTagFilterHelp(force = null) {
		const panel = MA.byId('tagFilterHelpPanel')
		if ( panel === null ) { return }
		const show = force === null ? panel.classList.contains('d-none') : force === true
		panel.clsShow(show)
	}

	toggleRequiredTagMode() {
		this.track.filter_must_any = MA.byIdCheck('tagRequiredAnyToggle')
		this.filter.updateModeDisplay()
		this.doDisplay('toggleRequiredTagMode')
	}

	changeSort() {
		this.track.sortOrder = MA.byIdValue('modSortOrder')
		this.doDisplay('changeSort')
	}

	startFile(mode) {
		this.files.start(mode, this.track.selected, this.track.altClick)
	}

	// MARK: filters
	filter = {
		build : () => {
			MA.byIdText('tag_filter_full_count', this.track.filter_must.size + this.track.filter_not.size)
			this.filter.updateModeDisplay()
			const dropNode = document.createDocumentFragment()
			const textNode = document.createElement('i18n-text')
			textNode.classList.add('text-center', 'd-block', 'pb-1')
			textNode.setAttribute('data-key', 'filter_tag_title')

			dropNode.appendChild(textNode)

			const allTags = []
			for ( const tag of [...this.searchTagList].filter((x) => x !== `fs${this.flag.currentVersion}`).sort() ) {
				allTags.push(this.filter.buildTag(tag.toLowerCase()))
			}

			const halfMark = Math.ceil(allTags.length / 2)

			for ( let i = 0; i < halfMark; i++ ) {
				const tagNode = document.createElement('div')
				tagNode.classList.add('row', 'filter-row', 'border-top', 'mt-0', 'py-0', 'mx-0')
				tagNode.appendChild(allTags[i])
				if ( typeof allTags[i+halfMark] !== 'undefined') {
					tagNode.appendChild(allTags[i+halfMark])
				}
				dropNode.appendChild(tagNode)
			}

			const resetNode = document.createElement('i18n-text')
			resetNode.classList.add('btn', 'btn-primary', 'btn-sm', 'w-75', 'mx-auto', 'd-block', 'my-2')
			resetNode.setAttribute('data-key', 'filter_tag_reset')
			resetNode.addEventListener('click', () => {
				this.track.filter_must.clear()
				this.track.filter_not.clear()
				this.doDisplay('tagFilterReset')
			})
			dropNode.appendChild(resetNode)

			MA.byIdHTML('filter_new_style', '')
			MA.byId('filter_new_style').appendChild(dropNode)
		},
		buildTag : (tag) => {
			const must    = this.track.filter_must.has(tag)
			const mustNot = this.track.filter_not.has(tag)
			
			const tagNode    = document.createDocumentFragment()
			const tagNodeTag = document.createElement('div')
			tagNodeTag.classList.add('col-3', 'text-center', 'py-1')
			if ( tag === 'github_update' ) {
				tagNodeTag.appendChild(this.#buildGitHubUpdateBadge())
			} else if ( tag === 'rollback_available' ) {
				tagNodeTag.appendChild(this.#buildRollbackBadge())
			} else if ( tag === 'disabled' ) {
				tagNodeTag.appendChild(this.#buildDisabledBadge())
			} else {
				tagNodeTag.appendChild(I18N.buildBadgeMod({name : tag, class : []}))
			}
			tagNode.appendChild(tagNodeTag)

			const tagNodeBtn = document.createElement('div')
			tagNodeBtn.classList.add('col-3', 'py-1')
			tagNodeBtn.innerHTML = [
				'<div class="btn-group btn-group-sm" role="group">',
				`<button type="button" class="btn ${mustNot ? 'btn-warning' : 'btn-outline-warning'} rounded-0 rounded-start" data-tag-mode="not" title="Mod MUST NOT have this tag. Click again to clear this tag filter."><i class="bi bi-eye-slash"></i></button>`,
				`<button type="button" class="btn ${must ? 'btn-danger' : 'btn-outline-danger'} rounded-0 rounded-end" data-tag-mode="must" title="Mod MUST have this tag. Click again to clear this tag filter."><i class="bi bi-pin-angle"></i></button>`,
				'</div>',
			].join('')
			for ( const element of tagNodeBtn.querySelectorAll('button') ) {
				element.addEventListener('click', (e) => {
					const value = e.currentTarget.dataset.tagMode
					if ( value === 'must' && !must ) {
						this.track.filter_must.add(tag)
						this.track.filter_not.delete(tag)
					} else if ( value === 'not' && !mustNot ) {
						this.track.filter_must.delete(tag)
						this.track.filter_not.add(tag)
					} else {
						this.track.filter_must.delete(tag)
						this.track.filter_not.delete(tag)
					}
					this.doDisplay('tagFilterChange')
				})
			}
			tagNode.appendChild(tagNodeBtn)

			return tagNode
		},
		updateModeDisplay : () => {
			const toggle = MA.byId('tagRequiredAnyToggle')
			const label = MA.byId('tagRequiredModeLabel')
			if ( toggle !== null ) { toggle.checked = this.track.filter_must_any }
			if ( label !== null ) {
				label.textContent = this.track.filter_must_any ? 'Match any required tag' : 'Match all required tags'
			}
		},

		findClear : () => {
			MA.byIdValue('filter_input', '')
			this.track.searchString = ''
			this.doDisplay('findClear')
		},
		findForce : (text) => {
			MA.byIdValue('filter_input', text)
			this.filter.findTerm()
		},
		findTerm : () => {
			const newValue = MA.byIdValueLC('filter_input')
			const needsUpdate = this.track.searchString.length >= 2 ||
				(this.track.searchString.length <= 2 && newValue.length >= 2)
	
			this.track.searchString = MA.byIdValueLC('filter_input')
			MA.byId('filter_clear').clsHide(this.track.searchString.length === 0)
	
			if ( needsUpdate ) { this.doDisplay('findTerm') }
		},
		findType : () => {
			this.track.searchType = MA.byIdValue('modFindType')
			this.doDisplay('findType')
		},
	}

	select = {
		all : () => {
			if ( this.track.openCollection === null ) { return }

			const CKey = this.track.openCollection

			for ( const MKey of Object.keys(this.mods[CKey]) ) {
				this.track.selected.add(`${CKey}--${MKey}`)
			}
			this.refreshSelected()
			this.doSideBar()
		},
		count : () => {
			MA.byIdText('select_quantity', this.track.selected.size)
		},
		invert : () => {
			if ( this.track.openCollection === null ) { return }

			const CKey    = this.track.openCollection
			const allMods = new Set(Object.keys(this.mods[CKey]).map((MKey) => `${CKey}--${MKey}`))
			const invertedSelection = new Set()
			for ( const modID of allMods ) {
				if ( !this.track.selected.has(modID) ) {
					invertedSelection.add(modID)
				}
			}
			this.track.selected = invertedSelection
			this.refreshSelected()
			this.doSideBar()
		},
		none : () => {
			this.track.selected.clear()
			this.refreshSelected()
			this.doSideBar()
		},
		updates : () => {
			if ( this.track.openCollection === null ) { return }

			const CKey = this.track.openCollection

			this.track.selected.clear()
			for ( const [MKey, modRec] of Object.entries(this.mods[CKey]) ) {
				if ( modRec.updateCheck.hasGitHubUpdate || modRec.updateCheck.hasModHubUpdate ) {
					this.track.selected.add(`${CKey}--${MKey}`)
				}
			}
			this.refreshSelected()
			this.doSideBar()
		},
	}

	// MARK: collect order
	order = {
		next : (key) => {
			const thisIndex = this.orderMap.keyToNum[key]

			if ( typeof thisIndex === 'undefined' ) { return null }

			for ( let i = thisIndex + 1; i <= this.orderMap.max; i++ ) {
				if ( typeof this.orderMap.numToKey[i] !== 'undefined' ) { return i }
			}
			return null
		},
		prev : (key) => {
			const thisIndex = this.orderMap.keyToNum[key]

			if ( typeof thisIndex === 'undefined' ) { return null }

			for ( let i = thisIndex - 1; i >= 0; i-- ) {
				if ( typeof this.orderMap.numToKey[i] !== 'undefined' ) { return i }
			}
			return null
		},
		set : (CKey, moveUp, forceLast = false) => {
			const curIndex = this.orderMap.keyToNum[CKey]
			const newIndex = forceLast ?
				moveUp ? 0 : this.orderMap.max :
				moveUp ? this.order.prev(CKey) : this.order.next(CKey)

			if ( curIndex !== null && newIndex !== null ) {
				this.track.scrollPosition = MA.byId('mod-collections').offsetParent.scrollTop
				window.main_IPC.folder.set(curIndex, newIndex)
			}
		},
	}

	// MARK: actions
	action = {
		collectActive : async () => {
			const activePick = MA.byIdValue('collectionSelect').replace('collection--', '')
		
			if ( activePick !== '0' && activePick !== '999' ) {
				LEDLib.blinkLED()
				
				return window.main_IPC.folder.active(activePick).then((result) => {
					if ( this.flag.gameRunning ) {
						window.i18n.get('game_running_warning').then((entry) => {
							MA.alert(entry.entry)
						})
					}
					return result
				})
				
			}
		},
		collectInActive : async () => {
			MA.byIdValue('collectionSelect', 0)
			return window.main_IPC.folder.active(null)
		},
		disableGameLogIssueMods : async () => {
			const modIDs = this.#selectedGameLogIssueModIDs()
			if ( modIDs.length === 0 ) { return }
			MA.byId('gameLogIssuesDisable').disabled = true
			this.track.pendingSearchFocus = true
			try {
				const result = await window.main_IPC.files.disableSelected(modIDs)
				MA.alert(`Disabled ${result.disabled} log issue mod(s); ${result.failed} could not be disabled.`)
				this.modal.gameLogIssues.hide()
				this.track.selected.clear()
				this.forceSelectOnly(false)
			} catch (err) {
				this.track.pendingSearchFocus = false
				MA.alert(`Disable failed: ${err.message}`)
				MA.byId('gameLogIssuesDisable').disabled = false
			}
		},
		disableSelectedMods : async () => {
			const selectedRecords = this.#selectedEnabledZipModRecords()
			const modIDs = selectedRecords.map(({ modID }) => modID)
			if ( selectedRecords.length === 0 ) { return }
			MA.byId('batchDisableSelected').disabled = true
			this.track.pendingSearchFocus = true
			await this.files.runProgressOperation({
				detail     : `Disabling ${selectedRecords.length} selected mod${selectedRecords.length === 1 ? '' : 's'}...`,
				failureText : (result) => `Disabled ${result.disabled ?? 0}; ${result.failed ?? 0} failed.`,
				items      : selectedRecords.map(({ mod }) => this.#modStatusLabel(mod)),
				run        : (operationId) => window.main_IPC.files.disableSelected(modIDs, operationId),
				successText : (result) => `Disabled ${result.disabled ?? selectedRecords.length} selected mod${selectedRecords.length === 1 ? '' : 's'}.`,
				title      : 'Disabling selected mods',
			})
			this.#updateBatchModButtons()
		},
		disableSingleMod : async (modID, button = null) => {
			if ( typeof modID !== 'string' || modID === '' ) { return }
			if ( button !== null ) { button.disabled = true }
			this.track.pendingSearchFocus = true
			try {
				const result = await window.main_IPC.files.disableSelected([modID])
				if ( result.failed > 0 ) { MA.alert(`${result.failed} mod(s) could not be disabled.`) }
			} catch (err) {
				this.track.pendingSearchFocus = false
				MA.alert(`Disable failed: ${err.message}`)
				if ( button !== null ) { button.disabled = false }
			}
		},
		enableSelectedMods : async () => {
			const selectedRecords = this.#selectedDisabledZipModRecords()
			const filesByCollection = this.#selectedDisabledZipFilesByCollection()
			const fileCount = [...filesByCollection.values()].reduce((total, files) => total + files.length, 0)
			if ( fileCount === 0 ) { return }
			MA.byId('batchEnableSelected').disabled = true
			this.track.pendingSearchFocus = true
			await this.files.runProgressOperation({
				detail     : `Re-enabling ${fileCount} selected mod${fileCount === 1 ? '' : 's'}...`,
				failureText : (result) => `Re-enabled ${result.restored ?? 0}; ${result.failed ?? 0} failed.`,
				items      : selectedRecords.map(({ mod }) => this.#modStatusLabel(mod)),
				run        : async (operationId) => {
					let restored = 0
					let failed = 0
					const results = await Promise.all([...filesByCollection].map(([collectionKey, fileNames]) => (
						window.main_IPC.files.restoreDisabled(collectionKey, fileNames, operationId)
					)))
					for ( const result of results ) {
						restored += result.restored ?? 0
						failed += result.failed ?? 0
					}
					return { failed, restored }
				},
				successText : (result) => `Re-enabled ${result.restored ?? fileCount} selected mod${fileCount === 1 ? '' : 's'}.`,
				title      : 'Re-enabling selected mods',
			})
			this.#updateBatchModButtons()
		},
		enableSingleMod : async (thisMod, button = null) => {
			const collectionKey = thisMod?.currentCollection
			const filePath = thisMod?.fileDetail?.fullPath
			const fileName = typeof filePath === 'string' ? filePath.split(/[/\\]/).pop() : null
			if ( typeof collectionKey !== 'string' || collectionKey === '' || typeof fileName !== 'string' || fileName === '' ) { return }
			if ( button !== null ) { button.disabled = true }
			this.track.pendingSearchFocus = true
			try {
				const result = await window.main_IPC.files.restoreDisabled(collectionKey, [fileName])
				if ( result.failed > 0 ) { MA.alert(`${result.failed} mod(s) could not be enabled.`) }
			} catch (err) {
				this.track.pendingSearchFocus = false
				MA.alert(`Enable failed: ${err.message}`)
				if ( button !== null ) { button.disabled = false }
			}
		},
		launchGame() {
			const currentList = MA.byIdValue('collectionSelect')
			if ( currentList === window.state.flag.activeCollect ) {
				// Selected is active, no confirm
				window.state.#launchWithReadiness(window.state.flag.activeCollect)
			} else {
				// Different, ask confirmation
				MA.byIdHTML('no_match_game_list', window.state.mapCollectionDropdown.get(window.state.flag.activeCollect))
				MA.byIdHTML('no_match_ma_list', window.state.mapCollectionDropdown.get(currentList))
				LEDLib.fastBlinkLED()
				window.state.modal.mismatch.show()
			}
		},
		launchGame_CONTINUE : () => {
			window.state.modal.readiness.hide()
			window.state.track.pendingLaunchCollection = null
			window.state.#dispatchGameLaunch()
		},
		launchGame_FIX : () => {
			const launchCollection = MA.byIdValue('collectionSelect').replace('collection--', '')
			window.state.modal.mismatch.hide()
			window.state.action.collectActive().then(() => {
				window.state.#launchWithReadiness(launchCollection)
			})
		},
		launchGame_IGNORE : () => {
			window.state.modal.mismatch.hide()
			MA.byIdValue('collectionSelect', window.state.flag.activeCollect)
			window.state.#launchWithReadiness(window.state.flag.activeCollect)
		},
		openDisabledMods : async () => {
			await this.#openDisabledMods(this.#selectedCollectionKey())
		},
		openGameLogIssues : async () => {
			await this.#openGameLogIssues(this.#selectedCollectionKey())
		},
		openModInfo : (mod) => {
			window.settings.site(mod.fileDetail.shortName, false).then((value) => {
				MA.byIdHTML('mod_info_mod_name', mod.fileDetail.shortName)
				MA.byIdValue('mod_info_input', value)
				this.modal.modInfo.show()
			})
		},
		restoreSelectedDisabledMods : async () => {
			const collectionKey = this.disabledMods.collectionKey
			const selectedFiles = [...document.querySelectorAll('.disabled-mod-select:checked')].map((checkbox) => checkbox.value)
			if ( collectionKey === null || selectedFiles.length === 0 ) { return }
			MA.byId('disabledModsRestoreSelected').disabled = true
			try {
				const result = await window.main_IPC.files.restoreDisabled(collectionKey, selectedFiles)
				MA.alert(`Restored ${result.restored} mod(s); ${result.failed} could not be restored.`)
				await this.#openDisabledMods(collectionKey)
			} catch (err) {
				MA.alert(`Restore failed: ${err.message}`)
				MA.byId('disabledModsRestoreSelected').disabled = false
			}
		},
		selectGameLogIssueMods : () => {
			const selected = this.#selectedGameLogIssueModIDs()
			const modIDs = selected.length === 0 ?
				this.gameLogIssues.candidates.map((candidate) => candidate.modID) :
				selected
			this.modal.gameLogIssues.hide()
			this.#selectModIDsInCollection(this.gameLogIssues.collectionKey, modIDs)
		},
		selectMissingDependencyMods : () => {
			const collectionKey = this.track.pendingLaunchCollection
			if ( collectionKey === null ) { return }
			const modIDs = this.#collectionReadinessMissingDependencyItems(collectionKey, this.#collectionReadinessMods(collectionKey))
				.map((item) => item.modID)
			this.modal.readiness.hide()
			this.#selectModIDsInCollection(collectionKey, modIDs)
		},
		setModInfo : () => {
			window.settings.site(
				MA.byIdHTML('mod_info_mod_name'),
				MA.byIdValue('mod_info_input')
			)
			this.modal.modInfo.hide()
		},
	}
}

// MARK: SUB MODULES



// MARK: LEDLib
const LEDLib = {
	ledUSB : { filters : [{ vendorId : MA.led.vendor, productId : MA.led.product }] },

	blinkLED     : async () => { LEDLib.operateLED('blink') },
	fastBlinkLED : async () => { LEDLib.operateLED('blink', 1000) },
	spinLED      : async () => { LEDLib.operateLED('spin') },

	operateLED   : async (type = 'spin', time = 2500) => {
		if ( ! await window.settings.get('led_active') ) {
			window.log.debug('LED is not active')
			return
		}
		
		try {
			const clientLED = await navigator.hid.requestDevice(LEDLib.ledUSB)

			if ( clientLED.length === 0 ) { return }

			const clientLEDDevice = clientLED[0]

			await clientLEDDevice.open()
			await clientLEDDevice.sendReport(0x00, MA.led[type])
			setTimeout(async () => {
				await clientLEDDevice.sendReport(0x00, MA.led.off)
				await clientLEDDevice.close()
			}, time)
		} catch (err) {
			window.log.debug('Unable to spin LED (no light?)', err.message)
		}
	},
}

// MARK: PrefLib
class PrefLib {

	currentDev = null
	overlay    = null

	buttons = {
		changelog : {
			callback : () => { window.main_IPC.dispatch('changelog') },
			icon     : 'check2-circle',
		},
		reset_window : {
			callback : () => { window.settings.winReset() },
			icon     : 'check2-circle',
		},
		wizard : {
			callback : () => { window.main_IPC.dispatch('wizard') },
			icon     : 'check2-circle',
		},
	}

	inputs = {
		led : {
			set    : (input) => { this.#processCheck('led_active', input, true) },
			update : (input) => { this.#processCheck('led_active', input, false) },
		},
		poll_game : {
			set    : (input) => { this.#processCheck('poll_game', input, true) },
			update : (input) => { this.#processCheck('poll_game', input, false) },
		},
		show_tooltips : {
			set    : (input) => { this.#processCheck('show_tooltips', input, true) },
			update : (input) => { this.#processCheck('show_tooltips', input, false) },
		},
		use_one_drive : {
			set    : (input) => { this.#processCheck('use_one_drive', input, true) },
			update : (input) => { this.#processCheck('use_one_drive', input, false) },
		},
	}

	#processCheck(key, input, setValue = false) {
		if ( !setValue ) {
			window.settings.get(key).then((value) => {
				input.checked = value
			})
		} else {
			window.settings.set(key, input.checked).then((value) => {
				input.checked = value
			})
		}
	}

	update = []

	constructor () {
		this.overlay = new bootstrap.Offcanvas('#prefcanvas')
		MA.byId('prefcanvas').addEventListener('hide.bs.offcanvas', () => {
			window.state.dragDrop.flags.preventRun = false
		})
		MA.byId('prefcanvas').addEventListener('show.bs.offcanvas', () => {
			MA.byId('prefcanvas').querySelector('.offcanvas-body').scrollTop = 0
			window.state.dragDrop.flags.preventRun = true
		})
		MA.byId('prefs--close-btn').addEventListener('click', () => {
			this.overlay.hide() // Prefs Canvas
		})
		window.settings.receive('settings:invalidate', () => { this.forceUpdate() })
		this.init()
	}

	init() {
		for ( const element of MA.byId('prefcanvas').querySelectorAll('page-replace')) {
			const replaceType = element.safeAttribute('data-type')
			const replaceKey  = element.safeAttribute('data-name')
			const replaceExt  = element.safeAttribute('data-extra')
	
			switch ( replaceType ) {
				case 'version-input' :
					element.replaceWith(this.#doVersion(replaceKey))
					break
				case 'button-input':
					element.replaceWith(this.#doButton(replaceKey))
					break
				case 'special-input' :
					element.replaceWith(this.#doSpecial(replaceKey))
					break
				case 'switch-input':
					element.replaceWith(this.#doSwitch(replaceKey, replaceExt || 3))
					break
				default :
					break
			}
		}
	}

	forceUpdate() {
		for ( const update of this.update ) {
			update()
		}
	}

	open() {
		this.forceUpdate()
		this.overlay.show()
	}

	#doButton(key) {
		const node = document.createElement('div')
		node.innerHTML = [
			`<i18n-text class="inset-block-header" data-key="user_pref_title_${key}"></i18n-text>`,
			'<div class="row">',
			`<i18n-text class="inset-block-blurb-option col-9" data-key="user_pref_blurb_${key}"></i18n-text>`,
			`<div class="btn btn-primary btn-sm col-3 align-self-start"><i class="bi-${this.buttons[key].icon}"></i></div>`,
			'</div>'
		].join('')
		node.querySelector('.btn').addEventListener('click', this.buttons[key].callback)

		return node
	}

	#doSwitch(key, size = 3) {
		const node = document.createElement('div')
		node.innerHTML = [
			`<i18n-text class="inset-block-header" data-key="user_pref_title_${key}"></i18n-text>`,
			'<div class="row">',
			`<i18n-text class="inset-block-blurb-option col-${12-size}" data-key="user_pref_blurb_${key}"></i18n-text>`,
			`<div class="col-${size} form-switch custom-switch">`,
			'<input class="form-check-input" type="checkbox" role="switch">',
			'</div></div>',
		].join('')
		const input = node.querySelector('input')
		input.addEventListener('change', () => { this.inputs[key].set(input) })
		this.update.push(() => { this.inputs[key].update(input) })
		return node
	}

	#doSpecial(key) {
		const node = document.createElement('div')
		switch (key) {
			case 'font_size' : {
				node.innerHTML = [
					'<i18n-text class="inset-block-header" data-key="user_pref_title_font_size"></i18n-text>',
					'<div class="row">',
					'<i18n-text class="inset-block-blurb-option col-10" data-key="user_pref_blurb_font_size"></i18n-text>',
					'<div class="col-2 text-center small text-body-emphasis" id="pref--font_size_value">XX</div>',
					'<div class="col-12 mt-2">',
					'<input id="pref--font_size_input" type="range" class="form-range" min="70" max="150" step="1" >',
					'<div class="p-0" style="margin-top: -0.95rem"><i style="margin-left: calc(38% - 0.5rem)" class="text-body-tertiary bi-caret-up"></i></div>',
					'</div><div class="col-10 offset-1 mt-2">',
					'<i18n-text id="pref--font_size_reset" class="d-block btn btn-outline-primary btn-sm w-100 mx-auto" data-key="user_pref_font_size_default"></i18n-text>',
					'</div></div>',
				].join('')

				const font_size_number = node.querySelector('#pref--font_size_value')
				const font_size_slider = node.querySelector('#pref--font_size_input')
				const font_size_reset  = node.querySelector('#pref--font_size_reset')

				font_size_reset.addEventListener('click', () => {
					window.settings.set('font_size', 14).then((value) => {
						const percent = (value / 100) * 14
						font_size_slider.value       = value
						font_size_number.textContent = `${percent}%`
					})
				})
				font_size_slider.addEventListener('input', () => {
					font_size_number.textContent = `${Math.floor(font_size_slider.value)}%`
				})
				font_size_slider.addEventListener('change', () => {
					const numberValue = (font_size_slider.value / 100) * 14
					window.settings.set('font_size', numberValue).then((value) => {
						const percent = (value / 14) * 100
						font_size_slider.value       = value
						font_size_number.textContent = `${Math.floor(percent)}%`
					})
				})

				const font_size_update = () => {
					window.settings.get('font_size').then((value) => {
						const percent = (value / 14) * 100
						font_size_slider.value       = percent
						font_size_number.textContent = `${Math.floor(percent)}%`
					})
				}
				
				window?.operations?.receive('win:updateFontSize', font_size_update)

				this.update.push(font_size_update)
				break
			}
			case 'theme_color' : {
				node.innerHTML = [
					'<i18n-text class="inset-block-header" data-key="user_pref_title_theme_color"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option" data-key="user_pref_blurb_theme_color"></i18n-text>',
					'<select class="form-select mt-3 px-4" name="theme_select" id="theme_select"></select>',
				].join('')

				const theme_select = node.querySelector('select')
				
				theme_select.addEventListener('change', () => {
					window.settings.themeChange(theme_select.value)
				})

				const theme_update = () => {
					window.settings.themeList().then((values) => {
						theme_select.innerHTML = ''
						for ( const value of values ) {
							const opt = document.createElement('option')
							opt.value = value[0]
							opt.textContent = value[1]
							theme_select.appendChild(opt)
						}
						window.settings.get('color_theme').then((value) => {
							theme_select.value = value
						})
					})
				}

				this.update.push(theme_update)
				window?.operations?.receive('win:updateTheme', theme_update)
				break
			}
			case 'lang' : {
				node.innerHTML = [
					'<i18n-text class="inset-block-header" data-key="user_pref_title_lang"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option" data-key="user_pref_blurb_lang"></i18n-text>',
					'<select class="form-select mt-3 px-4" name="language_select" id="language_select"></select>',
					'<div class="row mt-2">',
					'<i18n-text class="inset-block-blurb-option col-9 fst-italic" data-key="user_pref_blurb2_lang"></i18n-text>',
					'<div class="col-3 form-check form-switch custom-switch">',
					'<input id="uPref_lock_lang" class="form-check-input" type="checkbox" role="switch">',
					'</div></div>'
				].join('')

				const lang_lock   = node.querySelector('input')
				const lang_select = node.querySelector('select')

				lang_lock.addEventListener('change', () => {
					window.settings.set('lang_lock', lang_lock.checked).then((value) => {
						lang_lock.checked = value
					})
				})
				lang_select.addEventListener('change', () => {
					window.i18n.lang(lang_select.value).then((value) => {
						lang_select.value = value
					})
				})

				const lang_update = () => {
					window.i18n.list().then((values) => {
						lang_select.innerHTML = ''
						for ( const value of values ) {
							const opt = document.createElement('option')
							opt.value = value[0]
							opt.textContent = value[1]
							lang_select.appendChild(opt)
						}
						window.i18n.lang().then((value) => {
							lang_select.value = value
						})
					})
					window.settings.get('lang_lock').then((value) => {
						lang_lock.checked = value
					})
					window.state.updateI18NDrops()
				}

				this.update.push(lang_update)
				window?.i18n?.receive('i18n:refresh', lang_update)
				break
			}
			case 'use_discord' : {
				node.innerHTML = [
					'<i18n-text class="inset-block-header" data-key="user_pref_title_use_discord"></i18n-text>',
					'<div class="row gy-2">',
					'<i18n-text class="inset-block-blurb-option col-10" data-key="user_pref_blurb_use_discord"></i18n-text>',
					'<div class="form-check form-switch custom-switch col-2">',
					'<input id="pref--use-discord-check" class="form-check-input" type="checkbox" role="switch">',
					'</div>',
					'<i18n-text class="col-6" data-key="user_pref_setting_discord_2"></i18n-text>',
					'<div class="col-6 px-0"><input type="text" class="form-control" id="pref--use-discord-c2" style="font-size: 70%"></div>',
					'<i18n-text class="col-6" data-key="user_pref_setting_discord_1"></i18n-text>',
					'<div class="col-6 px-0"><input type="text" class="form-control" id="pref--use-discord-c1" style="font-size: 70%"></div>',
					'</div>',
				].join('')
				const discord_check = node.querySelector('#pref--use-discord-check')
				const discord_text_1 = node.querySelector('#pref--use-discord-c1')
				const discord_text_2 = node.querySelector('#pref--use-discord-c2')

				discord_check.addEventListener('change', () => {
					window.settings.set('use_discord', discord_check.checked).then((value) => {
						discord_check.checked = value
					})
				})

				discord_text_1.addEventListener('change', () => {
					window.settings.set('use_discord_c1', discord_text_1.value).then((value) => {
						discord_text_1.value = value
					})
				})

				discord_text_2.addEventListener('change', () => {
					window.settings.set('use_discord_c2', discord_text_2.value).then((value) => {
						discord_text_2.value = value
					})
				})

				this.update.push(() => {
					window.settings.get('use_discord').then((value) => {
						discord_check.checked = value
					})
					window.settings.get('use_discord_c1').then((value) => {
						discord_text_1.value = value
					})
					window.settings.get('use_discord_c2').then((value) => {
						discord_text_2.value = value
					})
				})
				break
			}
			case 'cache_manage' :
				node.innerHTML = [
					'<i18n-text class="inset-block-header" data-key="user_pref_title_clean_cache"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option" data-key="user_pref_blurb_clean_cache"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option text-body-emphasis py-1" data-key="clean_cache_size" id="clean_cache_size"></i18n-text>',
					'<i18n-text class="d-block btn btn-success btn-sm w-75 mt-2 mx-auto mb-3" id="pref--cache-clean-btn" data-key="user_pref_button_clean_cache"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option" data-key="user_pref_blurb_clear_cache"></i18n-text>',
					'<i18n-text class="d-block btn btn-danger btn-sm w-75 mt-2 mx-auto" id="pref--cache-clear-btn" data-key="user_pref_button_clear_cache"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option mt-2" data-key="user_pref_blurb_clear_malware"></i18n-text>',
					'<i18n-text class="inset-block-blurb-option mt-2 text-body-emphasis py-1 fst-italic mx-3" data-key="clear_malware_size" id="clear_malware_size"></i18n-text>',
					'<i18n-text class="d-block btn btn-warning btn-sm w-75 mt-2 mx-auto" id="pref--cache-malware-btn" data-key="user_pref_button_clear_malware"></i18n-text>',
				].join('')

				this.update.push(() => {
					MA.byId('clear_malware_size').setAttribute('refresh', 'true')
					MA.byId('clean_cache_size').setAttribute('refresh', 'true')
				})

				node.querySelector('#pref--cache-clean-btn').addEventListener('click', () => {
					window.main_IPC.cache.clean()
				})
				node.querySelector('#pref--cache-clear-btn').addEventListener('click', () => {
					window.main_IPC.cache.clear()
				})
				node.querySelector('#pref--cache-malware-btn').addEventListener('click', () => {
					window.main_IPC.cache.malware()
				})
				break
			default :
				break
		}

		return node
	}

	#doVersion(ver) {
		const node = document.createElement('div')
		node.classList.add('col-12', 'inset-block')
		node.innerHTML = [
			'<div>',
			`<div class="inset-block-header"><i18n-text data-key="game_title_farming_simulator"></i18n-text> 20${ver}</div>`,
			'<div class="row">',

			'<div class="col-12 mt-3 inset-block"><div>',
			'<i18n-text class="inset-block-header" data-key="user_pref_title_game_settings"></i18n-text>',
			'<div class="input-group ">',
			`<input type="text" class="form-control" id="pref--${ver}-game-settings" readonly style="font-size: 70%">`,
			`<button class="btn btn-outline-secondary" id="pref--${ver}-game-settings-btn" type="button"><i class="bi bi-folder"></i></button>`,
			'</div>',
			'<i18n-text class="inset-block-subtext" data-key="user_pref_blurb_game_settings"></i18n-text>',
			'</div></div>',

			'<div class="col-12 mt-3 inset-block"><div>',
			'<i18n-text class="inset-block-header" data-key="user_pref_title_game_path"></i18n-text>',
			'<div class="input-group ">',
			`<input type="text" class="form-control" id="pref--${ver}-game-path" readonly style="font-size: 70%">`,
			`<button class="btn btn-outline-secondary" id="pref--${ver}-game-path-btn" type="button"><i class="bi bi-folder"></i></button>`,
			'</div>',
			'<i18n-text class="inset-block-subtext" data-key="user_pref_blurb_game_path"></i18n-text>',
			'</div></div>',

			'<div class="col-12 mt-3 inset-block"><div>',
			'<i18n-text class="inset-block-header" data-key="user_pref_setting_game_args"></i18n-text>',
			`<input type="text" class="form-control" id="pref--${ver}-game-args" style="font-size: 70%">`,
			'<i18n-text class="inset-block-subtext" data-key="user_pref_setting_game_args_example"></i18n-text>',
			'<div class="text-end">',
			`<i18n-text class="btn btn-sm btn-outline-danger" id="pref--${ver}-game-args-cheat" data-key="user_pref_setting_game_cheats"></i18n-text>`,
			`<i18n-text class="btn btn-sm btn-outline-danger ms-1" id="pref--${ver}-game-args-video" data-key="user_pref_setting_game_video"></i18n-text>`,
			'</div></div></div>',

			'<div class="col-12"><div class="row">',

			'<div class="col-6 mt-3 inset-block"><div>',
			'<i18n-text class="inset-block-header" data-key="user_pref_title_game_enabled"></i18n-text>',
			'<div class="row">',
			'<i18n-text class="inset-block-blurb-option col-10 align-self-center" data-key="user_pref_blurb_game_enabled"></i18n-text>',
			'<div class="form-check form-switch custom-switch col-2">',
			`<input id="pref--${ver}-game-enabled" class="form-check-input" type="checkbox" role="switch">`,
			'</div></div></div></div>',

			'<div class="col-6 mt-3 inset-block"><div>',
			'<i18n-text class="inset-block-header" data-key="user_pref_title_dev"></i18n-text>',
			'<div class="row">',
			'<i18n-text class="inset-block-blurb-option col-10 align-self-center" data-key="user_pref_blurb_dev"></i18n-text>',
			'<div class="form-check form-switch custom-switch col-2">',
			`<input id="pref--${ver}-dev-mode" class="form-check-input" type="checkbox" role="switch">`,
			'</div></div></div></div>',

			'<div class="col-12 mt-3 inset-block"><div>',
			'<i18n-text class="inset-block-header" data-key="user_pref_title_clear"></i18n-text>',
			'<div class="row">',
			'<i18n-text class="inset-block-blurb-option col-12 align-self-center" data-key="user_pref_blurb_clear"></i18n-text>',
			'<div class="col-12 mt-2">',
			`<i18n-text data-key="user_pref_button_clear" id="pref--${ver}-clear" class="btn btn-sm btn-danger w-100" type="button"></i18n-text>`,
			'</div></div></div></div>',
			'</div></div>',

			'</div>',
			'</div>'
		].join('')

		const button_game_path = node.querySelector(`#pref--${ver}-game-path-btn`)
		const button_set_path  = node.querySelector(`#pref--${ver}-game-settings-btn`)
		const button_clear     = node.querySelector(`#pref--${ver}-clear`)
		const value_game_path  = node.querySelector(`#pref--${ver}-game-path`)
		const value_set_path   = node.querySelector(`#pref--${ver}-game-settings`)
		const value_args       = node.querySelector(`#pref--${ver}-game-args`)
		const switch_dev_mode  = node.querySelector(`#pref--${ver}-dev-mode`)
		const switch_enabled   = node.querySelector(`#pref--${ver}-game-enabled`)


		const arg_cheats = node.querySelector(`#pref--${ver}-game-args-cheat`)
		const arg_video  = node.querySelector(`#pref--${ver}-game-args-video`)

		const updater = () => {
			window.settings.dev().then((dev) => {
				this.currentDev = dev

				window.settings.get(`game_settings_${ver}`).then((value) => {
					value_set_path.value = value
				})
				window.settings.get(`game_path_${ver}`).then((value) => {
					value_game_path.value = value
				})
				window.settings.get(`game_args_${ver}`).then((value) => {
					const args_split = new Set(value.split(' '))

					if ( args_split.has('-cheats') ) {
						arg_cheats.classList.remove('btn-outline-danger')
						arg_cheats.classList.add('btn-success')
					} else {
						arg_cheats.classList.add('btn-outline-danger')
						arg_cheats.classList.remove('btn-success')
					}

					if ( args_split.has('-skipStartVideos') ) {
						arg_video.classList.remove('btn-outline-danger')
						arg_video.classList.add('btn-success')
					} else {
						arg_video.classList.add('btn-outline-danger')
						arg_video.classList.remove('btn-success')
					}

					value_args.value = value

				})
				window.settings.get(`game_enabled_${ver}`).then((value) => {
					switch_enabled.checked = value
				})
				switch_dev_mode.checked = this.currentDev[ver]
			})
		}

		arg_video.addEventListener('click', () => {
			window.settings.get(`game_args_${ver}`).then((currentValue) => {
				const args_split = new Set(currentValue.split(' '))

				if ( args_split.has('-skipStartVideos') ) {
					args_split.delete('-skipStartVideos')
				} else {
					args_split.add('-skipStartVideos')
				}

				window.settings.set(`game_args_${ver}`, [...args_split].join(' ')).then(() => {
					updater()
				})
			})
		})

		arg_cheats.addEventListener('click', () => {
			window.settings.get(`game_args_${ver}`).then((currentValue) => {
				const args_split = new Set(currentValue.split(' '))

				if ( args_split.has('-cheats') ) {
					args_split.delete('-cheats')
				} else {
					args_split.add('-cheats')
				}

				window.settings.set(`game_args_${ver}`, [...args_split].join(' ')).then(() => {
					updater()
				})
			})
		})

		button_game_path.addEventListener('click', () => {
			window.settings.setGamePath(ver)
		})

		button_set_path.addEventListener('click', () => {
			window.settings.setPrefFile(ver)
		})

		button_clear.addEventListener('click', () => {
			window.settings.clearVer(ver).then(() => {
				updater()
			})
		})

		value_args.addEventListener('change', () => {
			window.settings.set(`game_args_${ver}`, value_args.value).then((value) => {
				value_args.value = value
			})
		})

		switch_dev_mode.addEventListener('change', () => {
			window.settings.set(`dev_mode_${ver}`, switch_dev_mode.checked).then(() => {
				window.settings.dev().then((value) => {
					this.currentDev = value
					switch_dev_mode.checked = this.currentDev[ver]
				})
			})
		})

		switch_enabled.addEventListener('change', () => {
			window.settings.set(`game_enabled_${ver}`, switch_enabled.checked).then((value) => {
				switch_enabled.checked = value
			})
		})


		this.update.push(updater)
		return node

	}
}

// MARK: DragDropLib
class DragDropLib {
	flags = {
		isFolder   : false,
		isRunning  : false,
		preventRun : false,
	}

	feedback = {
		backdrop         : null,
		file             : null,
		folder           : null,
		icon_csv_file    : null,
		icon_normal_file : null,
		text_csv_file    : null,
		text_normal_file : null,
	}

	constructor() {
		/*
		drag	...a dragged item (element or text selection) is dragged.
		dragend	...a drag operation ends
		dragenter	...a dragged item enters a valid drop target.
		dragleave	...a dragged item leaves a valid drop target.
		dragover	...a dragged item is being dragged over a valid drop target, every few hundred milliseconds.
		dragstart	...the user starts dragging an item.
		drop	...an item is dropped on a valid drop target.
		*/

		const dragTarget = MA.byId('drag_target')
		dragTarget.addEventListener('dragenter', (e) => { this.dragEnter(e) } )
		dragTarget.addEventListener('dragleave', (e) => { this.dragLeave(e) } )
		dragTarget.addEventListener('dragover',  (e) => { this.dragOver(e) } )
		dragTarget.addEventListener('dragend',   (e) => { this.dragEnd(e) } )
		dragTarget.addEventListener('drop',      (e) => { this.dragDrop(e) } )
		dragTarget.addEventListener('dragend',   (e) => { this.dragEnd(e) } )

		this.feedback.backdrop         = MA.byId('drag_back')
		this.feedback.file             = MA.byId('drag_add_file')
		this.feedback.folder           = MA.byId('drag_add_folder')
		this.feedback.text_csv_file    = MA.byId('csv-yes-text')
		this.feedback.text_normal_file = MA.byId('csv-no-text')
		this.feedback.icon_csv_file    = MA.byId('csv-yes')
		this.feedback.icon_normal_file = MA.byId('csv-no')

		this.feedback.backdrop.addEventListener('dragenter', (e) => { this.dragEnter(e) } )
		this.feedback.backdrop.addEventListener('dragleave', (e) => { this.dragLeave(e) } )
		this.feedback.backdrop.addEventListener('dragover',  (e) => { this.dragOver(e) } )
		this.feedback.backdrop.addEventListener('dragend',   (e) => { this.dragEnd(e) } )
		this.feedback.backdrop.addEventListener('drop',      (e) => { this.dragDrop(e) } )
	}

	resetArea(area) {
		area.classList.remove('d-none', 'bg-primary')
	}

	csvTrueSwitch(isCSV) {
		this.feedback.text_csv_file.clsShow(isCSV)
		this.feedback.text_normal_file.clsHide(isCSV)
		this.feedback.icon_csv_file.clsShow(isCSV)
		this.feedback.icon_normal_file.clsHide(isCSV)
	}

	dragEnd (e) {
		e.preventDefault()
		e.stopPropagation()
	}

	dragDrop (e) {
		e.preventDefault()
		e.stopPropagation()
	
		if ( window.state.files.flags.isRunning ) { return }
		if ( this.flags.preventRun ) { return }
		
		const types = e.dataTransfer.types

		if (types.length !== 1 || !types.includes('Files')) { return }

		this.flags.isRunning = false

		const dt    = e.dataTransfer
		const files = dt.files

		if ( this.flags.isFolder ) {
			window.main_IPC.folder.drop(files[0])
		} else {
			window.main_IPC.files.drop(files).then((result) => {
				if ( typeof result !== 'undefined' ) {
					window.state.files.start_external('import', result)
				}
			})
		}

		this.feedback.backdrop.clsHide()
		this.resetArea(this.feedback.file)
		this.resetArea(this.feedback.folder)
		this.flags.isFolder = false
	}

	dragEnter (e) {
		e.preventDefault()
		e.stopPropagation()
	
		if ( window.state.files.flags.isRunning ) { return }
		if ( this.flags.preventRun ) { return }

		const types = e.dataTransfer.types

		if (types.length !== 1 || !types.includes('Files')) { return }

		if ( !this.flags.isRunning ) {
			
			this.feedback.backdrop.clsShow()
		
			const isCSV = e.dataTransfer.items[0].type === 'text/csv'
	
			this.csvTrueSwitch(isCSV)
	
			if ( e.dataTransfer.items.length > 1 || e.dataTransfer.items[0].type !== '' ) {
				// multiple or non-empty type
				this.feedback.folder.clsHide()
			}
	
		} else {
			let   thisID    = e.target.id
			const thePath   = e.composedPath()
	
			if ( thisID !== 'drag_add_folder' && thisID !== 'drag_add_file' ) {
				if ( thePath.includes(this.feedback.folder) ) { thisID = 'drag_add_folder' }
				if ( thePath.includes(this.feedback.file) )   { thisID = 'drag_add_file' }
			}
			if ( thisID === 'drag_add_folder' ) {
				this.feedback.folder.classList.add('bg-primary')
				this.feedback.file.classList.remove('bg-primary')
				this.flags.isFolder = true
			}
			if ( thisID === 'drag_add_file' ) {
				this.feedback.folder.classList.remove('bg-primary')
				this.feedback.file.classList.add('bg-primary')
				this.flags.isFolder = false
			}
		}
	
		this.flags.isRunning = true
	}
	dragLeave (e) {
		e.preventDefault()
		e.stopPropagation()
	
		if ( e.x <= 0 && e.y <= 0 ) {
			this.flags.isRunning = false
			this.flags.isFolder  = false
			this.feedback.backdrop.clsHide()
	
			this.resetArea(this.feedback.file)
			this.resetArea(this.feedback.folder)
		}
	}
	dragOver (e) {
		e.preventDefault()
		e.stopPropagation()
	
		e.dataTransfer.dropEffect = (this.flags.isFolder ? 'link' : 'copy')
	}
}

// MARK: modal overlays
class ModalOverlay {
	overlay = null

	constructor(id) {
		this.overlay = new bootstrap.Modal(id, {backdrop : 'static'})
		this.overlay.hide() // Modal Overlay Class
	}

	show() {
		this.overlay.show()
	}

	hide() {
		this.overlay.hide() // Modal Overlay Class
	}
}

// MARK: LoaderLib
class LoaderLib {
	overlay = null

	lastTotal = 1
	startTime = Date.now()

	constructor() {
		this.overlay = MA.byId('loadOverlay')
	}

	hide() { this.overlay?.clsHide() }
	show() { this.overlay?.clsShow() }

	hideCount() {
		MA.byId('loadOverlay_statusCount').clsHide()
		MA.byId('loadOverlay_statusProgBar').clsHide()
	}
	startDownload() {
		this.startTime = Date.now()
		MA.byId('loadOverlay_downloadCancel').clsShow()
		MA.byId('loadOverlay_speed').clsShow()
	}
	async updateCount(count, inMB = false) {
		const thisCount   = inMB ? await DATA.bytesToMB(count, false) : count
		const thisElement = MA.byId('loadOverlay_statusCurrent')
		const thisProg    = MA.byId('loadOverlay_statusProgBarInner')
		const thisProgLabel = MA.byId('loadOverlay_statusProgBarLabel')
		const thisPercent = `${Math.max(Math.ceil((count / this.lastTotal) * 100), 0)}%`
	
		if ( thisProg !== null ) { thisProg.style.width = thisPercent }
		if ( thisProgLabel !== null ) { thisProgLabel.textContent = `${thisCount} / ${MA.byId('loadOverlay_statusTotal')?.textContent ?? this.lastTotal}` }
	
		if ( thisElement !== null ) { thisElement.innerHTML = thisCount }
	
		if ( inMB ) {
			const perDone    = Math.max(1, Math.ceil((count / this.lastTotal) * 100))
			const perRem     = 100 - perDone
			const elapsedSec = (Date.now() - this.startTime) / 1000
			const estSpeed   = await DATA.bytesToMBCalc(count, false) / elapsedSec // MB/sec
			const secRemain  = elapsedSec / perDone * perRem
	
			const prettyMinRemain = Math.floor(secRemain / 60)
			const prettySecRemain = secRemain % 60
	
			MA.byIdText('loadOverlay_speed_speed', `${estSpeed.toFixed(1)} MB/s`)
			MA.byIdText('loadOverlay_speed_time', `~ ${prettyMinRemain.toFixed(0).padStart(2, '0')}:${prettySecRemain.toFixed(0).padStart(2, '0')}`)
		}
	}
	updateText(mainTitle, subTitle, dlCancel) {
		MA.byIdHTML('loadOverlay_statusMessage', mainTitle)
		MA.byIdHTML('loadOverlay_statusDetail', subTitle)
		MA.byIdText('loadOverlay_statusTotal', '0')
		MA.byIdText('loadOverlay_statusCurrent', '0')
		MA.byIdText('loadOverlay_statusProgBarLabel', '')
		MA.byIdHTML('loadOverlay_downloadCancelButton', dlCancel)
	
		MA.byId('loadOverlay_statusCount').clsShow()
		MA.byId('loadOverlay_statusProgBar').clsShow()
	
		MA.byId('loadOverlay_downloadCancel').clsHide()
		MA.byId('loadOverlay_speed').clsHide()
		
		this.show()
	}
	async updateTotal(count, inMB = false) {
		if ( inMB ) { this.startTime = Date.now() }
		const thisCount   = inMB ? await DATA.bytesToMB(count) : count
		MA.byIdText('loadOverlay_statusTotal', thisCount)
		MA.byIdText('loadOverlay_statusProgBarLabel', `0 / ${thisCount}`)
		this.lastTotal = ( count < 1 ) ? 1 : count
	}
}

// MARK: FileLib
class FileLib {
	flags = {
		count      : 0,
		isRunning  : false,
		operation  : null,
	}

	overlay      = {}
	overlayDiv   = null
	feedback     = null
	infoData     = null

	dest_multi  = new Set(['import', 'multiCopy', 'multiMove', 'copyFavs'])
	dest_none   = new Set(['delete'])
	dest_single = new Set(['copy', 'move'])

	l10n_button = {
		copy      : 'copy',
		delete    : 'delete',
		favs      : 'copy',
		import    : 'copy',
		move      : 'move',
		multiCopy : 'copy',
		multiMove : 'move',
	}
	l10n_info = {
		copy      : 'confirm_copy_blurb',
		delete    : 'confirm_delete_blurb',
		favs      : 'confirm_copy_multi_blurb',
		import    : 'confirm_import_blurb',
		move      : 'confirm_move_blurb',
		multiCopy : 'confirm_copy_multi_blurb',
		multiMove : 'confirm_move_multi_blurb',
	}
	l10n_title = {
		copy      : 'confirm_copy_title',
		delete    : 'confirm_delete_title',
		favs      : 'confirm_multi_copy_title',
		import    : 'confirm_import_title',
		move      : 'confirm_move_title',
		multiCopy : 'confirm_multi_copy_title',
		multiMove : 'confirm_move_title',
	}

	lastPayload  = null
	statusStartedAt = 0
	statusOperationId = null
	statusLast = {
		current : 0,
		currentText : '',
		detail : '',
		percent : 0,
		title : '',
		total : 0,
	}
	selectedDest = new Set()
	buttonDest   = new Map()
	selectedMods = {}

	constructor() {
		this.overlayDiv = MA.byId('fileOpCanvas')
		this.overlay.show = () => {
			this.overlayDiv.clsShow()
			MA.byId('fileOpMini').clsHide()
			this.overlayDiv.querySelector('.fileOpCanvas-body').scrollTop = 0
		}
		this.overlay.hide = () => {
			this.overlayDiv.clsHide()
			MA.byId('fileOpMini').clsHide()
			this.stop()
		}
		this.overlay.collapse = () => {
			this.overlayDiv.clsHide()
			this.updateMiniStatus()
			MA.byId('fileOpMini').clsShow(this.flags.isRunning === true)
		}

		this.infoData = MA.byId('file_op_display')
		this.feedback = MA.byId('file_op_result')

		MA.byId('fileOpCanvas-button').addEventListener('click', () => { this.process() })
		MA.byId('fileOpCanvas-button-close').addEventListener('click', () => {
			if ( this.flags.isRunning === true && this.feedback.classList.contains('d-none') === false ) {
				this.overlay.collapse()
			} else {
				this.overlay.hide() // File Canvas
			}
		})
		MA.byId('fileOpMini').addEventListener('click', () => { this.overlay.show() })

		window.main_IPC.receive('files:operation', (mode, mods) => {
			this.start_external(mode, mods)
		})
		window.main_IPC.receive('files:batchStatus', (progress) => {
			this.updateStatusProgress(progress)
		})
	}

	// MARK: start (ext module)
	start_external(mode, mods) {
		if ( mods === null ) { return }
		this.flags.operation = mode
		this.flags.isRunning = true

		this.selectedDest.clear()
		this.buttonDest.clear()
		this.selectedMods = {}
		this.lastPayload = null

		this.display(mode, mods)
	}

	// MARK: start (button)
	start(mode, selectAll, selectOne) {
		const selectedList = Array.isArray(selectAll) ? selectAll : [...selectAll ?? []]
		if ( selectedList.length === 0 && selectOne === null ) { return }

		const realSelect = selectOne !== null ? [selectOne] : selectedList

		this.flags.operation = mode
		this.flags.isRunning = true

		this.selectedDest.clear()
		this.buttonDest.clear()
		this.selectedMods = {}
		this.lastPayload = null

		switch (mode) {
			case 'favs' :
				window.main_IPC.files.listFavs().then((files) => {
					if ( files === null ) {
						MA.alert('No favorite mods were found.')
					} else {
						this.display(mode, files)
					}
				})
				break
			case 'copy' :
			case 'move' :
			case 'delete' :
				window.main_IPC.files.list(mode, realSelect).then((files) => {
					this.display(mode, files)
				})
				break
			case 'zip' :
				window.main_IPC.files.exportZIP(realSelect)
				this.stop()
				break
			case 'openMods' :
				return window.main_IPC.files.openExplore(realSelect[0])
			case 'openHub' :
				return window.main_IPC.files.openModHub(realSelect[0])
			case 'openExt' :
				return window.main_IPC.files.openExtSite(realSelect[0])
			default :
				break
		}
	}

	// MARK: user buttons
	selectDestination(single = true, dest) {
		if ( this.selectedDest.has(dest) ) {
			this.selectedDest.delete(dest)
		} else if ( single ) {
			this.selectedDest.clear()
			this.selectedDest.add(dest)
		} else {
			this.selectedDest.add(dest)
		}
		for ( const [key, button] of this.buttonDest ) {
			button.clsOrGate(this.selectedDest.has(key), 'bg-success-subtle', 'bg-danger-subtle')
		}
		const selectArray = [...this.selectedDest]
		for ( const mod of Object.values(this.selectedMods) ) {
			if ( single && this.flags.operation !== 'delete') {
				mod.doAction = false
			}
			mod.destinations = selectArray
		}
		this.updateMods()
	}

	toggleMod(key) {
		this.selectedMods[key].doAction = !this.selectedMods[key].doAction
		this.updateMods()
	}

	// MARK: check conflict
	doesNewConflict(path) {
		if ( this.lastPayload.isZipImport ) { return false }
		const shortNameParts = path.split('\\')
		const shortNameExt   = shortNameParts.pop()
		const thisKey      = [...this.selectedDest][0]

		if ( shortNameExt.indexOf('.') !== -1 ) {
			if ( shortNameExt.endsWith('.zip') ) {
				const shortName = shortNameExt.replace('.zip', '')
				for ( const modKey of window.state.track.lastPayload.modList[thisKey].modSet ) {
					const checkMod = window.state.track.lastPayload.modList[thisKey].mods[modKey]
					if ( shortName === checkMod.fileDetail.shortName && !checkMod.fileDetail.isFolder ) {
						return true
					}
				}
				return false
			}
			return false
		}
		
		for ( const modKey of window.state.track.lastPayload.modList[thisKey].modSet ) {
			const checkMod = window.state.track.lastPayload.modList[thisKey].mods[modKey]
			if ( shortNameExt === checkMod.fileDetail.shortName && checkMod.fileDetail.isFolder ) {
				return true
			}
		}
		return false
	}

	doesModConflict(mod) {
		if ( this.selectedDest.size === 0 ) { return true }

		const thisKey = [...this.selectedDest][0]

		for ( const modKey of window.state.track.lastPayload.modList[thisKey].modSet ) {
			const checkMod = window.state.track.lastPayload.modList[thisKey].mods[modKey]
			if ( mod.fileDetail.shortName === checkMod.fileDetail.shortName && mod.fileDetail.isFolder === checkMod.fileDetail.isFolder ) {
				return true
			}
		}
		return false
	}

	// MARK: update display
	updateButton() {
		this.flags.count = 0

		if ( this.selectedDest.size !== 0 || this.flags.operation === 'delete' ) {
			for ( const mod of Object.values(this.selectedMods) ) {
				if ( mod.doAction ) { this.flags.count++ }
			}
		}

		const lookupOp = this.lastPayload.multiDestination ? `multi${this.flags.operation.slice(0, 1).toUpperCase()}${this.flags.operation.slice(1)}` : this.flags.operation

		MA.byIdHTML('fileOpCanvas-button', `${I18N.defer(this.l10n_button[lookupOp], false)} [${this.flags.count}]`)
		MA.byId('fileOpCanvas-button').clsEnable(this.flags.count)
	}

	showMod_known(mod) {
		return DATA.templateEngine('file_op_mod', {
			folderIcon : mod.fileDetail.isFolder ? '<i class="bi bi-folder2-open mod-folder-overlay"></i>' : '',
			iconImage  : `<img alt="" class="main-mod-icon" decoding="async" fetchpriority="low" height="64" loading="lazy" src="${DATA.iconMaker(mod.modDesc.iconImage)}" width="64">`,
			shortname  : mod.fileDetail.shortName,
			title      : window.state.doL10N(mod.l10n.title),
		})
	}

	showMod_new(path, zipFiles = null) {
		const shortNameParts = path.split('\\')
		const shortNameExt   = shortNameParts.pop()
		const isFolder       = shortNameExt.indexOf('.') === -1
		const shortName      = isFolder ? shortNameExt : shortNameExt.split('.')[0]

		return DATA.templateEngine('file_op_mod', {
			folderIcon : '',
			iconImage  : isFolder ?
				`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="currentColor" class="bi bi-folder-plus" viewBox="0 0 16 16">
					<path d="m.5 3 .04.87a2 2 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H9v-1H2.826a1 1 0 0 1-.995-.91l-.637-7A1 1 0 0 1 2.19 4h11.62a1 1 0 0 1 .996 1.09L14.54 8h1.005l.256-2.819A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2m5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19q-.362.002-.683.12L1.5 2.98a1 1 0 0 1 1-.98z"/>
					<path d="M13.5 9a.5.5 0 0 1 .5.5V11h1.5a.5.5 0 1 1 0 1H14v1.5a.5.5 0 1 1-1 0V12h-1.5a.5.5 0 0 1 0-1H13V9.5a.5.5 0 0 1 .5-.5"/>
				</svg>` :
				`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="currentColor" class="bi bi-file-earmark-plus" viewBox="0 0 16 16">
					<path d="M8 6.5a.5.5 0 0 1 .5.5v1.5H10a.5.5 0 0 1 0 1H8.5V11a.5.5 0 0 1-1 0V9.5H6a.5.5 0 0 1 0-1h1.5V7a.5.5 0 0 1 .5-.5"/>
					<path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/>
				</svg>`,
			shortname  : shortName,
			title      : zipFiles === null ? path.replaceAll('\\', '\\<wbr>') : [...zipFiles].join('<br>'),
		})
	}

	showMod(mod, hasDest, isDelete, isMulti) {
		const modPointer = this.flags.operation === 'import' ? mod : mod.colUUID
		let doesConflict = false
		if ( hasDest && !isDelete && !isMulti ) {
			if ( this.flags.operation !== 'import' ) {
				doesConflict = this.doesModConflict(mod)
			} else {
				doesConflict = this.doesNewConflict(mod)
			}
		}

		const thisModFileVersion = this.flags.operation !== 'import' ?
			mod.gameVersion :
			/FS(\d\d)_/.exec(mod)?.[1] || null

		const node = this.flags.operation !== 'import' ?
			this.showMod_known(mod) :
			this.showMod_new(mod, this.lastPayload.isZipImport ? this.lastPayload.zipFiles.map((x) => `${x.name} (${x.size})`) : null)

		if ( thisModFileVersion !== null && parseInt(thisModFileVersion) !== window.state.flag.currentVersion ) {
			node.querySelector('.version-diff').clsShow()
		} else {
			node.querySelector('.version-diff').clsHide()
		}

		if ( isMulti || isDelete ) {
			node.querySelector('.no-dest').clsHide()
			node.querySelector('.conf-dest').clsHide()
			node.querySelector('.over-dest').clsHide()
			node.querySelector('.clear-dest').clsHide()
		} else if ( !hasDest ) {
			node.querySelector('.no-dest').clsShow()
			node.querySelector('.conf-dest').clsHide()
			node.querySelector('.over-dest').clsHide()
			node.querySelector('.clear-dest').clsHide()
		} else {
			node.querySelector('.no-dest').clsHide()
			if ( doesConflict ) {
				node.firstElementChild.setAttribute('style', 'cursor:pointer')
				node.firstElementChild.addEventListener('click', () => { this.toggleMod(modPointer)} )
			} else {
				this.selectedMods[modPointer].doAction = true
			}
			node.querySelector('.conf-dest').clsShow((doesConflict && !this.selectedMods[modPointer].doAction))
			node.querySelector('.over-dest').clsShow((doesConflict && this.selectedMods[modPointer].doAction))
			node.querySelector('.clear-dest').clsShow(!doesConflict)
		}

		node.firstElementChild.children[0].clsOrGate(this.selectedMods[modPointer].doAction, 'bg-file-op-good', 'bg-file-op-bad')

		return node
	}

	updateMods() {
		const isDelete      = this.flags.operation === 'delete'
		const isMulti       = this.lastPayload.multiDestination
		const hasDest       = this.selectedDest.size !== 0

		const modList = MA.byId('fileOpCanvas-source')

		modList.innerHTML = ''
		if ( this.flags.operation !== 'import' ) {
			for ( const mod of this.lastPayload.records ) {
				modList.appendChild(this.showMod(mod, hasDest, isDelete, isMulti))
			}
		} else {
			for ( const mod of this.lastPayload.rawFileList ) {
				modList.appendChild(this.showMod(mod, hasDest, isDelete, isMulti))
			}
		}
		this.updateButton()
	}

	// MARK: prepare display
	display(mode, mods) {
		if ( mods === null ) {
			this.stop()
			return
		}
		this.lastPayload = mods
		this.selectedMods = {}

		const lookupOp = mods.multiDestination ? `multi${this.flags.operation.slice(0, 1).toUpperCase()}${this.flags.operation.slice(1)}` : this.flags.operation

		this.infoData.clsShow()
		this.feedback.clsHide()
		MA.byIdHTML('fileOpCanvas-title', I18N.defer(this.l10n_title[lookupOp], false))
		MA.byIdHTML('fileOpCanvas-info', I18N.defer(this.l10n_info[lookupOp], false))
		MA.byIdHTML('fileOpCanvas-button', `${I18N.defer(this.l10n_button[lookupOp], false)} [${this.flags.count}]`)
		MA.byId('fileOpCanvas-zipImport').clsShow(mods.isZipImport)

		const isSingle = mode !== 'delete' && !mods.multiDestination

		const collectPick = MA.byId('fileOpCanvas-destination')
		collectPick.innerHTML = ''
		collectPick.clsHide(mode === 'delete')

		if ( mode !== 'delete' ) {
			for ( const [key, info] of window.state.mapCollectionFiles ) {
				if ( key === mods.originCollectKey ) { continue }
				const node = DATA.templateEngine('file_op_collect_option', {
					icon : DATA.makeFolderIcon(
						false,
						false,
						false,
						false,
						info.color
					),
					name : info.name,
					tag  : info.tag === null ? '' : `<br><span class="small fst-italic">${info.tag}</span>`,
				})
				node.firstElementChild.addEventListener('click', () => { this.selectDestination(isSingle, key) })
				node.firstElementChild.setAttribute('title', info.folder)
				this.buttonDest.set(key, node.querySelector('.collect-indicate'))
				collectPick.appendChild(node)
			}
		}
		
		this.overlay.show()

		// NOTE: FILE OPS
		// destinations      : [thisCheck.value],
		// source_collectKey : sourceMod.collectKey,
		// source_modUUID    : sourceMod.uuid,
		// source_rawPath    : string (for drag-drop)
		// type              : 'copy','move','delete'

		if ( this.flags.operation === 'import' ) {
			for ( const file of this.lastPayload.rawFileList ) {
				this.selectedMods[file] = {
					destinations      : [],
					doAction          : false,
					source_collectKey : null,
					source_modUUID    : null,
					source_rawPath    : file,
					type              : this.lastPayload.isZipImport ? 'unzip' : 'copy',
				}
			}
		} else {
			for ( const mod of this.lastPayload.records ) {
				this.selectedMods[mod.colUUID] = {
					destinations      : [],
					doAction          : mode === 'delete' || this.lastPayload.multiDestination,
					source_collectKey : mod.currentCollection,
					source_modUUID    : mod.uuid,
					source_rawPath    : null,
					type              : this.flags.operation,
				}
			}
		}
		this.updateMods()
	}

	process() {
		const filePayload = Object.values(this.selectedMods).filter((x) => x.doAction)

		if ( filePayload.length === 0 ) { return }

		this.feedback.clsShow()
		this.infoData.clsHide()
		MA.byId('fileOpWorking').clsShow()
		MA.byId('fileOpSuccess').clsHide()
		MA.byId('fileOpDanger').clsHide()
		MA.byId('badFileFeedback').clsHide()
		const lookupOp = this.lastPayload.multiDestination ? `multi${this.flags.operation.slice(0, 1).toUpperCase()}${this.flags.operation.slice(1)}` : this.flags.operation
		const operationId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`
		this.statusOperationId = operationId
		this.statusStartedAt = performance.now()
		MA.byIdText('fileOpStatusTitle', I18N.defer(this.l10n_title[lookupOp], false))
		MA.byIdText('fileOpStatusDetail', `Processing ${filePayload.length} selected item${filePayload.length === 1 ? '' : 's'}...`)
		MA.byIdHTML('fileOpStatusList', '')
		this.resetStatusProgress(filePayload.length)
		this.setStatusProgress({
			current : 0,
			currentText : '',
			detail : `Processing ${filePayload.length} selected item${filePayload.length === 1 ? '' : 's'}...`,
			title : I18N.defer(this.l10n_title[lookupOp], false),
			total : filePayload.length,
		})

		window.main_IPC.files.process(filePayload, operationId).then((opResult) => {
			const didFail = opResult.some((x) => x.status === false )
			if ( didFail ) {
				MA.byId('fileOpDanger').clsShow()
				MA.byId('fileOpWorking').clsHide()
				MA.byId('badFileFeedback').clsShow()
				const badFiles = opResult
					.filter((x) => x.status === false)
					.map((x) => {
						if ( x.type === 'delete' ) {
							return `<i class="bi bi-trash3"></i> ${x.source}`
						}
						return `-> ${x.dest}<br>`
					})
				MA.byId('badFileList').innerHTML = badFiles.join('')
			} else {
				MA.byId('fileOpSuccess').clsShow()
				MA.byId('fileOpWorking').clsHide()
			}
			this.setStatusProgress({
				current : filePayload.length,
				currentText : '',
				detail : didFail ? 'Finished with issues.' : 'Finished.',
				title : didFail ? 'Finished with issues' : 'Finished',
				total : filePayload.length,
			})

			setTimeout(() => {
				this.overlay.hide() // File Canvas
				window.state.select.none()
				setTimeout(() => {
					window.main_IPC.folder.reload()
				}, 250)
			}, didFail ? 5000 : 1500)
		}).catch((err) => {
			MA.byId('fileOpWorking').clsHide()
			MA.byId('fileOpSuccess').clsHide()
			MA.byId('fileOpDanger').clsShow()
			MA.byIdText('fileOpStatusTitle', 'Operation failed')
			MA.byIdText('fileOpStatusDetail', err.message)
			this.statusLast.title = 'Operation failed'
			this.statusLast.detail = err.message
			this.updateMiniStatus()
			setTimeout(() => {
				this.overlay.hide()
			}, 5000)
		})
	}

	formatStatusDuration(ms) {
		if ( !Number.isFinite(ms) || ms <= 0 ) { return 'calculating' }
		const totalSeconds = Math.max(1, Math.round(ms / 1000))
		const minutes = Math.floor(totalSeconds / 60)
		const seconds = totalSeconds % 60
		if ( minutes === 0 ) { return `${seconds}s` }
		return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
	}

	setStatusProgress({
		current = 0,
		currentText = '',
		detail = null,
		title = null,
		total = 0,
	} = {}) {
		const safeTotal = Math.max(1, Number(total) || 1)
		const safeCurrent = Math.max(0, Math.min(safeTotal, Number(current) || 0))
		const percent = Math.round((safeCurrent / safeTotal) * 100)
		const elapsed = performance.now() - this.statusStartedAt
		const eta = safeCurrent > 0 && safeCurrent < safeTotal ? (elapsed / safeCurrent) * (safeTotal - safeCurrent) : null
		const etaText = eta === null ? '' : `, about ${this.formatStatusDuration(eta)} remaining`
		const label = `${safeCurrent} / ${safeTotal}${etaText}`

		this.statusLast = {
			current : safeCurrent,
			currentText,
			detail : detail ?? this.statusLast.detail,
			percent,
			title  : title ?? this.statusLast.title,
			total  : safeTotal,
		}

		MA.byId('fileOpStatusProgressInner').style.width = `${percent}%`
		MA.byId('fileOpStatusProgressInner').setAttribute('aria-valuenow', percent.toString())
		MA.byIdText('fileOpStatusProgressLabel', label)
		MA.byIdText('fileOpStatusCurrent', currentText)
		this.updateMiniStatus(label)
	}

	updateMiniStatus(label = null) {
		const progressLabel = label ?? `${this.statusLast.current} / ${Math.max(1, this.statusLast.total)}`
		MA.byIdText('fileOpMiniTitle', this.statusLast.title || 'File operation running')
		MA.byIdText('fileOpMiniDetail', this.statusLast.detail || 'Working...')
		MA.byId('fileOpMiniProgressInner').style.width = `${this.statusLast.percent}%`
		MA.byId('fileOpMiniProgressInner').setAttribute('aria-valuenow', this.statusLast.percent.toString())
		MA.byIdText('fileOpMiniProgressLabel', progressLabel)
		MA.byIdText('fileOpMiniCurrent', this.statusLast.currentText)
	}

	resetStatusProgress(total = 0) {
		MA.byId('fileOpStatusProgressWrap').clsShow()
		MA.byId('fileOpStatusProgressInner').style.width = '0%'
		MA.byId('fileOpStatusProgressInner').setAttribute('aria-valuenow', '0')
		MA.byIdText('fileOpStatusProgressLabel', `0 / ${total}`)
		MA.byIdText('fileOpStatusCurrent', '')
		this.statusLast = {
			current : 0,
			currentText : '',
			detail : this.statusLast.detail,
			percent : 0,
			title : this.statusLast.title,
			total,
		}
		this.updateMiniStatus()
	}

	updateStatusProgress(progress) {
		if ( this.statusOperationId === null || progress?.operationId !== this.statusOperationId ) { return }
		const verb = {
			copy    : 'Copied',
			delete  : 'Deleted',
			disable : 'Disabled',
			enable  : 'Re-enabled',
			favs    : 'Copied',
			file    : 'Processed',
			move    : 'Moved',
			unzip   : 'Imported',
		}[progress.operation] ?? 'Processed'
		const currentName = progress.modName ?? progress.fileName ?? ''
		this.setStatusProgress({
			current : progress.current,
			currentText : currentName === '' ? '' : `${verb}: ${currentName}`,
			total : progress.total,
		})
	}

	async runProgressOperation(options = {}) {
		const operationId = `status-${Date.now()}-${Math.random().toString(36).slice(2)}`
		this.statusOperationId = operationId
		this.statusStartedAt = performance.now()
		this.resetStatusProgress(options.items?.length ?? 0)
		MA.byId('fileOpWorking').clsHide()
		return this.runStatusOperation({
			...options,
			operationId,
			progress : true,
		})
	}

	/* eslint-disable-next-line complexity */
	async runStatusOperation({
		detail = '',
		failureText = null,
		items = [],
		operationId = null,
		progress = false,
		run,
		successText = null,
		title = 'Working...',
	} = {}) {
		if ( typeof run !== 'function' ) { return null }

		this.flags.operation = 'status'
		this.flags.isRunning = true
		this.lastPayload = null
		this.selectedMods = {}
		this.selectedDest.clear()
		this.buttonDest.clear()

		if ( operationId !== null ) {
			this.statusOperationId = operationId
			this.statusStartedAt = performance.now()
		} else {
			this.statusOperationId = null
		}
		MA.byIdText('fileOpStatusTitle', title)
		MA.byIdText('fileOpStatusDetail', detail)
		this.statusLast.title = title
		this.statusLast.detail = detail
		MA.byId('fileOpStatusProgressWrap').clsShow(progress === true)
		MA.byIdText('fileOpStatusCurrent', '')
		if ( progress === true ) { this.resetStatusProgress(items.length) }
		MA.byIdHTML('fileOpStatusList', items.length === 0 ? '' : [
			'<ul class="mb-0">',
			...items.slice(0, 12).map((item) => `<li>${DATA.escapeSpecial(item)}</li>`),
			items.length > 12 ? `<li>and ${items.length - 12} more...</li>` : '',
			'</ul>',
		].join(''))
		MA.byId('fileOpWorking').clsShow(progress !== true)
		MA.byId('fileOpSuccess').clsHide()
		MA.byId('fileOpDanger').clsHide()
		MA.byId('badFileFeedback').clsHide()
		this.feedback.clsShow()
		this.infoData.clsHide()
		this.overlay.show()

		try {
			const result = await run(operationId)
			const failed = result?.failed ?? 0
			const didFail = failed > 0
			MA.byId('fileOpWorking').clsHide()
			MA.byId('fileOpSuccess').clsShow(!didFail)
			MA.byId('fileOpDanger').clsShow(didFail)
			if ( progress === true ) {
				const total = items.length
				this.setStatusProgress({
					current : total,
					currentText : '',
					detail : didFail ? 'Finished with issues.' : 'Finished.',
					title : didFail ? 'Finished with issues' : 'Finished',
					total,
				})
			}
			MA.byIdText('fileOpStatusTitle', didFail ? 'Finished with issues' : 'Finished')
			MA.byIdText(
				'fileOpStatusDetail',
				didFail ?
					(typeof failureText === 'function' ? failureText(result) : failureText ?? 'Some selected mods could not be processed.') :
					(typeof successText === 'function' ? successText(result) : successText ?? 'Selected mods processed.')
			)
			if ( !didFail ) { window.state.select.none() }
			setTimeout(() => { this.overlay.hide() }, didFail ? 5000 : 1800)
			this.statusOperationId = null
			return result
		} catch (err) {
			MA.byId('fileOpWorking').clsHide()
			MA.byId('fileOpSuccess').clsHide()
			MA.byId('fileOpDanger').clsShow()
			MA.byIdText('fileOpStatusTitle', 'Operation failed')
			MA.byIdText('fileOpStatusDetail', err.message)
			this.statusLast.title = 'Operation failed'
			this.statusLast.detail = err.message
			this.updateMiniStatus()
			setTimeout(() => { this.overlay.hide() }, 5000)
			this.statusOperationId = null
			return null
		}
	}
	
	// MARK: keyboard interaction
	key(type) {
		if ( this.selectedDest.size === 0 ) { return }
		if ( this.flags.operation === 'delete' ) { return }
		if ( this.lastPayload.multiDestination ) { return }

		for ( const data of Object.values(this.selectedMods) ) {
			switch (type) {
				case 'all' :
					data.doAction = true
					break
				case 'invert' :
					data.doAction = !data.doAction
					break
				default :
					data.doAction = false
					break
			}
		}
		this.updateMods()
	}

	key_all()    { this.key('all') }
	key_invert() { this.key('invert') }
	key_none()   { this.key('none') }

	// MARK: stop operation and hide
	stop() {
		this.flags.count     = 0
		this.flags.isRunning = false
		this.flags.operation = null
		this.lastPayload     = null
		this.statusOperationId = null
		this.statusLast = {
			current : 0,
			currentText : '',
			detail : '',
			percent : 0,
			title : '',
			total : 0,
		}
		this.selectedMods    = {}
		this.selectedDest.clear()
		this.buttonDest.clear()
		MA.byId('fileOpMini').clsHide()
	}
}
