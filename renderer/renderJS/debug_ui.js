/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// MARK: DEBUG UI

/* global MA */

window.operations.receive('select:all', () => {
	const selection = window.getSelection()
	const range     = document.createRange()
	const target = MA.byId('debugPanelPerformance').classList.contains('d-none') ? MA.byId('debug_log') : MA.byId('debugPanelPerformance')
	range.selectNodeContents(target)
	selection.removeAllRanges()
	selection.addRange(range)
})

// MARK: PAGE LOAD
window.addEventListener('DOMContentLoaded', () => {
	window.state = new windowState()
})

class windowState {
	levelStyleSheet = null
	levelNames      = new Set(['debug', 'info', 'notice', 'warning', 'danger'])
	
	constructor() {
		window.debug_IPC.receive('debug:item', (level, item) => { this.addItem(level, item) })

		this.init()
	}

	init() {
		for ( const element of MA.queryA('input.filter_only') ) {
			element.addEventListener('change', (e) => {
				const thisLevel = e.target.id.replace(/^debug_/, '')

				for ( const [index, cssRule] of Object.entries(this.levelStyleSheet.cssRules) ) {
					if ( cssRule.selectorText.endsWith(thisLevel) ) {
						this.levelStyleSheet.deleteRule(index)
						break
					}
				}
				this.levelStyleSheet.insertRule(`.debug_log_item.${thisLevel} { display : ${e.target.checked ? 'block' : 'none' } }`)
			})
		}

		const viewStyle = document.createElement('style')

		document.head.appendChild(viewStyle)

		this.levelStyleSheet = viewStyle.sheet

		this.initialViewRules()

		MA.byId('debug_reset').addEventListener('click', () => { this.resetViewRules() })
		MA.byId('debug_log').addEventListener('contextmenu', window.debug_IPC.context)
		MA.byId('performanceRefresh').addEventListener('click', () => { this.loadPerformanceSummary() })
		MA.byId('performanceOpenLog').addEventListener('click', () => { this.openPerformanceLog() })
		for ( const element of MA.queryA('input.debug_view') ) {
			element.addEventListener('change', () => { this.setView(element.value) })
		}
		this.getAll()
		this.loadPerformanceSummary()
	}

	setView(view) {
		const isPerformance = view === 'performance'
		MA.byId('debugPanelLog').classList.toggle('d-none', isPerformance)
		MA.byId('debugPanelPerformance').classList.toggle('d-none', !isPerformance)
		MA.queryF('.debug-toolbar-log').classList.toggle('d-none', isPerformance)
		if ( isPerformance ) { this.loadPerformanceSummary() }
	}

	performanceText(metric) {
		if ( metric === null || typeof metric === 'undefined' || !Number.isFinite(metric.ms) ) {
			return 'not recorded'
		}
		return `${metric.ms.toFixed(1)} ms`
	}

	async loadPerformanceSummary() {
		const status = MA.byId('performanceStatus')
		status.className = 'col-12 small text-info'
		status.textContent = 'Reading performance log...'

		try {
			const summary = await window.debug_IPC.performanceSummary()
			MA.byIdText('performanceMainVisible', this.performanceText(summary.metrics?.mainVisible))
			MA.byIdText('performanceFolderScan', this.performanceText(summary.metrics?.modFolderScan))
			MA.byIdText('performanceRendererUpdate', this.performanceText(summary.metrics?.rendererUpdate))
			MA.byIdText('performanceVaultIndex', this.performanceText(summary.metrics?.vaultIndex))
			MA.byIdText('performanceVaultCopy', this.performanceText(summary.metrics?.vaultCopy))
			MA.byIdText('performanceVaultCopyPreview', this.performanceText(summary.metrics?.vaultCopyPreview))
			MA.byIdText('performanceVaultBulkCopy', this.performanceText(summary.metrics?.vaultBulkCopy))
			MA.byIdText('performanceModHubRefresh', this.performanceText(summary.metrics?.modHubRefresh))
			MA.byIdText('performanceLogPath', `Log file: ${summary.logPath ?? '--'}`)
			status.className = summary.ok ? 'col-12 small text-success' : 'col-12 small text-warning'
			status.textContent = summary.status ?? 'Performance summary refreshed.'
		} catch (err) {
			status.className = 'col-12 small text-danger'
			status.textContent = `Performance summary failed: ${err.message}`
		}
	}

	async openPerformanceLog() {
		const status = MA.byId('performanceStatus')
		try {
			const result = await window.debug_IPC.openPerformanceLog()
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

	// MARK: OUTPUT BUILD
	clearOutput() {
		MA.byIdText('debug_log', '')
	}

	addItem(level, html) {
		const thisDiv = document.createElement('div')
		thisDiv.innerHTML = html
		thisDiv.classList.add('debug_log_item', level)
		MA.byIdAppend('debug_log', thisDiv)
	}

	getAll() {
		this.clearOutput()
		window.debug_IPC.all().then((results) => {
			for ( const thisItem of results ) {
				this.addItem(...thisItem)
			}
		})
	}

	// MARK: DYNAMIC CSS
	resetViewRules() {
		while ( this.levelStyleSheet.cssRules.length !== 0 ) {
			this.levelStyleSheet.deleteRule(0)
		}
		for ( const thisLevel of this.levelNames ) {
			MA.byId(`debug_${thisLevel}`).checked = thisLevel !== 'debug'
		}
		this.initialViewRules()
	}

	initialViewRules() {
		for ( const thisLevel of this.levelNames ) {
			this.levelStyleSheet.insertRule(`.debug_log_item.${thisLevel} { display : ${thisLevel === 'debug' ? 'none' : 'block' } }`)
		}
	}
}
