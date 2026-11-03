/* global modhub_downloader_IPC */

function byId(id) {
	return document.getElementById(id)
}

function isSelectable(row) {
	return row.status === 'Ready'
}

function modHubPageURL(id) {
	return /^\d+$/u.test(String(id ?? '')) ? `https://www.farming-simulator.com/mod.php?mod_id=${id}` : null
}

function setReportsLoadError(panel, message) {
	panel.textContent = message
}

window.addEventListener('DOMContentLoaded', () => {
	const results = byId('modHubResults')
	const status = byId('modHubStatus')
	const progressWrap = byId('modHubProgressWrap')
	const progressBar = byId('modHubProgress')
	let progressStarted = 0
	let progressTimer = null
	let progressState = { completed : 0, total : 0 }
	const updateProgress = () => {
		const { completed, total } = progressState
		const percent = total > 0 ? Math.min(100, Math.floor(completed / total * 100)) : 0
		progressBar.style.width = `${total > 0 ? percent : 100}%`
		progressBar.textContent = total > 0 ? `${percent}%` : ''
		if ( total > 0 ) { progressBar.setAttribute('aria-valuenow', String(percent)) }
		else { progressBar.removeAttribute('aria-valuenow') }
		byId('modHubProgressCount').textContent = total > 0 ? `${completed.toLocaleString()} of ${total.toLocaleString()} processed` : 'Preparing…'
		const seconds = completed > 0 ? Math.ceil((performance.now() - progressStarted) / 1000 / completed * Math.max(0, total - completed)) : null
		byId('modHubProgressETA').textContent = cancelling ? 'Cancelling after current item…' : seconds === null ? 'Estimating time remaining…' : completed >= total ? 'Finishing…' : `About ${seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.ceil(seconds % 3600 / 60)}m` : seconds >= 60 ? `${Math.ceil(seconds / 60)}m` : `${seconds}s`} remaining`
	}
	const reportsPanel = byId('modHubReports')
	let rows = []
	let visibleLimit = 250
	let busy = false
	let downloading = false
	let appliedConcurrency = 1
	let cancelling = false
	let showingReports = false
	let reportsRequestID = 0
	const selected = new Map()
	let sizeSelection = ''
	const selectedTags = new Set()
	const collapsedTags = new Set()
	const knownTagGroups = new Set()
	let tagNodes = new Map()
	const rebuildTags = () => {
		tagNodes = new Map()
		for ( const row of rows ) {
			const category = Array.isArray(row.categoryPath) ? row.categoryPath : []
			const paths = category.length === 0 ? [['Uncategorised']] : category.map((_, index) => category.slice(0, index + 1))
			for ( const tag of row.customTags ?? [] ) { paths.push(['My tags', tag]) }
			for ( const path of paths ) {
				const key = JSON.stringify(path.map((part) => part.toLocaleLowerCase()))
				if ( !tagNodes.has(key) ) { tagNodes.set(key, { path, ids : new Set() }) }
				tagNodes.get(key).ids.add(row.id)
			}
		}
		for ( const key of selectedTags ) { if ( !tagNodes.has(key) ) { selectedTags.delete(key) } }
	}
	const renderTags = () => {
		const tree = byId('modHubTagTree')
		tree.replaceChildren()
		const query = byId('modHubTagSearch').value.trim().toLocaleLowerCase()
		// Keep alternative tags available while filtering the result list by selected tags.
		const visibleIDs = new Set(visibleRows(true).map((row) => row.id))
		const parentKeys = new Set()
		for ( const node of tagNodes.values() ) {
			for ( let depth = 1; depth < node.path.length; depth++ ) {
				const parentKey = JSON.stringify(node.path.slice(0, depth).map((part) => part.toLocaleLowerCase()))
				parentKeys.add(parentKey)
				if ( !knownTagGroups.has(parentKey) ) {
					knownTagGroups.add(parentKey)
					collapsedTags.add(parentKey)
				}
			}
		}
		for ( const [key, node] of [...tagNodes].sort((left, right) => left[1].path.join(' › ').localeCompare(right[1].path.join(' › '))) ) {
			const count = [...node.ids].filter((id) => visibleIDs.has(id)).length
			if ( count === 0 ) { continue }
			if ( query !== '' && !node.path.join(' ').toLocaleLowerCase().includes(query) ) { continue }
			const ancestors = node.path.slice(0, -1).map((_, index) => JSON.stringify(node.path.slice(0, index + 1).map((part) => part.toLocaleLowerCase())))
			if ( query === '' && ancestors.some((ancestor) => collapsedTags.has(ancestor)) ) { continue }
			const tagRow = document.createElement('div')
			tagRow.className = 'd-flex align-items-start gap-1'
			tagRow.style.paddingLeft = `${(node.path.length - 1) * 12}px`
			if ( parentKeys.has(key) ) {
				const toggle = document.createElement('button')
				const expanded = query !== '' || !collapsedTags.has(key)
				toggle.type = 'button'
				toggle.className = 'modhub-tag-toggle flex-shrink-0'
				toggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="${expanded ? 'M3 5 L8 10 L13 5' : 'M5 3 L10 8 L5 13'}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
				toggle.title = `${expanded ? 'Collapse' : 'Expand'} group`
				toggle.setAttribute('aria-expanded', String(expanded))
				toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${node.path.join(' › ')}`)
				toggle.disabled = query !== ''
				toggle.addEventListener('click', () => {
					if ( collapsedTags.has(key) ) { collapsedTags.delete(key) } else { collapsedTags.add(key) }
					renderTags()
				})
				tagRow.appendChild(toggle)
			} else {
				const spacer = document.createElement('span')
				spacer.style.width = '26px'
				spacer.className = 'flex-shrink-0'
				tagRow.appendChild(spacer)
			}
			const label = document.createElement('label')
			label.className = 'd-flex gap-2 align-items-start small py-1'
			const checkbox = document.createElement('input')
			checkbox.type = 'checkbox'
			checkbox.className = 'form-check-input flex-shrink-0'
			checkbox.checked = selectedTags.has(key)
			checkbox.disabled = busy
			checkbox.addEventListener('change', () => {
				if ( checkbox.checked ) { selectedTags.add(key) } else { selectedTags.delete(key) }
				visibleLimit = 250
				render()
			})
			const text = document.createElement('span')
			text.textContent = `${node.path.at(-1)} (${count})`
			label.title = node.path.join(' › ')
			label.append(checkbox, text)
			tagRow.appendChild(label)
			tree.appendChild(tagRow)
		}
		if ( tree.childElementCount === 0 ) { tree.textContent = rows.length === 0 ? 'Scan the catalogue to see tags.' : 'No matching tags.' }
		const selectedPanel = byId('modHubTagSelected')
		selectedPanel.textContent = `Selected tags (${selectedTags.size})`
		for ( const key of selectedTags ) {
			const remove = document.createElement('button')
			remove.type = 'button'
			remove.className = 'btn btn-sm btn-outline-info d-block mt-1 text-start'
			remove.textContent = `${tagNodes.get(key)?.path.join(' › ')} ×`
			remove.setAttribute('aria-label', `Remove tag filter ${tagNodes.get(key)?.path.join(' › ')}`)
			remove.addEventListener('click', () => { selectedTags.delete(key); visibleLimit = 250; render() })
			selectedPanel.appendChild(remove)
		}
	}

	const visibleRows = (ignoreTags = false) => {
		const query = byId('modHubSearch').value.trim().toLocaleLowerCase()
		return rows.filter((row) => {
			if ( byId('modHubHideExisting').checked && ['Already in Vault', 'Imported'].includes(row.status) ) { return false }
			if ( byId('modHubHideUnavailable').checked && row.status === 'Unavailable on ModHub' ) { return false }
			const matches = [...selectedTags].map((key) => tagNodes.get(key)?.ids.has(row.id) === true)
			const tagsMatch = ignoreTags || matches.length === 0 || (byId('modHubTagAll').checked ? matches.every(Boolean) : matches.some(Boolean))
			return tagsMatch && (query === '' || `${row.name} ${row.source} ${row.game ?? ''}`.toLocaleLowerCase().includes(query))
		})
	}
	const updateButtons = () => {
		const selectionKey = [...selected.keys()].sort().join(',')
		if ( selectionKey !== sizeSelection ) {
			sizeSelection = selectionKey
			byId('modHubSelectedSize').textContent = 'Selection changed. Calculate selected size to check ZIP storage required.'
		}
		byId('modHubCalculateSize').disabled = busy || selected.size === 0
		byId('modHubDownload').textContent = `Download selected (${selected.size})`
		byId('modHubDownload').disabled = busy || selected.size === 0
		byId('modHubSelectAll').disabled = busy || !rows.some((row) => isSelectable(row))
		byId('modHubScan').disabled = busy
		byId('modHubClear').disabled = busy
		byId('modHubGame').disabled = busy
		byId('modHubSearch').disabled = busy
		byId('modHubHideExisting').disabled = busy
		byId('modHubHideUnavailable').disabled = busy
		byId('modHubCancel').hidden = !busy
		byId('modHubCancel').textContent = cancelling ? 'Stopping…' : 'Stop batch'
		byId('modHubToggleReports').textContent = showingReports ? 'Back to catalogue results' : 'View saved reports'
	}
	const renderRow = (row) => {
		const item = document.createElement('div')
		item.className = `downloader-row${isSelectable(row) ? '' : ' is-skipped'}`
		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.className = 'form-check-input m-0'
		checkbox.setAttribute('aria-label', `Select ${row.name}`)
		checkbox.disabled = busy || !isSelectable(row)
		checkbox.checked = selected.has(row.id)
		checkbox.addEventListener('change', () => {
			if ( checkbox.checked ) { selected.set(row.id, -1) }
			else { selected.delete(row.id) }
			updateButtons()
		})
		const details = document.createElement('div')
		const name = document.createElement('div')
		name.className = 'downloader-name'
		name.textContent = row.name || row.source
		const source = document.createElement('div')
		source.className = 'downloader-source'
		source.textContent = `${row.game ?? 'Farming Simulator'} · ModHub ID ${row.modHubID}`
		details.append(name, source)
		const listingURL = modHubPageURL(row.modHubID)
		if ( listingURL ) {
			const listing = document.createElement('a')
			listing.className = 'small d-inline-block mt-1'
			listing.href = listingURL
			listing.target = '_blank'
			listing.rel = 'noreferrer'
			listing.textContent = 'View ModHub page'
			details.appendChild(listing)
		}
		if ( row.version ) {
			const version = document.createElement('div')
			version.className = 'small text-body-secondary'
			version.textContent = `Catalogue version ${row.version}`
			details.appendChild(version)
		}
		if ( Number.isSafeInteger(row.sizeBytes) && row.sizeBytes > 0 ) {
			const size = document.createElement('div')
			size.className = 'small text-body-secondary downloader-size-result'
			const sizeText = row.sizeBytes >= 1000000000 ? `${(row.sizeBytes / 1000000000).toFixed(2)} GB` : `${(row.sizeBytes / 1000000).toFixed(1)} MB`
			size.textContent = `ZIP size ${sizeText} (${row.sizeSource === 'cached' ? 'cached' : 'checked online'})`
			details.appendChild(size)
		} else if ( row.sizeReason ) {
			const size = document.createElement('div')
			size.className = 'small text-warning downloader-size-result'
			size.textContent = `ZIP size unavailable: ${row.sizeReason}`
			details.appendChild(size)
		}
		const state = document.createElement('div')
		state.className = 'downloader-status'
		const badge = document.createElement('span')
		badge.className = `badge ${row.status === 'Ready' ? 'text-bg-success' : row.status === 'Already in Vault' ? 'text-bg-secondary' : row.status === 'Imported' ? 'text-bg-primary' : 'text-bg-warning'}`
		badge.textContent = row.status
		state.appendChild(badge)
		if ( row.detail ) {
			const message = document.createElement('div')
			message.className = 'small text-danger mt-1'
			message.textContent = row.detail
			state.appendChild(message)
		}
		item.append(checkbox, details, state)
		return item
	}
	const render = () => {
		renderTags()
		results.hidden = showingReports
		reportsPanel.hidden = !showingReports
		if ( showingReports ) { updateButtons(); return }
		results.replaceChildren()
		const shownRows = visibleRows()
		const renderRows = shownRows.slice(0, visibleLimit)
		if ( shownRows.length === 0 ) {
			const empty = document.createElement('div')
			empty.className = 'p-3 text-body-secondary'
			empty.textContent = rows.length === 0 ? 'No catalogue scanned yet.' : 'No listings match this search.'
			results.appendChild(empty)
		} else {
			for ( const row of renderRows ) {
				results.appendChild(renderRow(row))
			}
			if ( renderRows.length < shownRows.length ) {
				const more = document.createElement('div')
				more.className = 'downloader-more p-3 text-center'
				const button = document.createElement('button')
				button.type = 'button'
				button.className = 'btn btn-outline-primary'
				button.textContent = `Show 250 more (${renderRows.length} of ${shownRows.length} shown)`
				button.addEventListener('click', () => { visibleLimit += 250; render() })
				more.appendChild(button)
				results.appendChild(more)
			}
		}
		const alreadyThere = rows.filter((row) => row.status === 'Already in Vault').length
		const unavailable = rows.filter((row) => row.status === 'Unavailable on ModHub').length
		const missing = rows.filter((row) => isSelectable(row)).length
		if ( rows.length !== 0 && !busy ) {
			status.textContent = `${rows.length} catalogue listings · ${missing} not in the Vault · ${alreadyThere} already in the Vault · ${unavailable} unavailable on ModHub. ${renderRows.length} of ${shownRows.length} matching listings shown.`
		}
		updateButtons()
	}
	const renderReports = (reports) => {
		reportsPanel.replaceChildren()
		if ( reports.length === 0 ) {
			const empty = document.createElement('p')
			empty.className = 'text-body-secondary mb-0'
			empty.textContent = 'No ModHub download reports have been saved yet.'
			reportsPanel.appendChild(empty)
			return
		}
		for ( const report of reports ) {
			const card = document.createElement('article')
			card.className = 'border rounded p-3 mb-3'
			const heading = document.createElement('h2')
			heading.className = 'h5'
			heading.textContent = `${report.game ?? 'Farming Simulator'} download run · ${new Date(report.completedAt).toLocaleString()}`
			const summary = document.createElement('p')
			summary.className = 'text-body-secondary'
			const downloaded = report.items.filter((item) => ['Imported', 'Already in Vault'].includes(item.outcome)).length
			summary.textContent = `${downloaded} ZIP${downloaded === 1 ? '' : 's'} added or matched in the Vault out of ${report.items.length} selected.`
			const list = document.createElement('div')
			list.className = 'list-group'
			for ( const item of report.items ) {
				const line = document.createElement('div')
				line.className = 'list-group-item bg-transparent text-body'
				const name = document.createElement('strong')
				name.textContent = item.modName ?? item.fileName
				const details = document.createElement('div')
				details.className = 'small text-body-secondary mt-1'
				details.textContent = `ZIP: ${item.fileName ?? 'Unknown'} · ModHub version: ${item.modHubVersion ?? 'Unknown'} · ZIP version: ${item.zipVersion ?? 'Unknown'} · Result: ${item.outcome}`
				line.append(name, details)
				if ( item.detail ) {
					const error = document.createElement('div')
					error.className = 'small text-warning mt-1'
					error.textContent = item.detail
					line.appendChild(error)
				}
				const listingURL = modHubPageURL(item.modHubID) ?? (typeof item.url === 'string' && /^https:\/\/www\.farming-simulator\.com\/mod\.php\?/u.test(item.url) ? item.url : null)
				if ( listingURL ) {
					const link = document.createElement('a')
					link.className = 'small d-inline-block mt-1'
					link.href = listingURL
					link.target = '_blank'
					link.rel = 'noreferrer'
					link.textContent = 'View ModHub page'
					line.appendChild(link)
				}
				list.appendChild(line)
			}
			card.append(heading, summary, list)
			reportsPanel.appendChild(card)
		}
	}
	const setBusy = (value) => {
		busy = value
		if ( !value ) { cancelling = false }
		progressWrap.hidden = !value
		updateButtons()
		render()
	}
	const run = async (operation, startText, autoSelectReady = false) => {
		progressStarted = performance.now()
		byId('modHubDownloadSpeed').textContent = 'Download speed: —'
		progressState = { completed : 0, total : autoSelectReady ? 0 : selected.size }
		setBusy(true)
		status.className = 'alert alert-info mb-0'
		status.textContent = startText
		updateProgress()
		progressTimer = setInterval(updateProgress, 1000)
		try {
			const result = await operation()
			if ( result === null ) { status.textContent = 'No operation was started.'; return }
			if ( result.ok === false ) { throw new Error(result.error ?? 'The ModHub task failed.') }
			rows = result.rows ?? []
			rebuildTags()
			visibleLimit = 250
			selected.clear()
			const counts = new Map()
			for ( const row of rows ) { counts.set(row.status, (counts.get(row.status) ?? 0) + 1) }
			status.className = `alert ${result.cancelled ? 'alert-warning' : 'alert-secondary'} mb-0`
			status.textContent = `${result.cancelled ? 'Cancelled. ' : ''}${[...counts].map(([label, count]) => `${label}: ${count}`).join(' | ') || 'No listings found in the cached catalogue for this game.'}`
			if ( autoSelectReady && result.catalogueRefresh?.supported ) {
				if ( result.catalogueRefresh.updated ) { status.textContent += ' The latest ModHub catalogue feed was downloaded and saved.' }
				else if ( result.catalogueRefresh.offline ) { status.textContent += ' You are offline, so the saved catalogue was used.' }
				else if ( result.catalogueRefresh.results ) { status.textContent += ' The latest feed could not be downloaded; the saved catalogue was used.' }
			} else if ( autoSelectReady ) { status.textContent += ' Older game versions use the saved catalogue; missing category details were checked online.' }
			window.taskCompletion.play(result)
		} catch (err) {
			status.className = 'alert alert-danger mb-0'
			status.textContent = err.message
		} finally { clearInterval(progressTimer); progressTimer = null; setBusy(false) }
	}

	byId('modHubScan').addEventListener('click', () => run(
		() => modhub_downloader_IPC.scan(byId('modHubGame').value),
		'Refreshing ModHub and checking listings against the Vault…', true
	))
	byId('modHubCalculateSize').addEventListener('click', async () => {
		const ids = [...selected.keys()]
		progressStarted = performance.now()
		progressState = { completed : 0, total : ids.length }
		setBusy(true)
		updateProgress()
		byId('modHubSelectedSize').textContent = 'Checking selected ZIP sizes…'
		try {
			const estimate = await modhub_downloader_IPC.size(ids)
			for ( const checked of estimate.results ?? [] ) {
				const row = rows.find((item) => item.id === checked.id)
				if ( !row ) { continue }
				row.sizeBytes = checked.bytes
				row.sizeSource = checked.source
				row.sizeReason = checked.reason
				if ( checked.status ) { row.status = checked.status }
				if ( checked.detail ) { row.detail = checked.detail }
				if ( row.status === 'Unavailable on ModHub' ) { selected.delete(row.id) }
			}
			sizeSelection = [...selected.keys()].sort().join(',')
			const size = estimate.bytes >= 1000000000 ? `${(estimate.bytes / 1000000000).toFixed(2)} GB` : `${(estimate.bytes / 1000000).toFixed(1)} MB`
			const unknown = estimate.total - estimate.known
			const failed = (estimate.results ?? []).filter((item) => item.reason !== null)
			const unchecked = Math.max(0, unknown - failed.length)
			const reasonCounts = new Map()
			for ( const item of failed ) { reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1) }
			const reasonSummary = [...reasonCounts].slice(0, 3).map(([reason, count]) => `${count}× ${reason}`).join(' · ')
			const unknownText = unknown === 0 ? '' : ` ${failed.length} could not be checked${unchecked > 0 ? `, ${unchecked} not checked before stopping` : ''}.${reasonSummary ? ` Details: ${reasonSummary}` : ''}`
			byId('modHubSelectedSize').textContent = `${estimate.cancelled ? 'Cancelled. ' : ''}Selected ZIP storage: ${unknown > 0 ? 'at least ' : ''}${size} (${estimate.known} of ${estimate.total} sizes known).${unknownText} Allow extra free space for temporary files during download and import.`
			render()
			window.taskCompletion.play(estimate)
		} catch (err) {
			byId('modHubSelectedSize').textContent = `Could not calculate selected size: ${err.message}`
		} finally { setBusy(false) }
	})
	byId('modHubDownload').addEventListener('click', () => {
		const chosen = [...selected.keys()].map((id) => ({ id, asset : -1 }))
		downloading = true
		appliedConcurrency = Number(byId('modHubConcurrency').value)
		run(() => modhub_downloader_IPC.download({ concurrency : appliedConcurrency, gameVersion : byId('modHubGame').value, selected : chosen }), 'Downloading selected mods to the Vault…').finally(() => {
			downloading = false
			byId('modHubActiveDownloads').textContent = 'Downloads finished'
		})
	})
	byId('modHubConcurrency').addEventListener('change', async () => {
		if ( !downloading ) { return }
		const control = byId('modHubConcurrency')
		control.disabled = true
		try {
			appliedConcurrency = await modhub_downloader_IPC.concurrency(Number(control.value))
			byId('modHubActiveDownloads').textContent = `Parallel limit: ${appliedConcurrency}. Active downloads finish normally.`
		} catch (err) {
			control.value = String(appliedConcurrency)
			status.textContent = `Could not change parallel limit: ${err.message}`
		} finally { control.disabled = false }
	})
	byId('modHubToggleReports').addEventListener('click', async () => {
		showingReports = !showingReports
		const requestID = ++reportsRequestID
		if ( showingReports ) {
			reportsPanel.replaceChildren()
			const loading = document.createElement('p')
			loading.className = 'text-body-secondary mb-0'
			loading.textContent = 'Loading saved reports…'
			reportsPanel.appendChild(loading)
			try {
				const reports = await modhub_downloader_IPC.reports()
				if ( requestID === reportsRequestID && showingReports ) { renderReports(reports) }
			} catch (err) {
				if ( requestID === reportsRequestID && showingReports ) { setReportsLoadError(reportsPanel, `Could not load saved reports: ${err.message}`) }
			}
		}
		render()
	})
	byId('modHubSelectAll').addEventListener('click', () => {
		selected.clear()
		for ( const row of visibleRows().filter((item) => isSelectable(item)) ) { selected.set(row.id, -1) }
		render()
	})
	byId('modHubSelectAll').textContent = 'Select matching missing'
	byId('modHubTagSearch').addEventListener('input', renderTags)
	byId('modHubTagAll').addEventListener('change', () => { visibleLimit = 250; render() })
	byId('modHubHideExisting').addEventListener('change', () => { visibleLimit = 250; render() })
	byId('modHubHideUnavailable').addEventListener('change', () => { visibleLimit = 250; render() })
	byId('modHubTagClear').addEventListener('click', () => {
		selectedTags.clear()
		byId('modHubTagSearch').value = ''
		byId('modHubHideExisting').checked = true
		byId('modHubHideUnavailable').checked = true
		byId('modHubSearch').value = ''
		visibleLimit = 250
		render()
	})
	byId('modHubSearch').addEventListener('input', () => { visibleLimit = 250; render() })
	byId('modHubClear').addEventListener('click', () => {
		rows = []
		selectedTags.clear()
		rebuildTags()
		visibleLimit = 250
		selected.clear()
		byId('modHubSearch').value = ''
		status.className = 'alert alert-secondary mb-0'
		status.textContent = 'Choose a game version, then scan the ModHub catalogue.'
		render()
	})
	byId('modHubCancel').addEventListener('click', async () => {
		cancelling = true
		status.textContent = 'Stopping the batch and cancelling active downloads…'
		updateButtons()
		await modhub_downloader_IPC.cancel()
	})
	modhub_downloader_IPC.receive('modhub-downloader:progress', (progress) => {
		if ( !busy ) { return }
		const speed = progress.bytesPerSecond
		if ( Number.isInteger(progress.activeDownloads) ) { byId('modHubActiveDownloads').textContent = `${progress.activeDownloads} active item${progress.activeDownloads === 1 ? '' : 's'} · parallel limit ${appliedConcurrency}` }
		byId('modHubDownloadSpeed').textContent = Number.isFinite(speed) ? `Download speed: ${speed >= 1000000 ? `${(speed / 1000000).toFixed(1)} MB/s` : `${(Math.max(0, speed) / 1000).toFixed(1)} KB/s`}` : 'Download speed: —'
		if ( !cancelling ) { status.textContent = progress.label ?? 'Working…' }
		progressState = { completed : Math.max(0, progress.completed ?? 0), total : Math.max(0, progress.total ?? 0) }
		updateProgress()
	})
	modhub_downloader_IPC.receive('modhub-downloader:closeBlocked', (payload = {}) => {
		status.className = 'alert alert-warning mb-0'
		status.textContent = `Please wait for the current Vault task to finish before closing this screen. ${Array.isArray(payload.blockers) ? payload.blockers.join(', ') : ''}`
	})
	render()
})
