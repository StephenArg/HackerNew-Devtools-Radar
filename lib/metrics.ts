import type { CompareMetrics, ReportContent } from "@/types";
import { countCitations, getRubricHeuristicRatio, type RubricContext } from "@/lib/rubric";
import { extractThemes } from "@/lib/topics";

export function computeCompareMetrics(
  rag: ReportContent | null,
  noRag: ReportContent | null,
  retrievedChunks = 0,
): CompareMetrics {
  const ctx: RubricContext = { retrievedChunks };
  const ragThemes = rag
    ? extractThemes([
        ...rag.topThemes,
        ...rag.excitedAbout,
        ...rag.complaints,
      ])
    : [];
  const noRagThemes = noRag
    ? extractThemes([
        ...noRag.topThemes,
        ...noRag.excitedAbout,
        ...noRag.complaints,
      ])
    : [];

  return {
    groundedness: {
      rag: getRubricHeuristicRatio("groundedness", rag, "rag", ctx),
      noRag: getRubricHeuristicRatio("groundedness", noRag, "no_rag", ctx),
    },
    specificity: {
      rag: getRubricHeuristicRatio("specificity", rag, "rag", ctx),
      noRag: getRubricHeuristicRatio("specificity", noRag, "no_rag", ctx),
    },
    citationCount: {
      rag: rag ? countCitations(rag) : 0,
      noRag: noRag ? countCitations(noRag) : 0,
    },
    retrievedChunks: {
      rag: retrievedChunks,
      noRag: 0,
    },
    repeatedThemes: {
      rag: ragThemes,
      noRag: noRagThemes,
    },
  };
}
