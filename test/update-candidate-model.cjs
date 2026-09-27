/* global __dirname, console */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../renderer/renderJS/update_candidate_model.js'), 'utf8')
const context = { URL : globalThis.URL, window : {} }
vm.createContext(context)
vm.runInContext(source, context)

const model = context.window.UpdateCandidateModel

assert.equal(model.sourceTypeLabel('modhub'), 'ModHub')
assert.equal(model.sourceTypeLabel('github'), 'GitHub')
assert.equal(model.sourceTypeLabel('itch'), 'itch.io')
const gitHubSource = model.sourceInfoFromURL('https://github.com/author/repo')
assert.equal(gitHubSource.label, 'GitHub')
assert.equal(gitHubSource.type, 'github')
const modHubSource = model.sourceInfoFromURL('https://www.farming-simulator.com/mod.php?mod_id=123')
assert.equal(modHubSource.label, 'ModHub')
assert.equal(modHubSource.type, 'modhub')
assert.equal(model.isWebURL('https://example.com/mod'), true)
assert.equal(model.isWebURL('file:///example.zip'), false)
assert.equal(model.modHubURL(123), 'https://www.farming-simulator.com/mod.php?mod_id=123')
assert.equal(model.candidateGroupKey('FS25_Test.zip', { modHubID : null, sourceType : 'github', sourceURL : 'https://github.com/author/repo' }, (value) => String(value).replace(/\.zip$/u, '')), 'github:https://github.com/author/repo:fs25_test')
const vaultSources = model.sourcesForVaultRecord({
	modHubIDs : [123, '123', 456],
	sourceURL : 'https://github.com/author/repo',
})
assert.equal(vaultSources.length, 3)
assert.equal(vaultSources[0].modHubID, 123)
assert.equal(vaultSources[0].sourceURL, 'https://www.farming-simulator.com/mod.php?mod_id=123&title=fs2025')
assert.equal(vaultSources[2].sourceType, 'github')
assert.equal(model.compareVersions('1.2.10', '1.2.9') > 0, true)
assert.equal(model.newestVersion(['1.0.0', '1.2.0', '1.1.0']), '1.2.0')
assert.equal(model.reviewReasonLabels(['manualOnly', 'repositoryZip', 'unknown']).join('|'), 'Manual download only|Repository ZIP, check before installing|unknown')
assert.equal(model.isUpdateAvailable(new Set(['1.0.0']), '1.1.0'), true)
assert.equal(model.isUpdateAvailable(new Set(['1.1.0']), '1.0.0'), false)
const unknownDifferenceAvailable = model.isUpdateAvailable(new Set(['beta']), 'release', {
	allowUnknownDifference : true,
	versionCompare : () => Number.NaN,
	versionDifferent : () => true,
})
assert.equal(unknownDifferenceAvailable, true)
const collectionDecision = model.collectionRemoteDecision({
	local      : new Set(['1.0.0']),
	sourceType : 'github',
}, {
	downloadSource : 'repositoryFile',
	hasDownload    : true,
	ok             : true,
	source         : 'github',
	version        : '1.1.0',
})
assert.equal(collectionDecision.available, true)
assert.equal(collectionDecision.includeCandidate, true)
assert.equal(collectionDecision.reviewReasons.join(','), 'repositoryZip')
const manualDecision = model.collectionRemoteDecision({
	local      : new Set(['1.0.0']),
	sourceType : 'manual',
}, {
	hasDownload : false,
	ok          : true,
	source      : 'manual',
	version     : 'manual check',
})
assert.equal(manualDecision.available, false)
assert.equal(manualDecision.includeCandidate, true)
assert.equal(manualDecision.reviewReasons.join(','), 'manualSource,noDirectZip')
assert.equal(model.candidateUpdateState({ downloadURL : null, needsReview : false, packageMismatch : null }), 'manual')
assert.equal(model.candidateUpdateState({ downloadURL : 'https://example.com/mod.zip', needsReview : true, packageMismatch : null }), 'review')
assert.equal(model.candidateUpdateState({ downloadURL : 'https://example.com/mod.zip', needsReview : false, packageMismatch : null }), 'ready')
assert.equal(JSON.stringify(model.candidateStateCounts([
	{ downloadURL : null, needsReview : false, packageMismatch : null },
	{ downloadURL : 'https://example.com/mod.zip', needsReview : true, packageMismatch : null },
	{ downloadURL : 'https://example.com/mod.zip', needsReview : false, packageMismatch : null },
	{ downloadURL : 'https://example.com/mod.zip', needsReview : false, packageMismatch : {} },
])), JSON.stringify({
	manual          : 1,
	packageMismatch : 1,
	ready           : 1,
	review          : 1,
}))

const vaultDecision = model.vaultRemoteDecision({
	localVersions : ['1.0.0', '1.2.0'],
}, {
	ok      : true,
	version : '1.3.0',
})
assert.equal(vaultDecision.available, true)
assert.equal(vaultDecision.localVersion, '1.2.0')
const vaultReviewCandidate = model.applyVaultReviewState({
	assetName     : 'other_package.zip',
	downloadSource : 'repositoryFile',
	downloadURL   : null,
	fileName      : 'other_package.zip',
	localVersion  : '1.0.0',
	modHubReleased : '',
	modName       : 'FS25_TestMod',
	packageMismatch : { downloadedVersion : '1.0.0', expectedVersion : '1.1.0' },
	remoteVersion : '1.1.0',
	sourceType    : 'github',
}, {
	normalizeModName : (value) => String(value ?? '').replace(/\.zip$/u, ''),
})
assert.equal(vaultReviewCandidate.needsReview, true)
assert.equal(vaultReviewCandidate.reviewReasons.join(','), 'packageMismatch,manualOnly,repositoryZip,sourceMismatch')

const collectionCandidates = model.buildCollectionCandidateMap({
	appSettings : {
		force_lang   : 'en',
		game_version : 25,
	},
	collectionNotes : {
		active : { notes_frozen : false, notes_version : 25 },
		old    : { notes_frozen : false, notes_version : 22 },
	},
	collectionToName : {
		active : 'Active Collection',
		old    : 'Old Collection',
	},
	modList : {
		active : {
			modSet : ['github', 'manual', 'folder', 'modhub'],
			mods   : {
				folder : {
					fileDetail : { isFolder : true, shortName : 'FS25_Folder' },
					l10n       : { title : { en : 'Folder' } },
					modDesc    : { iconImage : 'folder.png', version : '1.0.0' },
					modHub     : { id : null, version : '' },
				},
				github : {
					fileDetail : { isFolder : false, shortName : 'FS25_GitHub' },
					l10n       : { title : { en : 'GitHub Mod' } },
					modDesc    : { iconImage : 'github.png', version : '1.0.0' },
					modHub     : { id : null, version : '' },
				},
				manual : {
					fileDetail : { isFolder : false, shortName : 'FS25_Manual' },
					l10n       : { title : { en : 'Manual Mod' } },
					modDesc    : { iconImage : 'manual.png', version : '2.0.0' },
					modHub     : { id : null, version : '' },
				},
				modhub : {
					fileDetail : { isFolder : false, shortName : 'FS25_ModHub' },
					l10n       : { title : { en : 'ModHub Mod' } },
					modDesc    : { iconImage : 'modhub.png', version : '1.0.0' },
					modHub     : { id : 789, version : '1.1.0' },
				},
			},
		},
		old : {
			modSet : ['ignored'],
			mods   : {
				ignored : {
					fileDetail : { isFolder : false, shortName : 'FS25_Ignored' },
					l10n       : { title : { en : 'Ignored Mod' } },
					modDesc    : { iconImage : 'ignored.png', version : '1.0.0' },
					modHub     : { id : 999, version : '9.9.9' },
				},
			},
		},
	},
	opts : {
		activeCollection : null,
		modSites : {
			FS25_GitHub : 'https://github.com/author/repo',
			FS25_Manual : 'https://example.com/manual-download',
		},
	},
	set_Collections : new Set(['active', 'old']),
}, {
	titleResolver : (thisMod) => thisMod.l10n.title.en,
})

assert.equal(Object.keys(collectionCandidates).length, 3)
assert.equal(collectionCandidates['FS25_GitHub::github'].sourceLabel, 'GitHub')
assert.equal([...collectionCandidates['FS25_GitHub::github'].local].join(','), '1.0.0')
assert.equal(collectionCandidates['FS25_Manual::manual'].title, 'Manual Mod')
assert.equal(collectionCandidates['FS25_ModHub::modhub'].modHubID, 789)
assert.equal(collectionCandidates['FS25_ModHub::modhub'].sourceURL, 'https://www.farming-simulator.com/mod.php?mod_id=789')
assert.equal(collectionCandidates['FS25_Ignored::modhub'], undefined)

console.log('PASS: shared update candidate model helpers')
