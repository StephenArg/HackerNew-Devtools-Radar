import { NextResponse } from "next/server";
import { generateNoRagReport } from "@/lib/reports";

export async function POST() {
  try {
    const result = await generateNoRagReport();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "No-RAG report failed",
      },
      { status: 500 },
    );
  }
}
