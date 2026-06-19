import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { computeCompareMetrics } from "@/lib/metrics";
import { ensureReportPredictions, enrichTopThemeCitations } from "@/lib/report-content";
import { buildCitationUrlMap, enrichReportVoiceUrls } from "@/lib/report-voices";
import { computeReportMethodologyStats } from "@/lib/report-stats";
import { computeRubricEvaluation } from "@/lib/rubric";
import { getCompareReports, getReportCitationChunks } from "@/lib/reports";
import type { ReportContent } from "@/types";
import type { ThemeCitationChunk } from "@/lib/report-content";

async function withEnrichedContent<T extends { id: string; contentJson: unknown }>(
  report: T | null,
  citationChunks?: { all: ThemeCitationChunk[]; topThemes: ThemeCitationChunk[] },
): Promise<(T & { contentJson: ReportContent }) | null> {
  if (!report) return null;
  const enriched = await enrichReportVoiceUrls(report.contentJson as unknown as ReportContent);
  let content = ensureReportPredictions(enriched);
  if (content.mode === "rag" && citationChunks && citationChunks.all.length > 0) {
    content = enrichTopThemeCitations(content, citationChunks.all, {
      preferChunks: citationChunks.topThemes,
    });
  }
  return { ...report, contentJson: content };
}

export async function GET() {
  try {
    const { rag, noRag } = await getCompareReports();

    let retrievedChunks = 0;
    if (rag) {
      // Count DISTINCT chunks retrieved for this report (a chunk can be
      // retrieved by multiple section queries) so this matches the unique
      // chunk count cached at generation time.
      const distinct = await prisma.retrievalEvent.findMany({
        where: { reportId: rag.id },
        distinct: ["chunkId"],
        select: { chunkId: true },
      });
      retrievedChunks = distinct.length;
    }

    const ragCitationChunks = rag
      ? await getReportCitationChunks(rag.id)
      : undefined;

    const [enrichedRag, enrichedNoRag, metrics, rubric] = await Promise.all([
      withEnrichedContent(rag, ragCitationChunks),
      withEnrichedContent(noRag),
      Promise.resolve(
        computeCompareMetrics(
          rag?.contentJson as ReportContent | null,
          noRag?.contentJson as ReportContent | null,
          retrievedChunks,
        ),
      ),
      computeRubricEvaluation(
        rag?.contentJson as ReportContent | null,
        noRag?.contentJson as ReportContent | null,
        { retrievedChunks },
        {
          ragReportId: rag?.id,
          noRagReportId: noRag?.id,
        },
      ),
    ]);

    const sourceUrlMap = enrichedRag
      ? await buildCitationUrlMap(enrichedRag.contentJson)
      : {};
    const methodologyStats = enrichedRag
      ? await computeReportMethodologyStats(enrichedRag.contentJson, {
          retrievedChunks,
        })
      : null;

    return NextResponse.json({
      rag: enrichedRag,
      noRag: enrichedNoRag,
      metrics,
      rubric,
      sourceUrlMap,
      methodologyStats,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Compare failed" },
      { status: 500 },
    );
  }
}
