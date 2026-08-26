import { NextResponse } from "next/server";
import { getRecentPrices } from "../../../lib/db";

// GET /api/prices?days=30 | 90
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(Number(searchParams.get("days")) || 30, 365);

  try {
    const rows = await getRecentPrices(days);
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("[/api/prices] databasefout:", err);
    return NextResponse.json(
      { error: "Kon historische prijzen niet ophalen." },
      { status: 500 }
    );
  }
}
