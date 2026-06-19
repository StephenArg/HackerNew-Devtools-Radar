import type { ReportContent, RubricEvaluation } from "@/types";
import { getAIStatus } from "@/lib/ai";
import { predictionToText } from "@/lib/report-content";
import { getRubricJudgeCache } from "@/lib/rubric-cache";
import { extractThemes } from "@/lib/topics";
import { stripHtml } from "@/lib/utils";

export interface RubricContext {
  retrievedChunks: number;
}

export interface RubricJudgeScores {
  noRag: Record<string, number>;
  rag: Record<string, number>;
}

export interface RubricEvaluationOptions {
  ragReportId?: string;
  noRagReportId?: string;
  judgeScores?: RubricJudgeScores | null;
  judgeBatched?: boolean;
}

interface CategoryDef {
  id: string;
  name: string;
  maxPoints: number;
  description: string;
}

export const RUBRIC_CATEGORIES: CategoryDef[] = [
  {
    id: "groundedness",
    name: "Groundedness",
    maxPoints: 25,
    description: "Claims supported by retrieved community sources.",
  },
  {
    id: "specificity",
    name: "Specificity",
    maxPoints: 20,
    description: "Concrete topics, examples, debates, and pain points.",
  },
  {
    id: "citationQuality",
    name: "Citation Quality",
    maxPoints: 15,
    description: "Relevant citations attached to the right claims.",
  },
  {
    id: "coverage",
    name: "Coverage",
    maxPoints: 15,
    description: "Multiple important weekly themes represented.",
  },
  {
    id: "predictionQuality",
    name: "Prediction Quality",
    maxPoints: 10,
    description: "Next-week predictions grounded in observed discussions.",
  },
  {
    id: "insightfulness",
    name: "Insightfulness",
    maxPoints: 10,
    description: "Synthesizes meaning instead of only listing topics.",
  },
  {
    id: "clarity",
    name: "Clarity",
    maxPoints: 5,
    description: "Readable, organized, and useful structure.",
  },
];

export function summarizeReportForJudge(content: ReportContent) {
  return {
    title: content.title,
    mode: content.mode,
    executiveSummary: stripHtml(content.executiveSummary).slice(0, 600),
    topThemes: content.topThemes.slice(0, 6),
    excitedAbout: content.excitedAbout.slice(0, 4),
    complaints: content.complaints.slice(0, 4),
    disagreements: content.disagreements.slice(0, 4),
    predictions: content.predictions.slice(0, 5).map(predictionToText),
    representativeVoices: content.representativeVoices.slice(0, 4).map((voice) => ({
      quote: stripHtml(voice.quote).slice(0, 200),
      sourceTitle: stripHtml(voice.sourceTitle),
      citation: voice.citation,
    })),
    methodology: stripHtml(content.methodology).slice(0, 300),
    citationCount: countCitations(content),
  };
}

export interface JudgeEvidence {
  retrievedChunks: number;
  citations: number;
  voicesWithCitations: number;
  uniqueSources: number;
  themes: number;
}

export function judgeEvidence(
  content: ReportContent | null,
  retrievedChunks: number,
): JudgeEvidence {
  if (!content) {
    return {
      retrievedChunks,
      citations: 0,
      voicesWithCitations: 0,
      uniqueSources: 0,
      themes: 0,
    };
  }
  return {
    retrievedChunks,
    citations: countCitations(content),
    voicesWithCitations: countVoicesWithCitations(content),
    uniqueSources: countUniqueSources(content),
    themes: themeCount(content),
  };
}

/**
 * Strict, evidence-anchored scoring rules shared by every judge prompt so the
 * LLM judge stays calibrated with the deterministic heuristics instead of
 * inflating scores. Returned text is appended to the report-generation prompt.
 */
export function buildJudgeInstructions(
  noRagEvidence: JudgeEvidence,
  ragEvidence: JudgeEvidence,
): string {
  return `Score BOTH reports on this rubric. BE STRICT AND CONSISTENT WITH THE MEASURED EVIDENCE BELOW — do not inflate.

Caps: groundedness 25, specificity 20, citationQuality 15, coverage 15, predictionQuality 10, insightfulness 10, clarity 5.

Scoring rules (anchor to the evidence, not vibes):
- A score above 85% of a category cap requires strong, specific, source-backed evidence.
- If a report has 0 citations: citationQuality = 0, and groundedness must be <= 30% of cap.
- A generic report with 0 retrieved chunks and 0 unique sources must score LOW on groundedness, specificity, and citationQuality.
- predictionQuality, insightfulness, and clarity should sit mid-range unless the report is clearly exceptional.
- The RAG report should only beat the no-RAG report where its evidence (citations, chunks, sources) is actually higher.

Measured evidence (use these to anchor scores):
- NO-RAG: citations=${noRagEvidence.citations}, voicesWithCitations=${noRagEvidence.voicesWithCitations}, uniqueSources=${noRagEvidence.uniqueSources}, themes=${noRagEvidence.themes}, retrievedChunks=0
- RAG: citations=${ragEvidence.citations}, voicesWithCitations=${ragEvidence.voicesWithCitations}, uniqueSources=${ragEvidence.uniqueSources}, themes=${ragEvidence.themes}, retrievedChunks=${ragEvidence.retrievedChunks}

Include a top-level "rubricJudge" object:
{
  "noRag": { "groundedness": number, "specificity": number, "citationQuality": number, "coverage": number, "predictionQuality": number, "insightfulness": number, "clarity": number },
  "rag": { "groundedness": number, "specificity": number, "citationQuality": number, "coverage": number, "predictionQuality": number, "insightfulness": number, "clarity": number }
}`;
}

export function buildRubricJudgePromptSection(
  retrievedChunks: number,
  noRag: ReportContent,
  rag: ReportContent,
): string {
  const instructions = buildJudgeInstructions(
    judgeEvidence(noRag, 0),
    judgeEvidence(rag, retrievedChunks),
  );
  return `${instructions}

NO-RAG REPORT SUMMARY:
${JSON.stringify(summarizeReportForJudge(noRag))}

RAG REPORT SUMMARY:
${JSON.stringify(summarizeReportForJudge(rag))}`;
}

export function parseRubricJudgeScores(raw: unknown): RubricJudgeScores | null {
  if (!raw || typeof raw !== "object") return null;
  const scores = raw as RubricJudgeScores;
  if (!scores.noRag || !scores.rag) return null;
  return scores;
}

function capFor(categoryId: string): number {
  return RUBRIC_CATEGORIES.find((c) => c.id === categoryId)?.maxPoints ?? 0;
}

/**
 * Deterministically pull LLM judge scores back in line with measured evidence so
 * they don't diverge from the heuristics. Applies the same hard rules the judge
 * prompt states, guaranteeing calibration even when the model inflates.
 */
function reconcileOneReport(
  scores: Record<string, number>,
  content: ReportContent | null,
  retrievedChunks: number,
): Record<string, number> {
  const evidence = judgeEvidence(content, retrievedChunks);
  const out: Record<string, number> = {};
  for (const category of RUBRIC_CATEGORIES) {
    const raw = Number(scores[category.id]);
    out[category.id] = Number.isFinite(raw)
      ? Math.max(0, Math.min(category.maxPoints, Math.round(raw)))
      : 0;
  }

  if (evidence.citations === 0) {
    out.citationQuality = Math.min(out.citationQuality, 1);
    out.groundedness = Math.min(out.groundedness, Math.round(capFor("groundedness") * 0.3));
  }
  if (evidence.retrievedChunks === 0 && evidence.uniqueSources === 0) {
    out.groundedness = Math.min(out.groundedness, Math.round(capFor("groundedness") * 0.3));
    out.citationQuality = Math.min(out.citationQuality, 2);
    out.specificity = Math.min(out.specificity, Math.round(capFor("specificity") * 0.6));
  }

  return out;
}

export function reconcileJudgeScores(
  judge: RubricJudgeScores,
  ragContent: ReportContent | null,
  noRagContent: ReportContent | null,
  retrievedChunks: number,
): RubricJudgeScores {
  return {
    noRag: reconcileOneReport(judge.noRag ?? {}, noRagContent, 0),
    rag: reconcileOneReport(judge.rag ?? {}, ragContent, retrievedChunks),
  };
}

const SPECIFICITY_MARKERS = [
  "sqlite",
  "postgres",
  "mcp",
  "self-host",
  "show hn",
  "ask hn",
  "pgvector",
  "cursor",
  "saas",
  "pricing",
  "open source",
  "open-source",
  "devtools",
  "kubernetes",
  "observability",
  "agentic",
  "pr review",
  "local model",
  "monetization",
  "monetiz",
  "vendor lock-in",
  "reliability",
  "ci/cd",
];

/**
 * Collect every section's text where inline [Source: ...] citations may appear,
 * so citation counting reflects the full report rather than a few sections.
 */
function citationBearingText(content: ReportContent): string[] {
  const signalText = (content.signals ?? []).flatMap((s) => [
    s.signal,
    s.evidence,
    s.interpretation,
    ...s.sources,
  ]);
  return [
    content.executiveSummary,
    ...content.topThemes,
    ...content.excitedAbout,
    ...content.complaints,
    ...content.disagreements,
    ...content.predictions.map(predictionToText),
    ...content.representativeVoices.map((v) => `${v.quote} ${v.citation ?? ""}`),
    ...signalText,
  ];
}

export function countCitations(content: ReportContent): number {
  const citationPattern = /\[Source:/g;
  return citationBearingText(content).reduce(
    (sum, text) => sum + (text.match(citationPattern)?.length ?? 0),
    0,
  );
}

function countVoicesWithCitations(content: ReportContent): number {
  return content.representativeVoices.filter(
    (v) => v.citation || /\[Source:/.test(v.quote),
  ).length;
}

export function countUniqueSources(content: ReportContent): number {
  const titles = new Set<string>();
  for (const voice of content.representativeVoices) {
    if (voice.sourceTitle) titles.add(stripHtml(voice.sourceTitle).toLowerCase());
  }
  // Inline [Source: title, ...] citations anywhere in the report.
  const inlinePattern = /\[Source:\s*([^,\]]+)/gi;
  for (const text of citationBearingText(content)) {
    let match: RegExpExecArray | null;
    const re = new RegExp(inlinePattern);
    while ((match = re.exec(text)) !== null) {
      if (match[1]) titles.add(stripHtml(match[1].trim()).toLowerCase());
    }
  }
  for (const citation of content.citations ?? []) {
    const match = citation.match(/\[Source:\s*([^,\]]+)/i);
    if (match?.[1]) titles.add(stripHtml(match[1].trim()).toLowerCase());
  }
  titles.delete("");
  return titles.size;
}

function reportText(content: ReportContent): string {
  return stripHtml(JSON.stringify(content)).toLowerCase();
}

function markerHits(content: ReportContent): number {
  const text = reportText(content);
  return SPECIFICITY_MARKERS.filter((marker) => text.includes(marker)).length;
}

function themeCount(content: ReportContent): number {
  return extractThemes([
    ...content.topThemes,
    ...content.excitedAbout,
    ...content.complaints,
    ...content.disagreements,
    ...content.predictions.map(predictionToText),
  ]).length;
}

function listDepth(content: ReportContent): number {
  return (
    content.topThemes.length +
    content.excitedAbout.length +
    content.complaints.length +
    content.disagreements.length +
    content.predictions.length
  );
}

function predictionThemeOverlap(content: ReportContent): number {
  const themes = [
    ...content.topThemes,
    ...content.excitedAbout,
    ...content.complaints,
  ]
    .join(" ")
    .toLowerCase();
  return content.predictions.filter((prediction) => {
    const words = stripHtml(predictionToText(prediction))
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4);
    return words.some((word) => themes.includes(word));
  }).length;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

interface WeightedSignal {
  value: number;
  weight: number;
  scale: number;
}

/** 0–1 with diminishing returns so strong signals help without auto-maxed scores */
function saturate(value: number, scale: number): number {
  if (value <= 0 || scale <= 0) return 0;
  return 1 - Math.exp(-value / scale);
}

function weightedSignalRatio(signals: WeightedSignal[]): number {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = signals.reduce(
    (sum, signal) => sum + signal.weight * saturate(signal.value, signal.scale),
    0,
  );
  return weighted / totalWeight;
}

function scoreFromSignals(signals: WeightedSignal[], maxPoints: number): number {
  return clamp(weightedSignalRatio(signals) * maxPoints, maxPoints);
}

function scoreHeuristicCategory(
  categoryId: string,
  content: ReportContent | null,
  mode: "rag" | "no_rag",
  ctx: RubricContext,
): number {
  if (!content) return 0;

  const citations = countCitations(content);
  const voices = content.representativeVoices.length;
  const voicesWithCitations = countVoicesWithCitations(content);
  const uniqueSources = countUniqueSources(content);
  const markers = markerHits(content);
  const themes = themeCount(content);
  const predictions = content.predictions.length;
  const predictionOverlap = predictionThemeOverlap(content);
  const disagreements = content.disagreements.length;
  const depth = listDepth(content);
  const summaryLength = stripHtml(content.executiveSummary).length;

  switch (categoryId) {
    case "groundedness":
      if (mode === "no_rag") {
        return scoreFromSignals(
          [
            { value: citations, weight: 0.45, scale: 5 },
            { value: voices, weight: 0.35, scale: 6 },
            { value: uniqueSources, weight: 0.2, scale: 3 },
          ],
          25,
        );
      }
      return scoreFromSignals(
        [
          { value: ctx.retrievedChunks, weight: 0.35, scale: 10 },
          { value: citations, weight: 0.25, scale: 6 },
          { value: voicesWithCitations, weight: 0.25, scale: 3 },
          { value: uniqueSources, weight: 0.15, scale: 6 },
        ],
        25,
      );
    case "specificity":
      if (mode === "no_rag") {
        return scoreFromSignals(
          [
            { value: markers, weight: 0.5, scale: 6 },
            { value: disagreements, weight: 0.3, scale: 3 },
            { value: voices, weight: 0.2, scale: 4 },
          ],
          20,
        );
      }
      return scoreFromSignals(
        [
          { value: markers, weight: 0.35, scale: 4 },
          { value: voices, weight: 0.3, scale: 3 },
          { value: disagreements, weight: 0.2, scale: 2 },
          { value: uniqueSources, weight: 0.15, scale: 4 },
        ],
        20,
      );
    case "citationQuality":
      if (mode === "no_rag") {
        return scoreFromSignals(
          [
            { value: citations, weight: 0.55, scale: 5 },
            { value: voicesWithCitations, weight: 0.45, scale: 4 },
          ],
          15,
        );
      }
      return scoreFromSignals(
        [
          { value: citations, weight: 0.35, scale: 6 },
          { value: voicesWithCitations, weight: 0.4, scale: 3 },
          { value: uniqueSources, weight: 0.25, scale: 6 },
        ],
        15,
      );
    case "coverage":
      return scoreFromSignals(
        [
          { value: themes, weight: 0.35, scale: 6 },
          { value: content.topThemes.length, weight: 0.25, scale: 4 },
          { value: depth, weight: 0.25, scale: 12 },
          {
            value: mode === "rag" ? uniqueSources : 0,
            weight: mode === "rag" ? 0.15 : 0,
            scale: 6,
          },
        ],
        15,
      );
    case "predictionQuality":
      return scoreFromSignals(
        [
          { value: predictions, weight: 0.35, scale: 3 },
          { value: predictionOverlap, weight: 0.45, scale: 2 },
          {
            value: mode === "rag" ? markers : Math.max(0, markers - 1),
            weight: 0.2,
            scale: 4,
          },
        ],
        10,
      );
    case "insightfulness":
      return scoreFromSignals(
        [
          { value: disagreements, weight: 0.35, scale: 2 },
          { value: summaryLength, weight: 0.25, scale: 250 },
          { value: voices, weight: 0.2, scale: 3 },
          { value: themes, weight: 0.2, scale: 5 },
        ],
        10,
      );
    case "clarity":
      return clamp(
        saturate(summaryLength, 300) * 1.5 +
          saturate(content.topThemes.length, 6) * 1.1 +
          saturate(content.predictions.length, 6) * 1.1 +
          (content.methodology ? 1 : 0) +
          saturate(depth, 24) * 1.1,
        5,
      );
    default:
      return 0;
  }
}

export function getRubricHeuristicRatio(
  categoryId: string,
  content: ReportContent | null,
  mode: "rag" | "no_rag",
  ctx: RubricContext,
): number {
  const category = RUBRIC_CATEGORIES.find((item) => item.id === categoryId);
  if (!category || !content) return 0;
  return scoreHeuristicCategory(categoryId, content, mode, ctx) / category.maxPoints;
}

function comparisonNote(
  category: CategoryDef,
  ragFinal: number,
  noRagFinal: number,
  ctx: RubricContext,
  rag: ReportContent | null,
  noRag: ReportContent | null,
): string {
  const delta = ragFinal - noRagFinal;
  const ragCitations = rag ? countCitations(rag) : 0;
  const noRagCitations = noRag ? countCitations(noRag) : 0;
  const ragSources = rag ? countUniqueSources(rag) : 0;

  if (category.id === "groundedness") {
    if (delta >= 5) {
      return `RAG links claims to ${ctx.retrievedChunks} retrieved chunks and ${ragCitations} inline citations; no-RAG lacks retrieval-backed evidence.`;
    }
    return "RAG shows modest grounding advantage from retrieved community text.";
  }

  if (category.id === "citationQuality") {
    if (delta >= 4) {
      return `RAG attaches ${ragCitations} source citations across claims; no-RAG has ${noRagCitations}.`;
    }
    return "Citation advantage is limited because neither report cites sources heavily.";
  }

  if (category.id === "coverage") {
    return delta >= 3
      ? `RAG spans ${ragSources} unique sources and broader theme coverage from ingested HN threads.`
      : "Both reports cover a similar number of themes this week.";
  }

  if (category.id === "specificity") {
    return delta >= 4
      ? "RAG names more concrete tools, threads, and community debates instead of generic summaries."
      : "Specificity is close; RAG adds only slightly more concrete community detail.";
  }

  if (category.id === "predictionQuality") {
    return delta >= 2
      ? "RAG predictions reference observed weekly themes more directly."
      : "Predictions in both reports stay fairly general.";
  }

  if (category.id === "insightfulness") {
    return delta >= 2
      ? "RAG synthesizes disagreements and representative voices into clearer takeaways."
      : "Both reports read more like summaries than deep synthesis.";
  }

  if (category.id === "clarity") {
    return delta >= 1
      ? "RAG keeps the same structured sections with slightly richer detail."
      : "Both reports are similarly organized and readable.";
  }

  if (delta >= 3) return `RAG outperforms by ${delta} points on ${category.name.toLowerCase()}.`;
  if (delta <= -3) {
    return `No-RAG unexpectedly leads by ${Math.abs(delta)} points on ${category.name.toLowerCase()}.`;
  }
  return `Scores are close on ${category.name.toLowerCase()}.`;
}

function averageScores(heuristic: number, judge: number | undefined, max: number): number {
  if (judge === undefined) return heuristic;
  return clamp((heuristic + clamp(judge, max)) / 2, max);
}

function heuristicOnlyReason(
  rag: ReportContent | null,
  noRag: ReportContent | null,
): string {
  const status = getAIStatus();
  if (status === "mock") {
    if (process.env.MOCK_MODE === "true") {
      return "Deterministic heuristics only (MOCK_MODE=true)";
    }
    return "Deterministic heuristics only (no OPENAI_API_KEY configured)";
  }
  if (status === "quota_fallback") {
    return "Deterministic heuristics only (OpenAI quota exceeded earlier — restart pnpm dev after fixing billing)";
  }
  if (!rag || !noRag) {
    return "Deterministic heuristics only (both reports required for batched judging)";
  }
  return "Deterministic heuristics only — use Generate Both + Judge or regenerate the paired report to batch LLM judging";
}

export async function computeRubricEvaluation(
  rag: ReportContent | null,
  noRag: ReportContent | null,
  ctx: RubricContext,
  options: RubricEvaluationOptions = {},
): Promise<RubricEvaluation> {
  let judgeScores = options.judgeScores ?? null;
  let judgeBatched = options.judgeBatched ?? false;

  if (
    !judgeScores &&
    options.ragReportId &&
    options.noRagReportId
  ) {
    judgeScores = await getRubricJudgeCache(
      options.ragReportId,
      options.noRagReportId,
    );
    if (judgeScores) judgeBatched = true;
  }

  const judgeUsed = judgeScores !== null;

  const categories = RUBRIC_CATEGORIES.map((category) => {
    const noRagHeuristic = scoreHeuristicCategory(
      category.id,
      noRag,
      "no_rag",
      ctx,
    );
    const ragHeuristic = scoreHeuristicCategory(category.id, rag, "rag", ctx);
    const noRagJudge = judgeScores?.noRag[category.id];
    const ragJudge = judgeScores?.rag[category.id];
    const noRagFinal = averageScores(noRagHeuristic, noRagJudge, category.maxPoints);
    const ragFinal = averageScores(ragHeuristic, ragJudge, category.maxPoints);

    return {
      id: category.id,
      name: category.name,
      maxPoints: category.maxPoints,
      description: category.description,
      noRagScore: noRagFinal,
      ragScore: ragFinal,
      noRagHeuristic,
      ragHeuristic,
      noRagJudge: noRagJudge ?? null,
      ragJudge: ragJudge ?? null,
      comparison: comparisonNote(
        category,
        ragFinal,
        noRagFinal,
        ctx,
        rag,
        noRag,
      ),
    };
  });

  const sum = (key: "noRagScore" | "ragScore" | "noRagHeuristic" | "ragHeuristic") =>
    categories.reduce((total, category) => total + category[key], 0);

  const noRagJudgeTotal = judgeUsed
    ? categories.reduce((total, c) => total + (c.noRagJudge ?? c.noRagHeuristic), 0)
    : null;
  const ragJudgeTotal = judgeUsed
    ? categories.reduce((total, c) => total + (c.ragJudge ?? c.ragHeuristic), 0)
    : null;

  return {
    categories,
    totals: {
      noRag: sum("noRagScore"),
      rag: sum("ragScore"),
      max: 100,
      noRagHeuristic: sum("noRagHeuristic"),
      ragHeuristic: sum("ragHeuristic"),
      noRagJudge: noRagJudgeTotal,
      ragJudge: ragJudgeTotal,
    },
    judgeUsed,
    judgeBatched,
    scoringMethod: judgeUsed
      ? judgeBatched
        ? "Average of heuristics and LLM judge scores (batched with report generation)"
        : "Average of deterministic heuristics and LLM judge scores"
      : heuristicOnlyReason(rag, noRag),
  };
}
