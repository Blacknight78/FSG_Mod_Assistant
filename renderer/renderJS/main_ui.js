/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Main Window UI

/* global bootstrap, MA, StateManager */

const rendererStartupStartedAt = performance.now()
let pendingModListPayload = null
let modListProcessTimer = null
let modListProcessPromise = null

function logRendererPerformance(label, startedAt, extraDetail = '') {
	const detailText = extraDetail === '' ? '' : ` ${extraDetail}`
	window.main_IPC.performance(`${label} took ${(performance.now() - startedAt).toFixed(1)} ms${detailText}`)
}

function scheduleModListProcess() {
	if ( modListProcessTimer !== null || modListProcessPromise !== null ) { return }

	modListProcessTimer = setTimeout(() => {
		modListProcessTimer = null
		const modCollect = pendingModListPayload
		pendingModListPayload = null
		if ( modCollect === null ) { return }

		const startedAt = performance.now()
		modListProcessPromise = window.state.updateFromData(modCollect)
			.then(() => {
				logRendererPerformance('Main renderer mods:list', startedAt)
			})
			.catch((err) => {
				window.main_IPC.performance(`Main renderer mods:list failed ${err.message}`)
			})
			.finally(() => {
				modListProcessPromise = null
				if ( pendingModListPayload !== null ) { scheduleModListProcess() }
			})
	}, 75)
}

// MARK: async events
window.operations.receive('select:invert', () => {
	if ( ! window.state.files.flags.isRunning ) { window.state.select.invert() }
	else { window.state.files.key_invert() }
})

window.operations.receive('select:none', () => {
	if ( ! window.state.files.flags.isRunning ) { window.state.select.none() }
	else { window.state.files.key_none() }
})

window.operations.receive('select:all', () => {
	if ( ! window.state.files.flags.isRunning ) { window.state.select.all() }
	else { window.state.files.key_all() }
})

window.main_IPC.receive('select:list', (list) => {
	const tableID = list[0].split('--')[0]
	window.state.colToggle(tableID, true)
	window.state.track.selected = new Set(list)
	window.state.forceSelectOnly()
	window.state.doDisplay('select:list')
	window.state.colScroll(tableID)
})

window.main_IPC.receive('select:withText', (list, text) => {
	const tableID = list.split('--')[0]
	window.state.colToggle(tableID, true)
	window.state.track.selected = new Set([list])
	window.state.filter.findForce(text)
	window.state.colScroll(tableID)
})

window.main_IPC.receive('mods:list', (modCollect) => {
	pendingModListPayload = modCollect
	scheduleModListProcess()
})
window.main_IPC.receive('mods:site', (mod) => {
	window.state.action.openModInfo(mod)
})

window.main_IPC.receive('app:closeBlocked', (payload = {}) => {
	const modalNode = MA.byId('app_close_guard_modal')
	const blockerList = MA.byId('appCloseGuardBlockers')
	const closeButton = MA.byId('appCloseGuardCloseAnyway')
	if ( modalNode === null || blockerList === null || closeButton === null ) { return }

	const blockers = Array.isArray(payload.blockers) && payload.blockers.length !== 0 ? payload.blockers : ['Background task']
	blockerList.replaceChildren()
	for ( const blocker of blockers ) {
		const item = document.createElement('li')
		item.textContent = blocker
		blockerList.appendChild(item)
	}

	closeButton.disabled = false
	closeButton.onclick = async () => {
		closeButton.disabled = true
		try {
			await window.main_IPC.closeApplicationAnyway()
		} catch (err) {
			window.main_IPC.performance(`Close anyway failed ${err.message}`)
			closeButton.disabled = false
		}
	}
	bootstrap.Modal.getOrCreateInstance(modalNode, { backdrop : 'static' }).show()
})

window.main_IPC.receive('app:confirmRequest', (payload = {}) => {
	const modalNode = MA.byId('app_confirm_modal')
	const titleNode = MA.byId('appConfirmTitle')
	const subtitleNode = MA.byId('appConfirmSubtitle')
	const messageNode = MA.byId('appConfirmMessage')
	const okButton = MA.byId('appConfirmOk')
	const cancelButton = MA.byId('appConfirmCancel')
	const closeButton = MA.byId('appConfirmClose')
	if ( modalNode === null || titleNode === null || subtitleNode === null || messageNode === null || okButton === null || cancelButton === null || closeButton === null ) { return }

	const requestID = typeof payload.id === 'string' ? payload.id : ''
	const modal = bootstrap.Modal.getOrCreateInstance(modalNode, { backdrop : 'static' })
	const respond = async (confirmed) => {
		okButton.disabled = true
		cancelButton.disabled = true
		closeButton.disabled = true
		try {
			await window.main_IPC.confirmResponse({ confirmed, id : requestID })
		} finally {
			modal.hide()
		}
	}

	titleNode.textContent = payload.title ?? 'Confirm action'
	subtitleNode.textContent = payload.subtitle ?? 'FSG Mod Assistant'
	messageNode.textContent = payload.message ?? ''
	okButton.textContent = payload.okText ?? 'OK'
	cancelButton.textContent = payload.cancelText ?? 'Cancel'
	cancelButton.hidden = payload.hideCancel === true
	okButton.className = `btn btn-lg ${payload.okClass ?? 'btn-primary'}`
	okButton.disabled = false
	cancelButton.disabled = false
	closeButton.disabled = false
	okButton.onclick = () => { void respond(true) }
	cancelButton.onclick = () => { void respond(false) }
	closeButton.onclick = () => { void respond(false) }
	modalNode.addEventListener('hidden.bs.modal', () => {
		okButton.onclick = null
		cancelButton.onclick = null
		closeButton.onclick = null
		cancelButton.hidden = false
	}, { once : true })
	modal.show()
	okButton.focus({ preventScroll : true })
})

// MARK: Loader Overlay
window.main_IPC.receive('loading:show',     () => { window.state.loader.show() })
window.main_IPC.receive('loading:hide',     () => { window.state.loader.hide() })
window.main_IPC.receive('loading:download', () => { window.state.loader.startDownload() })
window.main_IPC.receive('loading:noCount',  () => { window.state.loader.hideCount() })
window.main_IPC.receive('loading:titles',   (main, sub, cancel) => { window.state.loader.updateText(main, sub, cancel) })
window.main_IPC.receive('loading:total',    (count, inMB) => { window.state.loader.updateTotal(count, inMB) })
window.main_IPC.receive('loading:current',  (count, inMB) => { window.state.loader.updateCount(count, inMB) })


//MARK: top bar event
function topBarHandlers() {
	MA.byIdEventIfExists('bottomBar-debug',    () => { window.main_IPC.dispatch('debug') })
	MA.byIdEventIfExists('topBar-basegame',    () => { window.main_IPC.dispatch('basegame') })
	MA.byIdEventIfExists('topBar-find',        () => { window.main_IPC.dispatch('find') })
	MA.byIdEventIfExists('topBar-gamelog',     () => { window.main_IPC.dispatch('gamelog') })
	MA.byIdEventIfExists('topBar-help',        () => { window.main_IPC.dispatch('help') })
	MA.byIdEventIfExists('topBar-input',       () => { window.main_IPC.dispatch('input') })
	MA.byIdEventIfExists('topBar-launch',      () => { window.state.action.launchGame() })
	MA.byIdEventIfExists('topBar-mini',        () => { window.main_IPC.dispatch('mini') })
	MA.byIdEventIfExists('topBar-preferences', () => { window.state.prefs.open() })
	MA.byIdEventIfExists('topBar-savemanage',  () => { window.main_IPC.dispatch('savemanage') })
	MA.byIdEventIfExists('topBar-savetrack',   () => { window.main_IPC.dispatch('savetrack') })
	MA.byIdEventIfExists('topBar-tray',        () => { window.main_IPC.minimizeToTray() })
	MA.byIdEventIfExists('topBar-update',      () => { window.main_IPC.updateApplication() })
	MA.byIdEventIfExists('appVersionLink',     () => { window.main_IPC.openReleasePage() })
}

function openModManagementMenu() {
	bootstrap.Offcanvas.getOrCreateInstance(MA.byId('modManagementCanvas')).show()
}

function dispatchModManagementWindow(windowName) {
	const canvas = MA.byId('modManagementCanvas')
	const offcanvas = bootstrap.Offcanvas.getOrCreateInstance(canvas)
	const dispatchWindow = () => { window.main_IPC.dispatch(windowName) }
	if ( canvas.classList.contains('show') ) {
		canvas.addEventListener('hidden.bs.offcanvas', dispatchWindow, { once : true })
		offcanvas.hide()
		return
	}
	dispatchWindow()
}

//MARK: side bar event
function sideBarHandlers() {
	MA.byIdEventIfExists('mainModManagementButton', openModManagementMenu)
	for ( const button of document.querySelectorAll('.mod-management-menu-action') ) {
		button.addEventListener('click', () => { dispatchModManagementWindow(button.dataset.dispatchWindow) })
	}
}
// MARK: top UI event
function topUIHandlers() {
	MA.byIdEventIfExists('modSortOrder', () => { window.state.changeSort() }, 'change')
	MA.byIdEventIfExists('modFindType',  () => { window.state.filter.findType()}, 'change')
	MA.byIdEventIfExists('filter_input', () => { window.main_IPC.contextInput() }, 'contextmenu')
	MA.byIdEventIfExists('filter_input', () => { window.state.filter.findTerm() }, 'keyup')
	MA.byIdEventIfExists('filter_input', () => { window.state.filter.findTerm() }, 'blur')
	MA.byIdEventIfExists('filter_clear', () => { window.state.filter.findClear() }, 'click')

	MA.byIdEventIfExists('folderAddButton',    () => { window.main_IPC.folder.add() })
	MA.byIdEventIfExists('folderEditButton',   () => { window.main_IPC.folder.edit() })
	MA.byIdEventIfExists('folderReloadButton', () => { window.main_IPC.folder.reload() })
	MA.byIdEventIfExists('batchDisableSelected', () => { window.state.action.disableSelectedMods() })
	MA.byIdEventIfExists('batchEnableSelected',  () => { window.state.action.enableSelectedMods() })
	MA.byIdEventIfExists('disabledOnlyToggle',   () => { window.state.toggleDisabledOnly() })
	MA.byIdEventIfExists('advancedFilterToggle', () => { window.state.toggleAdvancedFilters() })
	MA.byIdEventIfExists('advancedFilterClose',  () => { window.state.toggleAdvancedFilters(false) })
	MA.byIdEventIfExists('tagRequiredAnyToggle', () => { window.state.toggleRequiredTagMode() }, 'change')
	MA.byIdEventIfExists('tagFilterHelpToggle',  () => { window.state.toggleTagFilterHelp() })

	MA.byIdEventIfExists('collectButtonActive',   () => { window.state.action.collectActive() })
	MA.byIdEventIfExists('collectButtonInActive', () => { window.state.action.collectInActive() })
}

function popUIHandlers() {
	MA.byIdEventIfExists('loadOverlay_downloadCancelButton', () => { window.main_IPC.cancelDownload() })
	MA.byIdEventIfExists('mismatchLaunchIgnore', () => { window.state.action.launchGame_IGNORE() })
	MA.byIdEventIfExists('mismatchLaunchFix',    () => { window.state.action.launchGame_FIX() })
	MA.byIdEventIfExists('collectionReadinessContinue', () => { window.state.action.launchGame_CONTINUE() })
	MA.byIdEventIfExists('collectionReadinessSelectMissingDependencies', () => { window.state.action.selectMissingDependencyMods() })
	MA.byIdEventIfExists('gameLogIssuesDisable', () => { window.state.action.disableGameLogIssueMods() })
	MA.byIdEventIfExists('gameLogIssuesSelect', () => { window.state.action.selectGameLogIssueMods() })
	MA.byIdEventIfExists('disabledModsRestoreSelected', () => { window.state.action.restoreSelectedDisabledMods() })

	MA.byIdEventIfExists('mod_info_input',  () => { window.main_IPC.contextInput() }, 'contextmenu')
	MA.byIdEventIfExists('mod_info_button', () => { window.state.action.setModInfo() })

	MA.byIdEventIfExists('prefOverlay-debug',    () => { window.main_IPC.dispatch('debug') })
}

// MARK: On Load
window.addEventListener('DOMContentLoaded', () => {
	logRendererPerformance('Main renderer DOMContentLoaded', rendererStartupStartedAt)
	const stateStartedAt = performance.now()
	window.state = new StateManager()
	logRendererPerformance('Main renderer StateManager construction', stateStartedAt)

	const handlersStartedAt = performance.now()
	topBarHandlers()
	sideBarHandlers()
	topUIHandlers()
	popUIHandlers()
	logRendererPerformance('Main renderer event binding', handlersStartedAt)

	window.addEventListener('hidden.bs.collapse', () => { window.state.select.none() })
	window.addEventListener('shown.bs.collapse',  () => { window.state.select.none() })

	setInterval(() => { window.state.updateState() }, 5000)
	requestAnimationFrame(() => {
		logRendererPerformance('Main renderer first animation frame', rendererStartupStartedAt)
	})
})


window.addEventListener('beforeunload', (e) => {
	if ( MA.byId('prefcanvas').classList.contains('show') ) {
		window.state.prefs.overlay.hide()
		e.preventDefault()
	} else if ( MA.byId('fileOpCanvas').classList.contains('show') ) {
		if ( window.state.files.flags.isRunning === true && window.state.files.feedback.classList.contains('d-none') === false ) {
			window.state.files.overlay.collapse()
		} else {
			window.state.files.overlay.hide()
		}
		e.preventDefault()
	}
})
