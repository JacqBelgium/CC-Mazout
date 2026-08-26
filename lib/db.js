import { sql } from "@vercel/postgres";

// Haalt de laatste `days` dagen op uit daily_prices, oplopend gesorteerd op datum.
// Twee FOD-tarieven per dag (>=2000L en <2000L) i.p.v. één "max"-prijs — zie schema.sql.
export async function getRecentPrices(days = 90) {
  const { rows } = await sql`
    SELECT date, wti_usd_bbl, ho_usd_gal, eur_usd, market_eur_l,
           fod_max_vanaf2000_l, fod_max_onder2000_l
    FROM daily_prices
    ORDER BY date DESC
    LIMIT ${days}
  `;
  return rows.reverse(); // oudste eerst, zoals de grafiek verwacht
}

