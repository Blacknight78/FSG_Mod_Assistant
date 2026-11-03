function taskSucceeded(result) {
	if ( result === null || result === false ) { return false }
	if ( typeof result !== 'object' ) { return true }
	if ( result.cancelled || result.canceled || result.stopped || result.ok === false || result.error || result.failed > 0 || result.errors > 0 ) { return false }
	if ( Array.isArray(result.errors) && result.errors.length !== 0 ) { return false }
	const items = result.rows ?? result.results ?? []
	return !items.some((item) => item.ok === false || ['Error', 'Failed', 'Cancelled'].includes(item.status))
}
module.exports = { taskSucceeded }
