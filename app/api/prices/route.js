import { NextResponse } from "next/server";
import { getRecentPrices, getPricesInRange } from "../../../lib/db";

// GET /api/prices?days=30 | 90
// GET /api/prices?from=2026-01-01&to=2026-02-01  (custom periode)
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    let rows;
    if (from && to) {
      rows = await getPricesInRange(from, to);
    } else {
      const days = Math.min(Number(searchParams.get("days")) || 30, 365);
      rows = await getRecentPrices(days);
    }
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("[/api/prices] databasefout:", err);
    return NextResponse.json(
      { error: "Kon historische prijzen niet ophalen." },
      { status: 500 }
    );
  }
}
