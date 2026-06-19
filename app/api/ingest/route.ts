import { NextResponse } from "next/server";
import { ingestLastSevenDays } from "@/lib/ingest";

export async function POST() {
  try {
    const result = await ingestLastSevenDays();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Ingestion failed",
      },
      { status: 500 },
    );
  }
}
