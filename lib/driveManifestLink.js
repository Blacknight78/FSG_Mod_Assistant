const DRIVE_COLLECTION_PREFIX = 'fsgma://collection/drive/'
const DRIVE_FILE_ID_PATTERN = /^[\w-]{10,200}$/u

function assertDriveFileID(fileID) {
	if ( typeof fileID !== 'string' || !DRIVE_FILE_ID_PATTERN.test(fileID) ) {
		throw new Error('Invalid Google Drive file ID.')
	}
	return fileID
}

function createDriveCollectionLink(fileID) {
	return `${DRIVE_COLLECTION_PREFIX}${assertDriveFileID(fileID)}`
}

function driveFileIDFromURL(value) {
	const url = new URL(value)
	const host = url.hostname.toLowerCase().replace(/^www\./u, '')
	if ( host !== 'drive.google.com' ) { return null }

	const pathMatch = url.pathname.match(/^\/file\/d\/([^/]+)/u)
	if ( pathMatch !== null ) { return pathMatch[1] }

	const queryID = url.searchParams.get('id')
	if ( typeof queryID === 'string' && queryID !== '' ) { return queryID }

	return null
}

function parseDriveCollectionLink(value) {
	const cleanValue = String(value ?? '').trim()
	if ( cleanValue.startsWith(DRIVE_COLLECTION_PREFIX) ) {
		return { fileID : assertDriveFileID(cleanValue.slice(DRIVE_COLLECTION_PREFIX.length)), type : 'drive' }
	}

	try {
		const fileID = driveFileIDFromURL(cleanValue)
		if ( fileID !== null ) {
			return { fileID : assertDriveFileID(fileID), type : 'drive' }
		}
	} catch {
		// Fall through to the standard unsupported-link message.
	}

	throw new Error('Use an FSG Mod Assistant Drive collection link or a Google Drive file link.')
}

module.exports = {
	DRIVE_COLLECTION_PREFIX,
	createDriveCollectionLink,
	parseDriveCollectionLink,
}
