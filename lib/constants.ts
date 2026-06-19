export const COMMUNITY_NAME = "Hacker News — Devtools & Indie Builders";

export const COMMUNITY_DESCRIPTION =
  "A curated slice of Hacker News focused on developer tools, AI coding assistants, databases, self-hosting, SaaS pricing, open source, infrastructure, and indie products. This community is active, opinionated, and highly technical — ideal for RAG-powered weekly digests.";

export const INGESTION_QUERIES = [
  "devtools",
  "developer tools",
  "AI coding",
  "postgres",
  "database",
  "self-hosted",
  "open source",
  "SaaS",
  "infrastructure",
  "frontend",
  "deployment",
  "observability",
  "security",
] as const;

/** Algolia tag-based fetches (broader candidate pools) */
export const INGESTION_TAG_FETCHES = ["show_hn", "ask_hn"] as const;

/**
 * Lower keep bound. Items scoring between RELEVANCE_THRESHOLD and
 * STRONG_RELEVANCE_THRESHOLD are only kept if they also contain a strong
 * devtools-builder keyword (see lib/relevance.ts two-tier logic).
 */
export const RELEVANCE_THRESHOLD = 0.45;

/** Items at or above this score are kept unconditionally. */
export const STRONG_RELEVANCE_THRESHOLD = 0.55;

/** When true, relevance scoring also calls OpenAI embeddings (1 extra call per candidate). Default off to save quota. */
export function isRelevanceEmbeddingsEnabled(): boolean {
  return process.env.RELEVANCE_USE_EMBEDDINGS === "true";
}

export const EMBEDDING_DIMENSIONS = 1536;
export const MIN_COMMENT_LENGTH = 40;
export const MAX_CHUNKS = 1500;
export const MIN_CHUNKS_TARGET = 300;
export const CHUNK_WORDS_MIN = 120;
export const CHUNK_WORDS_MAX = 200;
export const RETRIEVAL_TOP_K = 8;

/** Max retrieved chunks sent to report/judge chat prompts (reduces TPM spikes). */
export function reportPromptMaxChunks(): number {
  const value = parseInt(process.env.OPENAI_REPORT_MAX_CHUNKS ?? "16", 10);
  return Number.isFinite(value) && value > 0 ? value : 16;
}

export function limitChunksForPrompt<T extends { similarity: number }>(
  chunks: T[],
  max = reportPromptMaxChunks(),
): T[] {
  return [...chunks].sort((a, b) => b.similarity - a.similarity).slice(0, max);
}

export const TOPIC_COLORS: Record<string, string> = {
  "AI Coding": "#6366f1",
  Databases: "#0ea5e9",
  "Self-Hosting": "#10b981",
  "Open Source": "#f59e0b",
  SaaS: "#ec4899",
  Infrastructure: "#8b5cf6",
  "Indie Products": "#14b8a6",
  "Developer Tools": "#64748b",
  General: "#94a3b8",
};

export const RAG_QUERIES = [
  "What were the top themes in HN devtools discussions this week?",
  "What were developers complaining about?",
  "What tools or ideas were people excited about?",
  "What disagreements or debates appeared?",
  "What might this community discuss next week?",
] as const;

/** Maps each RAG retrieval query to the report section it feeds. */
export const RAG_QUERY_SECTIONS: Record<string, string> = {
  "What were the top themes in HN devtools discussions this week?": "Top Themes",
  "What were developers complaining about?": "Complaints",
  "What tools or ideas were people excited about?": "Excitement",
  "What disagreements or debates appeared?": "Disagreements",
  "What might this community discuss next week?": "Predictions",
};

export function sectionForQuery(query: string): string {
  return RAG_QUERY_SECTIONS[query] ?? "Other";
}
