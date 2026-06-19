import { NextResponse } from "next/server";
import { seedDemoData } from "@/lib/seed";

export async function POST() {
  try {
    const result = await seedDemoData();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Seed failed" },
      { status: 500 },
    );
  }
}
