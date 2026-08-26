"""
EENMALIG uit te voeren: haalt de historische FOD-maximumprijzen op via Statbel's
bestat-crosstable (officiële, downloadbare overheidsdata — incl. de dag van vandaag)
en vult daarmee de `daily_prices`-tabel, VOOR de dagelijkse GitHub Actions-job start.

Gebruik:
    POSTGRES_URL="postgres://..." python scripts/backfill_statbel.py

Bron: https://bestat.statbel.fgov.be/bestat/crosstable.xhtml?view=f8d4c0ce-bec4-4f58-b2a2-4f6b8667ad24
Exportlink (JSON), rechtstreeks bruikbaar zonder browser:
    https://bestat.statbel.fgov.be/bestat/api/views/f8d4c0ce-bec4-4f58-b2a2-4f6b8667ad24/result/JSON

LET OP: deze "view" is geconfigureerd voor de laatste 365 dagen. Voor een langere
historiek moet een nieuwe view met een ruimere periode aangemaakt worden op bestat.statbel.fgov.be
en de URL hieronder aangepast.
"""

import os
import sys

import psycopg2
import requests

STATBEL_JSON_URL = (
    "https://bestat.statbel.fgov.be/bestat/api/views/"
    "f8d4c0ce-bec4-4f58-b2a2-4f6b8667ad24/result/JSON"
)

PRODUCT_VANAF_2000 = "Gasolie verwarming (H0/H7) (vanaf 2000 l) (€/L)"
PRODUCT_ONDER_2000 = "Gasolie verwarming (H0/H7) (minder dan 2000 l) (€/L)"

MAAND_NL = {
    "jan": 1, "feb": 2, "mrt": 3, "apr": 4, "mei": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "okt": 10, "nov": 11, "dec": 12,
}


def parse_statbel_day(dag: str):
    """'27aug25' -> date(2025, 8, 27). Statbel gebruikt NL-maandafkortingen + 2-cijferig jaar."""
    dd = int(dag[0:2])
    maand = dag[2:5].lower()
    jj = int(dag[5:7])
    jaar = 2000 + jj
    return f"{jaar:04d}-{MAAND_NL[maand]:02d}-{dd:02d}"


def main() -> None:
    resp = requests.get(STATBEL_JSON_URL, timeout=60)
    resp.raise_for_status()
    facts = resp.json()["facts"]

    # Verzamel per dag de twee tarieven die ons interesseren
    by_date = {}
    for fact in facts:
        product = fact.get("Product")
        if product not in (PRODUCT_VANAF_2000, PRODUCT_ONDER_2000):
            continue
        prijs = fact.get("Prijs incl. BTW")
        if prijs is None:
            continue
        date_str = parse_statbel_day(fact["Dag"])
        row = by_date.setdefault(date_str, {})
        if product == PRODUCT_VANAF_2000:
            row["vanaf2000"] = round(float(prijs), 4)
        else:
            row["onder2000"] = round(float(prijs), 4)

    print(f"[backfill_statbel] {len(by_date)} dagen gevonden, wegschrijven naar Postgres...")

    conn = psycopg2.connect(os.environ["POSTGRES_URL"])
    try:
        with conn, conn.cursor() as cur:
            for date_str, prices in sorted(by_date.items()):
                cur.execute(
                    """
                    INSERT INTO daily_prices (date, fod_max_vanaf2000_l, fod_max_onder2000_l, source)
                    VALUES (%s, %s, %s, 'statbel_backfill')
                    ON CONFLICT (date) DO UPDATE SET
                        fod_max_vanaf2000_l = EXCLUDED.fod_max_vanaf2000_l,
                        fod_max_onder2000_l = EXCLUDED.fod_max_onder2000_l
                    -- Overschrijft bewust geen market_eur_l/wti/etc. als die al door de
                    -- dagelijkse job gezet zijn — backfill vult alleen de FOD-kolommen.
                    """,
                    (date_str, prices.get("vanaf2000"), prices.get("onder2000")),
                )
    finally:
        conn.close()

    print("[backfill_statbel] Klaar.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"[backfill_statbel] FOUT: {exc}", file=sys.stderr)
        sys.exit(1)
