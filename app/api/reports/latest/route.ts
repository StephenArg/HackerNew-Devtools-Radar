import { NextResponse } from "next/server";
import { enrichReportForApi, getLatestReport } from "@/lib/reports";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") as "rag" | "no_rag" | null;
    const report = await getLatestReport(mode ?? undefined);

    if (!report) {
      return NextResponse.json({ report: null }, { status: 404 });
    }

    const payload = await enrichReportForApi(report);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fetch failed" },
      { status: 500 },
    );
  }
}
