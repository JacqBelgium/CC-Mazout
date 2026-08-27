import { Pool } from "pg";

// Vercel Postgres als apart product bestaat niet meer — dit loopt nu via de
// Neon-integratie uit de Vercel Marketplace, die de env var DATABASE_URL zet.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Haalt de laatste `days` dagen op uit daily_prices, oplopend gesorteerd op datum.
// Twee FOD-tarieven per dag (>=2000L en <2000L) i.p.v. één "max"-prijs — zie schema.sql.
export async function getRecentPrices(days = 90) {
  const { rows } = await pool.query(
    `SELECT date, wti_usd_bbl, ho_usd_gal, eur_usd, market_eur_l,
            fod_max_vanaf2000_l, fod_max_onder2000_l
     FROM daily_prices
     ORDER BY date DESC
     LIMIT $1`,
    [days]
  );
  return rows.reverse(); // oudste eerst, zoals de grafiek verwacht
}

// Voor de custom "van–tot"-periodeselectie in de trendgrafiek.
// from/to zijn 'YYYY-MM-DD'-strings uit een <input type="date">.
export async function getPricesInRange(from, to) {
  const { rows } = await pool.query(
    `SELECT date, wti_usd_bbl, ho_usd_gal, eur_usd, market_eur_l,
            fod_max_vanaf2000_l, fod_max_onder2000_l
     FROM daily_prices
     WHERE date BETWEEN $1 AND $2
     ORDER BY date ASC`,
    [from, to]
  );
  return rows;
}



