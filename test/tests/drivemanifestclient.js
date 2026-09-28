/*  _______           __ _______               __         __
   |   |   |.-----.--|  |   _   |.-----.-----.|__|.-----.|  |_
   |       ||  _  |  _  |       ||__ --|__ --||  ||__ --||   _|
   |__|_|__||_____|_____|___|___||_____|_____||__||_____||____|
   (c) 2022-present FSG Modding.  MIT License. */

// Test Program - Google Drive Manifest Client

const assert      = require('node:assert/strict')
const { testLib } = require('../test.js')
const {
	GOOGLE_DEVICE_CODE_URL,
	GOOGLE_DEVICE_GRANT_TYPE,
	GOOGLE_DRIVE_FILE_SCOPE,
	buildAuthCodeTokenBody,
	buildDeviceCodeBody,
	buildDeviceTokenBody,
	buildDriveAuthURL,
	buildRefreshTokenBody,
	createPKCEChallenge,
	createPKCEVerifier,
	driveAnyoneReaderPermission,
	driveCreateURL,
	driveDownloadURL,
	driveFilesURL,
	driveFolderMetadata,
	driveManifestMetadata,
	driveMultipartBody,
	drivePermissionURL,
	driveUploadURL,
} = require('../../lib/driveManifestClient.js')

module.exports.test = async () => {
	const test = new testLib('Drive Manifest Client Test')
	await tester(test)
	test.end(false, true)
}

async function tester(test) {
	const verifier = createPKCEVerifier()
	const challenge = createPKCEChallenge(verifier)

	assert.match(verifier, /^[\w-]{43,128}$/u)
	assert.match(challenge, /^[\w-]{43,128}$/u)
	assert.notEqual(verifier, challenge)

	const authURL = new URL(buildDriveAuthURL({
		clientID      : 'desktop-client.apps.googleusercontent.com',
		codeChallenge : challenge,
		redirectURI   : 'http://127.0.0.1:42813',
		state         : 'test-state',
	}))
	assert.equal(authURL.hostname, 'accounts.google.com')
	assert.equal(authURL.searchParams.get('scope'), GOOGLE_DRIVE_FILE_SCOPE)
	assert.equal(authURL.searchParams.get('response_type'), 'code')
	assert.equal(authURL.searchParams.get('access_type'), 'offline')
	assert.equal(authURL.searchParams.get('prompt'), 'consent')
	assert.equal(authURL.searchParams.get('code_challenge_method'), 'S256')
	assert.equal(authURL.searchParams.get('state'), 'test-state')
	assert.ok(!authURL.searchParams.get('scope').includes('/auth/drive '))

	const tokenBody = buildAuthCodeTokenBody({
		clientID     : 'desktop-client.apps.googleusercontent.com',
		clientSecret : 'desktop-secret',
		code         : 'oauth-code',
		codeVerifier : verifier,
		redirectURI  : 'http://127.0.0.1:42813',
	})
	assert.equal(tokenBody.get('grant_type'), 'authorization_code')
	assert.equal(tokenBody.get('client_secret'), 'desktop-secret')
	assert.equal(tokenBody.get('code_verifier'), verifier)

	const refreshBody = buildRefreshTokenBody({
		clientSecret : 'client-secret',
		clientID     : 'desktop-client.apps.googleusercontent.com',
		refreshToken : 'refresh-token',
	})
	assert.equal(refreshBody.get('grant_type'), 'refresh_token')
	assert.equal(refreshBody.get('client_secret'), 'client-secret')

	const deviceBody = buildDeviceCodeBody({
		clientID : 'desktop-client.apps.googleusercontent.com',
	})
	assert.equal(deviceBody.get('client_id'), 'desktop-client.apps.googleusercontent.com')
	assert.equal(deviceBody.get('scope'), GOOGLE_DRIVE_FILE_SCOPE)
	assert.equal(GOOGLE_DEVICE_CODE_URL, 'https://oauth2.googleapis.com/device/code')

	const deviceTokenBody = buildDeviceTokenBody({
		clientSecret : 'device-client-secret',
		clientID    : 'desktop-client.apps.googleusercontent.com',
		deviceCode  : 'device-code',
	})
	assert.equal(deviceTokenBody.get('client_id'), 'desktop-client.apps.googleusercontent.com')
	assert.equal(deviceTokenBody.get('client_secret'), 'device-client-secret')
	assert.equal(deviceTokenBody.get('device_code'), 'device-code')
	assert.equal(deviceTokenBody.get('grant_type'), GOOGLE_DEVICE_GRANT_TYPE)

	const fileID = '1AbCdEfGhIjKlMnOpQrStUvWxYz-1234567890'
	assert.equal(
		driveUploadURL(),
		'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2Cname%2CwebViewLink'
	)
	assert.equal(
		driveUploadURL({ fileID, fields : ['id', 'name'] }),
		`https://www.googleapis.com/upload/drive/v3/files/${fileID}?uploadType=multipart&fields=id%2Cname`
	)
	assert.equal(
		driveCreateURL({ fields : ['id', 'name'] }),
		'https://www.googleapis.com/drive/v3/files?fields=id%2Cname'
	)
	assert.equal(
		driveFilesURL({ fields : ['files(id,name)'], query : 'name = \'FSG Mod Assistant Collection Links\'' }),
		'https://www.googleapis.com/drive/v3/files?fields=files%28id%2Cname%29&q=name+%3D+%27FSG+Mod+Assistant+Collection+Links%27'
	)
	assert.equal(driveDownloadURL(fileID), `https://www.googleapis.com/drive/v3/files/${fileID}?alt=media`)
	assert.equal(drivePermissionURL(fileID), `https://www.googleapis.com/drive/v3/files/${fileID}/permissions?fields=id`)
	assert.deepEqual(driveAnyoneReaderPermission(), { role : 'reader', type : 'anyone' })

	const folderMetadata = driveFolderMetadata({
		name : 'FSG Mod Assistant Collection Links',
	})
	assert.equal(folderMetadata.mimeType, 'application/vnd.google-apps.folder')
	assert.equal(folderMetadata.appProperties.fsgModAssistant, 'collection-link-folder')

	const metadata = driveManifestMetadata({
		appProperties : { collection : 'Gameplay DB' },
		name          : 'Gameplay DB.fsgcollection.json',
		parents       : ['folder-id'],
	})
	assert.equal(metadata.mimeType, 'application/json')
	assert.equal(metadata.appProperties.fsgModAssistant, 'collection-manifest')
	assert.equal(metadata.appProperties.collection, 'Gameplay DB')
	assert.deepEqual(metadata.parents, ['folder-id'])

	const multipart = driveMultipartBody({
		manifest : { collection : { name : 'Gameplay DB' }, mods : [] },
		metadata,
	})
	assert.match(multipart.contentType, /^multipart\/related; boundary=fsgma-[a-f0-9]{24}$/u)
	assert.match(multipart.body, /Content-Type: application\/json; charset=UTF-8/u)
	assert.match(multipart.body, /"fsgModAssistant":"collection-manifest"/u)
	assert.match(multipart.body, /"name": "Gameplay DB"/u)

	test.step('Built PKCE OAuth URLs with the narrow Google Drive file scope')
	test.step('Built token, refresh, and device-code bodies with the required secrets')
	test.step('Built Drive upload, download, permission, metadata, and multipart payloads')
}
