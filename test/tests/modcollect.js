/*  _______           __ _______               __         __   
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_ 
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Test Program - Savegame Mod Tracking

const localCollections           = 'C:\\Users\\jtsag\\Documents\\My Games\\FarmingSimulator2022\\mods'
const useLocalCollections        = false // only valid for developer, causes test fail

const path                       = require('node:path')
const fs                         = require('node:fs')
const { EventEmitter }           = require('node:events')
const { modFileCollection }      = require('../../lib/modCheckLib.js')
const { testLib }                = require('../test.js')
const { serveIPC, getDeferPromise } = require('../../lib/modUtilLib.js')

class queueEmitter extends EventEmitter {}
const queueDoneEmit = new queueEmitter()

const modCollect = new modFileCollection( require('node:os').homedir, queueDoneEmit )

module.exports.test = () => {
	return Promise.allSettled([
		testGood(new testLib('Mod Collection - Valid')),
		testModHubVersions(new testLib('ModHub - Separate FS22 and FS25 Records')),
	])
}

const testModHubVersions = (test) => {
	const testCollect = new modFileCollection(require('node:os').homedir)
	const sharedName  = 'EXAMPLE_Shared_Mod_Name'

	testCollect.modHubList = {
		games : {
			22 : { mods : { [sharedName] : 22001 }, last : [22001] },
			25 : { mods : { [sharedName] : 25001 }, last : [] },
		},
		last   : [22001],
		legacy : {},
		mods   : { [sharedName] : 25001 },
	}
	testCollect.modHubVersion = {
		22001 : '1.0.0.0',
		25001 : '2.0.0.0',
		games : {
			22 : { 22001 : '1.0.0.0' },
			25 : { 25001 : '2.0.0.0' },
		},
		legacy : {},
	}

	const fs22Record = testCollect.modHubFullRecord({
		fileDetail : { shortName : sharedName },
		gameVersion : 22,
	})
	const fs25Record = testCollect.modHubFullRecord({
		fileDetail : { shortName : sharedName },
		gameVersion : 25,
	})

	if ( fs22Record.id === 22001 && fs22Record.version === '1.0.0.0' && fs22Record.recent ) {
		test.step('FS22 record uses the FS22 ModHub entry')
	} else {
		test.error(`FS22 record was incorrect: ${JSON.stringify(fs22Record)}`)
	}

	if ( fs25Record.id === 25001 && fs25Record.version === '2.0.0.0' && !fs25Record.recent ) {
		test.step('FS25 record uses the FS25 ModHub entry')
	} else {
		test.error(`FS25 record was incorrect: ${JSON.stringify(fs25Record)}`)
	}

	test.end()
	return Promise.resolve()
}


const testGood = (test) => {
	test.step('Loading Valid Collection')

	const modPath    = path.join(__dirname, 'mods')

	if ( useLocalCollections ) {
		for ( const folder of fs.readdirSync(localCollections)) {
			modCollect.addCollection(path.join(localCollections, folder))
		}
	}

	const folderID   = modCollect.getMD5FromFolder(modPath)
	const defer      = getDeferPromise()

	queueDoneEmit.on('process-mods-done', () => { defer.resolve_ex() })

	serveIPC.IPCEmit    = queueDoneEmit

	modCollect.addCollection(modPath)
	modCollect.processMods()

	return defer.then(() => {
		if ( modCollect.collections.size === 1 && !useLocalCollections ) {
			test.step('Found expected (1) collection')
		} else if ( useLocalCollections ) {
			test.step(`Local collections loaded (${modCollect.collections.size})`)
		} else {
			test.error(`Found unexpected number of collections (${modCollect.collections.size})`)
		}
		const testSet = modCollect.getModCollection(folderID)

		if ( testSet.modSet.size === 13 ) {
			test.step('Found expected (13) mods in test collection')
		} else {
			test.error(`Found unexpected count of mods (${testSet.modSet.size})`)
		}

		const expectMinData = 60000
		const expectMaxData = 75000
		const actualSize = JSON.stringify(testSet).length
		if ( expectMinData < actualSize && actualSize < expectMaxData ) {
			test.step(`Got expected ${actualSize} bytes of data, within range`)
		} else {
			test.error(`Got unexpected ${actualSize} bytes of data, outside range`)
		}

		// console.dir(testSet, { depth : 3 })
	}).catch((err) => {
		test.error(`Unexpected error :: ${err}`)
	}).finally(() => {
		test.end()
	})
}

