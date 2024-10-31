/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */
// MARK: DETAIL UI
/* eslint complexity: ["error", 25] */
/* global DATA, MA, I18N, ft_doReplace, client_BuilderPlace, clientGetKeyMapSimple, clientGetKeyMap, clientMakeCropCalendar, client_BuilderVehicle */


window.lookItemMap  = {}
let locale       = 'en'

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	window.lookItemMap  = {}

	const urlParams = new URLSearchParams(window.location.search)
	const modColUUID = urlParams.get('mod')

	window.detail_IPC.getMod(modColUUID).then(async (thisResponse) => {
		console.log(thisResponse)
		const thisMod = thisResponse[0]
		const storeInfo = thisResponse[1]

		locale    = await window.i18n.lang()
		const i18nUnits = await window.settings.units()

		I18N.local_entries = storeInfo.l10n[locale] || storeInfo.l10n.en || {}

		const basicPromises = [
			step_table(thisMod),
			step_keyBinds(thisMod),
			step_problems(thisMod),
			step_badges(thisMod),
			step_crops(thisMod),
		]

		if ( thisMod.modDesc.mapImage !== null ) {
			MA.byId('map_image_div').clsShow()
			MA.byId('map_image').src = thisMod.modDesc.mapImage
		}

		try {
			MA.byIdHTML('storeitems', '')

			MA.byId('store_div').clsShow(Object.keys(storeInfo.vehicles).length !== 0 || Object.keys(storeInfo.placeables).length !== 0)

			for ( const storeItemFile of Object.keys(storeInfo.vehicles).sort() ) {
				const thisItem    = storeInfo.vehicles[storeItemFile]
				const thisVehicle = new client_BuilderVehicle(
					storeItemFile,
					thisItem,
					thisMod.fileDetail.shortName,
					locale,
					thisMod.gameVersion,
					storeInfo.brands
				)

				thisVehicle.populateCombos(storeInfo)

				window.lookItemMap[thisVehicle.lookItemMap[0]] = thisVehicle.lookItemMap[1]

				MA.byIdAppend('storeitems', thisVehicle.HTML)
				thisVehicle.doCharts(i18nUnits)
			}

			for ( const storeItemFile of Object.keys(storeInfo.placeables).sort() ) {
				const thisItem  = storeInfo.placeables[storeItemFile]
				const thisPlace = new client_BuilderPlace(
					thisItem,
					locale,
					thisMod.gameVersion
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
		window.log.error('page build error',  err.message, `\n${err.stack}`)
	})

	for ( const element of MA.query('.inset-block-header-show-hide i18n-text') ) {
		element.addEventListener('click', showHideClicker)
	}
})


// MARK: crops
async function step_crops(thisMod) {
	if ( Array.isArray(thisMod.modDesc.cropInfo) ) {
		MA.byId('cropcal_div').clsShow()
		MA.byId('detail_crop_json').clsShow()
		MA.byId('cropcal_button').addEventListener('click', () => {
			//TODO : this is wrong
			window.operations.clip(JSON.stringify(thisMod.modDesc.cropInfo))
		})
		
		return clientMakeCropCalendar(
			thisMod.modDesc.cropInfo,
			thisMod.modDesc?.mapIsSouth || false,
			thisMod.modDesc?.cropWeather || null
		).then((html) => {
			MA.byIdHTML('crop-table', html)
		})
	}
}

// MARK: badges
async function step_badges(thisMod) {
	return window.detail_IPC.getMalware().then((malware) => {
		let foundMalware = false

		const theseBadges = Array.isArray(thisMod.displayBadges) ? thisMod.displayBadges.filter((badge) => {
			if ( badge.name === 'malware' ) {
				if ( malware.dangerModsSkip.has(thisMod.fileDetail.shortName) ) { return false }
				if ( malware.suppressList.includes(thisMod.fileDetail.shortName)) { return false }
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
async function step_problems(thisMod) {
	return window.detail_IPC.getBinds().then(async (bindConflicts) => {
		const bindingIssue     = bindConflicts[thisMod.currentCollection][thisMod.fileDetail.shortName] ?? null

		if ( thisMod.issues.length === 0 && bindingIssue === null ) {
			MA.byId('problem_div').clsHide()
		} else {
			return Promise.allSettled([
				...await subStep_issues(thisMod),
				...await subStep_binds(bindingIssue, locale),
			]).then((value) => {
				const theseIssues = value.map((item) => `<tr class="py-2"><td class="px-2">${DATA.checkX(0, false)}</td><td>${item.value}}</td></tr>`)
				MA.byIdHTML('problems', `<table class="table table-borderless mb-0">${theseIssues.join('')}</table>`)
			})
		}
	})
}

// MARK: keyBinds
async function step_keyBinds(thisMod) {
	const keyBinds = []
	for ( const action in thisMod.modDesc.binds ) {
		const thisBinds = thisMod.modDesc.binds[action].map((keyCombo) => clientGetKeyMapSimple(keyCombo, locale))
		keyBinds.push(`${action} :: ${thisBinds.join('<span class="mx-3">/</span>')}`)
	}
	return DATA.joinArrayOrI18N(keyBinds, 'detail_key_none').then((value) => {
		MA.byIdHTML('keyBinds', value)
		MA.byId('keyBinds').clsOrGateArr(keyBinds, 'text-info')
	})
	
}


function doL10N(item) {
	let returnText = item?.[locale]
	returnText ??= item?.en
	returnText ??= item?.de
	returnText ??= '--'
	return DATA.escapeSpecial(returnText)
}

// MARK: table (top)
async function step_table(thisMod) {
	const joinedArrays = {
		bigFiles       : [thisMod.fileDetail.tooBigFiles],
		depends        : [thisMod.modDesc.depend, 'detail_depend_clean'],
		extraFiles     : [thisMod.fileDetail.extraFiles],
		pngTexture     : [thisMod.fileDetail.pngTexture],
		spaceFiles     : [thisMod.fileDetail.spaceFiles],
	}
	for ( const [id, content] of Object.entries(joinedArrays)) {
		DATA.joinArrayOrI18N(...content).then((value) => {
			MA.byIdHTML(id, value)
			MA.byId(id).clsOrGateArr(content[0])
		})
	}

	const tempTitle = doL10N(thisMod.l10n.title)

	const idMap = {
		description    : doL10N(thisMod.l10n.description),
		file_date      : (new Date(Date.parse(thisMod.fileDetail.fileDate))).toLocaleString(locale, {timeZoneName : 'short'}),
		filesize       : await DATA.bytesToHR(thisMod.fileDetail.fileSize),
		has_scripts    : DATA.checkX(thisMod.modDesc.scriptFiles),
		i3dFiles       : thisMod.fileDetail.i3dFiles.join('\n'),
		is_multiplayer : DATA.checkX(thisMod.modDesc.multiPlayer, false),
		mh_version     : ( thisMod.modHub.id !== null ) ?
			`<a href="https://www.farming-simulator.com/mod.php?mod_id=${thisMod.modHub.id}" target="_BLANK">${thisMod.modHub.version}</a>` :
			`<em>${I18N.defer(thisMod.modHub.id === null ? 'mh_norecord' : 'mh_unknown', false )}</em>`,
		mod_author     : DATA.escapeSpecial(thisMod.modDesc.author),
		mod_location   : thisMod.fileDetail.fullPath,
		store_items    : DATA.checkX(thisMod.modDesc.storeItems),
		title          : (( tempTitle !== '--' ) ? tempTitle : thisMod.fileDetail.shortName),
		version        : DATA.escapeSpecial(thisMod.modDesc.version),
	}
	for ( const [id, content] of Object.entries(idMap)) {
		MA.byIdHTML(id, content)
	}

	for ( const element of MA.query('#description a') ) { element.target = '_BLANK' }

	MA.byIdHTMLorHide(
		'icon_div',
		`<img class="img-fluid" src="${thisMod.modDesc.iconImage}" />`,
		thisMod.modDesc.iconImage
	)
}

// MARK: SUB issues
async function subStep_issues(modRecord) {
	const problemI18N = []
	for ( const issue of modRecord.issues ) {

		const issueI18N = I18N.defer(issue, false)
		if ( issue === 'FILE_ERROR_LIKELY_COPY' && modRecord.fileDetail.copyName !== false ) {
			const copyI18N = I18N.defer('file_error_copy_name', false)
			problemI18N.push(`${issueI18N} ${copyI18N} ${modRecord.fileDetail.copyName}${modRecord.fileDetail.isFolder?'':'.zip'}`)
		} else {
			problemI18N.push(issueI18N)
		}
	}
	return problemI18N
}

// MARK: SUB binds
async function subStep_binds(bindingIssue) {
	const problemPromises = []
	if ( bindingIssue !== null ) {
		for ( const keyCombo in bindingIssue ) {
			const actualKey = clientGetKeyMap(keyCombo, locale)
			const confList  = bindingIssue[keyCombo].join(', ')
			const i18n      = I18N.defer('bind_conflict')
			problemPromises.push(
				`${i18n} : ${actualKey} :: ${confList}`
			)
		}
	}
	return problemPromises
}



// MARK: CLICKERS
function showHideClicker(e) {
	const isShow      = e.target.classList.contains('section_show')
	const buttonGroup = e.target.parentElement
	const section     = e.target.parentElement.parentElement.querySelector('div')

	section.clsShow(isShow)
	buttonGroup.children[0].clsShow(!isShow)
	buttonGroup.children[1].clsShow(isShow)
}
