const statuses = {
	in_attesa: {
		container: '#pending-orders',
		count: '#pending-count',
		label: 'In attesa',
	},
	completato: {
		container: '#completed-orders',
		count: '#completed-count',
		label: 'Completato',
	},
	annullato: {
		container: '#cancelled-orders',
		count: '#cancelled-count',
		label: 'Annullato',
	},
};
const refreshStatus = document.querySelector('#refresh-status');
const ordersMessage = document.querySelector('#orders-message');

function renderOrders(orders) {
	for (const status of Object.values(statuses)) {
		const container = document.querySelector(status.container);
		container.replaceChildren();
		document.querySelector(status.count).textContent = '0';
	}

	const groupedOrders = new Map(Object.keys(statuses).map((status) => [status, []]));
	for (const order of orders) {
		if (groupedOrders.has(order.stato)) groupedOrders.get(order.stato).push(order);
	}

	for (const [statusKey, status] of Object.entries(statuses)) {
		const statusOrders = groupedOrders.get(statusKey);
		const container = document.querySelector(status.container);
		document.querySelector(status.count).textContent = String(statusOrders.length);
		if (statusOrders.length === 0) {
			const emptyState = document.createElement('p');
			emptyState.className = 'empty-state';
			emptyState.textContent = 'Nessun ordine.';
			container.append(emptyState);
			continue;
		}

		for (const order of statusOrders) {
			const card = document.createElement('article');
			card.className = 'order-card';
			const number = document.createElement('span');
			number.className = 'order-number';
			number.textContent = `Ordine #${order.id}`;
			const label = document.createElement('span');
			label.className = 'order-state';
			label.textContent = status.label;
			card.append(number, label);
			container.append(card);
		}
	}
}

async function refreshOrders() {
	try {
		const response = await fetch('/api/orders/progress', { cache: 'no-store' });
		const result = await response.json();
		if (!response.ok) throw new Error(result.error || 'Impossibile caricare gli ordini.');
		if (!Array.isArray(result.orders)) throw new Error('La risposta del server non è valida.');

		renderOrders(result.orders);
		ordersMessage.textContent = '';
		refreshStatus.textContent = `Aggiornato alle ${new Intl.DateTimeFormat('it-IT', {
			hour: '2-digit',
			minute: '2-digit',
		}).format(new Date())}`;
	} catch {
		ordersMessage.textContent = 'Stato ordini non disponibile. Riprovo automaticamente.';
		refreshStatus.textContent = 'Connessione non disponibile';
	} finally {
		window.setTimeout(refreshOrders, 15000);
	}
}

refreshOrders();
