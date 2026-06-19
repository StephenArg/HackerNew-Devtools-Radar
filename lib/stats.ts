import prisma from "@/lib/db";
import { isMockMode, getAIStatus } from "@/lib/ai";
import { COMMUNITY_DESCRIPTION, COMMUNITY_NAME, sectionForQuery } from "@/lib/constants";
import { projectAllEmbeddings } from "@/lib/projection";
import { stripHtml } from "@/lib/utils";
import type { EmbeddingPoint, InfluentialSnippet, SourceRow, StatsResponse } from "@/types";

type SourceSummary = {
  title: string;
  url: string;
};

type ChunkWithDocument = {
  id: string;
  embeddingJson: string;
  topic: string;
  text: string;
  retrievalCount: number;
  document: {
    source: SourceSummary;
  };
};

type RetrievalEventSummary = {
  query: string;
  similarity: number;
};

type ChunkWithRetrievalEvents = ChunkWithDocument & {
  retrievalEvents: RetrievalEventSummary[];
};

type SourceWithDocuments = {
  id: string;
  title: string;
  platform: string;
  author: string | null;
  createdAtExternal: Date;
  url: string;
  points: number | null;
  numComments: number | null;
  relevanceScore: number | null;
  relevanceCategory: string | null;
  relevanceReason: string | null;
  documents: Array<{ _count: { chunks: number } }>;
};

export async function getStats(): Promise<StatsResponse> {
  const [sources, documents, chunks, reports, latestSource] = await Promise.all([
    prisma.source.count(),
    prisma.document.count(),
    prisma.chunk.count(),
    prisma.report.count(),
    prisma.source.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);

  return {
    sources,
    documents,
    chunks,
    reports,
    latestIngestion: latestSource?.createdAt.toISOString() ?? null,
    mockMode: isMockMode(),
    aiStatus: getAIStatus(),
    community: {
      name: COMMUNITY_NAME,
      description: COMMUNITY_DESCRIPTION,
    },
  };
}

export async function getEmbeddingPoints(): Promise<EmbeddingPoint[]> {
  const chunks: ChunkWithDocument[] = await prisma.chunk.findMany({
    include: {
      document: {
        include: { source: true },
      },
    },
    orderBy: { retrievalCount: "desc" },
  });

  const vectors = chunks.map(
    (chunk: ChunkWithDocument) => JSON.parse(chunk.embeddingJson) as number[],
  );
  const { pca, umap } = projectAllEmbeddings(vectors);

  return chunks.map((chunk: ChunkWithDocument, index: number) => ({
    id: chunk.id,
    pca: pca[index],
    umap: umap[index],
    topic: chunk.topic,
    text: chunk.text,
    sourceTitle: chunk.document.source.title,
    sourceUrl: chunk.document.source.url,
    retrievalCount: chunk.retrievalCount,
  }));
}

export async function getMostRetrievedChunks(
  limit = 15,
): Promise<InfluentialSnippet[]> {
  const chunks: ChunkWithRetrievalEvents[] = await prisma.chunk.findMany({
    take: limit,
    orderBy: { retrievalCount: "desc" },
    where: { retrievalCount: { gt: 0 } },
    include: {
      document: { include: { source: true } },
      retrievalEvents: { select: { query: true, similarity: true } },
    },
  });

  return chunks.map((chunk: ChunkWithRetrievalEvents) => {
    const events = chunk.retrievalEvents;
    const avgSimilarity =
      events.length > 0
        ? events.reduce(
            (sum: number, event: RetrievalEventSummary) => sum + event.similarity,
            0,
          ) / events.length
        : null;
    const usedInSections: string[] = [
      ...new Set(events.map((event: RetrievalEventSummary) => sectionForQuery(event.query))),
    ];

    return {
      id: chunk.id,
      sourceTitle: chunk.document.source.title,
      sourceUrl: chunk.document.source.url,
      topic: chunk.topic,
      preview: stripHtml(chunk.text).slice(0, 160),
      retrievalCount: chunk.retrievalCount,
      avgSimilarity,
      usedInSections,
    };
  });
}

export async function getSources(): Promise<SourceRow[]> {
  const sources: SourceWithDocuments[] = await prisma.source.findMany({
    include: {
      documents: {
        include: { _count: { select: { chunks: true } } },
      },
    },
    orderBy: { createdAtExternal: "desc" },
  });

  return sources.map((source: SourceWithDocuments) => ({
    id: source.id,
    title: source.title,
    platform: source.platform,
    author: source.author,
    createdAtExternal: source.createdAtExternal.toISOString(),
    url: source.url,
    points: source.points,
    numComments: source.numComments,
    chunkCount: source.documents.reduce(
      (sum: number, doc: SourceWithDocuments["documents"][number]) =>
        sum + doc._count.chunks,
      0,
    ),
    relevanceScore: source.relevanceScore,
    relevanceCategory: source.relevanceCategory,
    relevanceReason: source.relevanceReason,
  }));
}
