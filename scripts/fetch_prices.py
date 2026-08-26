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
from datetime import datetime, timezone

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


def fetch_with_retry(ticker: str, attempts: int = 3, delay: float = 5.0):
    """yfinance kan sporadisch een 429 geven — een paar keer opnieuw proberen
    voordat we de job laten falen. Precies waarom dit als GitHub Action draait
    i.p.v. een Vercel-functie (geen harde timeout hier)."""
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            hist = yf.Ticker(ticker).history(period="5d", interval="1d")
            if hist.empty:
                raise ValueError(f"Lege data terugontvangen voor {ticker}")
            return float(hist["Close"].iloc[-1])
        except Exception as exc:  # noqa: BLE001 — bewust breed, we loggen en retryen
            last_err = exc
            print(f"[fetch_prices] poging {attempt}/{attempts} voor {ticker} faalde: {exc}")
            if attempt < attempts:
                time.sleep(delay)
    raise RuntimeError(f"Kon {ticker} niet ophalen na {attempts} pogingen") from last_err


def fetch_fod_prices() -> tuple[float, float]:
    """Parseert de twee officiële dagprijzen (>=2000L en <2000L) van de FOD-pagina.

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

    vanaf_2000 = float(match_vanaf.group(2).replace(",", "."))
    onder_2000 = float(match_onder.group(2).replace(",", "."))
    return vanaf_2000, onder_2000


def main() -> None:
    today = datetime.now(timezone.utc).date()

    wti = fetch_with_retry("CL=F")            # USD/vat
    ho = fetch_with_retry("HO=F")              # USD/gallon
    eur_usd = fetch_with_retry("EURUSD=X")     # EUR/USD

    ho_eur_per_liter = (ho / eur_usd) / GALLON_TO_LITER
    fod_vanaf_2000, fod_onder_2000 = fetch_fod_prices()

    conn = psycopg2.connect(os.environ["DATABASE_URL"].strip())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO daily_prices
                    (date, wti_usd_bbl, ho_usd_gal, eur_usd, market_eur_l,
                     fod_max_vanaf2000_l, fod_max_onder2000_l, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'petrolprices_daily')
                ON CONFLICT (date) DO UPDATE SET
                    wti_usd_bbl          = EXCLUDED.wti_usd_bbl,
                    ho_usd_gal           = EXCLUDED.ho_usd_gal,
                    eur_usd              = EXCLUDED.eur_usd,
                    market_eur_l         = EXCLUDED.market_eur_l,
                    fod_max_vanaf2000_l  = EXCLUDED.fod_max_vanaf2000_l,
                    fod_max_onder2000_l  = EXCLUDED.fod_max_onder2000_l,
                    source               = EXCLUDED.source,
                    fetched_at           = now()
                """,
                (today, wti, ho, eur_usd, ho_eur_per_liter, fod_vanaf_2000, fod_onder_2000),
            )
    finally:
        conn.close()

    print(
        f"[fetch_prices] {today}: WTI={wti:.2f} USD/vat, HO=F={ho:.4f} USD/gal, "
        f"EUR/USD={eur_usd:.4f}, markt={ho_eur_per_liter:.4f} EUR/L, "
        f"FOD(>=2000L)={fod_vanaf_2000:.4f} EUR/L, FOD(<2000L)={fod_onder_2000:.4f} EUR/L"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"[fetch_prices] FOUT: {exc}", file=sys.stderr)
        sys.exit(1)

