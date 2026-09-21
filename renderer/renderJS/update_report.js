/* Shared end-of-run reports for Vault and collection updates. */
window.UpdateRunReport = {
	error(error) {
		const messages = {
			invalid_github_url : 'GitHub repository URL required; an author profile cannot be checked.',
			modhub_listing_not_found : 'ModHub listing not found. It may have been removed.',
			modhub_metadata_unavailable : 'Could not read the ModHub version information.',
			no_release_or_tag : 'No usable GitHub release was found.',
		}
		return messages[error] ?? error ?? 'Unknown error'
	},
	show(anchorID, title, rows, note = '') {
		let report = document.getElementById('updateRunReport')
		if ( report === null ) {
			report = document.createElement('details')
			report.id = 'updateRunReport'
			report.className = 'border rounded p-3 my-3'
			report.style.minWidth = '0'
			report.style.overflowWrap = 'anywhere'
			document.getElementById(anchorID).after(report)
		}
		report.replaceChildren()
		report.open = true
		const add = (tag, text, parent = report) => {
			const node = document.createElement(tag)
			node.textContent = text
			parent.append(node)
			return node
		}
		add('summary', `${title} - ${new Date().toLocaleString()}`).className = 'fw-bold'
		const counts = new Map()
		for ( const row of rows ) { counts.set(row.status, (counts.get(row.status) ?? 0) + 1) }
		add('p', [...counts].map(([status, count]) => `${status}: ${count}`).join(' | ') || 'No items in this run.').className = 'my-2'
		if ( note ) { add('p', note).className = 'small text-body-secondary' }
		const search = add('input', '')
		search.type = 'search'
		search.placeholder = 'Search report'
		search.setAttribute('aria-label', 'Search update report')
		search.className = 'form-control my-2'
		const wrapper = add('div', '')
		wrapper.className = 'table-responsive'
		wrapper.style.maxWidth = '100%'
		const table = add('table', '', wrapper)
		table.className = 'table table-sm'
		const header = add('tr', '', add('thead', '', table))
		for ( const label of ['Mod', 'Source / collection', 'Outcome', 'Details'] ) { add('th', label, header).scope = 'col' }
		const body = add('tbody', '', table)
		const controls = add('div', '')
		controls.className = 'd-flex align-items-center gap-3'
		const previous = add('button', 'Previous', controls)
		const position = add('span', '', controls)
		const next = add('button', 'Next', controls)
		for ( const button of [previous, next] ) { button.type = 'button'; button.className = 'btn btn-outline-secondary btn-sm' }
		let page = 0
		const render = () => {
			const query = search.value.toLocaleLowerCase()
			const filtered = rows.filter((row) => Object.values(row).join(' ').toLocaleLowerCase().includes(query))
			body.replaceChildren()
			for ( const row of filtered.slice(page * 100, (page + 1) * 100) ) {
				const line = add('tr', '', body)
				for ( const value of [row.name, row.source, row.status, row.detail] ) { add('td', value ?? '', line).style.overflowWrap = 'anywhere' }
			}
			position.textContent = `${filtered.length === 0 ? 0 : page * 100 + 1}-${Math.min((page + 1) * 100, filtered.length)} of ${filtered.length}`
			previous.disabled = page === 0
			next.disabled = (page + 1) * 100 >= filtered.length
		}
		search.addEventListener('input', () => { page = 0; render() })
		previous.addEventListener('click', () => { page--; render() })
		next.addEventListener('click', () => { page++; render() })
		render()
	},
}
