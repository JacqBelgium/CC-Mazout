"""
Dagelijkse ophaal-job voor Belgian Mazout Prices & Trends.

Draait via GitHub Actions (.github/workflows/fetch-prices.yml), niet op Vercel —
zie de opdrachtbeschrijving voor de reden (geen 10s-timeout, ontkoppeld van hosting).

Haalt op:
  - HO=F, CL=F (WTI), EURUSD=X via yfinance — voor het markt/trendcomponent
  - de officiële FOD-maximumprijs (twee tarieven: >=2000L en <2000L) van
    petrolprices.economie.fgov.be

LET OP: de eenmalige historische FOD-data komt uit scripts/backfill_statbel.py
(Statbel-databank) — dit script vult enkel de nieuwste dag aan, dagelijks.
"""

import os
import re
import sys
import time
from datetime import date

import psycopg2
import requests
import yfinance as yf

FOD_URL = "https://petrolprices.economie.fgov.be/petrolprices/"
GALLON_TO_LITER = 3.785411784

# Regex op de rij-tekst van de FOD-pagina, bv.:
#   "Gasoil chauffage (H0/H7) (à partir de 2000 l) | 1,3383 euro/l"
#   "Gasoil chauffage (H0/H7) (moins de 2000 l)    | 1,3788 euro/l"
# NL-versie van de pagina gebruikt vermoedelijk "Gasolie verwarming ... (vanaf/minder dan 2000 l)"
# — vandaar dat beide taalvarianten in de regex zitten.
ROW_PATTERN = re.compile(
    r"(Gasoil chauffage \(H0/H7\)|Gasolie verwarming \(H0/H7\))"
    r"\s*\((?:à partir de|vanaf)\s*2000\s*l\)"
    r".*?(\d[.,]\d{3,4})\s*euro",
    re.IGNORECASE,
)
ROW_PATTERN_ONDER = re.compile(
    r"(Gasoil chauffage \(H0/H7\)|Gasolie verwarming \(H0/H7\))"
    r"\s*\((?:moins de|minder dan)\s*2000\s*l\)"
    r".*?(\d[.,]\d{3,4})\s*euro",
    re.IGNORECASE,
)
# Geldigheidsdatum van het tarief, bv. "tarif valable à partir du 05.11.2026".
# De pagina toont 's avonds (en al in de voormiddag) het tarief van MORGEN — die datum
# moet dus van de pagina komen, niet van de klok van de runner.
VALID_FROM_PATTERN = re.compile(
    r"(?:valable\s+\S+\s+partir\s+du|geldig\s+vanaf)\s*(\d{2})\.(\d{2})\.(\d{4})",
    re.IGNORECASE,
)


def fetch_with_retry(ticker: str, attempts: int = 3, delay: float = 5.0):
    """Geeft de slotkoersen van de laatste dagen terug (Series, index = handelsdag).

    yfinance kan sporadisch een 429 geven — een paar keer opnieuw proberen
    voordat we de job laten falen. Precies waarom dit als GitHub Action draait
    i.p.v. een Vercel-functie (geen harde timeout hier)."""
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            hist = yf.Ticker(ticker).history(period="5d", interval="1d")
            closes = hist["Close"].dropna() if not hist.empty else hist
            if closes.empty:
                raise ValueError(f"Lege data terugontvangen voor {ticker}")
            # Index = handelsdag in de tijdzone van de beurs -> .date() is de slotkoersdag
            closes.index = [ts.date() for ts in closes.index]
            return closes
        except Exception as exc:  # noqa: BLE001 — bewust breed, we loggen en retryen
            last_err = exc
            print(f"[fetch_prices] poging {attempt}/{attempts} voor {ticker} faalde: {exc}")
            if attempt < attempts:
                time.sleep(delay)
    raise RuntimeError(f"Kon {ticker} niet ophalen na {attempts} pogingen") from last_err


def fetch_fod_prices() -> tuple[date, float, float]:
    """Parseert de geldigheidsdatum en de twee officiële prijzen (>=2000L en <2000L)
    van de FOD-pagina.

    LET OP: dit is een HTML-scrape van een overheidspagina met een simpele tabel,
    geen API. Als FOD de tekst/opmaak wijzigt, moet ROW_PATTERN bijgewerkt worden —
    de foutmelding hieronder maakt dat expliciet zichtbaar in de Actions-log.
    """
    resp = requests.get(FOD_URL, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    text = resp.text

    match_vanaf = ROW_PATTERN.search(text)
    match_onder = ROW_PATTERN_ONDER.search(text)
    if not match_vanaf or not match_onder:
        raise ValueError(
            "Kon een of beide FOD-mazoutprijzen niet vinden op de pagina — opmaak is "
            "mogelijk gewijzigd, ROW_PATTERN in fetch_fod_prices() moet bijgewerkt worden."
        )

    match_datum = VALID_FROM_PATTERN.search(re.sub(r"<[^>]+>", " ", text))
    if not match_datum:
        raise ValueError(
            "Kon de geldigheidsdatum ('valable à partir du DD.MM.YYYY') niet vinden op de "
            "FOD-pagina — opmaak is mogelijk gewijzigd, VALID_FROM_PATTERN moet bijgewerkt worden."
        )
    dd, mm, yyyy = (int(g) for g in match_datum.groups())
    geldig_vanaf = date(yyyy, mm, dd)

    vanaf_2000 = float(match_vanaf.group(2).replace(",", "."))
    onder_2000 = float(match_onder.group(2).replace(",", "."))
    return geldig_vanaf, vanaf_2000, onder_2000


def main() -> None:
    # FOD eerst: als de pagina niet te parsen valt, stoppen we vóór er iets geschreven wordt.
    fod_datum, fod_vanaf_2000, fod_onder_2000 = fetch_fod_prices()

    wti_closes = fetch_with_retry("CL=F")            # USD/vat
    ho_closes = fetch_with_retry("HO=F")              # USD/gallon
    eur_usd_closes = fetch_with_retry("EURUSD=X")     # EUR/USD

    # Marktdatum = dag van de laatste HO=F-slotkoers (de basis van market_eur_l), niet de
    # rundatum. WTI en EUR/USD nemen we op die dag, of de laatst bekende koers ervoor.
    markt_datum = ho_closes.index[-1]
    ho = float(ho_closes.iloc[-1])
    wti = float(wti_closes[wti_closes.index <= markt_datum].iloc[-1])
    eur_usd = float(eur_usd_closes[eur_usd_closes.index <= markt_datum].iloc[-1])
    ho_eur_per_liter = (ho / eur_usd) / GALLON_TO_LITER

    # Twee aparte upserts: elke kolomgroep werkt enkel zijn eigen kolommen bij en
    # overschrijft nooit een bestaande waarde met NULL (COALESCE). Een rij mag dus
    # tijdelijk alleen FOD-data hebben (tarief van morgen, marktdata volgt later).
    conn = psycopg2.connect(os.environ["DATABASE_URL"].strip())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO daily_prices
                    (date, wti_usd_bbl, ho_usd_gal, eur_usd, market_eur_l, source)
                VALUES (%s, %s, %s, %s, %s, 'petrolprices_daily')
                ON CONFLICT (date) DO UPDATE SET
                    wti_usd_bbl  = COALESCE(EXCLUDED.wti_usd_bbl,  daily_prices.wti_usd_bbl),
                    ho_usd_gal   = COALESCE(EXCLUDED.ho_usd_gal,   daily_prices.ho_usd_gal),
                    eur_usd      = COALESCE(EXCLUDED.eur_usd,      daily_prices.eur_usd),
                    market_eur_l = COALESCE(EXCLUDED.market_eur_l, daily_prices.market_eur_l),
                    fetched_at   = now()
                """,
                (markt_datum, wti, ho, eur_usd, ho_eur_per_liter),
            )
            cur.execute(
                """
                INSERT INTO daily_prices
                    (date, fod_max_vanaf2000_l, fod_max_onder2000_l, source)
                VALUES (%s, %s, %s, 'petrolprices_daily')
                ON CONFLICT (date) DO UPDATE SET
                    fod_max_vanaf2000_l = COALESCE(EXCLUDED.fod_max_vanaf2000_l, daily_prices.fod_max_vanaf2000_l),
                    fod_max_onder2000_l = COALESCE(EXCLUDED.fod_max_onder2000_l, daily_prices.fod_max_onder2000_l),
                    source              = EXCLUDED.source,
                    fetched_at          = now()
                """,
                (fod_datum, fod_vanaf_2000, fod_onder_2000),
            )
    finally:
        conn.close()

    print(
        f"[fetch_prices] markt {markt_datum}: WTI={wti:.2f} USD/vat, HO=F={ho:.4f} USD/gal, "
        f"EUR/USD={eur_usd:.4f}, markt={ho_eur_per_liter:.4f} EUR/L | "
        f"FOD geldig vanaf {fod_datum}: >=2000L={fod_vanaf_2000:.4f} EUR/L, "
        f"<2000L={fod_onder_2000:.4f} EUR/L"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"[fetch_prices] FOUT: {exc}", file=sys.stderr)
        sys.exit(1)

