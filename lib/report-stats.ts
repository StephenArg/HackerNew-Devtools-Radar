import prisma from "@/lib/db";
import { countCitations, countUniqueSources } from "@/lib/rubric";
import type { ReportContent, ReportMethodologyStats } from "@/types";

/**
 * Compute the methodology counts surfaced in the report's Source Coverage
 * section. Corpus counts come from the database; citation/source counts are
 * derived from the report content. Nothing here is hardcoded.
 */
export async function computeReportMethodologyStats(
  content: ReportContent,
  options: { retrievedChunks?: number } = {},
): Promise<ReportMethodologyStats> {
  const [sources, documents, embeddedSnippets] = await Promise.all([
    prisma.source.count(),
    prisma.document.count(),
    prisma.chunk.count(),
  ]);

  return {
    sources,
    documents,
    embeddedSnippets,
    retrievedChunks: options.retrievedChunks ?? 0,
    inlineCitations: countCitations(content),
    uniqueCitedSources: countUniqueSources(content),
    coverageWindow: content.coverageWindow,
    mode: content.mode,
  };
}
