import { NextResponse } from "next/server";
import { listReports } from "@/lib/reports";

export async function GET() {
  try {
    const reports = await listReports();
    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fetch failed" },
      { status: 500 },
    );
  }
}
