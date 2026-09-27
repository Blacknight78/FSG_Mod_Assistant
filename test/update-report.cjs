/* global __dirname, console, process */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../modAssist_main.js'), 'utf8')
const start = source.indexOf("ipcMain.handle('update:downloadApplySelected'")
const end = source.indexOf("ipcMain.on('dispatch:resolve'", start)
let handler
let calls = 0
vm.runInNewContext(source.slice(start, end), {
  ipcMain: { handle(_name, fn) { handler = fn } },
  app: { getPath: () => 'test-only' }, path,
  fsPromise: { mkdir: async () => {} },
  downloadToVaultAndApplyUpdate: async () => { if (++calls === 2) throw new Error('Download rejected'); return {} },
  addCollectionHistoryEntry() {}, updateSourceTypeLabel: value => value,
  funcLib: { general: { toggleFolderDirty() {} } },
  processModFoldersAndWait: async () => {},
})
handler(null, ['First', 'Second', 'Third'].map(modName => ({modName}))).then(result => {
  assert.equal(result.count, 1)
  assert.equal(result.results[0].ok, true)
  assert.equal(result.results[1].error, 'Download rejected')
  assert.equal(result.results[2].skipped, true)
  assert.equal(calls, 2)
  console.log('PASS: collection partial success, failure and unattempted results')
}).catch(error => { console.error(error); process.exitCode = 1 })
