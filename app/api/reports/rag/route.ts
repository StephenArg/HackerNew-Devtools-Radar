import { NextResponse } from "next/server";
import { generateRagReport } from "@/lib/reports";

export async function POST() {
  try {
    const result = await generateRagReport();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "RAG report failed",
      },
      { status: 500 },
    );
  }
}
