/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// MARK: MAIN FIND PANEL

/* global bootstrap, DATA, MA */

class MainFindAllPanel {
	fullList_data   = {}
	fullList_sort   = []
	fullList_filter = new Set()
	filter_last     = ''
	filter_length   = 0
	isLoaded        = false
	isLoading       = false
	locale          = 'en'
	filterTimer     = null

	constructor() {
		this.canvas = MA.byId('mainFindAllCanvas')
		if ( this.canvas === null ) { return }

		this.canvasInstance = bootstrap.Offcanvas.getOrCreateInstance(this.canvas)

		MA.byIdEventIfExists('mainFindAllButton', () => {
			this.open(MA.byIdValue('filter_input'))
		})
		MA.byIdEventIfExists('mainFindAllClear', () => {
			MA.byIdValue('mainFindAllInput', '')
			this.doFilter()
		})
		MA.byIdEventIfExists('mainFindAllInput', () => { window.main_IPC.findInputContext() }, 'contextmenu')
		MA.byIdEventIfExists('mainFindAllInput', () => {
			if ( this.filterTimer !== null ) { clearTimeout(this.filterTimer) }
			this.filterTimer = setTimeout(() => {
				this.filterTimer = null
				this.doFilter()
			}, 100)
		}, 'input')

		window.addEventListener('main-find-all:open', () => { this.open() })
		this.canvas.addEventListener('shown.bs.offcanvas', () => {
			MA.byId('mainFindAllInput')?.focus({ preventScroll : true })
		})
	}

	doL10N(item) {
		let returnText = item?.[this.locale]
		returnText ??= item?.en
		returnText ??= item?.de
		returnText ??= '--'
		return DATA.escapeSpecial(returnText)
	}

	open(searchText = null) {
		if ( typeof searchText === 'string' ) {
			MA.byIdValue('mainFindAllInput', searchText.trim())
		}
		this.canvasInstance.show()
		if ( this.isLoaded || this.isLoading ) {
			this.doFilter()
			return
		}
		this.load()
	}

	async load() {
		this.isLoading = true
		MA.byIdText('mainFindAllSummary', 'Loading every collection...')
		try {
			const results = await window.main_IPC.findAll()
			this.buildObject(results)
			this.isLoaded = true
		} catch (err) {
			MA.byIdText('mainFindAllSummary', `Find all failed: ${err.message}`)
		} finally {
			this.isLoading = false
		}
	}

	doFilter() {
		const filterThis = MA.byIdValueLC('mainFindAllInput')

		MA.byId('mainFindAllClear').disabled = filterThis === ''

		if ( filterThis === this.filter_last ) { return }
		if ( filterThis.length <= 2 ) {
			this.fullList_filter = new Set(this.fullList_sort)
			this.filter_length = this.fullList_filter.size
			this.filter_last   = filterThis
			this.buildDisplay()
			return
		}

		const filterNew = new Set()

		for ( const key of this.fullList_sort ) {
			if ( this.fullList_data[key].search.includes(filterThis) ) {
				filterNew.add(key)
			}
		}

		this.fullList_filter = filterNew
		this.filter_length = this.fullList_filter.size
		this.filter_last   = filterThis
		this.buildDisplay()
	}

	buildObject(response) {
		this.fullList_data   = {}
		this.fullList_sort   = []
		this.fullList_filter = new Set()
		this.filter_last     = ''

		const curVersion = response.appSettings.game_version

		try {
			for ( const collectKey of response.set_Collections ) {
				if ( response.collectionNotes[collectKey]?.notes_version !== curVersion ) { continue }
				for ( const modKey of response.modList[collectKey].modSet ) {
					const mod = response.modList[collectKey].mods[modKey]
					if ( mod.canNotUse ) { continue }

					this.fullList_data[mod.fileDetail.shortName] ??= {
						author  : DATA.escapeSpecial(mod.modDesc.author),
						collect : [],
						icon    : mod.modDesc.iconImage,
						name    : mod.fileDetail.shortName,
						search  : [
							mod.fileDetail.shortName,
							DATA.escapeSpecial(mod.modDesc.author),
							this.doL10N(mod.l10n.title),
						].join(' ').toLowerCase(),
						title : this.doL10N(mod.l10n.title),
					}
					this.fullList_data[mod.fileDetail.shortName].collect.push({
						fullId  : `${collectKey}--${mod.uuid}`,
						name    : response.collectionToName[collectKey],
						version : DATA.escapeSpecial(mod.modDesc.version),
					})
				}
			}
		} catch (err) {
			window.log.warning('Failed to build main search data', err.message)
		}

		this.fullList_sort   = Object.keys(this.fullList_data).sort((a, b) => a.localeCompare(b))
		this.fullList_filter = new Set(this.fullList_sort)
		this.filter_length   = this.fullList_filter.size

		this.filter_last = null
		this.doFilter()
	}

	buildDisplay() {
		const displayNode = MA.byId('mainFindAllTable')
		let shownCount = 0

		displayNode.innerHTML = ''

		for ( const key of this.fullList_sort ) {
			if ( ! this.fullList_filter.has(key) ) { continue }

			const item = this.fullList_data[key]
			const itemNode = DATA.templateEngine('main_find_mod_entry', {
				author : item.author,
				icon   : `<img src="${DATA.iconMaker(item.icon)}" class="main-find-icon">`,
				name   : item.name,
				title  : item.title,
			})

			const itemCollectNode = itemNode.querySelector('.versionList')
			for ( const cItem of item.collect ) {
				const node = DATA.templateEngine('main_find_version_entry', {
					name    : cItem.name,
					version : cItem.version,
				})
				node.querySelector('dt').addEventListener('click', () => {
					window.main_IPC.findSelect(cItem.fullId, item.name)
					this.canvasInstance.hide()
				})
				itemCollectNode.appendChild(node)
			}

			itemNode.firstElementChild.addEventListener('contextmenu', () => {
				window.main_IPC.findModContext(item)
			})

			displayNode.appendChild(itemNode)
			shownCount++
		}

		MA.byIdText('mainFindAllSummary', `${shownCount} of ${this.fullList_sort.length} mods shown`)
	}
}

window.addEventListener('DOMContentLoaded', () => {
	window.mainFindAllPanel = new MainFindAllPanel()
})
