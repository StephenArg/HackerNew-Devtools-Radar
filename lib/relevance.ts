import {
  COMMUNITY_DESCRIPTION,
  RELEVANCE_THRESHOLD,
  STRONG_RELEVANCE_THRESHOLD,
  isRelevanceEmbeddingsEnabled,
} from "@/lib/constants";
import { cosineSimilarity, getEmbedding, isMockMode } from "@/lib/ai";

export interface RelevanceInput {
  title: string;
  text: string;
  tags?: string[];
  searchQuery?: string;
  searchTag?: string;
}

/** Canonical relevance categories for the HN devtools / builder community. */
export type RelevanceCategory =
  | "ai_coding"
  | "developer_tools"
  | "databases"
  | "self_hosting"
  | "open_source"
  | "infrastructure"
  | "frontend_tooling"
  | "backend_tooling"
  | "devops"
  | "observability"
  | "security"
  | "saas_pricing"
  | "indie_products"
  | "engineering_workflow"
  | "not_relevant";

/**
 * Strong devtools/builder keywords. An item scoring just below the primary
 * threshold is still kept if it contains at least one of these (see
 * scoreRelevance two-tier logic). Matched with word boundaries to avoid
 * substring false positives (e.g. "ci" inside "social").
 */
export const STRONG_KEYWORDS = [
  "api",
  "cli",
  "sdk",
  "database",
  "postgres",
  "sqlite",
  "redis",
  "vector",
  "embedding",
  "rag",
  "ci/cd",
  "ci",
  "cd",
  "developer",
  "devtool",
  "devtools",
  "code",
  "coding",
  "programming",
  "agent",
  "agents",
  "ai coding",
  "open source",
  "oss",
  "self-hosted",
  "self hosting",
  "observability",
  "monitoring",
  "framework",
  "library",
  "github",
  "git",
  "terminal",
  "deployment",
  "infrastructure",
  "kubernetes",
  "docker",
  "server",
  "backend",
  "frontend",
  "security tool",
  "testing",
  "test automation",
  "compiler",
  "runtime",
  "npm",
  "package",
  "workflow",
  "automation",
] as const;

const STRONG_KEYWORD_REGEXES = STRONG_KEYWORDS.map(
  (kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`),
);

/** True if the title/text clearly contains a strong devtools-builder keyword. */
export function hasStrongKeyword(text: string): boolean {
  const haystack = text.toLowerCase();
  return STRONG_KEYWORD_REGEXES.some((re) => re.test(haystack));
}

export interface RelevanceResult {
  score: number;
  keywordScore: number;
  embeddingScore: number | null;
  passed: boolean;
  category: RelevanceCategory;
  reason: string;
  matchedSignals: string[];
}

interface CommunitySignal {
  label: string;
  category: RelevanceCategory;
  keywords: string[];
  weight: number;
}

const COMMUNITY_SIGNALS: CommunitySignal[] = [
  {
    // Only genuine coding/engineering AI. Generic AI terms ("gpt", "image
    // generator", "ai art") are intentionally excluded so consumer/AI-news
    // stories do not get classified as ai_coding.
    label: "ai_coding",
    category: "ai_coding",
    keywords: [
      "ai coding",
      "coding agent",
      "coding assistant",
      "code generation",
      "copilot",
      "cursor",
      "agentic coding",
      "code review",
      "pr review",
      "ai pair",
      "llm",
      "claude code",
      "mcp",
      "local model",
      "ollama",
      "qwen",
    ],
    weight: 0.16,
  },
  {
    label: "developer_tools",
    category: "developer_tools",
    keywords: [
      "devtools",
      "dev tool",
      "developer tool",
      "ide",
      "cli",
      "sdk",
      "lint",
      "debugger",
      "compiler",
      "build tool",
      "package manager",
    ],
    weight: 0.15,
  },
  {
    label: "databases",
    category: "databases",
    keywords: [
      "postgres",
      "postgresql",
      "sqlite",
      "mysql",
      "database",
      "sql",
      "redis",
      "pgvector",
      "duckdb",
      "clickhouse",
      "orm",
    ],
    weight: 0.14,
  },
  {
    label: "self_hosting",
    category: "self_hosting",
    keywords: [
      "self-host",
      "self host",
      "self-hosted",
      "homelab",
      "on-prem",
      "on prem",
      "docker compose",
      "kubernetes",
      "k8s",
    ],
    weight: 0.13,
  },
  {
    label: "open_source",
    category: "open_source",
    keywords: [
      "open source",
      "open-source",
      "oss",
      "mit license",
      "apache license",
      "maintainer",
      "github",
      "monetiz",
      "sustainab",
    ],
    weight: 0.12,
  },
  {
    label: "saas_pricing",
    category: "saas_pricing",
    keywords: [
      "saas",
      "pricing",
      "subscription",
      "billing",
      "stripe",
      "seat-based",
      "per-seat",
      "free tier",
      "paywall",
    ],
    weight: 0.12,
  },
  {
    label: "infrastructure",
    category: "infrastructure",
    keywords: [
      "infrastructure",
      "infra",
      "cloud",
      "aws",
      "gcp",
      "azure",
      "terraform",
      "cdn",
      "load balancer",
    ],
    weight: 0.12,
  },
  {
    label: "frontend_tooling",
    category: "frontend_tooling",
    keywords: [
      "frontend",
      "react",
      "vue",
      "svelte",
      "next.js",
      "nextjs",
      "css",
      "tailwind",
      "ui library",
      "bundler",
      "vite",
      "webpack",
    ],
    weight: 0.1,
  },
  {
    label: "backend_tooling",
    category: "backend_tooling",
    keywords: [
      "backend",
      "rest api",
      "graphql",
      "grpc",
      "microservice",
      "message queue",
      "runtime",
      "node.js",
      "fastapi",
      "django",
      "rails",
      "server framework",
    ],
    weight: 0.11,
  },
  {
    label: "devops",
    category: "devops",
    keywords: [
      "ci/cd",
      "ci cd",
      "github actions",
      "gitlab ci",
      "deploy",
      "deployment",
      "pipeline",
      "vercel",
      "fly.io",
      "railway",
      "release automation",
      "rollback",
    ],
    weight: 0.12,
  },
  {
    label: "observability",
    category: "observability",
    keywords: [
      "observability",
      "monitoring",
      "grafana",
      "prometheus",
      "opentelemetry",
      "tracing",
      "metrics",
      "logging",
      "alerting",
      "uptime",
    ],
    weight: 0.11,
  },
  {
    label: "engineering_workflow",
    category: "engineering_workflow",
    keywords: [
      "workflow",
      "developer experience",
      "developer workflow",
      "dx",
      "code review process",
      "version control",
      "merge",
      "pull request",
      "productivity",
    ],
    weight: 0.11,
  },
  {
    label: "security",
    category: "security",
    keywords: [
      "security",
      "auth",
      "oauth",
      "encryption",
      "vulnerability",
      "cve",
      "secrets",
      "supply chain",
    ],
    weight: 0.11,
  },
  {
    label: "indie_products",
    category: "indie_products",
    keywords: [
      "show hn",
      "ask hn",
      "indie",
      "bootstrapped",
      "side project",
      "solo founder",
      "launch",
      "i built",
      "i made",
    ],
    weight: 0.1,
  },
];

/**
 * Off-topic signals subtract from the score. Weighted heavily so general HN
 * front-page stories (energy, politics, consumer/business news) get filtered out
 * even when they momentarily trend on Hacker News.
 */
const OFF_TOPIC_SIGNALS: Array<{ label: string; keywords: string[]; weight: number }> = [
  {
    label: "off_topic_politics",
    keywords: ["election", "president", "congress", "senate", "war in", "ukraine", "gaza", "supreme court"],
    weight: 0.45,
  },
  {
    label: "off_topic_energy",
    keywords: ["nuclear", "reactor", "power plant", "solar farm", "oil", "natural gas", "climate change", "carbon emissions"],
    weight: 0.45,
  },
  {
    label: "off_topic_sports",
    keywords: ["nba", "nfl", "world cup", "championship game", "olympics"],
    weight: 0.5,
  },
  {
    label: "off_topic_celebrity",
    keywords: ["celebrity", "kardashian", "movie review", "box office", "netflix series"],
    weight: 0.45,
  },
  {
    label: "off_topic_consumer",
    keywords: ["recipe", "weight loss", "dating app", "real estate", "stock market", "crypto price", "bitcoin price"],
    weight: 0.35,
  },
  {
    label: "off_topic_science_general",
    keywords: ["black hole", "dinosaur", "archaeolog", "telescope", "vaccine", "cancer treatment"],
    weight: 0.3,
  },
  {
    // Consumer / non-developer AI: image generation, art, deepfakes, etc.
    // Keeps "ChatGPT's image generator can be manipulated..." out of ai_coding.
    label: "off_topic_ai_consumer",
    keywords: [
      "image generator",
      "image generation",
      "text-to-image",
      "midjourney",
      "dall-e",
      "dall·e",
      "stable diffusion",
      "ai art",
      "deepfake",
      "voice clone",
      "ai girlfriend",
      "image model",
    ],
    weight: 0.5,
  },
  {
    label: "off_topic_medical",
    keywords: [
      "medical",
      "clinical",
      "patient",
      "diagnosis",
      "healthcare",
      "fda approval",
      "drug trial",
      "therapy",
      "disease",
    ],
    weight: 0.45,
  },
  {
    label: "off_topic_business_news",
    keywords: [
      "philanthropy",
      "given away",
      "donated",
      "billionaire",
      "quarterly earnings",
      "stock buyback",
      "ipo filing",
      "hedge fund",
      "lawsuit settlement",
    ],
    weight: 0.4,
  },
];

const SEARCH_QUERY_BOOSTS: Record<string, number> = {
  show_hn: 0.08,
  ask_hn: 0.06,
  devtools: 0.1,
  "developer tools": 0.1,
  "AI coding": 0.1,
  postgres: 0.08,
  database: 0.06,
  "self-hosted": 0.08,
  "open source": 0.07,
  SaaS: 0.07,
  infrastructure: 0.08,
  frontend: 0.07,
  deployment: 0.07,
  observability: 0.08,
  security: 0.07,
};

const CATEGORY_LABELS: Record<RelevanceCategory, string> = {
  ai_coding: "AI Coding",
  developer_tools: "Developer Tools",
  databases: "Databases",
  self_hosting: "Self-Hosting",
  open_source: "Open Source",
  infrastructure: "Infrastructure",
  frontend_tooling: "Frontend Tooling",
  backend_tooling: "Backend Tooling",
  devops: "DevOps / CI/CD",
  observability: "Observability",
  security: "Security",
  saas_pricing: "SaaS / Pricing",
  indie_products: "Indie Products",
  engineering_workflow: "Engineering Workflow",
  not_relevant: "Not Relevant",
};

export function relevanceCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category as RelevanceCategory] ?? category;
}

interface KeywordScore {
  keywordScore: number;
  category: RelevanceCategory;
  reason: string;
  matchedSignals: string[];
}

export function scoreKeywordRelevance(input: RelevanceInput): KeywordScore {
  const haystack = `${input.title} ${input.text}`.toLowerCase();
  const matchedSignals: string[] = [];
  let keywordScore = 0;

  // Track the strongest matched community signal to derive a primary category.
  let topCategory: RelevanceCategory | null = null;
  let topWeight = 0;

  for (const group of COMMUNITY_SIGNALS) {
    const hit = group.keywords.some((kw) => haystack.includes(kw));
    if (hit) {
      matchedSignals.push(group.label);
      keywordScore += group.weight;
      if (group.weight > topWeight) {
        topWeight = group.weight;
        topCategory = group.category;
      }
    }
  }

  if (input.tags?.includes("show_hn") || haystack.includes("show hn")) {
    matchedSignals.push("tag_show_hn");
    keywordScore += 0.08;
  }

  if (input.tags?.includes("ask_hn") || haystack.includes("ask hn")) {
    matchedSignals.push("tag_ask_hn");
    keywordScore += 0.06;
  }

  if (input.searchQuery && SEARCH_QUERY_BOOSTS[input.searchQuery]) {
    matchedSignals.push(`search:${input.searchQuery}`);
    keywordScore += SEARCH_QUERY_BOOSTS[input.searchQuery];
  }

  if (input.searchTag) {
    matchedSignals.push(`tag_fetch:${input.searchTag}`);
    keywordScore += input.searchTag === "show_hn" ? 0.08 : 0.06;
  }

  const offTopicMatches: string[] = [];
  for (const group of OFF_TOPIC_SIGNALS) {
    if (group.keywords.some((kw) => haystack.includes(kw))) {
      matchedSignals.push(group.label);
      offTopicMatches.push(group.label);
      keywordScore -= group.weight;
    }
  }

  keywordScore = Math.max(0, Math.min(1, keywordScore));

  const category: RelevanceCategory = topCategory ?? "not_relevant";

  let reason: string;
  if (topCategory) {
    const topics = matchedSignals
      .filter((s) => !s.startsWith("tag_") && !s.startsWith("search:") && !s.startsWith("off_topic_"))
      .join(", ");
    reason = `Relevant to ${CATEGORY_LABELS[topCategory]} (matched: ${topics || topCategory})`;
    if (offTopicMatches.length > 0) {
      reason += `; off-topic penalty: ${offTopicMatches.join(", ")}`;
    }
  } else if (offTopicMatches.length > 0) {
    reason = `Off-topic for this community (${offTopicMatches.join(", ")})`;
  } else {
    reason = "No clear devtools/builder community signals detected";
  }

  return { keywordScore, category, reason, matchedSignals };
}

export async function scoreRelevance(
  input: RelevanceInput,
  communityEmbedding?: number[] | null,
): Promise<RelevanceResult> {
  const keyword = scoreKeywordRelevance(input);
  let embeddingScore: number | null = null;
  let score = keyword.keywordScore;

  if (communityEmbedding && isRelevanceEmbeddingsEnabled() && !isMockMode()) {
    try {
      const docText = `${input.title}\n${input.text}`.slice(0, 1200);
      const docEmbedding = await getEmbedding(docText);
      embeddingScore = cosineSimilarity(communityEmbedding, docEmbedding);
      score = keyword.keywordScore * 0.65 + embeddingScore * 0.35;
    } catch {
      // Keyword-only fallback if embedding call fails
      score = keyword.keywordScore;
    }
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));

  // Two-tier keep rule:
  //  - keep if score >= STRONG_RELEVANCE_THRESHOLD (clearly on-topic), OR
  //  - keep if score >= RELEVANCE_THRESHOLD AND a strong devtools-builder
  //    keyword is present (borderline but clearly builder-adjacent).
  const strongKeyword = hasStrongKeyword(`${input.title} ${input.text}`);
  const passed =
    score >= STRONG_RELEVANCE_THRESHOLD ||
    (score >= RELEVANCE_THRESHOLD && strongKeyword);
  const category: RelevanceCategory = passed ? keyword.category : "not_relevant";

  const tierNote =
    passed && score < STRONG_RELEVANCE_THRESHOLD
      ? "; kept via strong-keyword tier"
      : "";
  const reason = embeddingScore
    ? `${keyword.reason}; embedding similarity ${embeddingScore.toFixed(2)}; combined score ${score.toFixed(2)}${tierNote}`
    : `${keyword.reason}; relevance score ${score.toFixed(2)}${tierNote}`;

  return {
    score,
    keywordScore: keyword.keywordScore,
    embeddingScore,
    passed,
    category,
    reason,
    matchedSignals: keyword.matchedSignals,
  };
}

let cachedCommunityEmbedding: number[] | null = null;

export async function getCommunityEmbedding(): Promise<number[] | null> {
  if (!isRelevanceEmbeddingsEnabled() || isMockMode()) return null;
  if (!cachedCommunityEmbedding) {
    cachedCommunityEmbedding = await getEmbedding(COMMUNITY_DESCRIPTION);
  }
  return cachedCommunityEmbedding;
}

export function resetCommunityEmbeddingCache(): void {
  cachedCommunityEmbedding = null;
}

export { RELEVANCE_THRESHOLD };
