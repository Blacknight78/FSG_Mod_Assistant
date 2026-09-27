/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Test Program - Collection Manifest Share Links

const assert      = require('node:assert/strict')
const fs          = require('node:fs')
const path        = require('node:path')
const vm          = require('node:vm')
const zlib        = require('node:zlib')
const { testLib } = require('../test.js')

module.exports.test = async () => {
	const test = new testLib('Collection Manifest Share Link Test')
	await tester(test)
	test.end(false, true)
}

function loadManifestHelpers() {
	const source = fs.readFileSync(path.join(__dirname, '..', '..', 'modAssist_main.js'), 'utf8')
	const start = source.indexOf('const COLLECTION_MANIFEST_SCHEMA')
	const end = source.indexOf('function manifestLocalRecords', start)
	const context = {
		Buffer,
		funcLib : {
			general : {
				doModHub : (id) => `https://www.farming-simulator.com/mod.php?mod_id=${id}`,
			},
		},
		safeDownloadFileName : (value) => String(value).replace(/[<>:"/\\|?*]/gu, '_'),
		zlib,
	}
	vm.createContext(context)
	vm.runInContext(`${source.slice(start, end)}
		globalThis.__manifestTest = {
			collectionManifestShareCode,
			parseCollectionManifestText,
		}`, context)
	return context.__manifestTest
}

function testManifest(modCount = 80) {
	return {
		collection : { name : 'Gameplay DB' },
		exportedAt : '2026-09-27T20:00:00.000Z',
		gameVersion : 25,
		mods : Array.from({ length : modCount }, (_, index) => {
			const suffix = String(index + 1).padStart(3, '0')
			const name = `FS25_Test_Mod_${suffix}`
			return {
				fileName : `${name}.zip`,
				name,
				sources : [
					{ id : 100000 + index, type : 'modhub', url : `https://www.farming-simulator.com/mod.php?mod_id=${100000 + index}` },
					{ type : 'github', url : `https://github.com/tester/${name.toLowerCase()}` },
				],
				version : `1.${index % 10}.${index % 3}`,
			}
		}),
		schema : 'fsg-mod-assistant.collection',
		version : 1,
	}
}

async function tester(test) {
	const helpers = loadManifestHelpers()
	const manifest = testManifest()
	const v1Link = `fsgma://collection/v1/${zlib.gzipSync(Buffer.from(JSON.stringify(manifest)), { level : 9 }).toString('base64url')}`
	const v2Link = helpers.collectionManifestShareCode(manifest)
	const parsedV2 = helpers.parseCollectionManifestText(v2Link)
	const parsedV1 = helpers.parseCollectionManifestText(v1Link)

	assert.ok(v2Link.startsWith('fsgma://collection/v2/'))
	assert.equal(parsedV2.collection.name, manifest.collection.name)
	assert.equal(parsedV2.mods.length, manifest.mods.length)
	assert.equal(parsedV2.mods[0].name, manifest.mods[0].name)
	assert.equal(parsedV2.mods[0].fileName, manifest.mods[0].fileName)
	assert.equal(parsedV2.mods[0].sources[0].type, 'modhub')
	assert.equal(parsedV2.mods[0].sources[0].id, 100000)
	assert.equal(parsedV2.mods[0].sources[1].type, 'github')
	assert.equal(parsedV1.mods.length, manifest.mods.length)
	assert.ok(v2Link.length < v1Link.length)

	test.step(`v2 share link is ${v2Link.length.toLocaleString()} characters`)
	test.step(`old v1 equivalent is ${v1Link.length.toLocaleString()} characters`)
	test.step(`saved ${(v1Link.length - v2Link.length).toLocaleString()} characters on the sample manifest`)
}
