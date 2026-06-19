import prisma from "@/lib/db";
import { chunkText } from "@/lib/chunk";
import { createChunksWithEmbeddings, type ChunkToEmbed } from "@/lib/chunk-embed";
import {
  INGESTION_QUERIES,
  INGESTION_TAG_FETCHES,
  MAX_CHUNKS,
  MIN_COMMENT_LENGTH,
} from "@/lib/constants";
import {
  getCommunityEmbedding,
  resetCommunityEmbeddingCache,
  scoreRelevance,
} from "@/lib/relevance";
import { ensureCommunity } from "@/lib/seed";
import { getEmbeddingBatchSize } from "@/lib/rate-limit";
import { stripHtml, hnDiscussionUrl, isHnDiscussionUrl } from "@/lib/utils";

interface HNHit {
  objectID: string;
  title?: string;
  story_title?: string;
  comment_text?: string;
  story_text?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at_i: number;
  _tags?: string[];
}

interface HNSearchResponse {
  hits: HNHit[];
}

interface FetchContext {
  searchQuery?: string;
  searchTag?: string;
}

async function fetchHNHits(
  sinceUnix: number,
  options: { query?: string; tag?: string },
): Promise<HNHit[]> {
  const params = new URLSearchParams({
    hitsPerPage: "100",
    numericFilters: `created_at_i>${sinceUnix}`,
  });

  if (options.tag) {
    params.set("tags", options.tag);
    params.set("query", "");
  } else {
    params.set("query", options.query ?? "");
    params.set("tags", "(story,comment)");
  }

  const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    const label = options.tag ?? options.query ?? "unknown";
    throw new Error(`HN API error for "${label}": ${response.status}`);
  }

  const data = (await response.json()) as HNSearchResponse;
  return data.hits ?? [];
}

function hitToText(hit: HNHit): string {
  const raw =
    hit.comment_text?.trim() ||
    hit.story_text?.trim() ||
    hit.title?.trim() ||
    hit.story_title?.trim() ||
    "";
  return stripHtml(raw);
}

function hitToTitle(hit: HNHit): string {
  return hit.title || hit.story_title || hitToText(hit).slice(0, 120) || "HN item";
}

async function processHit(
  hit: HNHit,
  context: FetchContext,
  state: {
    totalChunks: number;
    seenExternalIds: Set<string>;
    sourcesCreated: number;
    documentsCreated: number;
    chunksCreated: number;
    filteredCount: number;
    pendingChunks: ChunkToEmbed[];
  },
  communityId: string,
  communityEmbedding?: number[] | null,
): Promise<void> {
  if (state.totalChunks + state.pendingChunks.length >= MAX_CHUNKS) return;

  const externalId = hit.objectID;
  if (state.seenExternalIds.has(externalId)) return;

  const text = hitToText(hit);
  if (text.length < MIN_COMMENT_LENGTH) return;

  const title = hitToTitle(hit);
  const relevance = await scoreRelevance(
    {
      title,
      text,
      tags: hit._tags,
      searchQuery: context.searchQuery,
      searchTag: context.searchTag,
    },
    communityEmbedding,
  );

  if (!relevance.passed) {
    state.filteredCount++;
    return;
  }

  state.seenExternalIds.add(externalId);
  const createdAtExternal = new Date(hit.created_at_i * 1000);
  const isComment = hit._tags?.includes("comment") ?? !!hit.comment_text;
  const discussionUrl = hnDiscussionUrl(externalId);
  const linkedUrl =
    hit.url && !isHnDiscussionUrl(hit.url) ? hit.url : null;

  const source = await prisma.source.upsert({
    where: {
      platform_externalId: {
        platform: "hackernews",
        externalId,
      },
    },
    update: {
      url: discussionUrl,
      points: hit.points ?? undefined,
      numComments: hit.num_comments ?? undefined,
      relevanceScore: relevance.score,
      relevanceCategory: relevance.category,
      relevanceReason: relevance.reason,
    },
    create: {
      communityId,
      platform: "hackernews",
      externalId,
      url: discussionUrl,
      title,
      author: hit.author ?? null,
      createdAtExternal,
      points: hit.points ?? null,
      numComments: hit.num_comments ?? null,
      relevanceScore: relevance.score,
      relevanceCategory: relevance.category,
      relevanceReason: relevance.reason,
    },
  });
  state.sourcesCreated++;

  const existingDoc = await prisma.document.findFirst({
    where: { sourceId: source.id, text },
  });
  if (existingDoc) return;

  const document = await prisma.document.create({
    data: {
      sourceId: source.id,
      type: isComment ? "comment" : "story",
      text,
      url: discussionUrl,
      author: hit.author ?? null,
      createdAtExternal,
      metadata: {
        searchQuery: context.searchQuery ?? null,
        searchTag: context.searchTag ?? null,
        hnTags: hit._tags ?? [],
        linkedUrl,
        relevanceScore: relevance.score,
        relevanceCategory: relevance.category,
        keywordScore: relevance.keywordScore,
        embeddingScore: relevance.embeddingScore,
        relevanceReason: relevance.reason,
        matchedSignals: relevance.matchedSignals,
        passedFilter: true,
      },
    },
  });
  state.documentsCreated++;

  const pieces = chunkText(text);
  for (const piece of pieces) {
    if (state.totalChunks + state.pendingChunks.length >= MAX_CHUNKS) break;
    state.pendingChunks.push({
      documentId: document.id,
      text: piece,
      title,
    });
  }
}

async function flushPendingChunks(state: {
  totalChunks: number;
  chunksCreated: number;
  pendingChunks: ChunkToEmbed[];
}): Promise<void> {
  if (state.pendingChunks.length === 0) return;

  const remaining = MAX_CHUNKS - state.totalChunks;
  const batch = state.pendingChunks.splice(0, remaining);
  if (batch.length === 0) return;

  const created = await createChunksWithEmbeddings(batch);
  state.chunksCreated += created;
  state.totalChunks += created;
}

/** Point all stored HN sources (and their documents) at the discussion thread. */
export async function backfillHnDiscussionUrls(): Promise<number> {
  const sources = await prisma.source.findMany({
    where: { platform: "hackernews" },
    select: { id: true, externalId: true, url: true },
  });

  let updated = 0;
  for (const source of sources) {
    const discussionUrl = hnDiscussionUrl(source.externalId);
    if (source.url === discussionUrl) continue;

    await prisma.$transaction([
      prisma.source.update({
        where: { id: source.id },
        data: { url: discussionUrl },
      }),
      prisma.document.updateMany({
        where: { sourceId: source.id },
        data: { url: discussionUrl },
      }),
    ]);
    updated++;
  }
  return updated;
}

export async function ingestLastSevenDays(): Promise<{
  sources: number;
  documents: number;
  chunks: number;
  queries: number;
  filtered: number;
}> {
  resetCommunityEmbeddingCache();
  const community = await ensureCommunity();
  await backfillHnDiscussionUrls();
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const communityEmbedding = await getCommunityEmbedding();

  const state = {
    totalChunks: await prisma.chunk.count(),
    seenExternalIds: new Set<string>(),
    sourcesCreated: 0,
    documentsCreated: 0,
    chunksCreated: 0,
    filteredCount: 0,
    pendingChunks: [] as ChunkToEmbed[],
  };

  const flushEvery = getEmbeddingBatchSize();

  const fetchJobs: FetchContext[] = [
    ...INGESTION_TAG_FETCHES.map((tag) => ({ searchTag: tag })),
    ...INGESTION_QUERIES.map((query) => ({ searchQuery: query })),
  ];

  for (const job of fetchJobs) {
    if (state.totalChunks + state.pendingChunks.length >= MAX_CHUNKS) break;

    let hits: HNHit[] = [];
    try {
      hits = await fetchHNHits(since, {
        query: job.searchQuery,
        tag: job.searchTag,
      });
    } catch (error) {
      console.error(error);
      continue;
    }

    for (const hit of hits) {
      await processHit(hit, job, state, community.id, communityEmbedding);
      if (state.pendingChunks.length >= flushEvery) {
        await flushPendingChunks(state);
      }
    }
  }

  await flushPendingChunks(state);

  return {
    sources: state.sourcesCreated,
    documents: state.documentsCreated,
    chunks: state.chunksCreated,
    queries: fetchJobs.length,
    filtered: state.filteredCount,
  };
}
