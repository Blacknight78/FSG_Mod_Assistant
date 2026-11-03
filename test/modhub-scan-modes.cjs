const assert = require('node:assert/strict')
const { VaultImportService } = require('../lib/vaultImportService')
async function main() {
 let requests = 0
 const service = new VaultImportService({ category: async () => { requests++; return ['Vehicles', 'Tractors'] } })
 const entries = [{id:1, name:'Missing'}, {id:2, name:'Cached', categoryPath:['Tools']}]
 let result = await service.scanModHubCatalogue(1, entries, () => {})
 assert.equal(requests, 0, 'Normal scanning must never fetch categories')
 assert.equal(result.rows.length, 2)
 result = await service.scanModHubCatalogue(1, entries, () => {}, {loadMissingTags:true})
 assert.equal(requests, 1, 'Only missing categories should be fetched')
 assert.deepEqual(result.rows[0].categoryPath, ['Vehicles', 'Tractors'])
 assert.deepEqual(result.rows[1].categoryPath, ['Tools'])
 service.deps.category = async () => { service.cancel(1); return [] }
 result = await service.scanModHubCatalogue(1, entries, () => {}, {loadMissingTags:true})
 assert.equal(result.cancelled, true)
 assert.equal(service.busy, false)
 console.log('PASS: fast scan makes no requests; optional loading fetches only missing tags and supports cancellation')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
