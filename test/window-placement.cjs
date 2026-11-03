const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../lib/modAssist_window_lib.js'), 'utf8')
const context = {
 module: { exports: {} },
 require: (name) => name === 'electron' ? { screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] } } : name === 'node:path' ? path : {},
}
vm.runInNewContext(source, context)
const check = context.module.exports.windowLib.prototype.checkValidPlacement
for (const missing of [undefined, null]) {
 const result = check(missing)
 assert.equal(result.x, -1)
 assert.equal(result.y, -1)
 assert.equal(result.w, 900)
 assert.equal(result.h, 600)
}
const saved = { x: 100, y: 150, w: 1100, h: 750, m: false }
assert.deepEqual(check({ ...saved }), saved)
const offscreen = check({ ...saved, x: 5000, y: 3000 })
assert.equal(offscreen.x, -1)
assert.equal(offscreen.y, -1)
console.log('Window placement regression checks passed')
