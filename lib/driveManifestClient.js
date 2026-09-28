const crypto = require('node:crypto')

const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code'
const GOOGLE_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3'

function base64URLEncode(buffer) {
	return Buffer.from(buffer).toString('base64url')
}

function createPKCEVerifier() {
	return base64URLEncode(crypto.randomBytes(32))
}

function createPKCEChallenge(verifier) {
	if ( typeof verifier !== 'string' || verifier.length < 43 ) {
		throw new Error('A valid PKCE verifier is required.')
	}
	return base64URLEncode(crypto.createHash('sha256').update(verifier).digest())
}

function requireText(value, label) {
	if ( typeof value !== 'string' || value.trim() === '' ) {
		throw new Error(`${label} is required.`)
	}
	return value.trim()
}

function buildDriveAuthURL({ clientID, codeChallenge, redirectURI, state }) {
	const url = new URL(GOOGLE_AUTH_URL)
	url.searchParams.set('client_id', requireText(clientID, 'Google OAuth client ID'))
	url.searchParams.set('redirect_uri', requireText(redirectURI, 'Google OAuth redirect URI'))
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('scope', GOOGLE_DRIVE_FILE_SCOPE)
	url.searchParams.set('access_type', 'offline')
	url.searchParams.set('prompt', 'consent')
	url.searchParams.set('code_challenge', requireText(codeChallenge, 'PKCE code challenge'))
	url.searchParams.set('code_challenge_method', 'S256')
	if ( typeof state === 'string' && state !== '' ) {
		url.searchParams.set('state', state)
	}
	return url.toString()
}

function buildAuthCodeTokenBody({ clientID, code, codeVerifier, redirectURI, clientSecret = null }) {
	const body = new URLSearchParams()
	body.set('client_id', requireText(clientID, 'Google OAuth client ID'))
	if ( typeof clientSecret === 'string' && clientSecret.trim() !== '' ) {
		body.set('client_secret', clientSecret.trim())
	}
	body.set('code', requireText(code, 'Google OAuth code'))
	body.set('code_verifier', requireText(codeVerifier, 'PKCE verifier'))
	body.set('grant_type', 'authorization_code')
	body.set('redirect_uri', requireText(redirectURI, 'Google OAuth redirect URI'))
	return body
}

function buildRefreshTokenBody({ clientID, refreshToken, clientSecret = null }) {
	const body = new URLSearchParams()
	body.set('client_id', requireText(clientID, 'Google OAuth client ID'))
	if ( typeof clientSecret === 'string' && clientSecret.trim() !== '' ) {
		body.set('client_secret', clientSecret.trim())
	}
	body.set('grant_type', 'refresh_token')
	body.set('refresh_token', requireText(refreshToken, 'Google refresh token'))
	return body
}

function buildDeviceCodeBody({ clientID, scope = GOOGLE_DRIVE_FILE_SCOPE }) {
	const body = new URLSearchParams()
	body.set('client_id', requireText(clientID, 'Google OAuth client ID'))
	body.set('scope', requireText(scope, 'Google OAuth scope'))
	return body
}

function buildDeviceTokenBody({ clientID, deviceCode, clientSecret = null }) {
	const body = new URLSearchParams()
	body.set('client_id', requireText(clientID, 'Google OAuth client ID'))
	if ( typeof clientSecret === 'string' && clientSecret.trim() !== '' ) {
		body.set('client_secret', clientSecret.trim())
	}
	body.set('device_code', requireText(deviceCode, 'Google device code'))
	body.set('grant_type', GOOGLE_DEVICE_GRANT_TYPE)
	return body
}

function driveFields(fields = ['id', 'name', 'webViewLink']) {
	return fields.join(',')
}

function driveUploadURL({ fileID = null, fields = ['id', 'name', 'webViewLink'] } = {}) {
	const encodedFields = encodeURIComponent(driveFields(fields))
	if ( typeof fileID === 'string' && fileID !== '' ) {
		return `${DRIVE_UPLOAD_ROOT}/files/${encodeURIComponent(fileID)}?uploadType=multipart&fields=${encodedFields}`
	}
	return `${DRIVE_UPLOAD_ROOT}/files?uploadType=multipart&fields=${encodedFields}`
}

function driveCreateURL({ fields = ['id', 'name', 'webViewLink'] } = {}) {
	return `${DRIVE_API_ROOT}/files?fields=${encodeURIComponent(driveFields(fields))}`
}

function driveFilesURL({ fields = ['files(id,name)'], query = '' } = {}) {
	const url = new URL(`${DRIVE_API_ROOT}/files`)
	url.searchParams.set('fields', driveFields(fields))
	if ( typeof query === 'string' && query !== '' ) {
		url.searchParams.set('q', query)
	}
	return url.toString()
}

function driveDownloadURL(fileID) {
	return `${DRIVE_API_ROOT}/files/${encodeURIComponent(requireText(fileID, 'Google Drive file ID'))}?alt=media`
}

function drivePermissionURL(fileID) {
	return `${DRIVE_API_ROOT}/files/${encodeURIComponent(requireText(fileID, 'Google Drive file ID'))}/permissions?fields=id`
}

function driveAnyoneReaderPermission() {
	return { role : 'reader', type : 'anyone' }
}

function driveFolderMetadata({ name, appProperties = {} }) {
	return {
		appProperties : {
			fsgModAssistant : 'collection-link-folder',
			...appProperties,
		},
		mimeType : 'application/vnd.google-apps.folder',
		name     : requireText(name, 'Drive folder name'),
	}
}

function driveManifestMetadata({ name, appProperties = {}, parents = [] }) {
	const metadata = {
		appProperties : {
			fsgModAssistant : 'collection-manifest',
			...appProperties,
		},
		mimeType : 'application/json',
		name     : requireText(name, 'Drive manifest file name'),
	}
	if ( Array.isArray(parents) && parents.length !== 0 ) {
		metadata.parents = parents.map((parentID) => requireText(parentID, 'Drive parent folder ID'))
	}
	return metadata
}

function driveMultipartBody({ manifest, metadata }) {
	const boundary = `fsgma-${crypto.randomBytes(12).toString('hex')}`
	const body = [
		`--${boundary}`,
		'Content-Type: application/json; charset=UTF-8',
		'',
		JSON.stringify(metadata),
		`--${boundary}`,
		'Content-Type: application/json; charset=UTF-8',
		'',
		`${JSON.stringify(manifest, null, 2)}\n`,
		`--${boundary}--`,
		'',
	].join('\r\n')
	return {
		body,
		contentType : `multipart/related; boundary=${boundary}`,
	}
}

module.exports = {
	buildAuthCodeTokenBody,
	buildDeviceCodeBody,
	buildDeviceTokenBody,
	buildDriveAuthURL,
	buildRefreshTokenBody,
	createPKCEChallenge,
	createPKCEVerifier,
	DRIVE_API_ROOT,
	DRIVE_UPLOAD_ROOT,
	driveAnyoneReaderPermission,
	driveCreateURL,
	driveDownloadURL,
	driveFilesURL,
	driveFolderMetadata,
	driveManifestMetadata,
	driveMultipartBody,
	drivePermissionURL,
	driveUploadURL,
	GOOGLE_AUTH_URL,
	GOOGLE_DEVICE_CODE_URL,
	GOOGLE_DEVICE_GRANT_TYPE,
	GOOGLE_DRIVE_FILE_SCOPE,
	GOOGLE_TOKEN_URL,
}
