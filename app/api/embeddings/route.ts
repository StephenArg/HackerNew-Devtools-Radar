import { NextResponse } from "next/server";
import { getEmbeddingPoints, getMostRetrievedChunks } from "@/lib/stats";

export async function GET() {
  try {
    const [points, topRetrieved] = await Promise.all([
      getEmbeddingPoints(),
      getMostRetrievedChunks(),
    ]);

    return NextResponse.json({ points, topRetrieved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Embeddings failed" },
      { status: 500 },
    );
  }
}
