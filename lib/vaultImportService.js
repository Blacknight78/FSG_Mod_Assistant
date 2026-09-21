/* eslint-disable no-await-in-loop */
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

function parseImportURL(value) {
	const url = new URL(value.trim())
	if ( url.protocol !== 'https:' || url.username || url.password || url.port ) { throw new Error('Use a public HTTPS ModHub or GitHub link.') }
	const host = url.hostname.toLowerCase().replace(/^www\./u, '')
	if ( host === 'farming-simulator.com' && /^\d+$/u.test(url.searchParams.get('mod_id') ?? '') ) {
		const id = url.searchParams.get('mod_id')
		return { type : 'modhub', id, url : `https://www.farming-simulator.com/mod.php?mod_id=${id}` }
	}
	const parts = url.pathname.split('/').filter(Boolean)
	if ( host === 'github.com' && parts.length >= 2 && parts.slice(0, 2).every((part) => /^[\w.-]+$/u.test(part)) ) {
		const base = `https://github.com/${parts[0]}/${parts[1]}`
		if ( parts.length > 2 && !(parts[2] === 'releases' && (parts.length === 3 || (parts[3] === 'latest' && parts.length === 4) || (parts[3] === 'tag' && parts.length >= 5))) ) {
			throw new Error('Use a GitHub repository or release page, not a source archive or file link.')
		}
		const tag = parts[3] === 'tag' ? decodeURIComponent(parts.slice(4).join('/')) : null
		return { owner : parts[0], repo : parts[1], tag, type : 'github', url : tag ? `${base}/releases/tag/${encodeURIComponent(tag)}` : base }
	}
	throw new Error('Only ModHub mod pages and GitHub repositories/releases are supported.')
}

async function pool(values, limit, operation) {
	let next = 0
	await Promise.all(Array.from({ length : Math.min(limit, values.length) }, async () => {
		while ( next < values.length ) {
			const index = next++
			await operation(values[index], index)
		}
	}))
}

function fingerprint(stat) { return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}` }

class VaultImportService {
	constructor(deps) {
		this.deps = deps
		this.rows = new Map()
		this.busy = false
		this.cancelled = false
		this.owner = null
		this.registration = Promise.resolve()
	}
	cancel(owner) { if ( owner === this.owner ) { this.cancelled = true } }
	async job(owner, operation) {
		if ( this.busy ) { throw new Error('Another import operation is running.') }
		this.busy = true
		this.owner = owner
		this.cancelled = false
		try {
			this.deps.begin?.()
			return await operation()
		} finally {
			this.deps.end?.()
			this.busy = false
		}
	}
	view() {
		return [...this.rows.values()].map(({ filePath : _filePath, stamp : _stamp, hash : _hash, ...row }) => row)
	}
	add(row) {
		const entry = { assets : [], id : crypto.randomUUID(), status : 'Ready', ...row }
		this.rows.set(entry.id, entry)
		return entry
	}
	async scan(owner, folder, recursive, progress) {
		return this.job(owner, async () => {
			this.rows.clear()
			const pending = [folder]
			const seen = new Set()
			while ( pending.length !== 0 && !this.cancelled ) {
				const current = pending.pop()
				let entries
				try { entries = await fs.readdir(current, { withFileTypes : true }) } catch (err) {
					this.add({ name : current, status : 'Error', detail : err.message }); continue
				}
				for ( const entry of entries ) {
					if ( this.cancelled ) { break }
					if ( this.rows.size >= 10000 ) { throw new Error('Scan limited to 10,000 files. Choose a smaller folder.') }
					const filePath = path.join(current, entry.name)
					if ( this.deps.insideVault?.(filePath) ) { continue }
					if ( entry.isDirectory() && recursive ) { pending.push(filePath); continue }
					if ( !entry.isFile() ) { continue }
					if ( !entry.name.toLowerCase().endsWith('.zip') ) { continue }
					const row = this.add({ filePath, kind : 'folder', name : entry.name, source : filePath })
					try {
						const before = await fs.stat(filePath)
						const meta = this.deps.inspect(filePath)
						row.hash = await this.deps.hash(filePath)
						row.stamp = fingerprint(before)
						if ( row.stamp !== fingerprint(await fs.stat(filePath)) ) { throw new Error('File changed during scan. Retry when its download is complete.') }
						row.version = meta.version
						row.game = meta.gameVersion
						row.status = seen.has(row.hash) ? 'Duplicate in batch' : await this.deps.exists(row.hash) ? 'Already in Vault' : 'Ready'
						seen.add(row.hash)
					} catch (err) { row.status = 'Error'; row.detail = err.message }
					progress({ label : `Scanned ${this.rows.size} ZIP files`, completed : this.rows.size })
				}
			}
			return { rows : this.view(), cancelled : this.cancelled }
		})
	}
	async resolve(owner, text, progress) {
		return this.job(owner, async () => {
			this.rows.clear()
			const links = String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
			if ( links.length > 200 ) { throw new Error('Import up to 200 links per batch.') }
			const seen = new Set()
			const rows = links.map((link) => this.add({ name : link, source : link, kind : 'url' }))
			let completed = 0
			await pool(rows, 3, async (row) => {
				try {
					if ( this.cancelled ) { row.status = 'Cancelled'; return }
					const source = parseImportURL(row.source)
					const key = source.type === 'github' ? `${source.owner.toLowerCase()}/${source.repo.toLowerCase()}/${source.tag ?? ''}` : source.url
					if ( seen.has(key) ) { row.status = 'Duplicate link'; return }
					seen.add(key)
					row.source = source.url
					row.sourceType = source.type
					const result = await this.deps.resolve(source)
					Object.assign(row, result)
					row.status = row.assets.length > 1 ? 'Choose ZIP' : row.assets.length === 1 ? 'Ready' : 'No published mod ZIP'
				} catch (err) { row.status = 'Error'; row.detail = err.message }
				finally { progress({ label : `Resolved ${++completed} of ${rows.length} links`, completed, total : rows.length }) }
			})
			return { rows : this.view(), cancelled : this.cancelled }
		})
	}
	async run(owner, selections, progress) {
		if ( owner !== this.owner ) { throw new Error('Review the files or links before importing.') }
		return this.job(owner, async () => {
			if ( !Array.isArray(selections) || selections.length === 0 || selections.length > 10000 ) { throw new Error('Select mods to import.') }
			const root = this.deps.root()
			const seen = new Set()
			const selected = selections.map((selection) => {
				const row = this.rows.get(selection.id)
				if ( !row || seen.has(row.id) || !['Ready', 'Choose ZIP'].includes(row.status) ) { throw new Error('Selection is stale. Review the import again.') }
				seen.add(row.id)
				const asset = row.kind === 'url' ? row.assets[selection.asset] : null
				if ( row.kind === 'url' && !asset ) { throw new Error('Choose a release ZIP for every selected link.') }
				return { row, asset }
			})
			let completed = 0
			await pool(selected, 2, async ({ row, asset }) => {
				if ( this.cancelled ) { row.status = 'Cancelled'; return }
				let temp = null
				try {
					temp = await fs.mkdtemp(path.join(this.deps.temp(), 'fsg-vault-import-'))
					const name = asset?.name ?? row.name
					if ( path.basename(name) !== name || /[\\/:]/u.test(name) || !name.toLowerCase().endsWith('.zip') ) { throw new Error('Invalid mod ZIP filename.') }
					const stage = path.join(temp, name)
					progress({ label : `Preparing ${name}`, completed, total : selected.length })
					if ( asset ) {
						await this.deps.download(asset, stage)
					} else {
						if ( fingerprint(await fs.stat(row.filePath)) !== row.stamp ) { throw new Error('File changed since review. Scan again.') }
						await fs.copyFile(row.filePath, stage)
						if ( fingerprint(await fs.stat(row.filePath)) !== row.stamp || await this.deps.hash(stage) !== row.hash ) { throw new Error('File changed while copying. Scan again.') }
					}
					if ( this.cancelled ) { Object.assign(row, { status : 'Cancelled' }); return }
					const meta = this.deps.inspect(stage)
					const hash = await this.deps.hash(stage)
					// Serialize metadata commits while allowing two downloads/copies in flight.
					const commit = this.registration.then(async () => {
						if ( this.deps.root() !== root ) { throw new Error('Vault location changed. Review and retry.') }
						if ( this.cancelled ) { row.status = 'Cancelled'; return }
						const exists = await this.deps.exists(hash)
						await this.deps.register(stage, {
							...meta,
							modHubID : row.modHubID ?? null,
							modHubReleased : row.modHubReleased ?? null,
							modHubScreenshots : row.modHubScreenshots ?? [],
							modHubVersion : row.sourceType === 'modhub' ? row.version : null,
							source : row.sourceType ?? 'Folder import',
							sourceURL : asset ? row.source : null,
						})
						Object.assign(row, { game : meta.gameVersion, status : exists ? 'Already in Vault' : 'Imported', version : meta.version })
					})
					this.registration = commit.catch(() => {})
					await commit
				} catch (err) { Object.assign(row, { detail : err.message, status : 'Error' }) }
				finally {
					if ( temp ) { await fs.rm(temp, { recursive : true, force : true }).catch(() => {}) }
					progress({ label : `Processed ${++completed} of ${selected.length}`, completed, total : selected.length })
				}
			})
			return { rows : this.view(), cancelled : this.cancelled }
		})
	}
}

module.exports = { VaultImportService, parseImportURL, fingerprint }
