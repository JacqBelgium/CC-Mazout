# Opdracht: Belgian "Mazout" Prices & Trends

**Status:** startpunt voor review — prototype beschikbaar, databronnen nog te bevestigen
**Datum:** 24 augustus 2026

---

## 1. Doel

Een webpagina die de officiële Belgische mazoutprijs (stookolie) dagelijks toont, samen met de
onderliggende marktbeweging (ruwe olie, HO=F-future) en de prijsopbouw. Focus op **prijs en trend**,
geen leveranciersvergelijking of bestelfunctie.

**Doelgroep:** Belgische huishoudens die hun mazoutaankoop willen timen op basis van prijsevolutie.

---

## 2. Scope (op basis van het prototype)

### 2.1 Drie prijselementen
1. **Marktprijs ruwe stookolie** (excl. tax) — afgeleid van futures-markt
2. **Officiële maximumprijs** (FOD/SPF Finance) — wettelijk plafond voor consumenten, dagelijks
   berekend op basis van de voorgaande dag
3. **Geschatte prijs** — eigen onafhankelijke inschatting, incl. impact bij bestellingen > 2000 L

### 2.2 Prijsopbouw & specificatie
Per liter, in tekst en grafisch (gestapelde balk) — **definitieve verdeling, opgezocht door opdrachtgever:**

| Component | €/L |
|---|---|
| Productprijs/markt | 0,90 |
| Distributiemarge | 0,20 |
| Accijnzen/energieheffing (incl. overige bijdragen) | 0,28 |
| **Subtotaal (excl. BTW)** | **1,38** |
| BTW (21%) | 0,29 |
| **Totaal (FOD-maximumprijs)** | **1,67** |

*Oorspronkelijke "Overige bijdragen" (0,03) is samengevoegd met Accijnzen/energieheffing,
zoals voorgesteld.*

### 2.3 Trendgrafiek
- Periodeselectie: laatste 30 dagen / 90 dagen / vrije van–tot
- Twee weergaves:
  - **Prijsniveau (€/L)** — absolute waarden
  - **Beweging t.o.v. elkaar (%)** — alle reeksen geïndexeerd naar 100 bij start van de periode,
    zodat je marktprijs, HO=F en FOD-prijs kan vergelijken ondanks verschillende eenheden (USD/vat
    vs USD/gallon vs €/L)
- "Ruwe data"-optie: volledige historische tabel raadpleegbaar

### 2.4 Nadrukkelijk buiten scope
- Geen leverancierslijst of leveringsprijzen
- Geen bestelfunctie

---

## 3. Databronnen

### 3.1 Marktprijs ruwe olie / stookolie-future — **yfinance**
- Gratis, open-source Python-package (`pip install yfinance`), haalt data via Yahoo Finance's
  publieke (niet-officiële) endpoints. Gebruik is niet-commercieel — geen betaalde toegang tot de
  webpagina, dus geen probleem met Yahoo's "personal/non-commercial use"-voorwaarden.
- Relevante tickers:
  - `HO=F` — NY Harbor ULSD futures (NYMEX), notering in **USD/gallon**. Dichtstbijzijnde vrije
    proxy voor stookolie; niet identiek aan Europese gasolie (ICE Gasoil/Rotterdam-barges, betaald).
  - `CL=F` (WTI) of `BZ=F` (Brent) — ruwe olie, notering in **USD/vat**.
- **Welk moment / welke koers:**
  - Eén slotkoers per dag, niet meerdere intraday-punten — de FOD-prijs is zelf ook maar één
    dagcijfer, dus extra granulariteit voegt geen echte precisie toe.
  - Het officiële CME-settlement voor beide futures valt in het venster **14:28–14:30 ET**, wat
    omgerekend **±20:30 Belgische tijd** is (niet 17:30) — dat is het moment waarop de "close"
    effectief wordt vastgelegd (VWAP over die 2 minuten).
  - Gebruik de dagelijkse slotkoers (`yfinance` interval `1d`, "Close"), die dit settlement al
    reflecteert — geen aparte snapshot-logica nodig.
  - **Timing van de dagelijkse job:** laat die pas na ±21:00–22:00 Belgische tijd draaien, zodat
    het settlement al verwerkt is in Yahoo's data. Eerder ophalen (bv. 17:30) geeft een nog niet
    afgesloten/voorlopige koers.
- **Kanttekeningen:**
  - Geen officiële API — Yahoo kan structuur wijzigen, package kan tijdelijk breken.
  - Vereist eigen omrekening: USD → EUR (wisselkoers) en gallon/vat → liter.

### 3.2 Officiële FOD-maximumprijs — twee bronnen, één traject
- **Eenmalige historische backfill**: Statbel's bestat-databank (`bestat.statbel.fgov.be`)
  publiceert een directe JSON/CSV-export met de officiële dagprijzen, terug tot 365 dagen,
  inclusief vandaag. Bevat exact de twee tarieven die we nodig hebben:
  "Gasolie verwarming (H0/H7) (vanaf 2000 l)" en "(minder dan 2000 l)".
- **Dagelijkse aanvulling**: `petrolprices.economie.fgov.be` toont steeds het actueel geldige
  tarief (dezelfde twee varianten, in het Frans "Gasoil chauffage (H0/H7)"), maar heeft geen
  eigen historiek — vandaar de scrape voor alleen de nieuwste dag, dagelijks.
- brafco.be en energiafed.be hebben ook databanken, maar lopen niet gelijk met vandaag —
  daarom niet gebruikt.
- **Twee tarieven, geen één**: de officiële prijs hangt af van het bestelvolume (>=2000L vs
  <2000L) — sluit aan bij het "Impact >2000 liters"-punt uit het oorspronkelijke voorstel.

### 3.3 Wisselkoers (EUR/USD)
Via yfinance (`EURUSD=X`), zelfde package/structuur als de andere marktdata — geen aparte bron nodig.

---

## 4. Voorgestelde architectuur

1. **Dagelijkse scheduled job** (bv. cronjob) die:
   - `yfinance` bevraagt voor HO=F, WTI/Brent en EUR/USD
   - de FOD-pagina/PDF scraped voor de officiële maximumprijs
2. **Eigen database** om historiek op te bouwen — geen van beide bronnen levert zelf een kant-en-klare
   EUR/L-tijdreeks, dus die historiek moet zelf worden opgeslagen vanaf het moment van lancering.
3. **Backend/API-laag** die de opgeslagen data ontsluit naar de webpagina (huidige prototype werkt
   met mock data die deze structuur al volgt).
4. **Frontend**: prototype beschikbaar (`mazout_dashboard.jsx`) — LED-prijzenbord hero, 3
   prijselement-kaarten, prijsopbouw-balk, trendgrafiek met niveau/index-toggle, ruwe-datatabel.

---

## 5. Open punten

- [x] ~~Marge & accijnzen splitsen in 2 aparte componenten~~ — ingevuld, zie 2.2
- [x] ~~Hosting/deployment-keuze~~ — Vercel (Hobby, gratis, niet-commercieel), 4e project naast
      de bestaande 3
- [x] ~~Formule/factor voor de koppeling ruwe olie → HO=F → FOD-prijs~~ — prototype gebruikt
      raffinagemarge + 1-dag vertraging als benadering, te verfijnen zodra live data er is
- [x] ~~Bron voor EUR/USD-koers~~ — via yfinance, ticker `EURUSD=X` (zelfde package/structuur)
- [x] ~~Scraping-aanpak FOD Economie~~ — HTML-pagina parsen (`petrolprices.economie.fgov.be`),
      niet de PDF (stabielere opmaak)
- [ ] Custom "van–tot" periodeselectie (nu placeholder in prototype) — enige overblijvende punt
- [x] ~~DNS-locatie mazoutpricetrends.eu~~ — via hostingprovider (niet Cloudflare); niet-gerelateerd
      pickmynumers.eu loopt wel via Cloudflare, historische reden onbekend
- [x] ~~Historische data-opslag~~ — Vercel Postgres, bevestigd
- [x] ~~Juridische check yfinance-gebruiksvoorwaarden~~ — niet van toepassing, gratis/niet-commercieel

Met dit laatste punt is de architectuur volledig bepaald — klaar om de repo op te zetten.

---

## 4.1 Architectuur — technische invulling

1. **Data ophalen (dagelijks, 1x) — GitHub Actions:**
   - Scheduled workflow (`schedule: cron`) in de GitHub-repo, Python-script
   - `yfinance`: `HO=F`, `CL=F` (WTI) of `BZ=F` (Brent), `EURUSD=X`
   - HTML-scrape van `petrolprices.economie.fgov.be` voor de officiële FOD-maximumprijs
   - Schrijft rechtstreeks naar **Vercel Postgres** via de connectiestring (GitHub secret)
   - Gepland op 19:00 UTC (~21:00 BE-tijd, na CME-settlement van ±20:30 BE-tijd)
   - Gekozen boven Vercel Cron omdat: geen 10s-timeout (ruimte voor retries bij een 429 van
     Yahoo), en ontkoppeling van data-ingestie en website-hosting. Vercel's outbound IP's zijn
     overigens sowieso al dynamisch op Hobby (geen vast IP tenzij je voor Pro/Enterprise betaalt),
     dus qua IP-rotatie ontlopen beide platformen elkaar niet veel — bij deze lage frequentie
     (1x/dag) is rate-limiting sowieso een klein risico.

2. **Historische opslag — Vercel Postgres (Neon, gratis tier)**, bevestigd. Native geïntegreerd
   in het Vercel-dashboard, door GitHub Actions gevuld, door de website uitgelezen.

3. **Frontend:** Next.js, herbruikt de structuur/styling van `mazout_dashboard.jsx`, haalt data
   op via een eigen `/api`-leesroute (geen directe yfinance-call vanuit de browser).

---

## 6. Bijlagen
- Origineel voorstel: `Voorstel_webpagina.docx`
- Werkend prototype: `mazout_dashboard.jsx` (React, mock data)
- GitHub-repo: **CC-Mazout**
- Hosting: **Vercel** (Hobby/gratis)
- Domeinnaam: **mazoutpricetrends.eu** (geregistreerd; DNS-locatie nog te bevestigen)
- Ander domein ter info, niet gerelateerd aan dit project: pickmynumers.eu (DNS via Cloudflare)
