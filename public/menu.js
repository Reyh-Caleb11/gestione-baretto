const productsGrid = document.querySelector('#product-grid');
const cartItems = document.querySelector('#cart-items');
const cartCount = document.querySelector('#cart-count');
const cartTotal = document.querySelector('#cart-total');
const submitButton = document.querySelector('#submit-order');
const checkoutMessage = document.querySelector('#checkout-message');
const currencyFormatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const cart = new Map();
let products = [];

function cents(value) {
	return Math.round(Number(value) * 100);
}

function productImage(product) {
	const label = product.nome.toLocaleLowerCase('it-IT');
	const specificImages = {
		'acqua naturale': 'https://d3w0qkmdic0cyn.cloudfront.net/assets_thumbnails/prodotti/acque-minerali/san-benedetto/ecogreen/BENEDICTA/image-thumb__7154__slide_box_item_interesse/%402x_Ecogreen_Benedicta_0.5L.png',
		'caffè espresso': 'https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&cs=tinysrgb&w=900',
		cappuccino: 'https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg?auto=compress&cs=tinysrgb&w=900',
		cornetto: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=900&q=82',
		'panino prosciutto e formaggio': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e4/Ham_and_cheese_sandwich_with_salad.jpg/960px-Ham_and_cheese_sandwich_with_salad.jpg',
		'succo d’arancia': 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?auto=format&fit=crop&w=900&q=82',
		'tè freddo al limone': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/ca/Iced_Tea_with_Lemon%2C_First_Watch%2C_Melbourne%2C_Florida.jpg/960px-Iced_Tea_with_Lemon%2C_First_Watch%2C_Melbourne%2C_Florida.jpg',
		'tramezzino vegetariano': 'https://images.unsplash.com/photo-1521390188846-e2a3a97453a0?auto=format&fit=crop&w=900&q=82',
	};
	return specificImages[label] || validImageUrl(product.immagine_url);
}

function validImageUrl(value) {
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

function showMenuMessage(message) {
	const output = document.querySelector('#menu-message');
	output.textContent = message;
	output.hidden = !message;
}

function renderProducts() {
	productsGrid.replaceChildren();
	document.querySelector('#product-count').textContent = `${products.length} ${products.length === 1 ? 'prodotto' : 'prodotti'}`;
	if (products.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'catalog-empty';
		empty.textContent = 'Al momento non ci sono prodotti disponibili.';
		productsGrid.append(empty);
		return;
	}

	for (const product of products) {
		const card = document.createElement('article');
		card.className = 'product-card';
		const image = document.createElement('img');
		image.className = 'product-image';
		const imageUrl = productImage(product);
		if (imageUrl) image.src = imageUrl;
		else image.classList.add('image-unavailable');
		image.alt = product.nome;
		image.loading = 'lazy';
		image.addEventListener('error', () => {
			image.removeAttribute('src');
			image.classList.add('image-unavailable');
		}, { once: true });
		const imageFrame = document.createElement('div');
		imageFrame.className = 'product-photo';
		imageFrame.append(image);
		const label = product.nome.toLocaleLowerCase('it-IT');
		const imageCredits = {
			'tè freddo al limone': {
				href: 'https://commons.wikimedia.org/wiki/File:Iced_Tea_with_Lemon,_First_Watch,_Melbourne,_Florida.jpg',
				text: 'Foto: Pokemonprime · CC BY 4.0',
			},
			'panino prosciutto e formaggio': {
				href: 'https://commons.wikimedia.org/wiki/File:Ham_and_cheese_sandwich_with_salad.jpg',
				text: 'Foto: Peachyeung316 · CC BY-SA 4.0',
			},
		};
		if (imageCredits[label]) {
			const credit = document.createElement('a');
			credit.className = 'photo-credit';
			credit.href = imageCredits[label].href;
			credit.target = '_blank';
			credit.rel = 'noreferrer';
			credit.textContent = imageCredits[label].text;
			imageFrame.append(credit);
		}
		const content = document.createElement('div');
		content.className = 'product-content';
		const name = document.createElement('h3');
		name.textContent = product.nome;
		const description = document.createElement('p');
		description.className = 'product-description';
		description.textContent = product.descrizione || 'Preparato con cura, ogni giorno.';
		const footer = document.createElement('div');
		footer.className = 'product-footer';
		const price = document.createElement('strong');
		price.className = 'product-price';
		price.textContent = currencyFormatter.format(Number(product.prezzo));
		const availability = document.createElement('span');
		availability.className = 'availability';
		availability.textContent = `${product.quantita} disponibili`;
		const addButton = document.createElement('button');
		addButton.className = 'add-button';
		addButton.type = 'button';
		addButton.setAttribute('aria-label', `Aggiungi ${product.nome} al carrello`);
		addButton.textContent = '+';
		addButton.addEventListener('click', () => changeQuantity(product.id, 1));
		footer.append(price, addButton);
		content.append(name, description, availability, footer);
		card.append(imageFrame, content);
		productsGrid.append(card);
	}
}

function changeQuantity(productId, change) {
	const product = products.find((item) => String(item.id) === String(productId));
	if (!product) return;
	const current = cart.get(String(productId)) || 0;
	const next = Math.min(Number(product.quantita), Math.max(0, current + change));
	if (next === 0) cart.delete(String(productId));
	else cart.set(String(productId), next);
	renderCart();
}

function renderCart() {
	cartItems.replaceChildren();
	let itemCount = 0;
	let totalCents = 0;
	for (const [productId, quantity] of cart) {
		const product = products.find((item) => String(item.id) === productId);
		if (!product) continue;
		itemCount += quantity;
		totalCents += cents(product.prezzo) * quantity;
		const row = document.createElement('div');
		row.className = 'cart-item';
		const details = document.createElement('div');
		details.className = 'cart-item-details';
		const name = document.createElement('strong');
		name.textContent = product.nome;
		const subtotal = document.createElement('span');
		subtotal.textContent = currencyFormatter.format(cents(product.prezzo) * quantity / 100);
		details.append(name, subtotal);
		const controls = document.createElement('div');
		controls.className = 'quantity-control';
		const decrease = document.createElement('button');
		decrease.type = 'button';
		decrease.textContent = '−';
		decrease.setAttribute('aria-label', `Rimuovi un ${product.nome}`);
		decrease.addEventListener('click', () => changeQuantity(productId, -1));
		const count = document.createElement('span');
		count.textContent = String(quantity);
		const increase = document.createElement('button');
		increase.type = 'button';
		increase.textContent = '+';
		increase.disabled = quantity >= Number(product.quantita);
		increase.setAttribute('aria-label', `Aggiungi un ${product.nome}`);
		increase.addEventListener('click', () => changeQuantity(productId, 1));
		controls.append(decrease, count, increase);
		row.append(details, controls);
		cartItems.append(row);
	}
	if (itemCount === 0) {
		const empty = document.createElement('p');
		empty.className = 'cart-empty';
		empty.append('Il carrello è vuoto.', document.createElement('br'), 'Aggiungi qualcosa dal menu.');
		cartItems.append(empty);
	}
	cartCount.textContent = String(itemCount);
	cartTotal.textContent = currencyFormatter.format(totalCents / 100);
	submitButton.disabled = itemCount === 0;
}

async function loadProducts() {
	showMenuMessage('');
	productsGrid.setAttribute('aria-busy', 'true');
	try {
		const response = await fetch('/api/menu/products', { cache: 'no-store' });
		const result = await response.json();
		if (!response.ok) throw new Error(result.error || 'Impossibile caricare il menu.');
		products = result.products;
		for (const [productId, quantity] of cart) {
			const product = products.find((item) => String(item.id) === productId);
			if (!product) cart.delete(productId);
			else if (quantity > Number(product.quantita)) cart.set(productId, Number(product.quantita));
		}
		renderProducts();
		renderCart();
	} catch (error) {
		showMenuMessage(error.message);
	} finally {
		productsGrid.setAttribute('aria-busy', 'false');
	}
}

document.querySelector('#checkout-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	if (cart.size === 0) return;
	const form = event.currentTarget;
	submitButton.disabled = true;
	checkoutMessage.textContent = '';
	try {
		const formData = new FormData(form);
		const response = await fetch('/api/menu/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				nome_cliente: formData.get('nome_cliente'),
				metodo_pagamento: formData.get('metodo_pagamento'),
				items: [...cart].map(([prodotto_id, quantita]) => ({ prodotto_id, quantita })),
			}),
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error || 'Non è stato possibile inviare l’ordine.');
		cart.clear();
		form.reset();
		renderCart();
		const confirmation = document.querySelector('#order-confirmation');
		document.querySelector('#confirmation-detail').textContent = `Codice ${result.id} · Totale ${currencyFormatter.format(result.totale)}. Paga al ritiro.`;
		confirmation.hidden = false;
		confirmation.scrollIntoView({ behavior: 'smooth', block: 'center' });
		await loadProducts();
	} catch (error) {
		checkoutMessage.textContent = error.message;
		if (error.message.includes('quantità') || error.message.includes('disponibili')) await loadProducts();
	} finally {
		submitButton.disabled = cart.size === 0;
	}
});

renderCart();
loadProducts();
