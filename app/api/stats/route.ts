import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

export async function GET() {
  try {
    const stats = await getStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stats failed" },
      { status: 500 },
    );
  }
}
