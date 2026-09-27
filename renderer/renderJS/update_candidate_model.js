/* Shared update candidate helpers for collection and Vault update screens. */
window.UpdateCandidateModel = (() => {
	const SOURCE_LABELS = {
		github  : 'GitHub',
		itch    : 'itch.io',
		kingmods : 'KingMods',
		manual  : 'Manual web page',
		modhub  : 'ModHub',
	}

	const REVIEW_REASON_LABELS = {
		manualOnly       : 'Manual download only',
		manualSource     : 'Manual download source',
		missingModHubDate : 'ModHub release date not recorded',
		noDirectZip      : 'No direct ZIP found',
		packageMismatch  : 'Package version does not match source version',
		repositoryZip    : 'Repository ZIP, check before installing',
		sourceMismatch   : 'Source filename may not match this mod',
		versionUnclear   : 'Version could not be compared clearly',
	}

	const UPDATE_STATE_LABELS = {
		manual          : 'Manual only',
		packageMismatch : 'Package mismatch',
		ready           : 'Ready',
		review          : 'Needs review',
	}

	function sourceTypeLabel(sourceType) {
		return SOURCE_LABELS[sourceType] ?? SOURCE_LABELS.manual
	}

	function isManualSourceType(sourceType) {
		return ['itch', 'kingmods', 'manual'].includes(sourceType)
	}

	function isWebURL(sourceURL) {
		try {
			return new URL(sourceURL).protocol === 'https:'
		} catch {
			return false
		}
	}

	function sourceInfoFromURL(sourceURL) {
		try {
			const url = new URL(sourceURL)
			if ( url.protocol !== 'https:' ) { return { label : SOURCE_LABELS.manual, type : 'manual' } }
			const host = url.hostname.toLowerCase().replace(/^www\./u, '')
			if ( host === 'github.com' ) { return { label : SOURCE_LABELS.github, type : 'github' } }
			if ( host === 'kingmods.net' ) { return { label : SOURCE_LABELS.kingmods, type : 'kingmods' } }
			if ( host === 'itch.io' || host.endsWith('.itch.io') ) { return { label : SOURCE_LABELS.itch, type : 'itch' } }
			if ( host === 'farming-simulator.com' && url.searchParams.has('mod_id') ) { return { label : SOURCE_LABELS.modhub, type : 'modhub' } }
			return { label : SOURCE_LABELS.manual, type : 'manual' }
		} catch {
			return { label : SOURCE_LABELS.manual, type : 'manual' }
		}
	}

	function modHubURL(modHubID) {
		return `https://www.farming-simulator.com/mod.php?mod_id=${modHubID}`
	}

	function defaultNormalizeModName(value) {
		return String(value ?? '').trim()
	}

	function sourceDedupKey(source) {
		return `${source.sourceType}:${source.modHubID ?? source.sourceURL}`
	}

	function candidateGroupKey(modName, source, normalizeModName = defaultNormalizeModName) {
		return `${source.sourceType}:${source.modHubID ?? source.sourceURL}:${normalizeModName(modName).toLocaleLowerCase()}`
	}

	function sourcesForVaultRecord(record) {
		const sources = []
		const seen = new Set()
		const addSource = (source) => {
			const key = sourceDedupKey(source)
			if ( seen.has(key) ) { return }
			seen.add(key)
			sources.push(source)
		}

		for ( const rawModHubID of record.modHubIDs ?? [] ) {
			const modHubID = Number(rawModHubID)
			if ( Number.isInteger(modHubID) && modHubID > 0 ) {
				addSource({
					modHubID,
					sourceType : 'modhub',
					sourceURL  : record.modHubURL ?? `${modHubURL(modHubID)}&title=fs2025`,
				})
			}
		}

		const sourceURL = record.sourceURL ?? ''
		if ( /^https:\/\/github\.com\//iu.test(sourceURL) ) {
			addSource({ modHubID : null, sourceType : 'github', sourceURL })
		}

		return sources
	}

	function versionParts(value) {
		return String(value ?? '')
			.replace(/^v/iu, '')
			.split(/[^0-9]+/u)
			.filter((part) => part.length !== 0)
			.map(Number)
	}

	function compareVersions(left, right) {
		const leftParts = versionParts(left)
		const rightParts = versionParts(right)
		const length = Math.max(leftParts.length, rightParts.length)

		for ( let index = 0; index < length; index++ ) {
			const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
			if ( difference !== 0 ) { return difference }
		}
		return 0
	}

	function newestVersion(versions) {
		return [...new Set((versions ?? []).filter((value) => typeof value === 'string' && value.length !== 0))]
			.sort((left, right) => compareVersions(right, left))[0] ?? 'unknown'
	}

	function modHubReleasedLabel(value) {
		const released = typeof value === 'string' ? value.trim() : ''
		return released === '' ? 'not recorded' : released
	}

	function reviewReasonLabels(reasons) {
		return reasons.map((reason) => REVIEW_REASON_LABELS[reason] ?? reason)
	}

	function updateStateLabel(state) {
		return UPDATE_STATE_LABELS[state] ?? state
	}

	function isUpdateAvailable(localVersions, remoteVersion, {
		allowUnknownDifference = false,
		versionCompare = compareVersions,
		versionDifferent = (localVersion, onlineVersion) => String(localVersion ?? '') !== String(onlineVersion ?? ''),
	} = {}) {
		for ( const localVersion of localVersions ) {
			const compare = versionCompare(localVersion, remoteVersion)
			if ( compare < 0 || (allowUnknownDifference && Number.isNaN(compare) && versionDifferent(localVersion, remoteVersion)) ) {
				return true
			}
		}
		return false
	}

	function collectionReviewReasons(entry, result, {
		versionCompare = compareVersions,
	} = {}) {
		const reasons = []
		if ( isManualSourceType(entry.sourceType) ) {
			reasons.push('manualSource')
		}
		if ( result.hasDownload !== true ) {
			reasons.push('noDirectZip')
		}
		if ( result.source === 'modhub' && modHubReleasedLabel(result.released) === 'not recorded' ) {
			reasons.push('missingModHubDate')
		}
		if ( entry.sourceType === 'github' && result.downloadSource === 'repositoryFile' ) {
			reasons.push('repositoryZip')
		}
		if ( typeof result.version !== 'string' || ![...entry.local].some((version) => !Number.isNaN(versionCompare(version, result.version))) ) {
			reasons.push('versionUnclear')
		}
		return reasons
	}

	function collectionRemoteDecision(entry, result, {
		versionCompare = compareVersions,
		versionDifferent,
	} = {}) {
		const allowUnknownDifference = entry.sourceType === 'github'
		const available = result.ok === true && isUpdateAvailable(entry.local, result.version, {
			allowUnknownDifference,
			versionCompare,
			versionDifferent,
		})
		return {
			available,
			includeCandidate : result.ok === true && (isManualSourceType(entry.sourceType) || available),
			reviewReasons : collectionReviewReasons(entry, result, { versionCompare }),
		}
	}

	function sourceMismatchRisk(candidate, normalizeModName = defaultNormalizeModName) {
		const assetName = normalizeModName(candidate.assetName ?? candidate.fileName ?? '')
		const modName = normalizeModName(candidate.modName ?? '')
		if ( assetName === '' || modName === '' ) { return false }
		return !assetName.toLocaleLowerCase().includes(modName.toLocaleLowerCase()) &&
			!modName.toLocaleLowerCase().includes(assetName.toLocaleLowerCase())
	}

	function vaultReviewReasons(candidate, {
		normalizeModName = defaultNormalizeModName,
	} = {}) {
		const reasons = []
		if ( candidate.packageMismatch !== null && typeof candidate.packageMismatch === 'object' ) {
			reasons.push('packageMismatch')
		}
		if ( candidate.downloadURL === null ) {
			reasons.push('manualOnly')
		}
		if ( candidate.sourceType === 'modhub' && modHubReleasedLabel(candidate.modHubReleased) === 'not recorded' ) {
			reasons.push('missingModHubDate')
		}
		if ( candidate.sourceType === 'github' && candidate.downloadSource === 'repositoryFile' ) {
			reasons.push('repositoryZip')
		}
		if ( candidate.localVersion === 'unknown' || compareVersions(candidate.remoteVersion, candidate.localVersion) === 0 ) {
			reasons.push('versionUnclear')
		}
		if ( sourceMismatchRisk(candidate, normalizeModName) ) {
			reasons.push('sourceMismatch')
		}
		return reasons
	}

	function applyVaultReviewState(candidate, options = {}) {
		candidate.reviewReasons = vaultReviewReasons(candidate, options)
		candidate.needsReview = candidate.reviewReasons.length !== 0
		return candidate
	}

	function vaultRemoteDecision(group, remote) {
		if ( remote?.ok !== true || typeof remote.version !== 'string' ) {
			return {
				available : false,
				localVersion : newestVersion(group.localVersions),
			}
		}
		const localVersion = newestVersion(group.localVersions)
		return {
			available : compareVersions(remote.version, localVersion) > 0,
			localVersion,
		}
	}

	function candidateUpdateState(candidate) {
		if ( candidate.packageMismatch !== null && typeof candidate.packageMismatch === 'object' ) { return 'packageMismatch' }
		if ( candidate.downloadURL === null ) { return 'manual' }
		if ( candidate.needsReview === true ) { return 'review' }
		return 'ready'
	}

	function candidateStateCounts(items) {
		const counts = {
			manual          : 0,
			packageMismatch : 0,
			ready           : 0,
			review          : 0,
		}
		for ( const candidate of items ) {
			counts[candidateUpdateState(candidate)] += 1
		}
		return counts
	}

	function stateSummaryText(items) {
		const counts = candidateStateCounts(items)
		const parts = [
			`Visible updates: ${items.length}`,
			`${updateStateLabel('ready')}: ${counts.ready}`,
			`${updateStateLabel('review')}: ${counts.review}`,
			`${updateStateLabel('manual')}: ${counts.manual}`,
			`${updateStateLabel('packageMismatch')}: ${counts.packageMismatch}`,
		]
		return `${parts.join(' | ')}.`
	}

	function packageMismatchMessage(mismatch, fallbackExpectedVersion = 'unknown') {
		return `Remote package mismatch: the source site says version ${mismatch?.expectedVersion ?? fallbackExpectedVersion}, but its downloaded ZIP reports ${mismatch?.downloadedVersion ?? 'unknown'}. This is a remote package/version-label problem, not an issue with your local Vault mod.`
	}

	function addCollectionCandidate(candidates, entry) {
		const candidateKey = `${entry.modName}::${entry.sourceType}`
		candidates[candidateKey] ??= {
			collectionKeys : [],
			collections : [],
			icon        : entry.icon,
			local       : new Set(),
			modHubID    : entry.modHubID,
			modName     : entry.modName,
			remoteVersion : entry.remoteVersion,
			sourceLabel : sourceTypeLabel(entry.sourceType),
			sourceType  : entry.sourceType,
			sourceURL   : entry.sourceURL,
			title       : entry.title,
		}
		if ( !candidates[candidateKey].collectionKeys.includes(entry.collectionKey) ) {
			candidates[candidateKey].collectionKeys.push(entry.collectionKey)
			candidates[candidateKey].collections.push(entry.collectionName)
		}
		candidates[candidateKey].local.add(entry.localVersion)
	}

	function addModCollectionCandidates(candidates, collectKey, collectionName, thisMod, modCollect, titleResolver) {
		const modName = thisMod.fileDetail.shortName
		const sourceURL = modCollect.opts?.modSites?.[modName] ?? ''
		const sourceInfo = sourceInfoFromURL(sourceURL)
		const addCandidate = (sourceType, sourceLink, remoteVersion = null, modHubID = null) => {
			addCollectionCandidate(candidates, {
				collectionKey  : collectKey,
				collectionName : collectionName,
				icon           : thisMod.modDesc.iconImage,
				localVersion   : thisMod.modDesc.version,
				modHubID,
				modName,
				remoteVersion,
				sourceType,
				sourceURL      : sourceLink,
				title          : titleResolver(thisMod, modCollect),
			})
		}

		if ( sourceInfo.type === 'github' ) {
			addCandidate('github', sourceURL)
		} else if ( ['itch', 'kingmods', 'manual'].includes(sourceInfo.type) && isWebURL(sourceURL) ) {
			addCandidate(sourceInfo.type, sourceURL)
		} else if ( sourceInfo.type === 'modhub' && thisMod.modHub.id === null && isWebURL(sourceURL) ) {
			addCandidate('modhub', sourceURL)
		}
		if ( thisMod.modHub.id !== null && typeof thisMod.modHub.version === 'string' && thisMod.modHub.version !== '' ) {
			addCandidate('modhub', modHubURL(thisMod.modHub.id), thisMod.modHub.version, thisMod.modHub.id)
		}
	}

	function buildCollectionCandidateMap(modCollect, {
		titleResolver = () => '--',
	} = {}) {
		const thisVersion = modCollect.appSettings.game_version
		const candidates = {}
		const activeCollect = modCollect.opts?.activeCollection ?? null
		const collectionKeys = [...modCollect.set_Collections]
		const collectKeys = activeCollect !== null && collectionKeys.includes(activeCollect) ?
			[activeCollect] :
			collectionKeys

		for ( const collectKey of collectKeys ) {
			const theseNotes = modCollect?.collectionNotes?.[collectKey]
			if ( theseNotes?.notes_frozen === true ) { continue }
			if ( theseNotes?.notes_version !== thisVersion ) { continue }

			const collectionName = modCollect.collectionToName[collectKey]
			for ( const modKey of modCollect.modList[collectKey].modSet ) {
				const thisMod = modCollect.modList[collectKey].mods[modKey]
				if ( thisMod.fileDetail.isFolder ) { continue }
				addModCollectionCandidates(candidates, collectKey, collectionName, thisMod, modCollect, titleResolver)
			}
		}

		return candidates
	}

	return {
		applyVaultReviewState,
		buildCollectionCandidateMap,
		candidateGroupKey,
		candidateStateCounts,
		candidateUpdateState,
		collectionRemoteDecision,
		collectionReviewReasons,
		compareVersions,
		isManualSourceType,
		isUpdateAvailable,
		isWebURL,
		modHubReleasedLabel,
		modHubURL,
		newestVersion,
		packageMismatchMessage,
		REVIEW_REASON_LABELS,
		reviewReasonLabels,
		SOURCE_LABELS,
		sourceDedupKey,
		sourceInfoFromURL,
		sourceMismatchRisk,
		sourcesForVaultRecord,
		sourceTypeLabel,
		stateSummaryText,
		updateStateLabel,
		vaultRemoteDecision,
		vaultReviewReasons,
		versionParts,
	}
})()
