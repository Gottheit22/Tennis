# Aufschlag – Tennistraining-Tool

Schüler- & Gruppenverwaltung, wöchentliche Trainingserfassung mit Anwesenheit
und automatische PDF-Rechnungserstellung (eine Seite pro Schüler). Läuft als
echte Webseite mit Datenbank – beides kostenlos über Supabase (Datenbank) und
Vercel (Hosting).

## 1. Supabase-Projekt einrichten

1. Auf [supabase.com](https://supabase.com) ein neues Projekt anlegen (Free Plan).
2. Im Projekt links auf **SQL Editor** → **New query**.
3. Den Inhalt von `sql/schema.sql` (in diesem Ordner) einfügen und **Run** klicken.
   Das legt alle Tabellen (`groups`, `students`, `attendance`, `invoices`, `biller`) an.
4. Links auf **Project Settings → API** gehen. Dort brauchst du gleich zwei Werte:
   - **Project URL**
   - **anon public** Key

## 2. Projekt zu GitHub pushen

1. Neues, leeres Repository auf GitHub anlegen (z. B. `aufschlag-tennis-tool`).
2. In diesem Ordner:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/DEIN-NUTZERNAME/aufschlag-tennis-tool.git
   git push -u origin main
   ```

## 3. Auf Vercel deployen

1. Auf [vercel.com](https://vercel.com) → **Add New → Project** → das GitHub-Repo auswählen.
2. Bei **Environment Variables** zwei Variablen eintragen (Werte aus Schritt 1.4):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. **Deploy** klicken. Nach ca. 1 Minute bekommst du eine Live-URL
   (z. B. `aufschlag-tennis-tool.vercel.app`) – das ist deine fertige Webseite.

Beides (Supabase Free Tier + Vercel Hobby Plan) ist für diesen Anwendungsfall
dauerhaft kostenlos.

## Hinweis zur Sichtbarkeit

Das Tool hat aktuell **keinen Login** – wer den Link kennt, kann die Daten sehen
und bearbeiten. Für ein privates Tool nur für dich reicht das meist, weil die
URL nicht öffentlich beworben wird. Falls du es zusätzlich schützen willst, sag
Bescheid – dann ergänze ich einen einfachen Passwortschutz (z. B. über Vercel)
oder einen echten Login über Supabase Auth.

## Lokal testen (optional)

```bash
npm install
cp .env.local.example .env.local   # Werte aus Schritt 1.4 eintragen
npm run dev
```
Dann [http://localhost:3000](http://localhost:3000) öffnen.
