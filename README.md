# WelfareCare · CRM Telemarketing

Gestione di liste, chiamate e appuntamenti per gli incaricati WelfareCare.
Stack: Next.js 16 + Supabase + Vercel (come il Gestionale Territori).

## Tappa 1 — cosa c'è

- Accesso con email e password; ruoli **Amministratore, Direzione, Operatore, Incaricato**
- Ognuno vede **solo le campagne assegnate** (regole nel database, non solo nelle schermate)
- **Centro di controllo** (solo amministratore): utenti, ruoli, campagne visibili, funzioni sbloccabili, disattivazione, spazio database, registro attività
- **Campagne** per comune ed edizione, con composizione della lista: edizione precedente, comune, comuni limitrofi, aggiunta libera, esclusioni automatiche
- **Import** CSV/Excel: abbinamento colonne, controllo doppioni (P.IVA e telefono), prova pilota su 200 righe
- **Coda chiamate**: richiami → aziende nuove → ritentativi; 12 esiti; appuntamento con controllo sovrapposizioni
- **Scheda azienda**: anagrafica, referenti, storico per edizione, cronologia di ogni modifica
- **Appuntamenti**: vista per l'incaricato (anche da telefono) con esito incontro e contratto

Tappa 2: Google Calendar e mail di conferma. Tappa 3: Gemini e report della direzione.

---

## Messa online (una volta sola)

### 1. Supabase
1. Nuovo progetto, regione **Central EU (Frankfurt)**.
2. **SQL Editor** → incolla tutto `supabase/setup_completo.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: disattiva **Allow new users to sign up** (gli utenti li crea solo l'amministratore).
4. **Authentication → Users → Add user → Create new user**: la tua email e una password, spunta **Auto Confirm User**.
5. **SQL Editor** → esegui `supabase/04_primo_admin.sql` (con la tua email): diventi amministratore.
6. **Authentication → Providers → Email**: lunghezza minima password **12**, requisiti **lettere minuscole, maiuscole e numeri**.
7. Al primo accesso l'app chiede di attivare la **doppia verifica** (obbligatoria per amministratore e direzione).

### 2. Vercel
1. **Add New → Project** → importa il repository GitHub.
2. **Environment Variables** (valori da Supabase → Project Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` ← segreta, serve solo al Centro di controllo
3. **Deploy**, poi **Settings → Domains** → es. `telemarketing.welfarecare.org`.
4. Torna su Supabase → **Authentication → URL Configuration** → **Site URL** = il dominio scelto.

### 3. Backup settimanale (gratuito)
1. Supabase → **Connect** → copia la stringa **Session pooler** (con la password del database).
2. GitHub → repository → **Settings → Secrets and variables → Actions → New repository secret**:
   nome `SUPABASE_DB_URL`, valore la stringa copiata.
3. GitHub → **Actions → Backup database → Run workflow** per provarlo subito.
   I backup restano scaricabili 90 giorni dalla pagina del singolo run.

---

## Primo test consigliato (pilota)
1. Centro di controllo → crea un operatore e un incaricato (password temporanea da comunicare a voce).
2. Campagne → nuova campagna (es. Castelfranco Veneto · 2027).
3. Importa lista → **prova pilota 200 righe** dentro la campagna.
4. Centro di controllo → assegna la campagna all'operatore; imposta la campagna **In corso**.
5. Entra come operatore → Coda chiamate.

## Sviluppo locale
```
cp .env.example .env.local   # e compila i valori
npm install
npm run dev
```

---

## Tappa 2 · Google Calendar (account aziendali welfarecare.org)

Il CRM scrive gli appuntamenti nel calendario dell'incaricato e ne legge le disponibilità,
tramite un **account di servizio** con **delega a livello di dominio** (solo calendario).

Variabili su Vercel: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (Sensitive).
Permessi da autorizzare nella Console di amministrazione Google:
`https://www.googleapis.com/auth/calendar.events.owned,https://www.googleapis.com/auth/calendar.freebusy`
