const assert = require('node:assert/strict')
const {LiveDownloadPool} = require('../lib/liveDownloadPool')
const tick = () => new Promise(resolve => setImmediate(resolve))
async function main() {
 const pool = new LiveDownloadPool(1)
 const started = []
 const release = new Map()
 const done = pool.run([0,1,2,3,4], item => { started.push(item); return new Promise(resolve => release.set(item, resolve)) })
 await tick(); assert.equal(started.length,1)
 pool.setLimit(3); await tick(); assert.equal(started.length,3)
 pool.setLimit(1)
 release.get(0)(); await tick(); assert.equal(started.length,3)
 release.get(1)(); await tick(); assert.equal(started.length,3)
 release.get(2)(); await tick(); assert.equal(started.length,4)
 release.get(3)(); await tick(); release.get(4)(); await done
 assert.throws(()=>pool.setLimit(9))
 assert.throws(()=>pool.setLimit(0))
 console.log('PASS: live increase starts work immediately; decrease drains safely; limits validated')
}
main().catch(err=>{console.error(err);process.exitCode=1})
