/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Test Program - Drive Collection Links

const assert      = require('node:assert/strict')
const { testLib } = require('../test.js')
const {
	createDriveCollectionLink,
	parseDriveCollectionLink,
} = require('../../lib/driveManifestLink.js')

module.exports.test = async () => {
	const test = new testLib('Drive Collection Link Test')
	await tester(test)
	test.end(false, true)
}

async function tester(test) {
	const fileID = '1AbCdEfGhIjKlMnOpQrStUvWxYz-1234567890'
	const shortLink = createDriveCollectionLink(fileID)

	assert.equal(shortLink, `fsgma://collection/drive/${fileID}`)
	assert.deepEqual(parseDriveCollectionLink(shortLink), { fileID, type : 'drive' })
	assert.deepEqual(parseDriveCollectionLink(`https://drive.google.com/file/d/${fileID}/view?usp=sharing`), { fileID, type : 'drive' })
	assert.deepEqual(parseDriveCollectionLink(`https://drive.google.com/open?id=${fileID}`), { fileID, type : 'drive' })
	assert.deepEqual(parseDriveCollectionLink(`https://drive.google.com/uc?id=${fileID}&export=download`), { fileID, type : 'drive' })

	assert.throws(() => createDriveCollectionLink('../bad'), /Invalid Google Drive file ID/u)
	assert.throws(() => parseDriveCollectionLink('https://example.com/file.json'), /Drive collection link/u)
	assert.throws(() => parseDriveCollectionLink('fsgma://collection/drive/../bad'), /Invalid Google Drive file ID/u)

	test.step(`Drive collection link is ${shortLink.length.toLocaleString()} characters`)
	test.step('Accepted fsgma, Drive file, open, and download URL shapes')
	test.step('Rejected unsupported hosts and unsafe file IDs')
}
