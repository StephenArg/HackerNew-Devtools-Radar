import { NextResponse } from "next/server";
import { clearAllData } from "@/lib/seed";

export async function POST() {
  try {
    await clearAllData();
    return NextResponse.json({ ok: true, message: "All data cleared." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Clear failed" },
      { status: 500 },
    );
  }
}
