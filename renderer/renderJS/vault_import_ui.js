/* global DATA */
const escapeImportValue = (value) => DATA.escapeSpecial(String(value ?? ''))
const importRowSelectable = (row) => ['Ready', 'Choose ZIP'].includes(row.status)
window.addEventListener('DOMContentLoaded', () => {
	const dialog = document.getElementById('vaultImportDialog')
	const byId = (id) => document.getElementById(id)
	let rows = []
	let page = 0
	let busy = false
	let mode = 'links'
	const selected = new Map()
	const escape = escapeImportValue
	const selectable = importRowSelectable
	const render = () => {
		const body = byId('vaultImportRows')
		body.innerHTML = ''
		for ( const row of rows.slice(page * 100, (page + 1) * 100) ) {
			const tr = document.createElement('tr')
			tr.innerHTML = `<td><input type="checkbox" aria-label="Select ${escape(row.name)}"></td><td class="vault-import-name">${escape(row.name)}<div class="small text-secondary">${escape(row.source)}</div></td><td>${escape(row.version || '--')}<div>${escape(row.game ? `FS${row.game}` : '')}</div></td><td class="vault-import-result">${escape(row.status)}<div class="small">${escape(row.detail)}</div></td>`
			const checkbox = tr.querySelector('input')
			checkbox.disabled = busy || !selectable(row)
			checkbox.checked = selected.has(row.id)
			checkbox.addEventListener('change', () => {
				if ( checkbox.checked ) { selected.set(row.id, row.assetChoice ?? (row.assets.length === 1 ? 0 : -1)) } else { selected.delete(row.id) }
				updateCount()
			})
			if ( row.assets.length !== 0 ) {
				const select = document.createElement('select')
				select.className = 'form-select form-select-sm mt-1'
				select.setAttribute('aria-label', 'Release ZIP')
				select.innerHTML = '<option value="-1">Choose release ZIP...</option>'
				for (const [index, asset] of row.assets.entries()) {
					const option = document.createElement('option')
					option.value = index
					option.textContent = asset.name
					select.appendChild(option)
				}
				select.value = row.assetChoice ?? (row.assets.length === 1 ? 0 : -1)
				select.disabled = busy || !selectable(row)
				select.addEventListener('change', () => {
					row.assetChoice = Number(select.value)
					if ( row.assetChoice >= 0 ) { selected.set(row.id, row.assetChoice); checkbox.checked = true } else { selected.delete(row.id); checkbox.checked = false }
					updateCount()
				})
				tr.children[1].appendChild(select)
			}
			body.appendChild(tr)
		}
		byId('vaultImportPage').textContent = `${rows.length === 0 ? 0 : page * 100 + 1}-${Math.min((page + 1) * 100, rows.length)} of ${rows.length}`
		byId('vaultImportPrevious').disabled = busy || page === 0
		byId('vaultImportNext').disabled = busy || (page + 1) * 100 >= rows.length
		updateCount()
	}
	const updateCount = () => {
		byId('vaultImportRun').textContent = `Import selected (${selected.size})`
		byId('vaultImportRun').disabled = busy || selected.size === 0 || [...selected.values()].some((value) => value < 0)
	}
	const setBusy = (value) => {
		busy = value
		for ( const control of dialog.querySelectorAll('[data-import-control]') ) { control.disabled = value }
		byId('vaultImportCancel').disabled = !value
		byId('vaultImportProgress').hidden = !value
		render()
	}
	const run = async (operation, importing = false) => {
		setBusy(true)
		byId('vaultImportStatus').textContent = importing ? 'Importing selected mods...' : 'Preparing import review...'
		byId('vaultImportProgress').removeAttribute('value')
		try {
			const result = await operation()
			if ( result !== null ) {
				if ( result.ok === false ) { throw new Error(result.error ?? 'Vault import failed.') }
				rows = result.rows
				page = 0
				selected.clear()
				if ( !importing ) {
					for ( const row of rows.filter((entry) => entry.status === 'Ready') ) { selected.set(row.id, 0) }
				}
				const counts = new Map()
				for ( const row of rows ) { counts.set(row.status, (counts.get(row.status) ?? 0) + 1) }
				const sourceText = Number.isFinite(result.sourceCount) ?
					`Loaded ${result.sourceCount} supported source URL${result.sourceCount === 1 ? '' : 's'} from manifest. ${result.skipped} manifest entr${result.skipped === 1 ? 'y was' : 'ies were'} skipped. ` :
					''
				byId('vaultImportStatus').textContent = `${result.cancelled ? 'Cancelled. ' : ''}${sourceText}${[...counts].map(([label, count]) => `${label}: ${count}`).join(' | ') || 'No mod ZIPs found.'}`
			} else { byId('vaultImportStatus').textContent = 'Folder selection cancelled.' }
		} catch (err) { byId('vaultImportStatus').textContent = err.message }
		finally { setBusy(false) }
	}
	const switchMode = (nextMode) => {
		if ( mode !== nextMode ) {
			rows = []
			page = 0
			selected.clear()
			byId('vaultImportStatus').textContent = ''
		}
		mode = nextMode
		byId('vaultImportLinksPane').hidden = mode !== 'links'
		byId('vaultImportFolderPane').hidden = mode !== 'folder'
		byId('vaultImportManifestPane').hidden = mode !== 'manifest'
		for ( const button of dialog.querySelectorAll('[data-import-mode]') ) {
			button.classList.toggle('active', button.dataset.importMode === mode)
			button.setAttribute('aria-selected', button.dataset.importMode === mode ? 'true' : 'false')
		}
		render()
	}
	byId('vaultImportOpen').addEventListener('click', () => { dialog.showModal(); render() })
	byId('vaultImportClose').addEventListener('click', () => dialog.close())
	dialog.addEventListener('cancel', (event) => { if ( busy ) { event.preventDefault() } })
	for ( const button of dialog.querySelectorAll('[data-import-mode]') ) { button.addEventListener('click', () => switchMode(button.dataset.importMode)) }
	byId('vaultImportResolve').addEventListener('click', () => run(() => window.vault_IPC.importLinks(byId('vaultImportURLs').value)))
	byId('vaultImportBrowse').addEventListener('click', () => run(() => window.vault_IPC.importFolder({ recursive : byId('vaultImportRecursive').checked })))
	byId('vaultManifestImport').addEventListener('click', () => run(() => window.vault_IPC.importRecoveryManifest()))
	byId('vaultImportRun').addEventListener('click', () => run(() => window.vault_IPC.importRun([...selected].map(([id, asset]) => ({ id, asset }))), true))
	byId('vaultImportCancel').addEventListener('click', async () => {
		await window.vault_IPC.importCancel()
		byId('vaultImportStatus').textContent = 'Cancelling after active file operations finish...'
	})
	byId('vaultImportAll').addEventListener('click', () => {
		for ( const row of rows.filter((entry) => selectable(entry)) ) {
			const asset = row.assetChoice ?? (row.assets.length <= 1 ? 0 : -1)
			if ( asset >= 0 ) { selected.set(row.id, asset) }
		}
		render()
	})
	byId('vaultImportNone').addEventListener('click', () => { selected.clear(); render() })
	byId('vaultImportPrevious').addEventListener('click', () => { page--; render() })
	byId('vaultImportNext').addEventListener('click', () => { page++; render() })
	window.vault_IPC.receive('vault:importProgress', (progress) => {
		byId('vaultImportStatus').textContent = progress.label
		if ( progress.total > 0 ) { byId('vaultImportProgress').value = progress.completed / progress.total }
	})
	switchMode('links')
})
