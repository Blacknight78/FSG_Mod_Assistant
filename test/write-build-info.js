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

fs.writeFileSync(path.join(__dirname, '..', 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`)
console.log(`Wrote build-info.json ${buildInfo.label}`)
