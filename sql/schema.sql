-- Belgian Mazout Prices & Trends — historische data
-- Eén rij per kalenderdag. Backfill (eenmalig) via Statbel, daarna dagelijks aangevuld
-- via GitHub Actions vanaf petrolprices.economie.fgov.be.
--
-- De officiële prijs kent twee tarieven, afhankelijk van bestelvolume — vandaar twee kolommen
-- i.p.v. één "fod_max_eur_l" (zie opdrachtdocument, oorspronkelijk voorstel punt 3: "Impact >2000 liters").

CREATE TABLE IF NOT EXISTS daily_prices (
    date                DATE PRIMARY KEY,
    wti_usd_bbl         NUMERIC(10, 4),         -- WTI ruwe olie, USD/vat (CL=F)
    ho_usd_gal          NUMERIC(10, 4),         -- HO=F stookolie future, USD/gallon
    eur_usd             NUMERIC(10, 6),         -- wisselkoers op moment van ophalen
    market_eur_l        NUMERIC(10, 4),         -- HO=F omgerekend naar EUR/L ("Productprijs/markt")
    fod_max_vanaf2000_l NUMERIC(10, 4),         -- officiële prijs, bestelling >= 2000 L (EUR/L)
    fod_max_onder2000_l NUMERIC(10, 4),         -- officiële prijs, bestelling < 2000 L (EUR/L)
    source              TEXT,                   -- 'statbel_backfill' of 'petrolprices_daily'
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_prices_date ON daily_prices (date DESC);

