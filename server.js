const express = require('express');
const mysql = require('mysql2/promise');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

try {
	process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
	if (error.code !== 'ENOENT') {
		throw error;
	}
}

const scrypt = promisify(crypto.scrypt);
const databaseName = process.env.DB_NAME || 'baretto';
const sessionCookieName = 'baretto_admin';
const sessionLifetimeSeconds = 8 * 60 * 60;
const loginLimit = 5;
const loginWindowMs = 15 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
let dummyPasswordHash;
const pool = mysql.createPool({
	host: process.env.DB_HOST || '127.0.0.1',
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: databaseName,
	waitForConnections: true,
	connectionLimit: 10,
});

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

async function hashPassword(password) {
	const salt = crypto.randomBytes(16);
	const key = await scrypt(password, salt, 64);
	return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, passwordHash) {
	const [algorithm, saltHex, keyHex] = passwordHash.split('$');
	if (algorithm !== 'scrypt' || !/^[\da-f]{32}$/i.test(saltHex || '') || !/^[\da-f]{128}$/i.test(keyHex || '')) {
		return false;
	}

	const expectedKey = Buffer.from(keyHex, 'hex');
	const actualKey = await scrypt(password, Buffer.from(saltHex, 'hex'), expectedKey.length);
	return crypto.timingSafeEqual(expectedKey, actualKey);
}

async function initializeDatabase() {
	if (Buffer.byteLength(process.env.SESSION_SECRET || '') < 32) {
		throw new Error('Configura SESSION_SECRET con almeno 32 caratteri casuali.');
	}

	await pool.query(`
		CREATE TABLE IF NOT EXISTS personale (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			nome VARCHAR(100) NOT NULL,
			cognome VARCHAR(100) NOT NULL,
			ruolo VARCHAR(100) NOT NULL,
			email VARCHAR(255) UNIQUE,
			creato_il TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	await pool.query(`
		CREATE TABLE IF NOT EXISTS prodotti (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			nome VARCHAR(150) NOT NULL,
			descrizione TEXT,
			prezzo DECIMAL(10, 2) NOT NULL,
			quantita INT UNSIGNED NOT NULL DEFAULT 0,
			creato_il TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT chk_prodotti_prezzo CHECK (prezzo >= 0)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	await pool.query(`
		CREATE TABLE IF NOT EXISTS ordini (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			prodotto_id BIGINT UNSIGNED NOT NULL,
			personale_id BIGINT UNSIGNED NOT NULL,
			quantita INT UNSIGNED NOT NULL DEFAULT 1,
			prezzo_unitario DECIMAL(10, 2) NOT NULL,
			stato ENUM('in_attesa', 'completato', 'annullato') NOT NULL DEFAULT 'in_attesa',
			creato_il TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT chk_ordini_quantita CHECK (quantita > 0),
			CONSTRAINT chk_ordini_prezzo CHECK (prezzo_unitario >= 0),
			CONSTRAINT fk_ordini_prodotto FOREIGN KEY (prodotto_id)
				REFERENCES prodotti (id) ON UPDATE CASCADE ON DELETE RESTRICT,
			CONSTRAINT fk_ordini_personale FOREIGN KEY (personale_id)
				REFERENCES personale (id) ON UPDATE CASCADE ON DELETE RESTRICT
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	await pool.query(`
		CREATE TABLE IF NOT EXISTS admin_accounts (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
			username VARCHAR(100) NOT NULL UNIQUE,
			password_hash VARCHAR(255) NOT NULL,
			creato_il TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	`);

	const [[{ accountCount }]] = await pool.query('SELECT COUNT(*) AS accountCount FROM admin_accounts');
	if (accountCount === 0) {
		const username = (process.env.ADMIN_USERNAME || '').trim();
		const password = process.env.ADMIN_PASSWORD || '';
		if (!username || username.length > 100 || password.length < 12) {
			throw new Error(
				'Per creare il primo Admin, configura ADMIN_USERNAME e una ADMIN_PASSWORD di almeno 12 caratteri.',
			);
		}

		await pool.execute(
			'INSERT INTO admin_accounts (username, password_hash) VALUES (?, ?)',
			[username, await hashPassword(password)],
		);
		console.log('Account Admin iniziale creato.');
	}

	dummyPasswordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
}

function createSessionToken(sessionId, expiresAt) {
	const payload = Buffer.from(JSON.stringify({ sessionId, expiresAt })).toString('base64url');
	const signature = crypto
		.createHmac('sha256', process.env.SESSION_SECRET)
		.update(payload)
		.digest('base64url');
	return `${payload}.${signature}`;
}

function getCookie(request, name) {
	const cookieHeader = request.headers.cookie;
	if (!cookieHeader) return null;

	for (const cookie of cookieHeader.split(';')) {
		const separator = cookie.indexOf('=');
		if (separator >= 0 && cookie.slice(0, separator).trim() === name) {
			return cookie.slice(separator + 1).trim();
		}
	}
	return null;
}

function readSession(request) {
	const token = getCookie(request, sessionCookieName);
	if (!token) return null;

	const [payload, signature, extra] = token.split('.');
	if (!payload || !signature || extra !== undefined) return null;

	const expectedSignature = crypto
		.createHmac('sha256', process.env.SESSION_SECRET)
		.update(payload)
		.digest('base64url');
	const received = Buffer.from(signature);
	const expected = Buffer.from(expectedSignature);
	if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

	try {
		const { sessionId, expiresAt } = JSON.parse(Buffer.from(payload, 'base64url').toString());
		const session = sessions.get(sessionId);
		if (!session || session.expiresAt !== expiresAt || expiresAt <= Date.now()) {
			sessions.delete(sessionId);
			return null;
		}
		return session;
	} catch {
		return null;
	}
}

function setSessionCookie(response, token) {
	const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
	response.setHeader(
		'Set-Cookie',
		`${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeSeconds}${secure}`,
	);
}

function clearSessionCookie(response) {
	const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
	response.setHeader(
		'Set-Cookie',
		`${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
	);
}

function requireAdmin(request, response, next) {
	const session = readSession(request);
	if (!session) {
		return response.status(401).json({ error: 'Accedi con un account Admin per continuare.' });
	}
	request.admin = session;
	next();
}

function getLoginAttempt(ip) {
	const now = Date.now();
	for (const [address, attempt] of loginAttempts) {
		if (attempt.resetAt <= now) loginAttempts.delete(address);
	}

	const attempt = loginAttempts.get(ip);
	if (attempt && attempt.resetAt > now && attempt.count >= loginLimit) {
		return Math.ceil((attempt.resetAt - now) / 1000);
	}
	return 0;
}

function recordFailedLogin(ip) {
	const now = Date.now();
	const attempt = loginAttempts.get(ip);
	if (!attempt || attempt.resetAt <= now) {
		loginAttempts.set(ip, { count: 1, resetAt: now + loginWindowMs });
	} else {
		attempt.count += 1;
	}
}

function requestBody(request) {
	if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
		throw new HttpError(400, 'Il corpo della richiesta non è valido.');
	}
	return request.body;
}

function requiredText(value, label, maxLength) {
	if (typeof value !== 'string') {
		throw new HttpError(400, `Il campo ${label} è obbligatorio.`);
	}
	const text = value.trim();
	if (!text || text.length > maxLength) {
		throw new HttpError(400, `Il campo ${label} deve contenere da 1 a ${maxLength} caratteri.`);
	}
	return text;
}

function optionalText(value, label, maxLength) {
	if (value === undefined || value === null || value === '') return null;
	return requiredText(value, label, maxLength);
}

function numberValue(value, label, { min, max, integer = false }) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
		throw new HttpError(400, `Il campo ${label} non è valido.`);
	}
	if (integer && !Number.isInteger(value)) {
		throw new HttpError(400, `Il campo ${label} deve essere un numero intero.`);
	}
	return value;
}

function numericId(value, label) {
	if (!(typeof value === 'number' || typeof value === 'string') || !/^[1-9]\d*$/.test(String(value))) {
		throw new HttpError(400, `Seleziona ${label}.`);
	}
	return String(value);
}

const app = express();
app.disable('x-powered-by');
app.use((request, response, next) => {
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('X-Frame-Options', 'DENY');
	response.setHeader('Referrer-Policy', 'same-origin');
	next();
});
app.use(express.json({ limit: '32kb' }));
app.get('/style.css', (request, response) => {
	response.sendFile(path.join(__dirname, 'style.css'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (request, response) => {
	try {
		await pool.query('SELECT 1');
		response.json({ status: 'ok', database: databaseName });
	} catch (error) {
		console.error('Controllo health del database non riuscito:', error);
		response.status(503).json({ status: 'error', database: 'unavailable' });
	}
});

app.get('/api/auth/session', (request, response) => {
	const session = readSession(request);
	if (!session) return response.json({ authenticated: false });
	return response.json({ authenticated: true, username: session.username });
});

app.post('/api/auth/login', async (request, response) => {
	const retryAfter = getLoginAttempt(request.ip);
	if (retryAfter > 0) {
		response.setHeader('Retry-After', String(retryAfter));
		return response.status(429).json({ error: 'Troppi tentativi. Riprova più tardi.' });
	}

	const body = requestBody(request);
	const username = typeof body.username === 'string' ? body.username.trim() : '';
	const password = typeof body.password === 'string' ? body.password : '';
	if (!username || !password || username.length > 100 || password.length > 1024) {
		recordFailedLogin(request.ip);
		return response.status(401).json({ error: 'Nome utente o password non validi.' });
	}

	const [accounts] = await pool.execute(
		'SELECT username, password_hash FROM admin_accounts WHERE username = ? LIMIT 1',
		[username],
	);
	const account = accounts[0];
	const isValid = await verifyPassword(password, account ? account.password_hash : dummyPasswordHash);
	if (!account || !isValid) {
		recordFailedLogin(request.ip);
		return response.status(401).json({ error: 'Nome utente o password non validi.' });
	}

	loginAttempts.delete(request.ip);
	const now = Date.now();
	for (const [activeSessionId, activeSession] of sessions) {
		if (activeSession.expiresAt <= now) sessions.delete(activeSessionId);
	}
	const sessionId = crypto.randomBytes(32).toString('base64url');
	const expiresAt = now + sessionLifetimeSeconds * 1000;
	sessions.set(sessionId, { sessionId, username: account.username, expiresAt });
	setSessionCookie(response, createSessionToken(sessionId, expiresAt));
	response.json({ authenticated: true, username: account.username });
});

app.post('/api/auth/logout', requireAdmin, (request, response) => {
	sessions.delete(request.admin.sessionId);
	clearSessionCookie(response);
	response.json({ authenticated: false });
});

app.get('/api/admin/data', requireAdmin, async (request, response) => {
	const [[personale], [prodotti], [ordini], [counts]] = await Promise.all([
		pool.query('SELECT id, nome, cognome, ruolo, email FROM personale ORDER BY cognome, nome'),
		pool.query('SELECT id, nome, prezzo, quantita FROM prodotti ORDER BY nome'),
		pool.query(`
			SELECT o.id, p.nome AS prodotto, CONCAT(s.nome, ' ', s.cognome) AS addetto,
				o.quantita, o.prezzo_unitario, o.stato, o.creato_il
			FROM ordini o
			INNER JOIN prodotti p ON p.id = o.prodotto_id
			INNER JOIN personale s ON s.id = o.personale_id
			ORDER BY o.creato_il DESC, o.id DESC
			LIMIT 50
		`),
		pool.query(`
			SELECT
				(SELECT COUNT(*) FROM personale) AS personale,
				(SELECT COUNT(*) FROM prodotti) AS prodotti,
				(SELECT COUNT(*) FROM ordini) AS ordini
		`),
	]);
	response.json({ personale, prodotti, ordini, counts });
});

app.post('/api/admin/personale', requireAdmin, async (request, response) => {
	const body = requestBody(request);
	const nome = requiredText(body.nome, 'nome', 100);
	const cognome = requiredText(body.cognome, 'cognome', 100);
	const ruolo = requiredText(body.ruolo, 'ruolo', 100);
	const email = optionalText(body.email, 'email', 255);
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new HttpError(400, 'Inserisci un indirizzo email valido.');
	}

	const [result] = await pool.execute(
		'INSERT INTO personale (nome, cognome, ruolo, email) VALUES (?, ?, ?, ?)',
		[nome, cognome, ruolo, email],
	);
	response.status(201).json({ id: result.insertId, message: 'Persona aggiunta.' });
});

app.post('/api/admin/prodotti', requireAdmin, async (request, response) => {
	const body = requestBody(request);
	const nome = requiredText(body.nome, 'nome prodotto', 150);
	const descrizione = optionalText(body.descrizione, 'descrizione', 60000);
	if (descrizione && Buffer.byteLength(descrizione, 'utf8') > 65535) {
		throw new HttpError(400, 'La descrizione supera la lunghezza massima consentita.');
	}
	const prezzo = numberValue(body.prezzo, 'prezzo', { min: 0, max: 99999999.99 });
	const quantita = numberValue(body.quantita, 'quantità', { min: 0, max: 4294967295, integer: true });
	const [result] = await pool.execute(
		'INSERT INTO prodotti (nome, descrizione, prezzo, quantita) VALUES (?, ?, ?, ?)',
		[nome, descrizione, Number(prezzo.toFixed(2)), quantita],
	);
	response.status(201).json({ id: result.insertId, message: 'Prodotto aggiunto.' });
});

app.post('/api/admin/ordini', requireAdmin, async (request, response) => {
	const body = requestBody(request);
	const prodottoId = numericId(body.prodotto_id, 'un prodotto');
	const personaleId = numericId(body.personale_id, 'un addetto');
	const quantita = numberValue(body.quantita, 'quantità', { min: 1, max: 4294967295, integer: true });
	const statiValidi = ['in_attesa', 'completato', 'annullato'];
	const stato = body.stato === undefined ? 'in_attesa' : body.stato;
	if (!statiValidi.includes(stato)) {
		throw new HttpError(400, 'Lo stato dell’ordine non è valido.');
	}

	const [[products], [staff]] = await Promise.all([
		pool.execute('SELECT prezzo FROM prodotti WHERE id = ? LIMIT 1', [prodottoId]),
		pool.execute('SELECT id FROM personale WHERE id = ? LIMIT 1', [personaleId]),
	]);
	if (!products[0] || !staff[0]) {
		throw new HttpError(400, 'Il prodotto o l’addetto selezionato non esiste più.');
	}

	const [result] = await pool.execute(
		'INSERT INTO ordini (prodotto_id, personale_id, quantita, prezzo_unitario, stato) VALUES (?, ?, ?, ?, ?)',
		[prodottoId, personaleId, quantita, products[0].prezzo, stato],
	);
	response.status(201).json({ id: result.insertId, message: 'Ordine aggiunto.' });
});

app.use((error, request, response, next) => {
	if (response.headersSent) return next(error);
	if (error instanceof HttpError) {
		return response.status(error.status).json({ error: error.message });
	}
	if (error.code === 'ER_DUP_ENTRY') {
		return response.status(409).json({ error: 'Esiste già un record con gli stessi dati univoci.' });
	}
	if (error.code === 'ER_NO_REFERENCED_ROW_2') {
		return response.status(409).json({ error: 'Uno dei record selezionati non è più disponibile.' });
	}
	if (error.status === 400 && error.type === 'entity.parse.failed') {
		return response.status(400).json({ error: 'Il JSON inviato non è valido.' });
	}
	if (error.status === 413) {
		return response.status(413).json({ error: 'La richiesta è troppo grande.' });
	}
	console.error('Errore durante la richiesta:', error);
	return response.status(500).json({ error: 'Si è verificato un errore interno. Riprova.' });
});

const port = Number(process.env.PORT || 3000);

initializeDatabase()
	.then(() => {
		app.listen(port, () => {
			console.log(`Server avviato sulla porta ${port}`);
		});
	})
	.catch(async (error) => {
		console.error('Errore durante la configurazione o inizializzazione del database:', error);
		await pool.end();
		process.exitCode = 1;
	});
