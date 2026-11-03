class LiveDownloadPool {
	constructor(limit = 1) { this.limit = limit; this.wake = () => {} }
	setLimit(limit) {
		if ( !Number.isInteger(limit) || limit < 1 || limit > 8 ) { throw new Error('Choose between 1 and 8 parallel downloads.') }
		this.limit = limit
		this.wake()
	}
	run(items, operation) {
		return new Promise((resolve, reject) => {
			let next = 0
			let active = 0
			let failure = null
			const pump = () => {
				while ( !failure && active < this.limit && next < items.length ) {
					const item = items[next++]
					active++
					Promise.resolve().then(() => operation(item)).catch((err) => { failure = err }).finally(() => { active--; pump() })
				}
				if ( active === 0 && (failure || next === items.length) ) {
					this.wake = () => {}
					if ( failure ) { reject(failure) } else { resolve() }
				}
			}
			this.wake = pump
			pump()
		})
	}
}
module.exports = { LiveDownloadPool }
