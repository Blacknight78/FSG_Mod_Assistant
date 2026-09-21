/* global DATA */
window.DetailImagePreview = (() => {
	let dialog = null
	let items = []
	let index = 0
	const render = () => {
		const item = items[index]
		dialog.querySelector('h2').textContent = item.name || 'Image preview'
		dialog.querySelector('[data-caption]').textContent = `${index + 1} of ${items.length}`
		const image = dialog.querySelector('img')
		image.alt = item.name || 'Image preview'
		image.src = item.url ?? DATA.iconMaker(item.icon)
		dialog.querySelector('[data-previous]').disabled = index === 0
		dialog.querySelector('[data-next]').disabled = index === items.length - 1
	}
	const move = (offset) => {
		index = Math.max(0, Math.min(items.length - 1, index + offset))
		render()
	}
	return {
		open(previews, selectedIndex = 0) {
			if ( !Array.isArray(previews) || previews.length === 0 ) { return }
			if ( dialog === null ) {
				dialog = document.createElement('dialog')
				dialog.className = 'detail-image-dialog'
				dialog.setAttribute('aria-labelledby', 'detailImageTitle')
				dialog.innerHTML = '<header><div><h2 id="detailImageTitle" class="h4 mb-0"></h2><div data-caption class="small text-secondary"></div></div><button data-close type="button" class="btn btn-outline-secondary">Close</button></header><div class="detail-image-content"><button data-previous type="button" class="btn btn-outline-secondary" aria-label="Previous image">&#8249;</button><img alt="" draggable="false"><button data-next type="button" class="btn btn-outline-secondary" aria-label="Next image">&#8250;</button></div>'
				dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close())
				dialog.querySelector('[data-previous]').addEventListener('click', () => move(-1))
				dialog.querySelector('[data-next]').addEventListener('click', () => move(1))
				dialog.addEventListener('keydown', (event) => {
					if ( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) {
						event.preventDefault()
						move(event.key === 'ArrowLeft' ? -1 : 1)
					}
				})
				dialog.addEventListener('close', () => {
					dialog.querySelector('img').removeAttribute('src')
					items = []
				})
				document.body.appendChild(dialog)
			}
			items = previews
			index = Math.max(0, Math.min(items.length - 1, selectedIndex))
			render()
			if ( !dialog.open ) { dialog.showModal() }
		},
	}
})()
