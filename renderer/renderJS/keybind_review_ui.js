/* global clientGetKeyMapSimple */

let activeCollectionKey = null
let activeReport = null
let pendingBindingEdit = null
let capturedBinding = null
let keybindEditModal = null
let keybindEditNoticeTimer = null

const KEYMAP_LAYOUT = [
	[
		[['KEY_esc', 'Esc'], null],
		Array.from({ length : 12 }, (_, index) => [`KEY_f${index + 1}`, `F${index + 1}`]),
		[null, null], [['KEY_print', 'PrtSc'], ['KEY_scrolllock', 'Scroll'], ['KEY_pause', 'Pause']],
	],
	[
		[['KEY_backquote', '`'], ...Array.from({ length : 9 }, (_, index) => [`KEY_${index + 1}`, String(index + 1)]), ['KEY_0', '0'], ['KEY_minus', '-'], ['KEY_equals', '='], ['KEY_backspace', 'Backspace', 2]],
		[['KEY_insert', 'Insert'], ['KEY_home', 'Home'], ['KEY_pageup', 'Page Up']],
		[['KEY_KP_numlock', 'Num'], ['KEY_KP_divide', '/'], ['KEY_KP_multiply', '*'], ['KEY_KP_minus', '-']],
	],
	[
		[['KEY_tab', 'Tab', 1.5], ...[...'qwertyuiop'].map((letter) => [`KEY_${letter}`, letter.toUpperCase()]), ['KEY_leftbracket', '['], ['KEY_rightbracket', ']'], ['KEY_backslash', '\\', 1.5]],
		[['KEY_delete', 'Delete'], ['KEY_end', 'End'], ['KEY_pagedown', 'Page Down']],
		[['KEY_KP_7', '7'], ['KEY_KP_8', '8'], ['KEY_KP_9', '9'], ['KEY_KP_plus', '+']],
	],
	[
		[['KEY_capslock', 'Caps', 1.8], ...[...'asdfghjkl'].map((letter) => [`KEY_${letter}`, letter.toUpperCase()]), ['KEY_semicolon', ';'], ['KEY_quote', '\''], ['KEY_return', 'Enter', 2.2]],
		[['KEY_KP_4', '4'], ['KEY_KP_5', '5'], ['KEY_KP_6', '6']],
	],
	[
		[['KEY_lshift', 'Shift', 2.4], ...[...'zxcvbnm'].map((letter) => [`KEY_${letter}`, letter.toUpperCase()]), ['KEY_comma', ','], ['KEY_period', '.'], ['KEY_slash', '/'], ['KEY_rshift', 'Shift', 2.8]],
		[['KEY_up', '↑']],
		[['KEY_KP_1', '1'], ['KEY_KP_2', '2'], ['KEY_KP_3', '3'], ['KEY_KP_enter', 'Enter']],
	],
	[
		[['KEY_lctrl', 'Ctrl', 1.5], ['KEY_lwin', 'Win'], ['KEY_lalt', 'Alt', 1.5], ['KEY_space', 'Space', 6], ['KEY_ralt', 'Alt', 1.5], ['KEY_menu', 'Menu'], ['KEY_rctrl', 'Ctrl', 1.5]],
		[['KEY_left', '←'], ['KEY_down', '↓'], ['KEY_right', '→']],
		[['KEY_KP_0', '0', 2], ['KEY_KP_period', '.']],
	],
]

const KEYMAP_TOKENS = new Set(KEYMAP_LAYOUT.flat(2).filter(Boolean).map(([token]) => token))

function collectModKeyAssignments(rows) {
	const assignments = new Map()
	for ( const row of rows ) {
		for ( const binding of row.bindings ) {
			if ( !binding.label ) { continue }
			const tokens = binding.label.split(/[+,\s]+/u).filter(Boolean)
			for ( const token of tokens ) {
				assignments.set(token, [...(assignments.get(token) ?? []), { binding, row }])
			}
		}
	}
	return assignments
}

function keyAssignmentTooltip(label, entries) {
	if ( entries.length === 0 ) { return `${label}: unused` }
	const actionLines = [...new Set(entries.map(({ binding, row }) => `${row.description ?? readableAction(row.action)} — Key combination: ${binding.label}`))]
	return `${label}\n${actionLines.join('\n')}`
}

function appendKeymapToken(parent, token, assignments, selectToken, options = {}) {
	const entries = assignments.get(token) ?? []
	const label = options.label ?? token
	const tooltip = keyAssignmentTooltip(label, entries)
	const button = addText(parent, 'button', '', `keymap-key${entries.length !== 0 ? ' is-used' : ''}${options.className ? ` ${options.className}` : ''}`)
	button.type = 'button'
	button.disabled = entries.length === 0
	button.setAttribute('aria-label', tooltip)
	button.title = tooltip
	button.style.setProperty('--key-grow', options.grow ?? 1)
	addText(button, 'span', label ?? token.replace(/^KEY_/u, ''), 'keymap-key-label')
	if ( entries.length > 1 ) { addText(button, 'span', entries.length, 'keymap-key-count') }
	if ( entries.length !== 0 ) { button.addEventListener('click', () => selectToken(token, button)) }
	return button
}

function renderModKeymap(target, rows) {
	const panel = document.createElement('section')
	panel.className = 'keymap-panel'
	panel.hidden = true
	addText(panel, 'p', 'Highlighted keys are used by this mod. Select one to see the action or actions assigned to it.', 'text-body-secondary mb-2')
	const assignments = collectModKeyAssignments(rows)
	const selection = addText(panel, 'div', 'Select a highlighted key to view its action.', 'keymap-selection text-body-secondary')
	const showSelection = (token, button) => {
		for (const item of panel.querySelectorAll('.keymap-key.selected, .keymap-other-control.selected')) item.classList.remove('selected')
		button.classList.add('selected')
		selection.replaceChildren()
		const items = assignments.get(token) ?? []
		addText(selection, 'h4', `Actions assigned to ${button.querySelector('.keymap-key-label')?.textContent ?? token}`, 'h6 mb-2')
		for ( const { binding, row } of items ) {
			const detail = addText(selection, 'article', '', 'keymap-action')
			addText(detail, 'strong', row.description ?? readableAction(row.action))
			addText(detail, 'div', `Action ID: ${row.action}`, 'small text-body-secondary')
			const display = addText(detail, 'div', '', 'small mt-1')
			const keyHTML = clientGetKeyMapSimple(binding.label.replaceAll(' + ', ' '), 'en')
			if ( typeof keyHTML === 'string' && !keyHTML.includes('undefined') ) { display.innerHTML = keyHTML }
			else { display.textContent = binding.label }
		}
	}

	const keyboard = addText(panel, 'div', '', 'keymap-scroll')
	const layout = addText(keyboard, 'div', '', 'keymap-layout')
	for ( const rowGroups of KEYMAP_LAYOUT ) {
		const row = addText(layout, 'div', '', 'keymap-row')
		for ( const keys of rowGroups ) {
			const cluster = addText(row, 'div', '', 'keymap-cluster')
			cluster.style.flex = `${keys.filter(Boolean).reduce((total, key) => total + (key[2] ?? 1), 0)} 1 0`
			for ( const key of keys ) {
				if ( key === null ) { addText(cluster, 'span', '', 'keymap-gap'); continue }
				const [token, label, grow] = key
				appendKeymapToken(cluster, token, assignments, showSelection, { label, grow })
			}
		}
	}

	const otherTokens = [...assignments.keys()].filter((token) => !KEYMAP_TOKENS.has(token))
	if ( otherTokens.length !== 0 ) {
		addText(panel, 'h4', 'Other assigned controls', 'h6 mt-3 mb-2')
		const controls = addText(panel, 'div', '', 'd-flex flex-wrap gap-2')
		for ( const token of otherTokens ) {
			const entries = assignments.get(token) ?? []
			const button = addText(controls, 'button', '', 'btn btn-outline-info keymap-other-control')
			button.type = 'button'
			button.title = keyAssignmentTooltip(token, entries)
			button.setAttribute('aria-label', button.title)
			const label = addText(button, 'span', '', 'me-1')
			const keyHTML = clientGetKeyMapSimple(token, 'en')
			if ( typeof keyHTML === 'string' && !keyHTML.includes('undefined') ) { label.innerHTML = keyHTML }
			else { label.textContent = token }
			if ( entries.length > 1 ) { addText(button, 'span', entries.length, 'badge text-bg-secondary ms-1') }
			button.addEventListener('click', () => showSelection(token, button))
		}
	}
	target.appendChild(panel)
	const toggle = addText(target, 'button', 'Show keyboard map', 'btn btn-sm btn-outline-info mb-3')
	toggle.type = 'button'
	toggle.setAttribute('aria-expanded', 'false')
	toggle.addEventListener('click', () => {
		panel.hidden = !panel.hidden
		toggle.setAttribute('aria-expanded', String(!panel.hidden))
		toggle.textContent = panel.hidden ? 'Show keyboard map' : 'Hide keyboard map'
	})
	target.insertBefore(toggle, panel)
}

function addText(parent, tag, text, className = '') {
	const node = document.createElement(tag)
	if ( className ) { node.className = className }
	node.textContent = text ?? ''
	parent.appendChild(node)
	return node
}

function setStatus(text) {
	document.getElementById('keybindSummary').textContent = text
}

function bindingLabels(row) {
	return row.bindings.map((binding) => binding.label).filter(Boolean).join(', ') || 'No key assigned'
}

function renderBindingKeys(parent, row) {
	const bindings = row.bindings.filter((binding) => binding.label)
	if ( bindings.length === 0 ) {
		const empty = addText(parent, 'div', 'No key assigned ', 'text-body-secondary')
		const set = addText(empty, 'button', 'Set key', 'btn btn-sm btn-outline-info ms-2')
		set.type = 'button'
		set.disabled = activeReport?.profileLoaded !== true
		set.title = 'A readable saved game profile is needed before bindings can be changed.'
		set.addEventListener('click', () => { void openBindingEditor(row, { index : null, device : 'KB_MOUSE_DEFAULT' }) })
		return
	}
	const group = addText(parent, 'div', '', 'd-flex flex-wrap gap-2 mt-1')
	for ( const binding of bindings ) {
		const combo = addText(group, 'span', '', 'd-inline-flex align-items-center gap-1')
		const normalized = binding.label.replaceAll(' + ', ' ')
		const keyHTML = clientGetKeyMapSimple(normalized, 'en')
		if ( typeof keyHTML === 'string' && !keyHTML.includes('undefined') ) { combo.innerHTML = keyHTML }
		else { combo.textContent = binding.label }
		const canEdit = binding.device === 'KB_MOUSE_DEFAULT' && activeReport?.profileLoaded === true
		const edit = addText(combo, 'button', binding.index === null ? 'Set' : 'Change', 'btn btn-sm btn-outline-info ms-1')
		edit.type = 'button'
		edit.disabled = !canEdit
		edit.title = binding.device !== 'KB_MOUSE_DEFAULT'
			? 'Controller bindings are not editable yet.'
			: (activeReport?.profileLoaded === true ? 'Change this keyboard binding' : 'A readable saved game profile is needed before bindings can be changed.')
		if ( canEdit ) { edit.addEventListener('click', () => { void openBindingEditor(row, binding) }) }
	}
}

function eventCodeToGameInput(code) {
	if ( /^Key[A-Z]$/u.test(code) ) { return `KEY_${code.slice(3).toLocaleLowerCase()}` }
	if ( /^Digit[0-9]$/u.test(code) ) { return `KEY_${code.slice(5)}` }
	if ( /^F(?:[1-9]|1[0-5])$/u.test(code) ) { return `KEY_${code.toLocaleLowerCase()}` }
	const codeMap = {
		ArrowDown : 'KEY_down', ArrowLeft : 'KEY_left', ArrowRight : 'KEY_right', ArrowUp : 'KEY_up',
		Backquote : 'KEY_backquote', Backslash : 'KEY_backslash', Backspace : 'KEY_backspace',
		BracketLeft : 'KEY_leftbracket', BracketRight : 'KEY_rightbracket', Comma : 'KEY_comma',
		Delete : 'KEY_delete', End : 'KEY_end', Enter : 'KEY_return', Equal : 'KEY_equals',
		Escape : 'KEY_esc', Home : 'KEY_home', Insert : 'KEY_insert', Minus : 'KEY_minus',
		PageDown : 'KEY_pagedown', PageUp : 'KEY_pageup', Period : 'KEY_period', Quote : 'KEY_quote',
		Semicolon : 'KEY_semicolon', Slash : 'KEY_slash', Space : 'KEY_space', Tab : 'KEY_tab',
	}
	if ( codeMap[code] ) { return codeMap[code] }
	if ( /^Numpad[0-9]$/u.test(code) ) { return `KEY_KP_${code.slice(6)}` }
	const keypadMap = { NumpadAdd : 'KEY_KP_plus', NumpadDecimal : 'KEY_KP_period', NumpadDivide : 'KEY_KP_divide', NumpadEnter : 'KEY_KP_enter', NumpadMultiply : 'KEY_KP_multiply', NumpadSubtract : 'KEY_KP_minus' }
	return keypadMap[code] ?? null
}

function showEditConflicts(conflicts) {
	const notice = document.getElementById('keybindEditConflicts')
	notice.replaceChildren()
	if ( conflicts.length === 0 ) {
		notice.className = 'alert alert-success'
		addText(notice, 'span', 'No other saved action uses this exact key combination.')
	} else {
		notice.className = 'alert alert-warning'
		addText(notice, 'p', `This key is already assigned to ${conflicts.length} other saved action${conflicts.length === 1 ? '' : 's'}:`, 'mb-2')
		const list = addText(notice, 'ul', '', 'mb-0')
		for ( const conflict of conflicts ) {
			addText(list, 'li', conflict.description ? `${conflict.description} (${conflict.action})` : conflict.action)
		}
	}
	document.getElementById('keybindEditSave').disabled = false
	document.getElementById('keybindEditSave').textContent = conflicts.length === 0 ? 'Save key' : 'Save despite conflicts'
}

async function previewCapturedBinding() {
	const status = document.getElementById('keybindEditStatus')
	const save = document.getElementById('keybindEditSave')
	const edit = pendingBindingEdit
	if ( !edit || !capturedBinding ) { return }
	save.disabled = true
	status.textContent = 'Checking for conflicts…'
	try {
		const result = await window.keybind_review_IPC.previewEdit({
			action : edit.action,
			bindingIndex : edit.bindingIndex,
			collectKey : activeCollectionKey,
			input : capturedBinding.input,
			modifier : capturedBinding.modifier,
		})
		if ( pendingBindingEdit !== edit ) { return }
		edit.confirmationKey = result.confirmationKey
		showEditConflicts(result.conflicts)
		status.textContent = 'Review the conflict result, then choose Save.'
	} catch (err) {
		status.textContent = err?.message ?? String(err)
		document.getElementById('keybindEditConflicts').className = 'alert alert-danger'
		document.getElementById('keybindEditConflicts').textContent = ''
		addText(document.getElementById('keybindEditConflicts'), 'span', status.textContent)
	}
}

async function openBindingEditor(row, binding) {
	const notice = document.getElementById('keybindEditNotice')
	notice.classList.add('d-none')
	if ( keybindEditNoticeTimer ) { window.clearTimeout(keybindEditNoticeTimer) }
	pendingBindingEdit = { action : row.action, bindingIndex : binding.index }
	capturedBinding = null
	document.getElementById('keybindEditTitle').textContent = `${row.modName} · ${row.action}`
	document.getElementById('keybindEditStatus').textContent = 'Press a keyboard key. You can hold Ctrl, Alt or Shift with it.'
	document.getElementById('keybindEditCaptured').textContent = 'Waiting for key…'
	document.getElementById('keybindEditConflicts').className = 'alert d-none'
	document.getElementById('keybindEditConflicts').replaceChildren()
	document.getElementById('keybindEditSave').disabled = true
	document.getElementById('keybindEditSave').textContent = 'Save key'
	keybindEditModal.show()
}

async function saveCapturedBinding() {
	const status = document.getElementById('keybindEditStatus')
	const save = document.getElementById('keybindEditSave')
	if ( !capturedBinding || !pendingBindingEdit ) { return }
	const edit = pendingBindingEdit
	save.disabled = true
	status.textContent = 'Saving key and creating an automatic backup…'
	try {
		const result = await window.keybind_review_IPC.saveEdit({
			action : edit.action,
			bindingIndex : edit.bindingIndex,
			collectKey : activeCollectionKey,
			confirmationKey : edit.confirmationKey,
			input : capturedBinding.input,
			modifier : capturedBinding.modifier,
		})
		if ( pendingBindingEdit !== edit ) { return }
		if ( result.requiresConfirmation ) {
			edit.confirmationKey = result.confirmationKey
			showEditConflicts(result.conflicts)
			status.textContent = 'The profile changed since the preview. Review these conflicts before saving.'
			return
		}
		keybindEditModal.hide()
		const notice = document.getElementById('keybindEditNotice')
		notice.textContent = `Key saved to the FS${result.gameVersion} profile. Automatic backup created: ${result.backupName}`
		notice.classList.remove('d-none')
		if ( keybindEditNoticeTimer ) { window.clearTimeout(keybindEditNoticeTimer) }
		keybindEditNoticeTimer = window.setTimeout(() => notice.classList.add('d-none'), 10000)
		void loadReport()
	} catch (err) {
		status.textContent = err?.message ?? String(err)
		save.disabled = false
	}
}

function readableAction(action) {
	return String(action ?? '').replaceAll('_', ' ').replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/\s+/gu, ' ').trim()
}

function addActionLabel(parent, entry) {
	if ( entry.description ) { addText(parent, 'div', entry.description, 'fw-semibold') }
	addText(parent, 'div', `${entry.modName} · ${entry.description ? entry.action : readableAction(entry.action)}${entry.description ? '' : ` · ${entry.action}`}`, 'small')
}

function appendModKeybindRow(parent, row, sharedBinding = false) {
	const line = addText(parent, 'article', '', `keybind-row${sharedBinding ? ' keybind-shared-action border-start border-4 border-warning ps-3' : ''}`)
	const header = document.createElement('div')
	header.className = 'd-flex flex-wrap justify-content-between gap-2'
	const actionName = row.description ?? readableAction(row.action)
	addText(header, 'strong', actionName)
	if ( sharedBinding ) {
		const badge = addText(header, 'span', 'Shared key', 'badge text-bg-warning')
		badge.title = 'This action shares at least one key assignment with another action. See Shared bindings to review above for details.'
	}
	const category = addText(header, 'span', row.category, 'badge text-bg-secondary')
	category.title = row.category.toLocaleUpperCase() === 'ALL'
		? 'Scope declared by the mod: this action is available in all contexts.'
		: 'Scope/category declared by the mod for this action.'
	category.setAttribute('aria-label', category.title)
	line.appendChild(header)
	addText(line, 'div', `Action ID: ${row.action}`, 'small text-body-secondary')
	renderBindingKeys(line, row)
	addText(line, 'div', row.source === 'profile' ? 'Using saved game-profile assignment' : 'Showing the default declared by the mod; no saved assignment was found for this action.', 'small text-body-secondary')
}

function findOverlapMatches(overlaps, search) {
	return overlaps.filter((group) => {
		const searchable = group.entries.map((entry) => `${entry.modName} ${entry.action} ${readableAction(entry.action)} ${entry.description ?? ''} ${entry.category} ${entry.binding}`).join(' ')
		return `${searchable} ${group.entries.map((entry) => entry.binding).join(' ')}`.toLocaleLowerCase().includes(search)
	})
}

function renderOverlapCard(overlapSection, group) {
	const card = addText(overlapSection, 'section', '', 'keybind-overlap')
	const heading = document.createElement('div')
	heading.className = 'd-flex flex-wrap align-items-center justify-content-between gap-2'
	const commonBinding = group.entries.find((entry) => entry.collectionMod)?.binding ?? ''
	addText(heading, 'strong', `Shared key: ${commonBinding.replaceAll(' + ', ' ') || 'Unknown key'}`)
	const intentionalButton = addText(heading, 'button', group.intentional ? 'Marked intentional' : 'Mark intentional', `btn btn-sm ${group.intentional ? 'btn-success' : 'btn-outline-warning'}`)
	intentionalButton.type = 'button'
	intentionalButton.addEventListener('click', async () => {
		await window.keybind_review_IPC.setIntentional({ collectKey : activeCollectionKey, fingerprint : group.fingerprint, intentional : !group.intentional })
		await loadReport()
	})
	card.appendChild(heading)
	if ( commonBinding !== '' ) {
		const keyDisplay = document.createElement('div')
		keyDisplay.className = 'my-2'
		const keyHTML = clientGetKeyMapSimple(commonBinding.replaceAll(' + ', ' '), 'en')
		if ( typeof keyHTML === 'string' && !keyHTML.includes('undefined') ) { keyDisplay.innerHTML = keyHTML }
		else { keyDisplay.textContent = commonBinding }
		card.appendChild(keyDisplay)
	}
	addText(card, 'p', 'This overlap may be intentional. Review the actions and context before changing anything.', 'text-body-secondary mb-2')
	for ( const entry of group.entries ) {
		const detail = addText(card, 'div', '', 'small mb-1')
		addActionLabel(detail, entry)
		addText(detail, 'div', `${entry.category} · ${entry.source === 'profile' ? 'saved profile' : 'mod default'}`, 'text-body-secondary')
	}
}

function createOverlapSection(overlaps, overlapMatches, search) {
	const section = document.createElement('details')
	section.className = 'keybind-clear-group keybind-mod-group'
	section.open = search !== ''
	const summary = addText(section, 'summary', `Shared bindings to review (${overlapMatches.length}${search ? ` of ${overlaps.length}` : ''})`, 'h5 py-2 mb-0')
	summary.setAttribute('role', 'button')
	if ( overlapMatches.length === 0 ) {
		addText(section, 'p', search ? 'No shared-key overlaps match this filter.' : 'No repeated key assignments were found among the scanned mod actions.', 'text-body-secondary')
	}
	for ( const group of overlapMatches ) { renderOverlapCard(section, group) }
	return section
}

function findMatchingModRows(rows, search) {
	return rows.filter((row) => `${row.modName} ${row.action} ${readableAction(row.action)} ${row.description ?? ''} ${row.category} ${bindingLabels(row)}`.toLocaleLowerCase().includes(search))
}

function groupModRows(rows) {
	const groupedMods = new Map()
	for ( const row of rows ) { groupedMods.set(row.modName, [...(groupedMods.get(row.modName) ?? []), row]) }
	return groupedMods
}

function renderModGroup(results, modName, rows, conflictedActions, search) {
	const group = document.createElement('details')
	group.className = 'keybind-clear-group keybind-mod-group keybind-mod-accordion'
	group.open = search !== ''
	const summary = document.createElement('summary')
	summary.className = 'd-flex flex-wrap align-items-center justify-content-between gap-2 py-2'
	addText(summary, 'strong', modName)
	const badges = addText(summary, 'span', '', 'd-flex gap-2')
	addText(badges, 'span', `${rows.length} action${rows.length === 1 ? '' : 's'}`, 'badge text-bg-secondary')
	const conflictCount = rows.filter((row) => conflictedActions.has(`${row.modName}::${row.action}`)).length
	if ( conflictCount > 0 ) { addText(badges, 'span', `${conflictCount} shared`, 'badge text-bg-warning') }
	group.appendChild(summary)
	renderModKeymap(group, rows)
	for ( const row of rows ) { appendModKeybindRow(group, row, conflictedActions.has(`${row.modName}::${row.action}`)) }
	results.appendChild(group)
}

function renderModGroups(results, groupedMods, conflictedActions, search) {
	for ( const [modName, rows] of groupedMods ) { renderModGroup(results, modName, rows, conflictedActions, search) }
}

function renderProfileWarning(report, results) {
	if ( !report.inputFileFound ) {
		addText(results, 'div', `No saved inputBinding.xml was found for FS${report.gameVersion}. The report will show each mod’s declared default keys. Run the game once and save key bindings to compare with the profile later.`, 'alert alert-warning')
	} else if ( !report.profileLoaded ) {
		addText(results, 'div', 'The saved inputBinding.xml exists but could not be read. The report will show each mod’s declared default keys.', 'alert alert-warning')
	}
}

function renderReportStatus(report, matches, overlapMatches, overlaps) {
	const search = document.getElementById('keybindSearch').value.trim()
	const actionStatus = search ? `Showing ${matches.length}/${report.mods.length} actions` : `${report.mods.length} actions`
	const overlapStatus = search ? `${overlapMatches.length}/${overlaps.length} shared assignments` : `${overlaps.length} shared assignments`
	setStatus(`${actionStatus} · ${overlapStatus}${report.profileLoaded ? '' : ' · profile unavailable'}`)
}

function renderReport(report) {
	activeReport = report
	const results = document.getElementById('keybindResults')
	results.replaceChildren()
	if ( report?.error ) {
		addText(results, 'div', report.error, 'alert alert-danger')
		setStatus('Could not scan collection')
		return
	}
	document.getElementById('keybindCollectionName').textContent = `${report.collectionName} · FS${report.gameVersion}`
	renderProfileWarning(report, results)
	const overlaps = report.overlaps ?? []
	const search = document.getElementById('keybindSearch').value.trim().toLocaleLowerCase()
	const overlapMatches = findOverlapMatches(overlaps, search)
	results.appendChild(createOverlapSection(overlaps, overlapMatches, search))
	const matches = findMatchingModRows(report.mods, search)
	const conflictedActions = new Set(overlaps.flatMap((group) => group.entries.filter((entry) => entry.collectionMod).map((entry) => `${entry.modName}::${entry.action}`)))
	const groupedMods = groupModRows(matches)
	addText(results, 'h2', `Mod keybinds (${matches.length}${search ? ` of ${report.mods.length}` : ''} across ${groupedMods.size} mod${groupedMods.size === 1 ? '' : 's'})`, 'h5 mt-4 mb-2')
	renderModGroups(results, groupedMods, conflictedActions, search)
	if ( matches.length === 0 ) { addText(results, 'p', 'No keybinds match this filter.', 'text-body-secondary') }
	renderReportStatus(report, matches, overlapMatches, overlaps)
}

async function loadReport() {
	if ( !activeCollectionKey ) { return }
	setStatus('Scanning collection…')
	document.getElementById('keybindRescan').disabled = true
	try { renderReport(await window.keybind_review_IPC.getReport(activeCollectionKey)) }
	catch (err) {
		document.getElementById('keybindResults').textContent = err?.message ?? String(err)
		setStatus('Scan failed')
	} finally { document.getElementById('keybindRescan').disabled = false }
}

window.keybind_review_IPC.receive('keybind:collection', (collectKey) => {
	activeCollectionKey = collectKey
	void loadReport()
})

window.addEventListener('DOMContentLoaded', () => {
	keybindEditModal = window.bootstrap.Modal.getOrCreateInstance(document.getElementById('keybindEditModal'), { backdrop : 'static', keyboard : false })
	document.getElementById('keybindRescan').addEventListener('click', () => { void loadReport() })
	document.getElementById('keybindEditSave').addEventListener('click', () => { void saveCapturedBinding() })
	document.addEventListener('keydown', (event) => {
		if ( !pendingBindingEdit || !document.getElementById('keybindEditModal').classList.contains('show') ) { return }
		if ( ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key) ) {
			event.preventDefault()
			document.getElementById('keybindEditStatus').textContent = 'Keep holding the modifier and press the key you want.'
			return
		}
		const input = eventCodeToGameInput(event.code)
		event.preventDefault()
		event.stopPropagation()
		if ( !input || event.metaKey ) {
			document.getElementById('keybindEditStatus').textContent = 'That key is not supported here. Try a letter, number, function key, arrow or common keyboard key.'
			return
		}
		const modifierCount = Number(event.ctrlKey) + Number(event.altKey) + Number(event.shiftKey)
		if ( modifierCount > 1 ) {
			document.getElementById('keybindEditStatus').textContent = 'Use only one modifier at a time: Ctrl, Alt or Shift.'
			return
		}
		capturedBinding = { input, modifier : event.ctrlKey ? 'KEY_lctrl' : (event.altKey ? 'KEY_lalt' : (event.shiftKey ? 'KEY_lshift' : '')) }
		const display = [capturedBinding.modifier, capturedBinding.input].filter(Boolean).join(' ')
		const keyHTML = clientGetKeyMapSimple(display, 'en')
		const keyDisplay = document.getElementById('keybindEditCaptured')
		keyDisplay.innerHTML = typeof keyHTML === 'string' && !keyHTML.includes('undefined') ? keyHTML : display
		void previewCapturedBinding()
	}, true)
	document.getElementById('keybindSearch').addEventListener('input', () => {
		if ( activeReport ) { renderReport(activeReport) }
	})
})
