import prisma from "@/lib/db";
import { isMockMode } from "@/lib/ai";
import { RETRIEVAL_TOP_K } from "@/lib/constants";
import { cosineSimilarity } from "@/lib/ai";

export interface VectorSearchResult {
  id: string;
  text: string;
  topic: string;
  sourceTitle: string;
  sourceUrl: string;
  similarity: number;
}

export async function storeChunkEmbedding(
  chunkId: string,
  embedding: number[],
): Promise<void> {
  await prisma.chunk.update({
    where: { id: chunkId },
    data: { embeddingJson: JSON.stringify(embedding) },
  });

  if (isMockMode()) return;

  const vectorLiteral = `[${embedding.join(",")}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE "Chunk" SET embedding = $1::vector WHERE id = $2`,
    vectorLiteral,
    chunkId,
  );
}

export async function searchSimilarChunks(
  queryEmbedding: number[],
  topK = RETRIEVAL_TOP_K,
): Promise<VectorSearchResult[]> {
  if (isMockMode()) {
    return searchSimilarChunksInMemory(queryEmbedding, topK);
  }

  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      text: string;
      topic: string;
      sourceTitle: string;
      sourceUrl: string;
      similarity: number;
    }>
  >(
    `
    SELECT
      c.id,
      c.text,
      c.topic,
      s.title AS "sourceTitle",
      s.url AS "sourceUrl",
      1 - (c.embedding <=> $1::vector) AS similarity
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    JOIN "Source" s ON s.id = d."sourceId"
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2
    `,
    vectorLiteral,
    topK,
  );

  return rows;
}

async function searchSimilarChunksInMemory(
  queryEmbedding: number[],
  topK: number,
): Promise<VectorSearchResult[]> {
  const chunks = await prisma.chunk.findMany({
    include: {
      document: {
        include: { source: true },
      },
    },
  });

  const scored = chunks
    .map((chunk) => {
      const embedding = JSON.parse(chunk.embeddingJson) as number[];
      return {
        id: chunk.id,
        text: chunk.text,
        topic: chunk.topic,
        sourceTitle: chunk.document.source.title,
        sourceUrl: chunk.document.source.url,
        similarity: cosineSimilarity(queryEmbedding, embedding),
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored;
}

export async function recordRetrieval(
  chunkId: string,
  query: string,
  similarity: number,
  reportId?: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.retrievalEvent.create({
      data: { chunkId, query, similarity, reportId },
    }),
    prisma.chunk.update({
      where: { id: chunkId },
      data: { retrievalCount: { increment: 1 } },
    }),
  ]);
}
