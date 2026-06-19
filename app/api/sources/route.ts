import { NextResponse } from "next/server";
import { getSources } from "@/lib/stats";

export async function GET() {
  try {
    const sources = await getSources();
    return NextResponse.json({ sources });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sources failed" },
      { status: 500 },
    );
  }
}
