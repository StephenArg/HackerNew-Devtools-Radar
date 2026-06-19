/** Evidence-grounded prediction. Wire-compatible with legacy plain strings. */
export interface ReportPrediction {
  prediction: string;
  why?: string;
  sources?: string[];
}

export type ReportPredictionItem = string | ReportPrediction;

export interface ReportContent {
  title: string;
  coverageWindow: string;
  executiveSummary: string;
  topThemes: string[];
  excitedAbout: string[];
  complaints: string[];
  disagreements: string[];
  representativeVoices: Array<{
    quote: string;
    sourceTitle: string;
    sourceUrl?: string;
    citation?: string;
  }>;
  predictions: ReportPredictionItem[];
  signals?: Array<{
    signal: string;
    evidence: string;
    interpretation: string;
    sources: string[];
  }>;
  methodology: string;
  mode: "rag" | "no_rag";
  citations?: string[];
}

export interface ReportSummary {
  id: string;
  title: string;
  mode: string;
  createdAt: string;
}

/** Counts surfaced in the report's Source Coverage / Methodology section. */
export interface ReportMethodologyStats {
  sources: number;
  documents: number;
  embeddedSnippets: number;
  retrievedChunks: number;
  inlineCitations: number;
  uniqueCitedSources: number;
  coverageWindow: string;
  mode: "rag" | "no_rag";
}

export interface RetrievedChunk {
  id: string;
  text: string;
  topic: string;
  sourceTitle: string;
  sourceUrl: string;
  similarity: number;
}

export interface StatsResponse {
  sources: number;
  documents: number;
  chunks: number;
  reports: number;
  latestIngestion: string | null;
  mockMode: boolean;
  aiStatus: "mock" | "openai" | "quota_fallback";
  community: {
    name: string;
    description: string;
  };
}

export interface CompareMetrics {
  groundedness: { rag: number; noRag: number };
  specificity: { rag: number; noRag: number };
  citationCount: { rag: number; noRag: number };
  retrievedChunks: { rag: number; noRag: number };
  repeatedThemes: { rag: string[]; noRag: string[] };
}

export interface RubricCategoryRow {
  id: string;
  name: string;
  maxPoints: number;
  description: string;
  noRagScore: number;
  ragScore: number;
  noRagHeuristic: number;
  ragHeuristic: number;
  noRagJudge: number | null;
  ragJudge: number | null;
  comparison: string;
}

export interface RubricEvaluation {
  categories: RubricCategoryRow[];
  totals: {
    noRag: number;
    rag: number;
    max: number;
    noRagHeuristic: number;
    ragHeuristic: number;
    noRagJudge: number | null;
    ragJudge: number | null;
  };
  judgeUsed: boolean;
  judgeBatched?: boolean;
  scoringMethod: string;
}

export interface EmbeddingProjection {
  x: number;
  y: number;
}

export interface EmbeddingPoint {
  id: string;
  pca: EmbeddingProjection;
  umap: EmbeddingProjection;
  topic: string;
  text: string;
  sourceTitle: string;
  sourceUrl?: string;
  retrievalCount: number;
}

export interface SourceRow {
  id: string;
  title: string;
  platform: string;
  author: string | null;
  createdAtExternal: string;
  url: string;
  points: number | null;
  numComments: number | null;
  chunkCount: number;
  relevanceScore: number | null;
  relevanceCategory: string | null;
  relevanceReason: string | null;
}

export interface InfluentialSnippet {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  topic: string;
  preview: string;
  retrievalCount: number;
  avgSimilarity: number | null;
  usedInSections: string[];
}
