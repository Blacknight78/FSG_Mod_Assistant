// Exercise cache lookup and timing without accessing real ZIPs or the Vault.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { AsyncLocalStorage } = require('node:async_hooks')
const source = fs.readFileSync(path.join(__dirname, '../modAssist_main.js'), 'utf8')
const code = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
let checks = 0
const records = Object.fromEntries(Array.from({length: 4000}, (_, i) => [i, {
  filePath: 'fake-' + i, modNames: ['mod' + i], versions: ['1'], sourceURL: 'https://example.invalid/a',
}]))
const diagnostics = new AsyncLocalStorage()
const logs = []
const context = {
  performance,
  modUpdateDiagnostics: diagnostics,
  serveIPC: {log: {info: (_level, text) => logs.push(text)}},
  fs: {existsSync(file) { checks++; return file !== 'fake-3998' }},
  getStoredModLibraryRecords: () => records,
  normalizeVaultModName: name => name,
  normalizedVaultModNames: names => names,
}
vm.createContext(context)
vm.runInContext(code('function addPerformanceStat(', 'function escapeBasicHTML('), context)
vm.runInContext(code('async function measureModUpdate(', 'const crypto'), context)
vm.runInContext(code('function findCachedModLibraryFile(', 'function vaultNoteKey('), context)
async function run() {
  assert.equal(context.findCachedModLibraryFile({modName: 'absent', version: '1'}), null)
  assert.equal(checks, 0)
  assert.equal(context.findCachedModLibraryFile({modName: 'mod3999', version: '1'}), records[3999])
  assert.equal(checks, 1)
  assert.equal(context.findCachedModLibraryFile({modName: 'mod3998', version: '1'}), null)
  assert.equal(checks, 2)
  assert.equal(context.findCachedModLibraryFile({modName: 'mod3999', version: '2'}), null)
  assert.equal(context.findCachedModLibraryFile({modName: 'mod3999', version: '1', sourceURL: 'different'}), null)
  assert.equal(checks, 2)
  const result = await context.measureModUpdate('vault', {modName: 'test'}, () => context.measureModUpdatePhase('downloadMS', async () => 42))
  assert.equal(result, 42)
  assert.match(logs[0], /ok=true.*downloadMS=/)
  await assert.rejects(context.measureModUpdate('collection', {}, async () => { throw Error('test failure') }), /test failure/)
  assert.match(logs[1], /ok=false/)
  assert.equal(diagnostics.getStore(), undefined)
  console.log('PASS: 4,000-record misses perform no file checks; matches, missing files, version/source rejection and success/failure timing')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
