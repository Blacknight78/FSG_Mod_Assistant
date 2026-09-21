const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { VaultImportService, parseImportURL } = require('../lib/vaultImportService')

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fsg-import-tests-'))
  try {
    const input = path.join(temp, 'input'); await fs.mkdir(input)
    const nested = path.join(input, 'nested'); await fs.mkdir(nested)
    const hash = async file => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')
    const records = new Map()
    let concurrent = 0, maximum = 0, registrations = 0
    const deps = {
      root: () => temp, temp: () => temp, hash,
      exists: async key => records.has(key),
      inspect: file => {
        const data = require('node:fs').readFileSync(file, 'utf8')
        if (!data.startsWith('valid')) throw Error('Invalid mod')
        return {fileName: path.basename(file), version: '1.0', gameVersion: 25}
      },
      resolve: async source => ({
        name: source.repo || source.id,
        modHubID: source.type === 'modhub' ? source.id : null,
        modHubReleased: source.type === 'modhub' ? '01/01/2026' : null,
        modHubScreenshots: source.type === 'modhub' ? [{name:'Screen 1', url:'https://www.farming-simulator.com/foo/screenshot.jpg'}] : [],
        version: source.type === 'modhub' ? '1.2.3' : '',
        assets: source.repo === 'multi' ? [{name:'a.zip', url:'one'}, {name:'b.zip', url:'two'}] : [{name: `${source.repo || source.id}.zip`, url:source.url}],
      }),
      download: async (asset, target) => {
        concurrent++; maximum = Math.max(maximum, concurrent)
        try {
          await new Promise(resolve => setTimeout(resolve, 10))
          if (asset.name === 'fail.zip') throw Error('Network failure')
          await fs.writeFile(target, 'valid ' + asset.url)
        } finally { concurrent-- }
      },
      register: async (file, meta) => { registrations++; records.set(await hash(file), meta) },
    }
    const service = new VaultImportService(deps)
    const progress = () => {}
    await fs.writeFile(path.join(input, 'a.zip'), 'valid first')
    await fs.writeFile(path.join(input, 'duplicate.zip'), 'valid first')
    await fs.writeFile(path.join(input, 'bad.zip'), 'invalid')
    await fs.writeFile(path.join(nested, 'b.zip'), 'valid second')
    await fs.writeFile(path.join(input, 'unfinished.zip.part'), 'partial')
    let result = await service.scan(1, input, false, progress)
    assert.equal(result.rows.length, 3)
    assert.equal(result.rows.filter(r=>r.status==='Duplicate in batch').length, 1)
    assert.equal(result.rows.filter(r=>r.status==='Error').length, 1)
    const ready = result.rows.find(r=>r.status==='Ready')
    await assert.rejects(service.run(2, [{id:ready.id}], progress), /Review/)
    await fs.writeFile(path.join(input, ready.name), 'valid changed')
    result = await service.run(1, [{id:ready.id}], progress)
    assert.match(result.rows.find(r=>r.id===ready.id).detail, /changed/)
    assert.equal(registrations, 0)
    result = await service.scan(1, input, true, progress)
    const selected = result.rows.filter(r=>r.status==='Ready').map(r=>({id:r.id}))
    result = await service.run(1, selected, progress)
    assert.equal(result.rows.filter(r=>r.status==='Imported').length, 3)
    assert.equal(await fs.readFile(path.join(input, ready.name), 'utf8'), 'valid changed')
    result = await service.scan(1, input, true, progress)
    assert.equal(result.rows.filter(r=>r.status==='Already in Vault').length, 3)

    assert.equal(parseImportURL('https://www.farming-simulator.com/mod.php?mod_id=123&lang=en').id, '123')
    assert.equal(parseImportURL('https://github.com/a/b/releases/tag/v1.2').tag, 'v1.2')
    for (const url of ['http://github.com/a/b', 'https://evil.test/a', 'https://github.com/a/b/archive/main.zip', 'https://user:pass@github.com/a/b']) assert.throws(()=>parseImportURL(url))
    result = await service.resolve(1, 'https://github.com/a/one\nhttps://github.com/a/one\nhttps://github.com/a/multi\nhttps://github.com/a/fail\nhttps://www.farming-simulator.com/mod.php?mod_id=123\ninvalid', progress)
    assert.equal(result.rows[1].status, 'Duplicate link')
    assert.equal(result.rows[2].status, 'Choose ZIP')
    assert.equal(result.rows[5].status, 'Error')
    await assert.rejects(service.run(1, [{id:result.rows[2].id, asset:-1}], progress), /Choose/)
    result = await service.run(1, result.rows.filter(r=>['Ready','Choose ZIP'].includes(r.status)).map(r=>({id:r.id, asset:0})), progress)
    assert.equal(result.rows.filter(r=>r.status==='Imported').length, 3)
    assert.match(result.rows.find(r=>r.name==='fail').detail, /Network failure/)
    assert.ok([...records.values()].some(meta => meta.modHubID === '123' && meta.modHubScreenshots?.length === 1 && meta.modHubVersion === '1.2.3' && meta.modHubReleased === '01/01/2026'))
    assert.equal(maximum, 2)
    assert.equal((await fs.readdir(temp)).filter(n=>n.startsWith('fsg-vault-import-')).length, 0)

    result = await service.resolve(1, 'https://github.com/a/cancel1\nhttps://github.com/a/cancel2\nhttps://github.com/a/cancel3', progress)
    const before = registrations
    const active = service.run(1, result.rows.map(r=>({id:r.id, asset:0})), progress)
    service.cancel(1)
    result = await active
    assert.equal(result.cancelled, true)
    assert.equal(registrations, before)
    assert.equal(result.rows.filter(r=>r.status==='Cancelled').length, 3)
    assert.equal(service.busy, false)
    console.log('PASS: folder recursion, duplicates, invalid ZIPs, changed sources, URL validation, ownership, release choices, bounded downloads, partial failure, cancellation, staging cleanup')
  } finally { await fs.rm(temp, {recursive:true, force:true}) }
}
main().catch(error=>{ console.error(error); process.exitCode=1 })
