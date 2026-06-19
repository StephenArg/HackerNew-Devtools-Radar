import prisma from "@/lib/db";
import { chunkText } from "@/lib/chunk";
import { createChunksWithEmbeddings, type ChunkToEmbed } from "@/lib/chunk-embed";
import {
  COMMUNITY_DESCRIPTION,
  COMMUNITY_NAME,
  MAX_CHUNKS,
  MIN_COMMENT_LENGTH,
} from "@/lib/constants";
import { SEED_ITEMS } from "@/lib/seed-data";
import { scoreKeywordRelevance } from "@/lib/relevance";

export async function ensureCommunity() {
  const existing = await prisma.community.findFirst({
    where: { name: COMMUNITY_NAME },
  });
  if (existing) return existing;

  return prisma.community.create({
    data: {
      name: COMMUNITY_NAME,
      description: COMMUNITY_DESCRIPTION,
    },
  });
}

export async function clearAllData(): Promise<void> {
  await prisma.retrievalEvent.deleteMany();
  await prisma.report.deleteMany();
  await prisma.chunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.source.deleteMany();
  await prisma.community.deleteMany();
}

export async function seedDemoData(): Promise<{
  sources: number;
  documents: number;
  chunks: number;
}> {
  const community = await ensureCommunity();
  const totalChunks = await prisma.chunk.count();
  let sourcesCreated = 0;
  let documentsCreated = 0;
  const pendingChunks: ChunkToEmbed[] = [];

  for (const item of SEED_ITEMS) {
    if (totalChunks + pendingChunks.length >= MAX_CHUNKS) break;
    if (item.text.length < MIN_COMMENT_LENGTH) continue;

    const createdAtExternal = new Date();
    createdAtExternal.setDate(createdAtExternal.getDate() - item.daysAgo);

    // Seed items are curated to be on-topic; score them deterministically so
    // the Sources page can display the same relevance metadata as live ingestion.
    const relevance = scoreKeywordRelevance({
      title: item.title,
      text: item.text,
    });

    const source = await prisma.source.upsert({
      where: {
        platform_externalId: {
          platform: "hackernews",
          externalId: item.externalId,
        },
      },
      update: {},
      create: {
        communityId: community.id,
        platform: "hackernews",
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        author: item.author,
        createdAtExternal,
        points: item.points,
        numComments: item.numComments,
        relevanceScore: relevance.keywordScore,
        relevanceCategory: relevance.category,
        relevanceReason: relevance.reason,
      },
    });
    sourcesCreated++;

    const document = await prisma.document.create({
      data: {
        sourceId: source.id,
        type: item.type,
        text: item.text,
        url: item.url,
        author: item.author,
        createdAtExternal,
        metadata: {
          seeded: true,
          relevanceScore: relevance.keywordScore,
          relevanceCategory: relevance.category,
          relevanceReason: relevance.reason,
          matchedSignals: relevance.matchedSignals,
        },
      },
    });
    documentsCreated++;

    for (const piece of chunkText(item.text)) {
      if (totalChunks + pendingChunks.length >= MAX_CHUNKS) break;
      pendingChunks.push({
        documentId: document.id,
        text: piece,
        title: item.title,
      });
    }
  }

  const chunksCreated = await createChunksWithEmbeddings(pendingChunks);

  return {
    sources: sourcesCreated,
    documents: documentsCreated,
    chunks: chunksCreated,
  };
}
