/* eslint-disable no-console */
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function runGit(args, fallback = '') {
	try {
		return childProcess.execFileSync('git', args, {
			cwd      : path.join(__dirname, '..'),
			encoding : 'utf8',
			stdio    : ['ignore', 'pipe', 'ignore'],
		}).trim()
	} catch {
		return fallback
	}
}

const packageInfo = require('../package.json')
const builtAt = new Date().toISOString()
const shortCommit = runGit(['rev-parse', '--short', 'HEAD'], 'unknown')
const branch = runGit(['branch', '--show-current'], 'unknown')
const dirty = runGit(['status', '--short'], '') !== ''
const compactDate = builtAt
	.replaceAll('-', '')
	.replaceAll(':', '')
	.replace(/\.\d{3}Z$/u, 'Z')

const buildInfo = {
	branch,
	builtAt,
	commit : shortCommit,
	dirty,
	label  : `${packageInfo.version}+${compactDate}.${shortCommit}${dirty ? '.dirty' : ''}`,
	version : packageInfo.version,
}

if ( typeof process.env.FSGMA_GOOGLE_DRIVE_CLIENT_ID === 'string' && process.env.FSGMA_GOOGLE_DRIVE_CLIENT_ID.trim() !== '' ) {
	buildInfo.googleDriveClientID = process.env.FSGMA_GOOGLE_DRIVE_CLIENT_ID.trim()
}

if ( typeof process.env.FSGMA_GOOGLE_DRIVE_CLIENT_SECRET === 'string' && process.env.FSGMA_GOOGLE_DRIVE_CLIENT_SECRET.trim() !== '' ) {
	buildInfo.googleDriveClientSecret = process.env.FSGMA_GOOGLE_DRIVE_CLIENT_SECRET.trim()
}

if ( typeof process.env.FSGMA_GOOGLE_DRIVE_DEVICE_CLIENT_ID === 'string' && process.env.FSGMA_GOOGLE_DRIVE_DEVICE_CLIENT_ID.trim() !== '' ) {
	buildInfo.googleDriveDeviceClientID = process.env.FSGMA_GOOGLE_DRIVE_DEVICE_CLIENT_ID.trim()
}

fs.writeFileSync(path.join(__dirname, '..', 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`)
console.log(`Wrote build-info.json ${buildInfo.label}`)
