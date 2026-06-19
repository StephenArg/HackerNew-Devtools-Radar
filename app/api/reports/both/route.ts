import { NextResponse } from "next/server";
import { getAIStatus, quotaFallbackSecondsRemaining } from "@/lib/ai";
import { generateBatchedComparePair } from "@/lib/reports";

export async function POST() {
  try {
    const result = await generateBatchedComparePair();
    const aiStatus = getAIStatus();
    const usedMock = aiStatus !== "openai";
    return NextResponse.json({
      ok: true,
      ...result,
      aiStatus,
      judgeBatched: !usedMock,
      warning: usedMock
        ? aiStatus === "quota_fallback"
          ? `OpenAI quota was hit during generation — reports use mock data. OpenAI will be retried in ~${quotaFallbackSecondsRemaining()}s or on the next generate. Check your OpenAI plan/billing.`
          : "Running in mock mode (no API key or MOCK_MODE=true) — reports use deterministic mock data."
        : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Batched compare failed",
      },
      { status: 500 },
    );
  }
}
