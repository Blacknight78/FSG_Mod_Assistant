/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: DETAIL UI
/* global DATA, MA, I18N, ft_doReplace, client_BGData, client_BuilderPlace, clientGetKeyMapSimple, clientGetKeyMap, clientMakeCropCalendar, client_BuilderVehicle */


window.lookItemMap  = {}

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	window.state = new windowState()
})

function normalizeStoreInfo(storeInfo) {
	const safeStoreInfo = typeof storeInfo === 'object' && storeInfo !== null ? storeInfo : {}
	return {
		...safeStoreInfo,
		brands     : typeof safeStoreInfo.brands === 'object' && safeStoreInfo.brands !== null ? safeStoreInfo.brands : {},
		icon       : typeof safeStoreInfo.icon === 'object' && safeStoreInfo.icon !== null ? safeStoreInfo.icon : {},
		items      : typeof safeStoreInfo.items === 'object' && safeStoreInfo.items !== null ? safeStoreInfo.items : {},
		l10n       : typeof safeStoreInfo.l10n === 'object' && safeStoreInfo.l10n !== null ? safeStoreInfo.l10n : { en : {} },
		placeables : typeof safeStoreInfo.placeables === 'object' && safeStoreInfo.placeables !== null ? safeStoreInfo.placeables : {},
		vehicles   : typeof safeStoreInfo.vehicles === 'object' && safeStoreInfo.vehicles !== null ? safeStoreInfo.vehicles : {},
	}
}

// MARK: PAGE STATE CLASS
class windowState {
	locale     = 'en'
	i18nUnits  = {}
	modColUUID = null
	mod        = null
	storeInfo  = null

	constructor() {
		window.lookItemMap  = {}

		const urlParams = new URLSearchParams(window.location.search)
		this.modColUUID = urlParams.get('mod')

		this.getMod()
	}

	// MARK: Main logic
	async getMod() {
		this.locale    = await window.i18n.lang()
		this.i18nUnits = await window.settings.units()

		window.detail_IPC.getMod(this.modColUUID).then(async (thisResponse) => {
			this.mod       = Array.isArray(thisResponse) ? thisResponse[0] : null
			this.storeInfo = normalizeStoreInfo(Array.isArray(thisResponse) ? thisResponse[1] : null)
			this.#resetDynamicPage()
			if ( this.mod === null ) {
				this.#showDetailError('The selected mod could not be found. Refresh the mod list and try again.')
				return
			}

			I18N.local_entries = this.storeInfo.l10n[this.locale] || this.storeInfo.l10n.en || {}

			const basicPromises = [
				this.do_step_table(),
				this.do_step_keyBinds(),
				this.do_step_problems(),
				this.do_step_badges(),
				this.do_step_crops(),
			]

			if ( this.mod.modDesc.mapImage !== null ) {
				MA.byId('map_image_div').clsShow()
				MA.byId('map_image').src = this.mod.modDesc.mapImage
			}

			
			MA.byIdHTML('storeitems', '')
			MA.byId('store_div').clsShow(Object.keys(this.storeInfo.vehicles).length !== 0 || Object.keys(this.storeInfo.placeables).length !== 0)
			this.#renderStoreItemPreview()

			try {
				for ( const storeItemFile of Object.keys(this.storeInfo.vehicles).sort() ) {
					const thisItem    = this.storeInfo.vehicles[storeItemFile]
					const thisVehicle = new client_BuilderVehicle(
						storeItemFile,
						thisItem,
						this.mod.fileDetail.shortName,
						this.locale,
						this.mod.gameVersion,
						this.storeInfo.brands
					)

					thisVehicle.populateCombos(this.storeInfo)

					window.lookItemMap[thisVehicle.lookItemMap[0]] = thisVehicle.lookItemMap[1]

					MA.byIdAppend('storeitems', thisVehicle.HTML)
					thisVehicle.doCharts(this.i18nUnits)
				}

				for ( const storeItemFile of Object.keys(this.storeInfo.placeables).sort() ) {
					const thisItem  = this.storeInfo.placeables[storeItemFile]
					const thisPlace = new client_BuilderPlace(
						thisItem,
						this.locale,
						this.mod.gameVersion
					)
					MA.byIdAppend('storeitems', thisPlace.HTML)
				}
			} finally {
				Promise.allSettled(basicPromises).then((results) => {
					for ( const thisResult of results ) {
						if ( thisResult.status === 'rejected' ) {
							window.log.log('Issue with page build', thisResult.reason.toString(), thisResult.reason?.stack)
						}
					}
					ft_doReplace()
					MA.byId('loading-spinner').clsHide()
				})
			}
		}).catch((err) => {
			this.#showDetailError(`The selected mod details could not be loaded: ${err.message}`)
			window.log.error('page build error',  err.message, `\n${err.stack}`)
		})

		for ( const element of MA.query('.inset-block-header-show-hide i18n-text') ) {
			element.addEventListener('click', this.showHideClicker)
		}
	}

	#resetDynamicPage() {
		window.lookItemMap = {}

		MA.byIdHTML('badges', '')
		MA.byIdHTML('problems', '')
		MA.byIdHTML('keyBinds', '')
		MA.byIdHTML('crop-table', '')
		MA.byIdHTML('storeitems', '')

		MA.byId('problem_div')?.clsShow()
		MA.byId('cropcal_div')?.clsHide()
		MA.byId('detail_crop_json')?.clsHide()
		MA.byId('store_div')?.clsHide()
		MA.byId('store_preview_div')?.clsHide()
		MA.byIdHTML('store_preview_items', '')
		MA.byId('map_image_div')?.clsHide()
		MA.byId('malware-found')?.clsHide()
		MA.byId('download_latest_update')?.clsHide()
		MA.byId('rollback_latest_update')?.clsHide()
		MA.byId('rollback_versions')?.clsHide()
		MA.byIdHTML('rollback_versions', '')
	}

	#showDetailError(message) {
		MA.byIdText('title', 'Mod details unavailable')
		MA.byIdText('mod_location', message)
		MA.byId('problem_div')?.clsHide()
		MA.byId('desc_div')?.clsHide()
		MA.byId('depend_div')?.clsHide()
		MA.byId('detail_div')?.clsHide()
		MA.byId('loading-spinner')?.clsHide()
	}

	// MARK: crops
	async do_step_crops() {
		if ( Array.isArray(this.mod.modDesc.cropInfo) ) {
			MA.byId('cropcal_div').clsShow()
			MA.byId('detail_crop_json').clsShow()
			MA.byId('cropcal_button').addEventListener('click', () => {
				window.operations.clip(JSON.stringify(this.mod.modDesc.cropInfo))
			})
			
			return clientMakeCropCalendar(
				this.mod.modDesc.cropInfo,
				this.mod.modDesc?.mapIsSouth || false,
				this.mod.modDesc?.cropWeather || null,
				this.mod.gameVersion || 22
			).then((html) => {
				MA.byIdHTML('crop-table', html)
			})
		}
	}
	
	// MARK: badges
	async do_step_badges() {
		return window.detail_IPC.getMalware().then((malware) => {
			let foundMalware = false

			const theseBadges = Array.isArray(this.mod.displayBadges) ? this.mod.displayBadges.filter((badge) => {
				if ( badge.name === 'malware' ) {
					if ( malware.dangerModsSkip.has(this.mod.fileDetail.shortName) ) { return false }
					if ( malware.suppressList.includes(this.mod.fileDetail.shortName)) { return false }
					foundMalware = true
				}
				return true
			}) : []

			MA.byId('malware-found').clsShow(foundMalware)

			const badgePromise = theseBadges.map((badge) => I18N.buildBadgeMod(badge))

			return Promise.allSettled(badgePromise).then((badges) => {
				badges.map((x) => {
					MA.byId('badges').appendChild(x.value)
				})
			})
		})
	}

	// MARK: problems
	async do_step_problems() {
		return window.detail_IPC.getBinds().then(async (bindConflicts) => {
			const bindingIssue     = bindConflicts[this.mod.currentCollection]?.[this.mod.fileDetail.shortName] ?? null

			if ( this.mod.issues.length === 0 && bindingIssue === null ) {
				MA.byId('problem_div').clsHide()
			} else {
				return Promise.allSettled([
					...await this.#do_subStep_issues(),
					...await this.#do_subStep_binds(bindingIssue),
				]).then((value) => {
					const theseIssues = value.map((item) => `<tr class="py-2"><td class="px-2">${DATA.checkX(0, false)}</td><td>${item.value}</td></tr>`)
					MA.byIdHTML('problems', `<table class="table table-borderless mb-0">${theseIssues.join('')}</table>`)
				})
			}
		})
	}

	// MARK: keyBinds
	async do_step_keyBinds() {
		const keyBinds = []
		for ( const action in this.mod.modDesc.binds ) {
			const thisBinds = this.mod.modDesc.binds[action].map((keyCombo) => clientGetKeyMapSimple(keyCombo, this.locale))
			keyBinds.push(`${action} :: ${thisBinds.join('<span class="mx-3">/</span>')}`)
		}
		return DATA.joinArrayOrI18N(keyBinds, 'detail_key_none').then((value) => {
			MA.byIdHTML('keyBinds', value)
			MA.byId('keyBinds').clsOrGateArr(keyBinds, 'text-info')
		})
		
	}

	// MARK: table (top)
	async do_step_table() {
		const joinedArrays = {
			bigFiles       : [this.mod.fileDetail.tooBigFiles],
			depends        : [this.mod.modDesc.depend, 'detail_depend_clean'],
			extraFiles     : [this.mod.fileDetail.extraFiles],
			pngTexture     : [this.mod.fileDetail.pngTexture],
			spaceFiles     : [this.mod.fileDetail.spaceFiles],
		}
		for ( const [id, content] of Object.entries(joinedArrays)) {
			DATA.joinArrayOrI18N(...content).then((value) => {
				MA.byIdHTML(id, value)
				MA.byId(id).clsOrGateArr(content[0])
			})
		}

		const tempTitle = this.#doL10N(this.mod.l10n.title)
		const sourceURL = await this.#detailSourceURL()
		const collectionName = await this.#detailCollectionName()

		const idMap = {
			description    : this.#doL10N(this.mod.l10n.description),
			file_date      : (new Date(Date.parse(this.mod.fileDetail.fileDate))).toLocaleString(this.locale, {timeZoneName : 'short'}),
			filesize       : await DATA.bytesToHR(this.mod.fileDetail.fileSize),
			github_version : this.#isGitHubURL(sourceURL) ? I18N.defer('update_status_checking', false) : `<em>${I18N.defer('update_source_not_configured', false )}</em>`,
			has_scripts    : DATA.checkX(this.mod.modDesc.scriptFiles),
			i3dFiles       : this.mod.fileDetail.i3dFiles.join('\n'),
			is_multiplayer : DATA.checkX(this.mod.modDesc.multiPlayer, false),
			mh_version     : ( this.mod.modHub.id !== null && typeof this.mod.modHub.version === 'string' ) ?
				`<a href="https://www.farming-simulator.com/mod.php?mod_id=${this.mod.modHub.id}" target="_BLANK">${this.mod.modHub.version}</a>` :
				`<em>${I18N.defer(this.mod.modHub.id === null ? 'mh_norecord' : 'mh_unknown', false )}</em>`,
			mod_author     : this.#authorHTML(sourceURL),
			mod_collection : `${I18N.defer('detail_mod_collection', false)}: ${DATA.escapeSpecial(collectionName ?? this.mod.currentCollection)}`,
			mod_filename   : this.#actualFileName(),
			mod_location   : this.mod.fileDetail.fullPath,
			modhub_status  : this.#modHubStatusHTML(),
			store_items    : DATA.checkX(this.mod.modDesc.storeItems),
			title          : (( tempTitle !== '--' ) ? tempTitle : this.mod.fileDetail.shortName),
			update_source  : this.#updateSourceHTML(sourceURL),
			update_status  : this.#isGitHubURL(sourceURL) ? I18N.defer('update_status_checking', false) : `<em>${I18N.defer('update_source_not_configured', false )}</em>`,
			version        : DATA.escapeSpecial(this.mod.modDesc.version),
		}
		for ( const [id, content] of Object.entries(idMap)) {
			MA.byIdHTML(id, content)
		}

		for ( const element of MA.query('#description a') ) { element.target = '_BLANK' }

		MA.byIdValue('update_source_input', sourceURL)
		MA.byIdEventIfExists('update_source_save', () => { this.#updateSourceSave() })
		MA.byIdEventIfExists('update_source_clear', () => { this.#updateSourceClear() })
		this.#refreshGitHubVersion(sourceURL)

		MA.byIdHTMLorHide(
			'icon_div',
			`<img class="img-fluid" src="${this.mod.modDesc.iconImage}" />`,
			this.mod.modDesc.iconImage
		)
	}

	#storeItemPreviewCandidates(item, itemKey = '') {
		return [
			item?.icon,
			item?.iconFile,
			item?.iconBase,
			item?.iconOrig,
			this.storeInfo?.icon?.[item?.icon],
			this.storeInfo?.icon?.[item?.iconFile],
			this.storeInfo?.icon?.[item?.iconOrig],
			this.storeInfo?.icon?.[itemKey],
		]
	}

	#storeItemPreviewValue(candidate) {
		if ( typeof candidate !== 'string' || candidate === '' ) { return null }
		if ( candidate.startsWith('data:') ) { return candidate.replace(/^(data:[^,]+,)\s*/u, '$1') }
		if ( candidate.startsWith('$data') ) {
			const iconPointer = candidate.replace('.png', '.dds')
			const trueIcon = client_BGData?.icons?.[iconPointer]
			return typeof trueIcon === 'string' ? trueIcon : null
		}
		const compactCandidate = candidate.replaceAll(/\s/gu, '')
		return ( compactCandidate.length > 100 && /^[A-Za-z0-9+/]+=*$/u.test(compactCandidate) ) ?
			`data:image/png;base64,${compactCandidate}` :
			null
	}

	#storeItemPreviewIcon(item, itemKey = '') {
		const iconCandidates = this.#storeItemPreviewCandidates(item, itemKey)
		for ( const candidate of iconCandidates ) {
			const iconValue = this.#storeItemPreviewValue(candidate)
			if ( iconValue !== null ) { return iconValue }
		}
		return null
	}

	#storeItemPreviewEntries(limit = 8) {
		const previews = []
		const seenImages = new Set()
		const addPreview = (item, itemKey = '') => {
			if ( previews.length >= limit ) { return }
			const icon = this.#storeItemPreviewIcon(item, itemKey)
			if ( icon === null || seenImages.has(icon) ) { return }
			seenImages.add(icon)
			previews.push({
				icon,
				name : typeof item?.name === 'string' ? item.name : itemKey,
			})
		}

		for ( const [itemKey, item] of Object.entries(this.storeInfo?.vehicles ?? {})) { addPreview(item, itemKey) }
		for ( const [itemKey, item] of Object.entries(this.storeInfo?.placeables ?? {})) { addPreview(item, itemKey) }
		for ( const [itemKey, item] of Object.entries(this.storeInfo?.items ?? {})) { addPreview(item, itemKey) }

		return previews
	}

	#renderStoreItemPreview() {
		const previewDiv = MA.byId('store_preview_div')
		const previewItems = MA.byId('store_preview_items')
		if ( previewDiv === null || previewItems === null ) { return }

		const previews = this.#storeItemPreviewEntries()
		previewItems.innerHTML = ''
		previewDiv.clsShow(previews.length !== 0)
		for ( const preview of previews ) {
			const image = document.createElement('img')
			image.alt = ''
			image.src = DATA.iconMaker(preview.icon)
			image.title = preview.name
			previewItems.appendChild(image)
		}
	}

	#authorHTML(sourceURL, modHubAuthorURL = null) {
		const author = String(this.mod.modDesc.author ?? '').trim()
		const safeAuthor = DATA.escapeSpecial(author || '--')
		const normalizedSourceURL = String(sourceURL ?? '')

		const githubOwner = normalizedSourceURL.match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)/iu)?.[1]
		if ( githubOwner !== undefined && githubOwner !== '' ) {
			const profileURL = `https://github.com/${encodeURIComponent(githubOwner)}`
			return `<a href="${DATA.escapeSpecial(profileURL)}" target="_BLANK" title="Open GitHub profile">${safeAuthor}</a>`
		}

		if ( typeof modHubAuthorURL === 'string' && modHubAuthorURL !== '' ) {
			return `<a href="${DATA.escapeSpecial(modHubAuthorURL)}" target="_BLANK" title="Open ModHub author page">${safeAuthor}</a>`
		}

		const modHubID = String(this.mod.modHub.id ?? '').trim()
		if ( /^\d+$/u.test(modHubID) && modHubID !== '0' ) {
			const modHubURL = `https://www.farming-simulator.com/mod.php?mod_id=${encodeURIComponent(modHubID)}`
			return `<a href="${DATA.escapeSpecial(modHubURL)}" target="_BLANK" title="Open ModHub page">${safeAuthor}</a>`
		}

		return safeAuthor
	}

	#actualFileName() {
		const vaultFileName = this.mod.detailContext?.vaultFileName
		if ( typeof vaultFileName === 'string' && vaultFileName.trim() !== '' ) {
			return DATA.escapeSpecial(vaultFileName.trim())
		}
		const fullPath = String(this.mod.fileDetail.fullPath ?? '')
		const fileName = fullPath.split(/[\\/]/u).at(-1) ?? ''
		return DATA.escapeSpecial(fileName || '--')
	}

	#sourceLookupName() {
		const contextName = this.mod.detailContext?.sourceLookupName
		return typeof contextName === 'string' && contextName !== '' ? contextName : this.mod.fileDetail.shortName
	}

	async #detailSourceURL() {
		const contextURL = this.mod.detailContext?.sourceURL
		if ( typeof contextURL === 'string' && contextURL.trim() !== '' ) { return contextURL.trim() }
		return window.settings.site(this.#sourceLookupName(), false)
	}

	async #detailCollectionName() {
		const contextName = this.mod.detailContext?.displayCollectionName
		if ( typeof contextName === 'string' && contextName !== '' ) { return contextName }
		const contextKey = this.mod.detailContext?.displayCollectionKey
		return window.detail_IPC.collectName(
			typeof contextKey === 'string' && contextKey !== '' ? contextKey : this.mod.currentCollection
		)
	}

	#updateSourceHTML(sourceURL) {
		if ( sourceURL !== '' ) {
			const safeURL = DATA.escapeSpecial(sourceURL)
			const label   = this.#updateSourceInfo(sourceURL).label
			return `<a href="${safeURL}" target="_BLANK">${label}</a>`
		}

		if ( this.mod.modHub.id !== null ) {
			return `<a href="https://www.farming-simulator.com/mod.php?mod_id=${this.mod.modHub.id}" target="_BLANK">ModHub</a>`
		}

		return `<em>${I18N.defer('update_source_not_configured', false )}</em>`
	}

	#isGitHubURL(sourceURL) {
		return this.#updateSourceInfo(sourceURL).type === 'github'
	}

	#updateSourceInfo(sourceURL) {
		try {
			const url = new URL(sourceURL)
			if ( url.protocol !== 'https:' ) {
				return { label : 'Manual', type : 'manual' }
			}
			const host = url.hostname.toLowerCase().replace(/^www\./u, '')
			if ( host === 'github.com' ) { return { label : 'GitHub', type : 'github' } }
			if ( host === 'kingmods.net' ) { return { label : 'KingMods', type : 'kingmods' } }
			if ( host === 'itch.io' || host.endsWith('.itch.io') ) { return { label : 'itch.io', type : 'itch' } }
			if ( host === 'farming-simulator.com' && url.searchParams.has('mod_id') ) { return { label : 'ModHub', type : 'modhub' } }
			return { label : 'Manual', type : 'manual' }
		} catch {
			return { label : 'Manual', type : 'manual' }
		}
	}

	#modHubStatusHTML() {
		if ( this.mod.modHub.id === null ) {
			return '<span class="text-body-secondary">Not matched to ModHub</span>'
		}
		if ( typeof this.mod.modHub.version !== 'string' || this.mod.modHub.version === '' ) {
			return '<span class="text-info">Matched by filename; ModHub version unavailable</span>'
		}

		const comparison = DATA.versionCompare(this.mod.modDesc.version, this.mod.modHub.version)
		if ( comparison < 0 ) {
			return '<span class="text-warning">Update available from ModHub</span>'
		}
		if ( comparison === 0 ) {
			return '<span class="text-success">Current on ModHub</span>'
		}
		if ( comparison > 0 ) {
			return '<span class="text-info">Local version is newer than ModHub</span>'
		}
		return '<span class="text-info">Matched to ModHub; comparison unavailable</span>'
	}

	#normalizedUpdateSourceURL(sourceURL) {
		try {
			const url = new URL(sourceURL)
			if ( url.protocol !== 'https:' ) { return null }
			const sourceInfo = this.#updateSourceInfo(url.toString())
			if ( sourceInfo.type === 'github' ) {
				const parts = url.pathname.split('/').filter((item) => item !== '')
				if ( parts.length < 2 ) { return null }
			}
			url.hash = ''
			return url.toString()
		} catch {
			return null
		}
	}

	#updateSourceSave() {
		const sourceURL = this.#normalizedUpdateSourceURL(MA.byIdValue('update_source_input').trim())

		if ( sourceURL === null ) {
			MA.byId('update_source_input').classList.add('is-invalid')
			return
		}

		MA.byId('update_source_input').classList.remove('is-invalid')
		window.settings.site(this.#sourceLookupName(), sourceURL).then((value) => {
			MA.byIdValue('update_source_input', value)
			MA.byIdHTML('update_source', this.#updateSourceHTML(value))
			MA.byIdHTML('mod_author', this.#authorHTML(value))
			this.#refreshGitHubVersion(value)
		})
	}

	#updateSourceClear() {
		MA.byId('update_source_input').classList.remove('is-invalid')
		window.settings.site(this.#sourceLookupName(), '').then((value) => {
			MA.byIdValue('update_source_input', value)
			MA.byIdHTML('update_source', this.#updateSourceHTML(value))
			MA.byIdHTML('mod_author', this.#authorHTML(value))
			this.#refreshGitHubVersion(value)
		})
	}

	#refreshGitHubVersion(sourceURL) {
		const sourceInfo = this.#updateSourceInfo(sourceURL)
		if ( sourceInfo.type === 'modhub' && this.mod.modHub.id !== null ) {
			this.#refreshModHubVersion()
			return
		}
		if ( sourceInfo.type !== 'github' ) {
			if ( sourceURL === '' && this.mod.modHub.id !== null ) {
				this.#refreshModHubVersion()
				return
			}
			const updatePointer = this.#updatePointer(null, sourceURL, sourceInfo.type)
			const safeLabel = DATA.escapeSpecial(sourceInfo.label)
			MA.byIdHTML('github_version', `<em>${safeLabel} source saved</em>`)
			MA.byIdHTML('update_status', `<span class="text-info">${safeLabel} is a manual download source. Open the web page to check and install updates manually.</span>`)
			MA.byId('download_latest_update')?.clsHide()
			window.detail_IPC.hasRollbackBackup(updatePointer).then((hasRollbackBackup) => {
				this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
				this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
			})
			return
		}

		MA.byIdText('github_version', I18N.defer('update_status_checking', false))
		MA.byIdText('update_status', I18N.defer('update_status_checking', false))

		window.detail_IPC.getGitHub(sourceURL).then(async (result) => {
			const updatePointer = this.#updatePointer(result.assetName ?? null, sourceURL)
			if ( !result.ok ) {
				MA.byIdHTML('github_version', `<em>${I18N.defer(result.error === 'no_release_or_tag' ? 'update_status_no_github_release' : 'update_status_failed', false )}</em>`)
				MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_unknown', false)}</span>`)
				MA.byId('download_latest_update')?.clsHide()
				const hasRollbackBackup = await window.detail_IPC.hasRollbackBackup(updatePointer)
				this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
				this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
				return
			}

			const hasRollbackBackup = await window.detail_IPC.hasRollbackBackup(updatePointer)
			const safeVersion = DATA.escapeSpecial(result.version)
			const safeURL     = DATA.escapeSpecial(result.url)
			MA.byIdHTML('github_version', `<a href="${safeURL}" target="_BLANK">${safeVersion}</a>`)
			MA.byIdHTML('update_status', this.#versionStatusHTML(this.mod.modDesc.version, result.version, hasRollbackBackup))
			this.#refreshDownloadButton(result, updatePointer)
			this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
			this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
		}).catch(() => {
			MA.byIdHTML('github_version', `<em>${I18N.defer('update_status_failed', false )}</em>`)
			MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_unknown', false)}</span>`)
			MA.byId('download_latest_update')?.clsHide()
			MA.byId('rollback_latest_update')?.clsHide()
			MA.byId('rollback_versions')?.clsHide()
		})
	}

	#refreshModHubVersion() {
		MA.byIdText('update_status', I18N.defer('update_status_checking', false))
		window.detail_IPC.getModHub(this.mod.modHub.id).then(async (result) => {
			const updatePointer = this.#updatePointer(result.assetName ?? null, result.url ?? null, 'modhub', this.mod.modHub.id)
			if ( !result.ok ) {
				MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_unknown', false)}</span>`)
				MA.byId('download_latest_update')?.clsHide()
				return
			}

			MA.byIdHTML('mod_author', this.#authorHTML(MA.byId('update_source_input')?.value ?? '', result.authorURL))
			const hasRollbackBackup = await window.detail_IPC.hasRollbackBackup(updatePointer)
			MA.byIdHTML('mh_version', `<a href="${DATA.escapeSpecial(result.url)}" target="_BLANK">${DATA.escapeSpecial(result.version)}</a>`)
			MA.byIdHTML('modhub_status', this.#versionStatusHTML(this.mod.modDesc.version, result.version, hasRollbackBackup))
			MA.byIdHTML('update_status', this.#versionStatusHTML(this.mod.modDesc.version, result.version, hasRollbackBackup))
			this.#refreshDownloadButton(result, updatePointer)
			this.#refreshRollbackButton(updatePointer, hasRollbackBackup)
			this.#refreshRollbackVersions(updatePointer, hasRollbackBackup)
		}).catch(() => {
			MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_unknown', false)}</span>`)
			MA.byId('download_latest_update')?.clsHide()
		})
	}

	#updatePointer(fileName = null, sourceURL = null, sourceType = 'github', modHubID = null) {
		return {
			collectionKey : this.mod.currentCollection,
			fileName      : fileName,
			modHubID      : modHubID,
			modName       : this.#sourceLookupName(),
			sourceType    : sourceType,
			sourceURL     : sourceURL,
		}
	}

	#refreshDownloadButton(result, updatePointer) {
		const downloadButton = MA.byId('download_latest_update')
		if ( downloadButton === null ) { return }
		if ( this.mod.isVaultRecord ) {
			downloadButton.clsHide()
			return
		}

		const compareResult = DATA.versionCompare(this.mod.modDesc.version, result.version)
		const isUpdate = compareResult < 0 || (Number.isNaN(compareResult) && DATA.versionDifferent(this.mod.modDesc.version, result.version))
		const canDownload = isUpdate && result.hasDownload && typeof result.downloadURL === 'string' && typeof result.assetName === 'string'

		downloadButton.clsShow(canDownload)
		downloadButton.disabled = !canDownload
		downloadButton.onclick = null
		if ( !canDownload ) { return }

		downloadButton.onclick = async () => {
			downloadButton.disabled = true
			MA.byIdHTML('update_status', I18N.defer('update_list_updating', false))
			try {
				const collectionName = await window.detail_IPC.collectName(updatePointer.collectionKey)
				const resultDownload = await window.detail_IPC.downloadApplySelected([{
					collectionKey  : updatePointer.collectionKey,
					collectionName : collectionName,
					fileName       : result.assetName,
					modHubID       : updatePointer.modHubID,
					modName         : updatePointer.modName,
					sourceType      : updatePointer.sourceType,
					sourceURL       : updatePointer.sourceURL,
					url             : result.downloadURL,
					version         : result.version,
				}])

				if ( !resultDownload.ok ) { throw new Error(resultDownload.error ?? 'Unknown update error') }
				downloadButton.clsHide()
				MA.byIdHTML('update_status', `<span class="text-success">${I18N.defer('update_status_updated', false)}: ${DATA.escapeSpecial(result.version)}</span>`)
				this.getMod()
			} catch (err) {
				downloadButton.disabled = false
				MA.byIdHTML('update_status', `<span class="text-danger">${I18N.defer('update_list_update_failed', false)} ${DATA.escapeSpecial(err.message)}</span>`)
			}
		}
	}

	#versionMatchesCurrent(version) {
		if ( typeof version !== 'string' || version === '' ) { return false }
		const compareResult = DATA.versionCompare(this.mod.modDesc.version, version)
		return compareResult === 0 || (Number.isNaN(compareResult) && !DATA.versionDifferent(this.mod.modDesc.version, version))
	}

	async #refreshRollbackVersions(updatePointer, hasRollbackBackup = false) {
		const rollbackDiv = MA.byId('rollback_versions')
		if ( rollbackDiv === null ) { return }
		if ( this.mod.isVaultRecord ) {
			rollbackDiv.clsHide()
			return
		}

		const entries = await window.detail_IPC.rollbackEntries(updatePointer)
		if ( entries.length === 0 ) {
			rollbackDiv.clsHide()
			rollbackDiv.innerHTML = ''
			return
		}

		MA.byId('rollback_latest_update')?.clsHide()
		rollbackDiv.clsShow()
		rollbackDiv.innerHTML = `
			<div class="border rounded p-2">
				<div class="fw-bold mb-2">Available rollback versions</div>
				<div class="d-grid gap-2" id="rollback_version_list"></div>
			</div>`

		const listDiv = MA.byId('rollback_version_list')
		for ( const [index, entry] of entries.entries() ) {
			const versionLabel = entry.previousVersion ?? entry.currentVersion ?? (entry.backupHash !== null ? entry.backupHash.slice(0, 12) : 'backup')
			const isCurrentVersion = this.#versionMatchesCurrent(entry.previousVersion ?? entry.currentVersion)
			const timestamp = entry.timestamp === null ?
				'Unknown date' :
				new Date(Date.parse(entry.timestamp)).toLocaleString(this.locale, { timeZoneName : 'short' })
			const sourceLabel = entry.source ?? 'Backup'
			const template = document.createElement('template')
			template.innerHTML = `
				<div class="bg-secondary bg-opacity-25 rounded p-2">
					<div class="d-flex flex-wrap justify-content-between gap-2">
						<div>
							<div class="fw-bold">Version ${DATA.escapeSpecial(versionLabel)}</div>
							<div class="small">${DATA.escapeSpecial(timestamp)}</div>
							<div class="small">${DATA.escapeSpecial(sourceLabel)}</div>
						</div>
						<button class="btn btn-sm ${isCurrentVersion ? 'btn-secondary' : 'btn-info'} rollback-version-button" type="button" data-index="${index}" ${isCurrentVersion ? 'disabled' : ''}>${isCurrentVersion ? 'Current version' : 'Restore this version'}</button>
					</div>
				</div>
			`
			const row = template.content.firstElementChild
			if ( isCurrentVersion ) {
				listDiv.appendChild(row)
				continue
			}

			row.querySelector('.rollback-version-button').addEventListener('click', async (event) => {
				const button = event.currentTarget
				button.disabled = true
				MA.byIdHTML('update_status', I18N.defer('update_status_rollback_applying', false))
				const result = await window.detail_IPC.rollbackEntry(entry)
				if ( result.ok ) {
					MA.byIdHTML('update_status', `<span class="text-success">${I18N.defer('update_status_rollback_restored', false)}</span>`)
					this.getMod()
				} else {
					button.disabled = false
					MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_rollback_failed', false)} ${DATA.escapeSpecial(result.error)}</span>`)
				}
			})
			listDiv.appendChild(row)
		}

		if ( !hasRollbackBackup ) { MA.byId('rollback_latest_update')?.clsHide() }
	}

	#refreshRollbackButton(updatePointer, hasRollbackBackup) {
		const rollbackButton = MA.byId('rollback_latest_update')
		if ( rollbackButton === null ) { return }
		if ( this.mod.isVaultRecord ) {
			rollbackButton.clsHide()
			return
		}

		rollbackButton.clsShow(hasRollbackBackup)
		if ( !hasRollbackBackup ) { return }

		rollbackButton.onclick = async () => {
			rollbackButton.disabled = true
			MA.byIdHTML('update_status', I18N.defer('update_status_rollback_applying', false))
			const result = await window.detail_IPC.rollbackLatest(updatePointer)
			if ( result.ok ) {
				MA.byIdHTML('update_status', `<span class="text-success">${I18N.defer('update_status_rollback_restored', false)}</span>`)
				rollbackButton.clsHide()
				this.getMod()
			} else {
				MA.byIdHTML('update_status', `<span class="text-warning">${I18N.defer('update_status_rollback_failed', false)} ${DATA.escapeSpecial(result.error)}</span>`)
				rollbackButton.disabled = false
			}
		}
	}

	#versionStatusHTML(localVersion, remoteVersion, hasRollbackBackup = false) {
		if ( hasRollbackBackup ) {
			return `<span class="text-info">${I18N.defer('update_status_rollback_available', false)}</span>`
		}
		const compareResult = DATA.versionCompare(localVersion, remoteVersion)
		if ( compareResult < 0 ) {
			return `<span class="text-warning">${I18N.defer('update_status_available', false)}</span>`
		}
		if ( Number.isNaN(compareResult) && DATA.versionDifferent(localVersion, remoteVersion) ) {
			return `<span class="text-warning">${I18N.defer('update_status_available', false)}</span>`
		}
		if ( compareResult === 0 ) {
			return `<span class="text-success">${I18N.defer('update_status_current', false)}</span>`
		}
		return `<span class="text-info">${I18N.defer('update_status_unknown', false)}</span>`
	}

	// MARK: SUB binds
	async #do_subStep_binds(bindingIssue) {
		const problemPromises = []
		if ( bindingIssue !== null ) {
			for ( const keyCombo in bindingIssue ) {
				const actualKey = clientGetKeyMap(keyCombo, this.locale)
				const confList  = bindingIssue[keyCombo].join(', ')
				const i18n      = I18N.defer('bind_conflict')
				problemPromises.push(
					`${i18n} : ${actualKey} :: ${confList}`
				)
			}
		}
		return problemPromises
	}
	// MARK: SUB issues
	async #do_subStep_issues() {
		const problemI18N = []
		for ( const issue of this.mod.issues ) {

			const issueI18N = I18N.defer(issue, false)
			if ( issue === 'FILE_ERROR_LIKELY_COPY' && this.mod.fileDetail.copyName !== false ) {
				const copyI18N = I18N.defer('file_error_copy_name', false)
				problemI18N.push(`${issueI18N} ${copyI18N} ${this.mod.fileDetail.copyName}${this.mod.fileDetail.isFolder?'':'.zip'}`)
			} else {
				problemI18N.push(issueI18N)
			}
		}
		return problemI18N
	}

	#doL10N(item) {
		let returnText = item?.[this.locale]
		returnText ??= item?.en
		returnText ??= item?.de
		returnText ??= '--'
		return DATA.escapeSpecial(returnText)
	}

	// MARK: CLICKERS
	showHideClicker(e) {
		const isShow      = e.target.classList.contains('section_show')
		const buttonGroup = e.target.parentElement
		const section     = e.target.parentElement.parentElement.querySelector('div')

		section.clsShow(isShow)
		buttonGroup.children[0].clsShow(!isShow)
		buttonGroup.children[1].clsShow(isShow)
	}
}
