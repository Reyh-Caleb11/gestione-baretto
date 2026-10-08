# gestione-baretto

Applicazione Node.js con database MySQL.

## Requisiti

- Node.js 20.6 o superiore e npm.
- Docker con Docker Compose, per avviare il database con la configurazione inclusa.

## Configurazione e avvio in locale

1. Clona il repository e spostati nella sua cartella:

   ```sh
   git clone https://github.com/Reyh-Caleb11/gestione-baretto.git
   cd gestione-baretto
   ```
2. Crea il file `.env` copiando il modello:

   ```sh
   cp .env.example .env
   ```

   Il modello usa le credenziali di sviluppo definite in `docker-compose.yml`. Modifica i valori se usi un database MySQL diverso.
3. Avvia MySQL:

   ```sh
   docker compose up -d mysql
   ```

   Attendi che il database sia pronto. Puoi verificarlo con:

   ```sh
   docker compose exec mysql mysqladmin ping -uroot -prootpassword
   ```

   Il comando deve rispondere `mysqld is alive`.
4. Installa le dipendenze e avvia il server:

   ```sh
   npm install
   npm start
   ```

   Al primo avvio il server crea automaticamente le tabelle necessarie nel database.
5. Verifica che il server e il database siano raggiungibili:

   ```sh
   curl http://localhost:3000/health
   ```

   Una risposta corretta è `{"status":"ok","database":"baretto"}`. Il server resta in esecuzione nel terminale; interrompilo con `Ctrl+C`.

Per arrestare MySQL senza eliminare i dati:

```sh
docker compose stop mysql
```

I dati MySQL sono conservati nel volume Docker `mysql_data`.

## Configurazione

Il server legge queste variabili dal file `.env`:

| Variabile | Descrizione | Valore predefinito |
| --- | --- | --- |
| `DB_HOST` | Host del server MySQL | `127.0.0.1` |
| `DB_PORT` | Porta MySQL | `3306` |
| `DB_USER` | Utente MySQL | Nessuno |
| `DB_PASSWORD` | Password MySQL | Nessuno |
| `DB_NAME` | Database da usare | `baretto` |
| `PORT` | Porta HTTP dell'applicazione | `3000` |

`DB_USER` e `DB_PASSWORD` devono essere impostate nel file `.env`. I valori di esempio sono esclusivamente per lo sviluppo locale: sostituiscili con credenziali sicure in ogni ambiente condiviso o di produzione.

## Endpoint disponibile

- `GET /health`: controlla la connessione al database e restituisce lo stato del servizio.

Express serve i file statici dalla cartella `public/`. Il file `docker-compose.yml` avvia solo MySQL; l'applicazione Node.js si avvia separatamente con `npm start`.
