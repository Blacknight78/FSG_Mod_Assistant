/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Folder window UI

/* global MA, I18N */

window.addEventListener('DOMContentLoaded', () => {
	window.prefs = new PrefLib()
})

class PrefLib {
	currentDev = null
	overlay    = null
	folders    = null
	gameManagement = []
	wizard     = null

	inputs = {
		game_enabled_13 : {
			set    : (input) => { this.#processCheck('game_enabled_13', input, true) },
			update : (input) => { this.#processCheck('game_enabled_13', input, false) },
		},
		game_enabled_15 : {
			set    : (input) => { this.#processCheck('game_enabled_15', input, true) },
			update : (input) => { this.#processCheck('game_enabled_15', input, false) },
		},
		game_enabled_17 : {
			set    : (input) => { this.#processCheck('game_enabled_17', input, true) },
			update : (input) => { this.#processCheck('game_enabled_17', input, false) },
		},
		game_enabled_19 : {
			set    : (input) => { this.#processCheck('game_enabled_19', input, true) },
			update : (input) => { this.#processCheck('game_enabled_19', input, false) },
		},
		game_enabled_22 : {
			set    : (input) => { this.#processCheck('game_enabled_22', input, true) },
			update : (input) => { this.#processCheck('game_enabled_22', input, false) },
		},
		game_enabled_25 : {
			set    : (input) => { this.#processCheck('game_enabled_25', input, true) },
			update : (input) => { this.#processCheck('game_enabled_25', input, false) },
		},
		show_tooltips : {
			set    : (input) => { this.#processCheck('show_tooltips', input, true) },
			update : (input) => { this.#processCheck('show_tooltips', input, false) },
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
		window.settings.receive('settings:invalidate', () => { this.forceUpdate() })
		this.init()
	}

	init() {
		for ( const element of document.querySelectorAll('page-replace')) {
			const replaceType = element.safeAttribute('data-type')
			const replaceKey  = element.safeAttribute('data-name')
			const replaceExt  = element.safeAttribute('data-extra')
			const replaceKeyO = element.safeAttribute('data-key')
	
			switch ( replaceType ) {
				case 'special-input' :
					element.replaceWith(this.#doSpecial(replaceKey))
					break
				case 'switch-input':
					element.replaceWith(this.#doSwitch(replaceKey, replaceKeyO, replaceExt || 2))
					break
				case 'settings-input':
					element.replaceWith(this.#doSettings(replaceKey))
					break
				case 'path-input':
					element.replaceWith(this.#doPath(replaceKey))
					break
				default :
					break
			}
		}

		this.update.push(
			() => { this.#doFolders() },
			() => { this.#renderGameManagement() }
		)
		MA.byId('scanGameInstallations')?.addEventListener('click', () => { this.#scanGameInstallations() })
		MA.byId('performanceRefresh')?.addEventListener('click', () => { this.#loadPerformanceSummary() })
		MA.byId('performanceOpenLog')?.addEventListener('click', () => { this.#openPerformanceLog() })

		this.forceUpdate()
		this.#loadPerformanceSummary()
	}

	forceUpdate() {
		window.setup_IPC.update().then((results) => {
			this.folders = results.folders
			this.gameManagement = results.gameManagement ?? []
			this.wizard  = results.wizard

			for ( const update of this.update ) {
				update()
			}
		})
	}

	open() {
		this.forceUpdate()
	}

	#scanSummary(result) {
		const configured = (result.results ?? []).filter((item) => item.enabled)
		if ( configured.length === 0 ) { return 'No installed Farming Simulator games were found in the standard locations.' }

		const changed = configured.filter((item) => item.gameChanged || item.settingsChanged)
		const versionText = configured
			.map((item) => `FS${item.version}${item.gameFound ? '' : ' (settings only)'}`)
			.join(', ')
		const changedText = changed.length === 0 ? ' Existing valid paths were kept.' : ` Updated ${changed.length} game setup${changed.length === 1 ? '' : 's'}.`
		const activeText = result.activeChanged ? ' Active game was switched to the newest detected setup.' : ''
		return `Configured ${configured.length} game${configured.length === 1 ? '' : 's'}: ${versionText}.${changedText}${activeText}`
	}

	async #scanGameInstallations() {
		const button = MA.byId('scanGameInstallations')
		const status = MA.byId('scanGameInstallationsStatus')
		const originalText = button.textContent
		button.disabled = true
		button.textContent = 'Scanning...'
		status.className = 'col-12 small text-info'
		status.textContent = 'Scanning installed games and game settings...'

		try {
			const result = await window.setup_IPC.scanGames()
			this.folders = result.folders ?? this.folders
			await this.#refreshGameManagement()
			this.wizard = result.wizard ?? this.wizard
			for ( const update of this.update ) { update() }
			status.className = result.results?.some((item) => item.enabled) ?
				'col-12 small text-success' :
				'col-12 small text-warning'
			status.textContent = this.#scanSummary(result)
		} catch (err) {
			status.className = 'col-12 small text-danger'
			status.textContent = `Game scan failed: ${err.message}`
		} finally {
			button.disabled = false
			button.textContent = originalText
		}
	}

	#pathButton(label, targetPath, variant = 'outline-secondary') {
		const button = document.createElement('button')
		button.className = `btn btn-sm btn-${variant}`
		button.textContent = label
		button.type = 'button'
		button.disabled = typeof targetPath !== 'string' || targetPath === ''
		button.addEventListener('click', async () => {
			const status = MA.byId('gameManagementStatus')
			try {
				const result = await window.setup_IPC.openSetupPath(targetPath)
				status.className = result === '' ? 'col-12 small text-success' : 'col-12 small text-warning'
				status.textContent = result === '' ? `Opened ${targetPath}` : `Could not open ${targetPath}: ${result}`
			} catch (err) {
				status.className = 'col-12 small text-danger'
				status.textContent = `Could not open ${targetPath}: ${err.message}`
			}
		})
		return button
	}

	#escapeHTML(value) {
		return String(value ?? '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll('\'', '&#39;')
	}

	#gamePathLine(label, targetPath, found) {
		const pathText = targetPath === '' ? 'not configured' : targetPath
		const stateText = found ? 'found' : 'missing'
		return `<div><span class="text-body-secondary">${this.#escapeHTML(label)}:</span> <span class="user-select-text">${this.#escapeHTML(pathText)}</span> <span class="badge text-bg-${found ? 'success' : 'secondary'}">${stateText}</span></div>`
	}

	#detectedPathList(label, items, formatter = (item) => item) {
		if ( items.length === 0 ) {
			return `<div class="small text-body-secondary">${this.#escapeHTML(label)}: none detected</div>`
		}
		const listItems = items
			.slice(0, 4)
			.map((item) => `<li class="user-select-text">${this.#escapeHTML(formatter(item))}</li>`)
			.join('')
		const hiddenCount = items.length - 4
		const hiddenText = hiddenCount > 0 ? `<li class="text-body-secondary">and ${hiddenCount} more</li>` : ''
		return [
			`<div class="small text-body-secondary">${this.#escapeHTML(label)}:</div>`,
			`<ul class="small mb-1 ps-3">${listItems}${hiddenText}</ul>`,
		].join('')
	}

	#renderGameManagementRow(item) {
		const node = document.createElement('div')
		node.className = 'list-group-item'
		const detectedGames = item.detectedGames ?? []
		const detectedSettings = item.detectedSettings ?? []
		const detectedSteamGames = detectedGames.filter((game) => game.source === 'Steam')
		const detectedOtherGames = detectedGames.filter((game) => game.source !== 'Steam')
		const trackedFolderCount = item.trackedModFolders?.length ?? 0
		node.innerHTML = [
			'<div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">',
			'<div class="flex-grow-1">',
			`<div class="fw-bold fs-5"><i class="fsico-ver-${item.version}"></i> FS${item.version} ${item.active ? '<span class="badge text-bg-info ms-1">active game</span>' : ''} ${item.enabled ? '<span class="badge text-bg-success ms-1">enabled</span>' : '<span class="badge text-bg-secondary ms-1">disabled</span>'}</div>`,
			'<div class="row g-2 mt-1">',
			'<div class="col-lg-6">',
			'<div class="small fw-semibold">Configured paths</div>',
			`<div class="small">${this.#gamePathLine('Game folder', item.gamePath ?? '', item.gameFound === true)}</div>`,
			`<div class="small">${this.#gamePathLine('Mods folder', item.configuredModFolder ?? '', (item.configuredModFolder ?? '') !== '')}</div>`,
			`<div class="small">${this.#gamePathLine('Settings file', item.settingsPath ?? '', item.settingsFound === true)}</div>`,
			'</div>',
			'<div class="col-lg-6">',
			'<div class="small fw-semibold">Detected installs</div>',
			this.#detectedPathList('Steam', detectedSteamGames, (game) => `${game.isConfigured ? '[configured] ' : ''}${game.path}`),
			this.#detectedPathList('Other stores', detectedOtherGames, (game) => `${game.source}: ${game.path}`),
			'</div>',
			'<div class="col-12">',
			this.#detectedPathList('Detected settings', detectedSettings),
			this.#detectedPathList('Detected mod folders', item.detectedModFolders ?? []),
			`<div class="small text-body-secondary">Tracked mod folders: ${trackedFolderCount} of ${(item.detectedModFolders?.length ?? 0)}</div>`,
			'</div>',
			'</div>',
			'</div>',
			'<div class="d-flex flex-wrap gap-2 align-content-start justify-content-end game-management-actions"></div>',
			'</div>',
		].join('')
		const buttonWrap = node.querySelector('.game-management-actions')
		buttonWrap.appendChild(this.#pathButton('Open game folder', item.gameFound ? item.gamePath : '', 'outline-info'))
		buttonWrap.appendChild(this.#pathButton('Open settings folder', item.settingsFound ? item.settingsPath.replace(/[^\\/]+$/u, '') : '', 'outline-info'))
		buttonWrap.appendChild(this.#pathButton('Open mods folder', item.configuredModFolder ?? '', 'outline-success'))
		return node
	}

	async #refreshGameManagement() {
		const results = await window.setup_IPC.update()
		this.gameManagement = results.gameManagement ?? this.gameManagement
		this.folders = results.folders ?? this.folders
		this.wizard = results.wizard ?? this.wizard
	}

	#renderGameManagement() {
		const list = MA.byId('gameManagementList')
		list.innerHTML = ''
		if ( this.gameManagement.length === 0 ) {
			list.innerHTML = '<div class="list-group-item text-body-secondary">No game setup information is available yet.</div>'
			return
		}
		const enabledCount = this.gameManagement.filter((item) => item.enabled).length
		const active = this.gameManagement.find((item) => item.active)
		const steamCount = this.gameManagement.reduce((sum, item) => sum + (item.detectedGames ?? []).filter((game) => game.source === 'Steam').length, 0)
		MA.byIdText('gameManagementSummary', `${enabledCount} Farming Simulator game${enabledCount === 1 ? '' : 's'} configured. ${steamCount} Steam install${steamCount === 1 ? '' : 's'} detected.`)
		MA.byIdText('gameManagementActive', `Active game: ${typeof active === 'undefined' ? '--' : `FS${active.version}`}`)
		for ( const item of this.gameManagement ) {
			list.appendChild(this.#renderGameManagementRow(item))
		}
	}

	#performanceText(metric) {
		if ( metric === null || typeof metric === 'undefined' || !Number.isFinite(metric.ms) ) {
			return 'not recorded'
		}
		return `${metric.ms.toFixed(1)} ms`
	}

	async #loadPerformanceSummary() {
		const status = MA.byId('performanceStatus')
		status.className = 'col-12 small text-info'
		status.textContent = 'Reading performance log...'

		try {
			const summary = await window.setup_IPC.performanceSummary()
			MA.byIdText('performanceMainVisible', this.#performanceText(summary.metrics?.mainVisible))
			MA.byIdText('performanceFolderScan', this.#performanceText(summary.metrics?.modFolderScan))
			MA.byIdText('performanceRendererUpdate', this.#performanceText(summary.metrics?.rendererUpdate))
			MA.byIdText('performanceVaultIndex', this.#performanceText(summary.metrics?.vaultIndex))
			MA.byIdText('performanceModHubRefresh', this.#performanceText(summary.metrics?.modHubRefresh))
			MA.byIdText('performanceLogPath', `Log file: ${summary.logPath ?? '--'}`)
			status.className = summary.ok ? 'col-12 small text-success' : 'col-12 small text-warning'
			status.textContent = summary.status ?? 'Performance summary refreshed.'
		} catch (err) {
			status.className = 'col-12 small text-danger'
			status.textContent = `Performance summary failed: ${err.message}`
		}
	}

	async #openPerformanceLog() {
		const status = MA.byId('performanceStatus')
		try {
			const result = await window.setup_IPC.openPerformanceLog()
			if ( result !== '' ) {
				status.className = 'col-12 small text-warning'
				status.textContent = `Could not open performance log: ${result}`
				return
			}
			status.className = 'col-12 small text-success'
			status.textContent = 'Performance log opened.'
		} catch (err) {
			status.className = 'col-12 small text-danger'
			status.textContent = `Could not open performance log: ${err.message}`
		}
	}

	#doFolderLine(folder, alreadyExists, version) {
		const buttonClass = alreadyExists ? 'secondary disabled' : 'info'
		const node = document.createElement('div')
		node.classList.add('row', 'border-bottom', 'pb-2', 'mb-2')

		node.innerHTML = [
			`<div class="col-9 align-self-center ${alreadyExists ? 'text-decoration-line-through' : ''}"><i class="fsico-ver-${version}"></i> ${folder}</div>`,
			'<div class="col-3 align-self-center">',
			alreadyExists ?
				'<div class="small text-center fst-italic"><i18n-text data-key="wizard_mods_exists"></i18n-text></div>' :
				`<i18n-text class="btn btn-sm btn-check-mark w-100 btn-outline-${buttonClass}" data-key="folder_add"></button>`,
			'</div>',
		].join('')

		if ( !alreadyExists ) {
			node.querySelector('.btn').addEventListener('click', () => {
				window.setup_IPC.addFolder(folder, version)
			})
		}
		return node
	}

	#doFolders() {
		const fullHTML = []
		for ( const propCollect of this.wizard.mods ) {
			if ( propCollect.isModFolder ) {
				fullHTML.push(this.#doFolderLine(
					propCollect.baseModFolder,
					this.folders.includes(propCollect.baseModFolder),
					propCollect.ver
				))
			}
			if ( propCollect.hasCollections.length !== 0 ) {
				fullHTML.push(...propCollect.hasCollections.map((x) => this.#doFolderLine(
					x,
					this.folders.includes(x),
					propCollect.ver
				)))
			}
		}

		MA.byIdNodeArray('step_3_folders', fullHTML)
	}

	#doButton(key, newValue, curValue, extraText = '') {
		const node = document.createElement('div')
		node.classList.add('row', 'mt-1')

		const buttonColor = newValue === curValue ? 'success btn-thumb-up' : 'outline-secondary btn-check-mark'
		const buttonText  = newValue === curValue ? 'wizard_using_this'    : 'wizard_use_this'
		
		node.innerHTML = [
			extraText !== '' ? `<div class="col-1 align-self-center">${extraText}</div>` : '',
			`<div class="col-${extraText !== '' ? '8' : '9'} align-self-center small">${newValue}</div>`,
			`<div class="col-3"><button class="btn btn-${buttonColor} w-100"><i18n-text data-key="${buttonText}"></i18n-text></button></div>`,
		].join('')

		if ( newValue !== curValue ) {
			node.querySelector('button').addEventListener('click', () => {
				window.settings.set(key, newValue).then(() => {
					this.forceUpdate()
				})
			})
		} else {
			node.querySelector('button').disabled = true
		}
		return node
	}

	#doPath(version) {
		const iVer    = parseInt(version)
		const fullKey = `game_path_${version}`
		const node    = document.createElement('div')
		node.innerHTML = [
			'<i18n-text class="inset-block-header" data-key="user_pref_title_game_path"></i18n-text>',
			'<i18n-text class="inset-block-blurb-option mb-3" data-key="user_pref_blurb_game_path"></i18n-text>',
			'<div class="row inset-block-lined-row">',
			'<div class="col"><i18n-text data-key="wizard_current"></i18n-text></div>',
			'<div class="col-auto fst-italic small current_game_path"></div>',
			'</div><div class="found_paths"></div>',
		].join('')

		const buttons = node.querySelector('.found_paths')

		const updater = () => {
			window.settings.get(fullKey).then((value) => {
				buttons.innerHTML = ''
				node.querySelector('.current_game_path').textContent = value !== '' ? value : '--'

				if ( this.wizard.games[iVer].length === 0 ) {
					buttons.appendChild(I18N.__('wizard_step_4_fail_exe', ['text-center', 'd-block']))
				} else {
					for ( const gamePath of this.wizard.games[iVer] ) {
						buttons.appendChild(this.#doButton(
							fullKey,
							gamePath[1],
							value,
							gamePath[0]
						))
					}
				}
			})
		}

		this.update.push(updater)
		return node
	}

	#doSettings(version) {
		const iVer    = parseInt(version)
		const fullKey = `game_settings_${version}`
		const node    = document.createElement('div')
		node.innerHTML = [
			'<i18n-text class="inset-block-header" data-key="user_pref_title_game_settings"></i18n-text>',
			'<i18n-text class="inset-block-blurb-option mb-3" data-key="user_pref_blurb_game_settings"></i18n-text>',
			'<div class="row inset-block-lined-row">',
			'<div class="col"><i18n-text data-key="wizard_current"></i18n-text></div>',
			'<div class="col-auto fst-italic small current_game_settings"></div>',
			'</div>',
			'<div class="found_settings"></div>',
		].join('')

		const buttons = node.querySelector('.found_settings')

		const updater = () => {
			window.settings.get(fullKey).then((value) => {
				buttons.innerHTML = ''
				node.querySelector('.current_game_settings').textContent = value !== '' ? value : '--'

				if ( this.wizard.settings[iVer].length === 0 ) {
					buttons.appendChild(I18N.__('wizard_step_4_fail_settings', ['text-center', 'd-block']))
				} else {
					for ( const setPath of this.wizard.settings[iVer] ) {
						buttons.appendChild(this.#doButton(
							fullKey,
							setPath,
							value
						))
					}
				}
			})
		}

		this.update.push(updater)
		return node
	}

	#doSwitch(key, keyOver = null, size = 2) {
		const i18nKey = keyOver !== null ? keyOver : key
		const node = document.createElement('div')
		node.innerHTML = [
			`<i18n-text class="inset-block-header" data-key="user_pref_title_${i18nKey}"></i18n-text>`,
			'<div class="row">',
			`<i18n-text class="inset-block-blurb-option col-${12-size}" data-key="user_pref_blurb_${i18nKey}"></i18n-text>`,
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
				}

				this.update.push(lang_update)
				window?.i18n?.receive('i18n:refresh', lang_update)
				break
			}
			default :
				break
		}

		return node
	}
}
