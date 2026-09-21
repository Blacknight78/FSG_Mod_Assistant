// Isolated regression tests: never open the user's Vault or Electron application.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { AsyncLocalStorage } = require('node:async_hooks')
const source = fs.readFileSync(path.join(__dirname, '../modAssist_main.js'), 'utf8').replace(/\r/g, '')
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
let writes = 0
let reads = 0
let failWrite = false
const disk = { modHub: {}, unrelated: 'keep' }
const context = {
  performance, AbortController, Date, URL,
  setTimeout, clearTimeout,
  remoteCheckDiagnostics: new AsyncLocalStorage(),
  serveIPC: {
    storeLibrary: {
      get(key, fallback) { reads++; return structuredClone(disk[key] ?? fallback) },
      set(updates) {
        if (failWrite) throw new Error('simulated disk failure')
        writes++
        for (const [key, value] of Object.entries(updates)) {
          if (key.startsWith('modHub.')) disk.modHub[key.slice(7)] = structuredClone(value)
          else disk[key] = structuredClone(value)
        }
      },
    },
    log: { info() {}, warning() {} },
  },
  funcLib: { general: { doModHub: id => `https://example.invalid/${id}` } },
  invalidateModLibrarySummary() {},
}
vm.createContext(context)
vm.runInContext(slice('const UPDATE_REMOTE_CACHE_MS', "ipcMain.handle('settings:site:githubLatest'")
  .replace('1000 * 12', '30'), context)
vm.runInContext(slice('function getCachedModHubMetadata(', 'function modHubTextLines('), context)
vm.runInContext(slice('async function fetchModHubMetadata(', '// eslint-disable-next-line complexity\nasync function getModHubLatestUpdate(').replace(/\r/g, ''), context)

async function run() {
  // Simulate hundreds of completed checks, without serializing the Vault per item.
  vm.runInContext(`for (let i = 0; i < 592; i++) {
    getModHubMetadataSnapshot()[i] = { ok: true, version: '1' };
    pendingModHubMetadata.set(String(i), getModHubMetadataSnapshot()[i]);
    setUpdateRemoteCacheRecord('modhub:' + i, { ok: true });
  }`, context)
  assert.equal(writes, 0)
  assert.equal(reads, 2)
  context.flushUpdateMetadataCache()
  assert.equal(writes, 1)
  assert.equal(Object.keys(disk.modHub).length, 592)
  assert.equal(disk.unrelated, 'keep')
  context.flushUpdateMetadataCache()
  assert.equal(writes, 1)

  context.setUpdateRemoteCacheRecord('failure', { ok: false })
  let calls = 0
  const lookup = async () => { calls++; return { ok: true } }
  await context.cachedRemoteUpdate('failure', false, lookup)
  assert.equal(calls, 0)
  vm.runInContext("updateRemoteCache.get('failure').checkedAt -= UPDATE_REMOTE_FAILURE_CACHE_MS + 1", context)
  await context.cachedRemoteUpdate('failure', false, lookup)
  assert.equal(calls, 1)
  vm.runInContext("updateRemoteCache.set('legacy', { expiresAt: Date.now() + UPDATE_REMOTE_CACHE_MS, result: { ok: false } })", context)
  await context.cachedRemoteUpdate('legacy', false, lookup)
  assert.equal(calls, 2)

  // Headers arrive, but the body stalls: the deadline must still abort it.
  context.fetch = async (_, { signal }) => ({ ok: true, text: () => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }) })
  const keepAlive = setTimeout(() => {}, 500)
  await assert.rejects(context.fetchWithTimeout('test', {}, response => response.text()), /timed out/)
  clearTimeout(keepAlive)

  context.fetch = async () => { throw new Error('offline') }
  const result = await context.fetchModHubMetadata('0', { force: true })
  assert.equal(result.ok, false)
  assert.equal(context.getCachedModHubMetadata('0').version, '1')
  failWrite = true
  context.flushUpdateMetadataCache()
  failWrite = false
  context.flushUpdateMetadataCache()
  assert.equal(writes, 2)
  console.log('PASS: batched persistence, unrelated data preservation, failure expiry, legacy failures, body timeout, last-good metadata and disk-write retry')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
