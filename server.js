const express = require('express');
const mysql = require('mysql2/promise');
const path = require('node:path');

try {
	process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
	if (error.code !== 'ENOENT') {
		throw error;
	}
}

const databaseName = process.env.DB_NAME || 'baretto';
const pool = mysql.createPool({
	host: process.env.DB_HOST || '127.0.0.1',
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: databaseName,
	waitForConnections: true,
	connectionLimit: 10,
});

async function initializeDatabase() {
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
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (request, response) => {
	try {
		await pool.query('SELECT 1');
		response.json({ status: 'ok', database: databaseName });
	} catch (error) {
		response.status(503).json({ status: 'error', database: 'unavailable' });
	}
});

const port = Number(process.env.PORT || 3000);

initializeDatabase()
	.then(() => {
		app.listen(port, () => {
			console.log(`Server avviato sulla porta ${port}`);
		});
	})
	.catch(async (error) => {
		console.error('Errore durante la connessione o inizializzazione del database:', error);
		await pool.end();
		process.exitCode = 1;
	});
