# CC-Mazout — Belgische Mazoutprijzen & Trends

Zie `Opdracht_Mazout_Prices_Trends.md` voor de volledige achtergrond, scope en architectuurkeuzes.

## Structuur

```
app/
  page.jsx              → de dashboard-pagina (client component)
  layout.js             → verplichte root layout (Next.js App Router)
  api/prices/route.js   → leest historiek uit Postgres voor de frontend
lib/db.js               → databasehelper (pg)
scripts/
  fetch_prices.py        → dagelijks ophaalscript (yfinance + FOD-scrape)
  requirements.txt
sql/schema.sql            → tabeldefinitie voor de Neon-database (via Vercel Storage-integratie)
.github/workflows/
  fetch-prices.yml         → GitHub Actions-cron die fetch_prices.py dagelijks draait
```

## Opzet — stap voor stap

1. **Neon-database aanmaken (via Vercel Storage)**
   In het Vercel-dashboard: *Storage → Create Database → Postgres (Neon)*. Koppel de database
   aan dit project — Vercel zet dan automatisch de `DATABASE_URL`-omgevingsvariabele.

2. **Schema toepassen**
   Voer `sql/schema.sql` uit tegen die database (via de query-editor in het Vercel Storage-dashboard,
   of lokaal met `psql "$DATABASE_URL" -f sql/schema.sql`).

3. **GitHub secret instellen**
   In de GitHub-repo: *Settings → Secrets and variables → Actions → New repository secret*,
   naam `DATABASE_URL`, waarde = dezelfde connectiestring als in Vercel.

4. **Eenmalige historische backfill**
   Tabblad *Actions* → workflow "Prijzen ophalen" → *Run workflow* → job `backfill_statbel`
   kiezen. Haalt ±365 dagen historiek op uit Statbel's officiële databank (bestat.statbel.fgov.be)
   voor beide FOD-tarieven (>=2000L en <2000L).

5. **Domein koppelen**
   In Vercel: *Project → Settings → Domains → Add* → `mazoutpricetrends.eu`. Vercel toont dan
   de A/CNAME-records die je bij je hostingprovider instelt.

6. **Dagelijkse job testen**
   Zelfde *Actions*-tabblad → *Run workflow* → job `daily` (of wacht op de cron om 19:00 UTC).
   Vult vanaf dan telkens de nieuwste dag aan via `petrolprices.economie.fgov.be`.

7. **Lokaal draaien**
   ```
   npm install
   npm run dev
   ```
   Zolang er nog geen data in Postgres staat, valt de pagina automatisch terug op
   voorbeelddata (duidelijk gemarkeerd met een banner).

## Databronnen

- **Historische FOD-prijzen (eenmalig)**: Statbel bestat-databank, JSON-export —
  officiële overheidsdata, incl. vandaag: zie `scripts/backfill_statbel.py`.
- **Dagelijkse FOD-prijs (doorlopend)**: `petrolprices.economie.fgov.be` — toont telkens het
  net-geldige tarief (>=2000L en <2000L), HTML-scrape via `scripts/fetch_prices.py`.
- **Markttrend**: yfinance (`HO=F`, `CL=F`, `EURUSD=X`) — gratis, niet-officieel, met retries
  bij een 429.

## Nog open (zie opdrachtdocument, §5)

- Custom "van–tot"-periodeselectie in de trendgrafiek (nu enkel 30D/90D).
- `ROW_PATTERN` in `fetch_prices.py` is gebaseerd op de Franse paginatekst zoals vandaag
  bekeken; als de NL-versie van de pagina afwijkt of FOD de opmaak wijzigt, moet dit bijgesteld
  worden — de foutmelding in de Actions-log maakt dat direct zichtbaar.
