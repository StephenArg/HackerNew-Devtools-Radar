import prisma from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  generateComparePair,
  generateReport,
  getEmbeddings,
  pauseBeforeChat,
  resetQuotaFallback,
} from "@/lib/ai";
import { COMMUNITY_DESCRIPTION, COMMUNITY_NAME, RAG_QUERIES } from "@/lib/constants";
import { saveRubricJudgeCache } from "@/lib/rubric-cache";
import {
  ensureReportPredictions,
  enrichTopThemeCitations,
  type ThemeCitationChunk,
} from "@/lib/report-content";
import { buildCitationUrlMap, enrichReportVoiceUrls } from "@/lib/report-voices";
import { computeReportMethodologyStats } from "@/lib/report-stats";
import { ensureCommunity } from "@/lib/seed";
import type {
  ReportContent,
  ReportMethodologyStats,
  ReportSummary,
  RetrievedChunk,
} from "@/types";
import { recordRetrieval, searchSimilarChunks } from "@/lib/vector";

function coverageWindow(): string {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

async function retrieveChunksForRag(): Promise<{
  chunks: RetrievedChunk[];
  retrievalResultsByQuery: Array<{
    query: string;
    results: Awaited<ReturnType<typeof searchSimilarChunks>>;
  }>;
}> {
  const chunkCount = await prisma.chunk.count();
  if (chunkCount === 0) {
    throw new Error("No chunks available. Ingest HN data first.");
  }

  const queries = [...RAG_QUERIES];
  const queryEmbeddings = await getEmbeddings(queries);
  const retrievedMap = new Map<string, RetrievedChunk>();
  const retrievalResultsByQuery: Array<{
    query: string;
    results: Awaited<ReturnType<typeof searchSimilarChunks>>;
  }> = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const results = await searchSimilarChunks(queryEmbeddings[i]);
    retrievalResultsByQuery.push({ query, results });

    for (const result of results) {
      if (!retrievedMap.has(result.id)) {
        retrievedMap.set(result.id, result);
      }
    }
  }

  return {
    chunks: [...retrievedMap.values()].sort((a, b) => b.similarity - a.similarity),
    retrievalResultsByQuery,
  };
}

async function persistJudgeScores(
  ragReportId: string,
  noRagReportId: string,
  retrievedChunks: number,
  judgeScores: import("@/lib/rubric").RubricJudgeScores | undefined,
): Promise<void> {
  if (!judgeScores?.noRag || !judgeScores?.rag) return;
  if (Object.keys(judgeScores.noRag).length === 0) return;
  await saveRubricJudgeCache(
    ragReportId,
    noRagReportId,
    retrievedChunks,
    judgeScores,
  );
}

export async function generateRagReport(): Promise<{
  reportId: string;
  content: ReportContent;
  judgeBatched: boolean;
}> {
  resetQuotaFallback();
  const community = await ensureCommunity();
  const { chunks: retrieved, retrievalResultsByQuery } =
    await retrieveChunksForRag();
  const existingNoRag = await getLatestReport("no_rag");
  const existingNoRagContent = existingNoRag?.contentJson as
    | ReportContent
    | undefined;

  await pauseBeforeChat();
  const { content, markdown, judgeScores } = await generateReport({
    mode: "rag",
    communityName: COMMUNITY_NAME,
    communityDescription: COMMUNITY_DESCRIPTION,
    coverageWindow: coverageWindow(),
    retrievedChunks: retrieved.map((r) => ({
      text: r.text,
      sourceTitle: r.sourceTitle,
      sourceUrl: r.sourceUrl,
      similarity: r.similarity,
    })),
    batchJudge: existingNoRagContent
      ? {
          compareContent: existingNoRagContent,
          compareMode: "no_rag",
          retrievedChunkCount: retrieved.length,
        }
      : undefined,
  });

  const report = await prisma.report.create({
    data: {
      communityId: community.id,
      mode: "rag",
      title: content.title,
      contentJson: content as unknown as Prisma.InputJsonValue,
      markdown,
    },
  });

  for (const { query, results } of retrievalResultsByQuery) {
    for (const result of results) {
      await recordRetrieval(result.id, query, result.similarity, report.id);
    }
  }

  if (existingNoRag && judgeScores) {
    await persistJudgeScores(
      report.id,
      existingNoRag.id,
      retrieved.length,
      judgeScores,
    );
  }

  return {
    reportId: report.id,
    content,
    judgeBatched: Boolean(existingNoRag && judgeScores),
  };
}

export async function generateNoRagReport(): Promise<{
  reportId: string;
  content: ReportContent;
  judgeBatched: boolean;
}> {
  resetQuotaFallback();
  const community = await ensureCommunity();
  const existingRag = await getLatestReport("rag");
  const existingRagContent = existingRag?.contentJson as ReportContent | undefined;
  let retrievedChunkCount = 0;

  if (existingRag) {
    retrievedChunkCount = await prisma.retrievalEvent.count({
      where: { reportId: existingRag.id },
    });
  }

  const { content, markdown, judgeScores } = await generateReport({
    mode: "no_rag",
    communityName: COMMUNITY_NAME,
    communityDescription: COMMUNITY_DESCRIPTION,
    coverageWindow: coverageWindow(),
    batchJudge: existingRagContent
      ? {
          compareContent: existingRagContent,
          compareMode: "rag",
          retrievedChunkCount,
        }
      : undefined,
  });

  const report = await prisma.report.create({
    data: {
      communityId: community.id,
      mode: "no_rag",
      title: content.title,
      contentJson: content as unknown as Prisma.InputJsonValue,
      markdown,
    },
  });

  if (existingRag && judgeScores) {
    await persistJudgeScores(
      existingRag.id,
      report.id,
      retrievedChunkCount,
      judgeScores,
    );
  }

  return {
    reportId: report.id,
    content,
    judgeBatched: Boolean(existingRag && judgeScores),
  };
}

export async function generateBatchedComparePair(): Promise<{
  ragReportId: string;
  noRagReportId: string;
  rag: ReportContent;
  noRag: ReportContent;
}> {
  resetQuotaFallback();
  const community = await ensureCommunity();
  const { chunks: retrieved, retrievalResultsByQuery } =
    await retrieveChunksForRag();
  const window = coverageWindow();

  await pauseBeforeChat();
  const result = await generateComparePair({
    communityName: COMMUNITY_NAME,
    communityDescription: COMMUNITY_DESCRIPTION,
    coverageWindow: window,
    retrievedChunks: retrieved.map((r) => ({
      text: r.text,
      sourceTitle: r.sourceTitle,
      sourceUrl: r.sourceUrl,
      similarity: r.similarity,
    })),
  });

  const [noRagReport, ragReport] = await prisma.$transaction([
    prisma.report.create({
      data: {
        communityId: community.id,
        mode: "no_rag",
        title: result.noRag.title,
        contentJson: result.noRag as unknown as Prisma.InputJsonValue,
        markdown: result.noRagMarkdown,
      },
    }),
    prisma.report.create({
      data: {
        communityId: community.id,
        mode: "rag",
        title: result.rag.title,
        contentJson: result.rag as unknown as Prisma.InputJsonValue,
        markdown: result.ragMarkdown,
      },
    }),
  ]);

  for (const { query, results } of retrievalResultsByQuery) {
    for (const chunk of results) {
      await recordRetrieval(chunk.id, query, chunk.similarity, ragReport.id);
    }
  }

  await persistJudgeScores(
    ragReport.id,
    noRagReport.id,
    retrieved.length,
    result.judgeScores,
  );

  return {
    ragReportId: ragReport.id,
    noRagReportId: noRagReport.id,
    rag: result.rag,
    noRag: result.noRag,
  };
}

export async function getLatestReport(mode?: "rag" | "no_rag") {
  // Batched generation creates the RAG and no-RAG reports inside one
  // transaction, so they share an identical `createdAt`. Tie-break toward
  // "rag" ("rag" > "no_rag" lexicographically) so the no-mode query
  // deterministically surfaces the RAG Community Voices Document.
  return prisma.report.findFirst({
    where: mode ? { mode } : undefined,
    orderBy: [{ createdAt: "desc" }, { mode: "desc" }],
  });
}

export type { ReportSummary };

export async function listReports(): Promise<ReportSummary[]> {
  const reports = await prisma.report.findMany({
    orderBy: [{ createdAt: "desc" }, { mode: "desc" }],
    select: {
      id: true,
      title: true,
      mode: true,
      createdAt: true,
    },
  });

  return reports.map((report) => ({
    id: report.id,
    title: report.title,
    mode: report.mode,
    createdAt: report.createdAt.toISOString(),
  }));
}

export async function getReportById(id: string) {
  return prisma.report.findUnique({ where: { id } });
}

type StoredReport = NonNullable<Awaited<ReturnType<typeof getReportById>>>;

export async function enrichReportForApi(report: StoredReport): Promise<{
  report: Omit<StoredReport, "contentJson"> & { contentJson: ReportContent };
  sourceUrlMap: Record<string, string>;
  methodologyStats: ReportMethodologyStats | null;
}> {
  const enriched = await enrichReportVoiceUrls(
    report.contentJson as unknown as ReportContent,
  );
  let content = ensureReportPredictions(enriched);
  if (content.mode === "rag") {
    const chunks = await getReportCitationChunks(report.id);
    content = enrichTopThemeCitations(content, chunks.all, {
      preferChunks: chunks.topThemes,
    });
  }
  const sourceUrlMap = await buildCitationUrlMap(content);

  let retrievedChunks = 0;
  if (content.mode === "rag") {
    const distinct = await prisma.retrievalEvent.findMany({
      where: { reportId: report.id },
      distinct: ["chunkId"],
      select: { chunkId: true },
    });
    retrievedChunks = distinct.length;
  }
  const methodologyStats = await computeReportMethodologyStats(content, {
    retrievedChunks,
  });

  return {
    report: { ...report, contentJson: content },
    sourceUrlMap,
    methodologyStats: content.mode === "rag" ? methodologyStats : null,
  };
}

export async function getCompareReports() {
  const [rag, noRag] = await Promise.all([
    getLatestReport("rag"),
    getLatestReport("no_rag"),
  ]);
  return { rag, noRag };
}

const TOP_THEMES_QUERY = RAG_QUERIES[0];

/** Retrieved chunks linked to a report, for backfilling section citations. */
export async function getReportCitationChunks(
  reportId: string,
): Promise<{ all: ThemeCitationChunk[]; topThemes: ThemeCitationChunk[] }> {
  const events = await prisma.retrievalEvent.findMany({
    where: { reportId },
    include: {
      chunk: {
        include: { document: { include: { source: true } } },
      },
    },
    orderBy: { similarity: "desc" },
  });

  const allByChunk = new Map<string, ThemeCitationChunk>();
  const topThemesByChunk = new Map<string, ThemeCitationChunk>();

  for (const event of events) {
    const chunk: ThemeCitationChunk = {
      sourceTitle: event.chunk.document.source.title,
      similarity: event.similarity,
    };
    if (!allByChunk.has(event.chunkId)) allByChunk.set(event.chunkId, chunk);
    if (event.query === TOP_THEMES_QUERY && !topThemesByChunk.has(event.chunkId)) {
      topThemesByChunk.set(event.chunkId, chunk);
    }
  }

  return {
    all: [...allByChunk.values()],
    topThemes: [...topThemesByChunk.values()],
  };
}
