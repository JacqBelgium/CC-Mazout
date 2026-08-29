"""
EENMALIG uit te voeren: vult de markt/WTI-kolommen (wti_usd_bbl, ho_usd_gal, eur_usd,
market_eur_l) met terugwerkende kracht in, voor alle dagen die al door
backfill_statbel.py zijn aangemaakt maar nog geen marktdata hadden (die kolommen
worden normaal pas gevuld door de dagelijkse fetch_prices.py-job, die logischerwijze
geen verleden kan invullen).

Gebruik:
    DATABASE_URL="postgres://..." python scripts/backfill_yfinance.py

Zonder dit script toont de trendgrafiek voor het "Beweging t.o.v. elkaar"-deel enkel
de FOD-lijn: er zijn dan te weinig opeenvolgende markt/WTI-datapunten om een lijn
doorheen te trekken.
"""

import os
import sys

import psycopg2
import yfinance as yf

GALLON_TO_LITER = 3.785411784
LOOKBACK_DAYS = 400  # iets ruimer dan de 365 dagen van de Statbel-backfill


def fetch_daily_close(ticker: str):
    """Geeft een dict {'YYYY-MM-DD': close_waarde} voor de laatste LOOKBACK_DAYS dagen."""
    hist = yf.Ticker(ticker).history(period=f"{LOOKBACK_DAYS}d", interval="1d")
    if hist.empty:
        raise ValueError(f"Lege historische data voor {ticker}")
    out = {}
    for idx, row in hist.iterrows():
        date_str = idx.strftime("%Y-%m-%d")
        out[date_str] = float(row["Close"])
    return out


def main() -> None:
    print("[backfill_yfinance] Historische koersen ophalen (WTI, HO=F, EUR/USD)...")
    wti_by_date = fetch_daily_close("CL=F")
    ho_by_date = fetch_daily_close("HO=F")
    eurusd_by_date = fetch_daily_close("EURUSD=X")

    # yfinance geeft niet noodzakelijk exact dezelfde handelsdagen voor elke ticker
    # (beurzen hebben andere feestdagen) — enkel dagen gebruiken waar alle drie bekend zijn.
    common_dates = set(wti_by_date) & set(ho_by_date) & set(eurusd_by_date)
    print(f"[backfill_yfinance] {len(common_dates)} dagen met volledige marktdata gevonden.")

    conn = psycopg2.connect(os.environ["DATABASE_URL"].strip())
    updated = 0
    try:
        with conn, conn.cursor() as cur:
            for date_str in sorted(common_dates):
                wti = wti_by_date[date_str]
                ho = ho_by_date[date_str]
                eur_usd = eurusd_by_date[date_str]
                market_eur_l = (ho / eur_usd) / GALLON_TO_LITER

                # Enkel bestaande rijen aanvullen (die al een FOD-prijs hebben via de
                # Statbel-backfill) — geen nieuwe rijen aanmaken vanuit dit script.
                cur.execute(
                    """
                    UPDATE daily_prices
                    SET wti_usd_bbl = %s,
                        ho_usd_gal = %s,
                        eur_usd = %s,
                        market_eur_l = %s
                    WHERE date = %s
                      AND market_eur_l IS NULL
                    """,
                    (
                        round(wti, 4),
                        round(ho, 4),
                        round(eur_usd, 6),
                        round(market_eur_l, 4),
                        date_str,
                    ),
                )
                updated += cur.rowcount
    finally:
        conn.close()

    print(f"[backfill_yfinance] Klaar — {updated} bestaande rijen aangevuld met marktdata.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"[backfill_yfinance] FOUT: {exc}", file=sys.stderr)
        sys.exit(1)
