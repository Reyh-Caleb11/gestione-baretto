const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loadingView = document.querySelector('#loading-view');
const accountBar = document.querySelector('#account-bar');
const loginMessage = document.querySelector('#login-message');
const dashboardMessage = document.querySelector('#dashboard-message');
const currencyFormatter = new Intl.NumberFormat('it-IT', {
	style: 'currency',
	currency: 'EUR',
});

function showLogin(message = '') {
	loginView.hidden = false;
	dashboardView.hidden = true;
	loadingView.hidden = true;
	accountBar.hidden = true;
	loginMessage.textContent = message;
}

function showDashboard(username) {
	loginView.hidden = true;
	dashboardView.hidden = false;
	loadingView.hidden = true;
	accountBar.hidden = false;
	document.querySelector('#account-name').textContent = username;
}

async function request(url, options = {}) {
	const headers = new Headers(options.headers);
	if (options.body) headers.set('Content-Type', 'application/json');
	const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
	const result = await response.json();
	if (response.status === 401 && url !== '/api/auth/login') {
		showLogin('La sessione è scaduta. Accedi di nuovo.');
	}
	if (!response.ok) {
		throw new Error(result.error || 'La richiesta non è riuscita.');
	}
	return result;
}

function setFormMessage(form, message, isError = false) {
	const output = form.querySelector('.form-message');
	output.textContent = message;
	output.classList.toggle('is-error', isError);
	output.classList.toggle('is-success', Boolean(message) && !isError);
}

function addOption(select, value, label, data = {}) {
	const option = document.createElement('option');
	option.value = value;
	option.textContent = label;
	for (const [key, item] of Object.entries(data)) {
		option.dataset[key] = item;
	}
	select.append(option);
}

function renderOrders(orders) {
	const table = document.querySelector('#orders-table');
	table.replaceChildren();
	if (orders.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 5;
		cell.className = 'empty-state';
		cell.textContent = 'Nessun ordine registrato.';
		row.append(cell);
		table.append(row);
		return;
	}

	const statusLabels = {
		in_attesa: 'In attesa',
		completato: 'Completato',
		annullato: 'Annullato',
	};
	for (const order of orders) {
		const row = document.createElement('tr');
		for (const value of [
			order.prodotto,
			order.addetto,
			String(order.quantita),
			currencyFormatter.format(Number(order.prezzo_unitario)),
		]) {
			const cell = document.createElement('td');
			cell.textContent = value;
			row.append(cell);
		}
		const statusCell = document.createElement('td');
		const badge = document.createElement('span');
		badge.className = `status-badge status-${order.stato}`;
		badge.textContent = statusLabels[order.stato] || order.stato;
		statusCell.append(badge);
		row.append(statusCell);
		table.append(row);
	}
}

function updateOrderPrice() {
	const select = document.querySelector('#order-form [name="prodotto_id"]');
	const selected = select.selectedOptions[0];
	const price = selected?.dataset.price;
	document.querySelector('#order-price').textContent = price
		? `Prezzo unitario dal listino: ${currencyFormatter.format(Number(price))}`
		: 'Il prezzo unitario viene preso dal listino.';
}

async function loadDashboard() {
	dashboardMessage.hidden = true;
	try {
		const data = await request('/api/admin/data');
		document.querySelector('#staff-count').textContent = data.counts.personale;
		document.querySelector('#product-count').textContent = data.counts.prodotti;
		document.querySelector('#order-count').textContent = data.counts.ordini;

		const productSelect = document.querySelector('#order-form [name="prodotto_id"]');
		productSelect.replaceChildren();
		addOption(productSelect, '', 'Seleziona un prodotto');
		for (const product of data.prodotti) {
			addOption(productSelect, product.id, product.nome, { price: product.prezzo });
		}

		const staffSelect = document.querySelector('#order-form [name="personale_id"]');
		staffSelect.replaceChildren();
		addOption(staffSelect, '', 'Seleziona una persona');
		for (const person of data.personale) {
			addOption(staffSelect, person.id, `${person.nome} ${person.cognome} · ${person.ruolo}`);
		}
		updateOrderPrice();
		renderOrders(data.ordini);
	} catch (error) {
		if (!loginView.hidden) return;
		dashboardMessage.textContent = error.message;
		dashboardMessage.hidden = false;
		dashboardMessage.classList.add('notice-error');
	}
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	const button = form.querySelector('button[type="submit"]');
	const formData = new FormData(form);
	button.disabled = true;
	loginMessage.textContent = '';
	try {
		const result = await request('/api/auth/login', {
			method: 'POST',
			body: JSON.stringify({
				username: formData.get('username'),
				password: formData.get('password'),
			}),
		});
		form.reset();
		showDashboard(result.username);
		await loadDashboard();
	} catch (error) {
		loginMessage.textContent = error.message;
	} finally {
		button.disabled = false;
	}
});

for (const form of document.querySelectorAll('form[data-endpoint]')) {
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const button = form.querySelector('button[type="submit"]');
		const formData = new FormData(form);
		const payload = Object.fromEntries(formData.entries());
		for (const input of form.querySelectorAll('input[type="number"]')) {
			payload[input.name] = Number(formData.get(input.name));
		}

		button.disabled = true;
		setFormMessage(form, '');
		try {
			const result = await request(form.dataset.endpoint, {
				method: 'POST',
				body: JSON.stringify(payload),
			});
			form.reset();
			setFormMessage(form, result.message);
			updateOrderPrice();
			await loadDashboard();
		} catch (error) {
			setFormMessage(form, error.message, true);
		} finally {
			button.disabled = false;
		}
	});
}

document.querySelector('#order-form [name="prodotto_id"]').addEventListener('change', updateOrderPrice);

document.querySelector('#logout-button').addEventListener('click', async () => {
	try {
		await request('/api/auth/logout', { method: 'POST' });
		showLogin();
	} catch (error) {
		dashboardMessage.textContent = error.message;
		dashboardMessage.hidden = false;
		dashboardMessage.classList.add('notice-error');
	}
});

async function restoreSession() {
	try {
		const result = await request('/api/auth/session');
		if (!result.authenticated) {
			showLogin();
			return;
		}
		showDashboard(result.username);
		await loadDashboard();
	} catch {
		showLogin('Impossibile contattare il server. Riprova tra poco.');
	}
}

restoreSession();
