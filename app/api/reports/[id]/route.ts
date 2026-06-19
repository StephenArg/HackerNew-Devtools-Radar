import { NextResponse } from "next/server";
import { enrichReportForApi, getReportById } from "@/lib/reports";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const report = await getReportById(id);

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
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
