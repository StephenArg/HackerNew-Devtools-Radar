import { EMBEDDING_DIMENSIONS, limitChunksForPrompt } from "@/lib/constants";
import {
  extractPredictions,
  ensureReportPredictions,
  enrichTopThemeCitations,
  normalizePrediction,
  parseStringArray,
  parseSignals,
} from "@/lib/report-content";
import { enrichVoicesFromChunks } from "@/lib/report-voices";
import {
  chatRateLimiter,
  embeddingRateLimiter,
  getEmbeddingBatchSize,
  getOpenAIRetryDelayMs,
  pauseBeforeChat,
} from "@/lib/rate-limit";
import { sleep, stripHtml } from "@/lib/utils";

/**
 * Shared analytical-tone guidance for RAG report generation. Keeps the memo
 * grounded in retrieved evidence and out of generic/promotional territory.
 */
const RAG_ANALYTICAL_TONE = `Write like an analytical research memo, not marketing copy.
- Do NOT write broad industry commentary. Only synthesize patterns that are supported by the retrieved HN sources. If the retrieved evidence for a claim is weak or thin, say so explicitly (e.g. "the signal here is weak").
- Avoid generic/promotional phrasing such as "the community is buzzing", "will continue to increase", "concerns will heighten", "innovations in", or "developers are excited about" without concrete specifics.
- Prefer evidence-led phrasing such as "Retrieved discussions clustered around...", "The strongest signal was...", "A recurring tension was...", "Several source threads pointed to...", "The evidence suggests...", "The community appears split on...", and "This prediction is grounded in...".`;

/** Simple deterministic hash for mock embeddings */
function hashString(input: string, seed = 0): number {
  let h = seed ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export type AIStatus = "mock" | "openai" | "quota_fallback";

/**
 * Timestamp (ms) until which OpenAI calls are skipped after a quota error.
 * Time-based so a transient quota/usage limit auto-recovers instead of pinning
 * the whole process into mock mode until the dev server restarts.
 */
let openaiQuotaFallbackUntil = 0;

function quotaCooldownMs(): number {
  const value = parseInt(process.env.OPENAI_QUOTA_COOLDOWN_MS ?? "60000", 10);
  return Number.isFinite(value) && value >= 0 ? value : 60000;
}

export function isOpenAIQuotaFallback(): boolean {
  return Date.now() < openaiQuotaFallbackUntil;
}

export function isMockMode(): boolean {
  if (process.env.MOCK_MODE === "true") return true;
  if (isOpenAIQuotaFallback()) return true;
  return !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === "";
}

export function getAIStatus(): AIStatus {
  if (process.env.MOCK_MODE === "true") return "mock";
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === "") {
    return "mock";
  }
  if (isOpenAIQuotaFallback()) return "quota_fallback";
  return "openai";
}

/** Clear the quota cooldown so the next call probes the live OpenAI API again. */
export function resetQuotaFallback(): void {
  openaiQuotaFallbackUntil = 0;
}

/** Seconds remaining before OpenAI is retried, or 0 if not in fallback. */
export function quotaFallbackSecondsRemaining(): number {
  const remaining = openaiQuotaFallbackUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function isOpenAIQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; code?: string; message?: string };
  if (err.code === "insufficient_quota") return true;
  if (
    typeof err.message === "string" &&
    /insufficient_quota|exceeded your current quota/i.test(err.message)
  ) {
    return true;
  }
  return false;
}

export function isOpenAIRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: number; code?: string; message?: string };
  if (err.status !== 429) return false;
  if (isOpenAIQuotaError(error)) return false;
  if (err.code === "rate_limit_exceeded") return true;
  if (typeof err.message === "string" && /rate limit/i.test(err.message)) {
    return true;
  }
  return false;
}

function activateQuotaFallback(error: unknown): void {
  const cooldown = quotaCooldownMs();
  const wasActive = isOpenAIQuotaFallback();
  openaiQuotaFallbackUntil = Date.now() + cooldown;
  if (!wasActive) {
    console.warn(
      `[ai] OpenAI quota reached — using mock embeddings/reports for the next ${Math.round(
        cooldown / 1000,
      )}s, then OpenAI will be retried.`,
      error instanceof Error ? error.message : error,
    );
  }
}

type ChatCompletionParams = Omit<
  Parameters<
    InstanceType<typeof import("openai").default>["chat"]["completions"]["create"]
  >[0],
  "stream"
> & { stream?: false };

export async function createChatCompletionWithRetry(
  params: ChatCompletionParams,
  options?: { activateFallbackOnQuota?: boolean },
): Promise<import("openai").default.Chat.Completions.ChatCompletion> {
  const maxAttempts = 5;
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await chatRateLimiter.acquire();
      return await client.chat.completions.create(params);
    } catch (error) {
      if (isOpenAIRateLimitError(error) && attempt < maxAttempts - 1) {
        await sleep(getOpenAIRetryDelayMs(error, attempt));
        continue;
      }
      if (isOpenAIQuotaError(error) && options?.activateFallbackOnQuota !== false) {
        activateQuotaFallback(error);
      }
      throw error;
    }
  }

  throw new Error("Chat request failed after retries");
}

export { pauseBeforeChat };

export function formatOpenAIError(error: unknown): string {
  if (isOpenAIQuotaError(error)) {
    return "OpenAI billing quota exceeded — using heuristics only";
  }
  if (isOpenAIRateLimitError(error)) {
    return "OpenAI chat rate limit hit after retries — using heuristics only";
  }
  if (error instanceof Error) return error.message;
  return "LLM judge call failed";
}

/** Deterministic hash-based embedding for offline demo mode */
export function mockEmbedding(text: string): number[] {
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);

  tokens.forEach((token, idx) => {
    for (let dim = 0; dim < 16; dim++) {
      const h = hashString(`${token}:${dim}`, idx + dim);
      const slot = h % EMBEDDING_DIMENSIONS;
      vector[slot] += ((h % 1000) / 1000) * 2 - 1;
    }
  });

  if (tokens.length === 0) {
    vector[0] = 1;
  }

  return normalize(vector);
}

export function projectTo2D(embedding: number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < embedding.length; i++) {
    const angle = (i * 9301 + 49297) % 6283;
    x += embedding[i] * Math.cos(angle / 1000);
    y += embedding[i] * Math.sin(angle / 1000);
  }
  return { x: x * 10, y: y * 10 };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) || 1;
  return dot / denom;
}

async function callOpenAIEmbeddings(texts: string[]): Promise<number[][]> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const response = await client.embeddings.create({ model, input: texts });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

async function callOpenAIEmbeddingsWithRetry(
  texts: string[],
): Promise<number[][]> {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await embeddingRateLimiter.acquire();
      return await callOpenAIEmbeddings(texts);
    } catch (error) {
      if (isOpenAIRateLimitError(error) && attempt < maxAttempts - 1) {
        await sleep(getOpenAIRetryDelayMs(error, attempt));
        continue;
      }
      if (isOpenAIQuotaError(error)) throw error;
      throw error;
    }
  }

  throw new Error("Embedding request failed after retries");
}

export async function getEmbedding(text: string): Promise<number[]> {
  const [embedding] = await getEmbeddings([text]);
  return embedding;
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (isMockMode()) return texts.map(mockEmbedding);

  const batchSize = getEmbeddingBatchSize();
  const results: number[][] = [];

  try {
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await callOpenAIEmbeddingsWithRetry(batch);
      results.push(...embeddings);
    }
    return results;
  } catch (error) {
    if (isOpenAIQuotaError(error)) {
      activateQuotaFallback(error);
      return texts.map(mockEmbedding);
    }
    throw error;
  }
}

export interface GenerateReportInput {
  mode: "rag" | "no_rag";
  communityName: string;
  communityDescription: string;
  coverageWindow: string;
  retrievedChunks?: Array<{
    text: string;
    sourceTitle: string;
    sourceUrl: string;
    similarity: number;
  }>;
  /** When set, rubric judging is batched into the same chat completion. */
  batchJudge?: {
    compareContent: import("@/types").ReportContent;
    compareMode: "rag" | "no_rag";
    retrievedChunkCount: number;
  };
}

export interface GenerateReportResult {
  content: import("@/types").ReportContent;
  markdown: string;
  judgeScores?: import("@/lib/rubric").RubricJudgeScores;
}

export interface GenerateComparePairInput {
  communityName: string;
  communityDescription: string;
  coverageWindow: string;
  retrievedChunks: Array<{
    text: string;
    sourceTitle: string;
    sourceUrl: string;
    similarity: number;
  }>;
}

export interface GenerateComparePairResult {
  noRag: import("@/types").ReportContent;
  rag: import("@/types").ReportContent;
  noRagMarkdown: string;
  ragMarkdown: string;
  judgeScores: import("@/lib/rubric").RubricJudgeScores;
}

export async function generateReport(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  if (isMockMode()) {
    return generateMockReport(input);
  }
  try {
    return await generateOpenAIReport(input);
  } catch (error) {
    if (isOpenAIQuotaError(error)) {
      activateQuotaFallback(error);
      return generateMockReport(input);
    }
    throw error;
  }
}

export async function generateComparePair(
  input: GenerateComparePairInput,
): Promise<GenerateComparePairResult> {
  if (isMockMode()) {
    const noRag = await generateMockReport({
      mode: "no_rag",
      communityName: input.communityName,
      communityDescription: input.communityDescription,
      coverageWindow: input.coverageWindow,
    });
    const rag = await generateMockReport({
      mode: "rag",
      communityName: input.communityName,
      communityDescription: input.communityDescription,
      coverageWindow: input.coverageWindow,
      retrievedChunks: input.retrievedChunks,
    });
    return {
      noRag: noRag.content,
      rag: rag.content,
      noRagMarkdown: noRag.markdown,
      ragMarkdown: rag.markdown,
      judgeScores: { noRag: {}, rag: {} },
    };
  }

  try {
    return await generateOpenAIComparePair(input);
  } catch (error) {
    if (isOpenAIQuotaError(error)) {
      activateQuotaFallback(error);
      const noRag = generateMockReport({
        mode: "no_rag",
        communityName: input.communityName,
        communityDescription: input.communityDescription,
        coverageWindow: input.coverageWindow,
      });
      const rag = generateMockReport({
        mode: "rag",
        communityName: input.communityName,
        communityDescription: input.communityDescription,
        coverageWindow: input.coverageWindow,
        retrievedChunks: input.retrievedChunks,
      });
      return {
        noRag: noRag.content,
        rag: rag.content,
        noRagMarkdown: noRag.markdown,
        ragMarkdown: rag.markdown,
        judgeScores: { noRag: {}, rag: {} },
      };
    }
    throw error;
  }
}

function generateMockReport(
  input: GenerateReportInput,
): GenerateReportResult {
  const chunks = input.retrievedChunks ?? [];
  const hasRag = input.mode === "rag" && chunks.length > 0;

  if (!hasRag) {
    return generateMockNoRagReport(input);
  }

  // Deterministic helpers grounded in the actually-retrieved chunks.
  const cite = (c: (typeof chunks)[number]) =>
    `[Source: ${c.sourceTitle}, similarity ${c.similarity.toFixed(2)}]`;
  const pick = (i: number) => chunks[i % chunks.length];
  const shortTitle = (c: (typeof chunks)[number]) =>
    stripHtml(c.sourceTitle).replace(/^(show hn|ask hn):\s*/i, "").slice(0, 70);
  const excerpt = (c: (typeof chunks)[number], n = 150) => {
    const text = stripHtml(c.text).slice(0, n).trim();
    return text.length === n ? `${text}…` : text;
  };

  const topThemes = [
    `Local and private AI coding workflows were a recurring focus — developers weighed hosted assistants against running models locally for cost and privacy control. ${cite(pick(0))} ${cite(pick(1))}`,
    `Agentic coding tools and local PR review tooling drew debate over how much autonomy to hand an AI agent before output becomes hard to trust. ${cite(pick(2))}`,
    `Self-hosted analytics and infrastructure tooling kept surfacing as teams pushed back on rising SaaS pricing. ${cite(pick(3))}`,
    `Open-source monetization problems and the setup burden of self-hosted tools came up as concrete adoption blockers, not abstract concerns. ${cite(pick(4))}`,
  ];

  const excitedAbout = chunks.slice(0, 3).map((c, i) => {
    const framing = [
      "a local/private AI coding workflow that keeps code off third-party servers",
      "an agentic coding or local PR review tool that automates review without losing control",
      "a self-hosted analytics stack that replaces an expensive SaaS subscription",
    ][i % 3];
    return `Builders were excited about ${shortTitle(c)} as ${framing}: "${excerpt(c)}" ${cite(c)}`;
  });

  const complaints = [
    `Setup burden for self-hosted tools was a repeated pain point — getting the stack running was described as more work than the SaaS it replaces. ${cite(pick(3))} ${cite(pick(0))}`,
    `Reliability and trust concerns around AI agents came up often: noisy, confidently-wrong output makes developers hesitant to let agents act unsupervised. ${cite(pick(2))}`,
    `Open-source monetization friction and seat-based SaaS pricing were criticized as misaligned with how small teams actually adopt tools. ${cite(pick(4))} ${cite(pick(1))}`,
  ];

  const disagreements = [
    `Local models vs hosted AI services split the community along privacy/control versus convenience/quality lines. ${cite(pick(0))} ${cite(pick(2))}`,
    `How much to trust autonomous coding agents divided people — some want full automation, others insist on a human in the loop for every change. ${cite(pick(2))} ${cite(pick(1))}`,
  ];

  const representativeVoices = chunks.slice(0, 4).map((c) => ({
    quote: excerpt(c, 220),
    sourceTitle: c.sourceTitle,
    sourceUrl: c.sourceUrl,
    citation: cite(c),
  }));

  const predictions = [
    {
      prediction:
        "Local/private AI coding workflows will likely remain an active topic next week.",
      why: "Multiple retrieved discussions this week centered on agentic coding, local PR review tools, and trust boundaries around hosted AI services.",
      sources: [cite(pick(0)), cite(pick(2))],
    },
    {
      prediction:
        "Debate on the operational setup burden of self-hosted tools should continue.",
      why: "Teams excited about replacing SaaS repeatedly hit installation and maintenance friction in the retrieved threads.",
      sources: [cite(pick(3))],
    },
    {
      prediction:
        "Open-source monetization will keep generating threads.",
      why: "Maintainers and indie builders in the retrieved evidence are still searching for sustainable models beyond donations.",
      sources: [cite(pick(4))],
    },
    {
      prediction:
        "Reliability and trust guardrails for AI agents should resurface.",
      why: "This week's retrieved complaints about noisy or unreliable agent output point to unresolved trust concerns.",
      sources: [cite(pick(2)), cite(pick(1))],
    },
  ];

  const signals = [
    {
      signal: "AI coding tools are useful, but trust remains fragile.",
      evidence:
        "Several retrieved threads discussed local PR review tools, coding agents, and frustration with noisy or unreliable AI output.",
      interpretation:
        "The community is not rejecting AI; it is asking for better control, context, and reliability.",
      sources: [cite(pick(2)), cite(pick(1))],
    },
    {
      signal: "Self-hosting is attractive but the setup burden is the real blocker.",
      evidence:
        "Threads excited about self-hosted analytics and infrastructure also complained that standing the stack up was harder than the SaaS it replaced.",
      interpretation:
        "Adoption hinges on smoother onboarding more than on raw feature parity.",
      sources: [cite(pick(3)), cite(pick(0))],
    },
    {
      signal: "Open-source monetization is an unsolved, recurring tension.",
      evidence:
        "Discussion of OSS sustainability and SaaS pricing surfaced repeatedly across separate threads.",
      interpretation:
        "Builders want models that fund maintenance without alienating the small teams that adopt them.",
      sources: [cite(pick(4)), cite(pick(1))],
    },
    {
      signal: "Privacy and control are driving the local-vs-hosted divide.",
      evidence:
        "Debate over local models versus hosted AI services framed the choice around data control and cost rather than capability alone.",
      interpretation:
        "Tools that keep code and data local while matching hosted quality have a clear opening.",
      sources: [cite(pick(0)), cite(pick(2))],
    },
  ];

  const citations = chunks.map((c) => cite(c));

  const uniqueSources = new Set(chunks.map((c) => c.sourceTitle)).size;

  const rawContent: import("@/types").ReportContent = {
    title: `${input.communityName} — Weekly Community Voices`,
    coverageWindow: input.coverageWindow,
    executiveSummary: `Retrieved HN discussions this week clustered around three practical builder concerns: whether AI coding agents can be trusted in review workflows, whether self-hosted tools are worth the operational burden, and whether open-source devtools can survive without acquisition or pricing pressure. The strongest signal was that developers want AI and self-hosted tooling but are gated by trust, reliability, and setup burden rather than missing features. This memo is grounded in ${chunks.length} retrieved snippets across ${uniqueSources} distinct sources, with inline citations on every major claim. ${cite(pick(0))} ${cite(pick(2))}`,
    topThemes,
    excitedAbout,
    complaints,
    disagreements,
    representativeVoices,
    predictions,
    signals,
    methodology: `Generated via RAG: ${chunks.length} snippets retrieved using five section-specific queries, embedded with ${isMockMode() ? "deterministic mock embeddings" : "OpenAI embeddings"}, ranked by cosine similarity, and synthesized into cited sections. Citations map to ${uniqueSources} distinct retrieved sources.`,
    mode: input.mode,
    citations,
  };

  const content = enrichVoicesFromChunks(rawContent, chunks);
  const markdown = reportContentToMarkdown(content);
  return { content, markdown };
}

function generateMockNoRagReport(
  input: GenerateReportInput,
): GenerateReportResult {
  const content: import("@/types").ReportContent = {
    title: `${input.communityName} — Weekly Community Voices`,
    coverageWindow: input.coverageWindow,
    executiveSummary: `This is a generic weekly summary of ${input.communityName}, generated without retrieval. It relies only on the community description and general model knowledge, so it stays high-level and cannot cite specific threads, quotes, or this week's actual discussions.`,
    topThemes: [
      "Developer productivity and tooling trends",
      "AI-assisted coding in general",
      "Cloud and infrastructure topics",
      "Open source and startup tooling discussions",
    ],
    excitedAbout: [
      "Developers are generally excited about new productivity tools.",
      "AI-assisted coding continues to draw broad interest.",
      "Open source projects remain popular among technical audiences.",
    ],
    complaints: [
      "Some users express frustration with rising software costs.",
      "Tool fragmentation can make developer workflows harder.",
      "Documentation quality varies across products.",
    ],
    disagreements: [
      "Debates continue around build vs buy for internal tools.",
      "Opinions differ on the pace of AI adoption in engineering teams.",
    ],
    representativeVoices: [
      {
        quote:
          "Modern teams keep weighing developer experience against cost and complexity.",
        sourceTitle: "Generic illustrative voice, not retrieved from source data.",
      },
      {
        quote:
          "AI tooling is exciting but teams still want control and reliability.",
        sourceTitle: "Generic illustrative voice, not retrieved from source data.",
      },
    ],
    predictions: [
      "Technology discussions will likely continue around AI and developer tools.",
      "Infrastructure and open source may remain popular topics.",
      "Community members will share new product launches.",
    ],
    signals: [],
    methodology:
      "Generated without RAG using only the community description and general model knowledge — intentionally generic, with no citations or thread-level evidence.",
    mode: input.mode,
    citations: [],
  };

  return { content, markdown: reportContentToMarkdown(content) };
}

async function generateOpenAIReport(
  input: GenerateReportInput,
): Promise<GenerateReportResult> {
  const {
    parseRubricJudgeScores,
    summarizeReportForJudge,
    buildJudgeInstructions,
    judgeEvidence,
  } = await import("@/lib/rubric");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const promptChunks = limitChunksForPrompt(input.retrievedChunks ?? []);

  const chunkContext =
    input.mode === "rag" && promptChunks.length
      ? promptChunks
          .map(
            (c, i) =>
              `[${i + 1}] Source: ${c.sourceTitle} (${c.sourceUrl}, similarity ${c.similarity.toFixed(2)})\n${stripHtml(c.text)}`,
          )
          .join("\n\n")
      : "No retrieved chunks — produce a generic summary.";

  let judgeSection = "";
  if (input.batchJudge) {
    const existingSummary = summarizeReportForJudge(input.batchJudge.compareContent);
    const existingIsRag = input.batchJudge.compareMode === "rag";
    const existingEvidence = judgeEvidence(
      input.batchJudge.compareContent,
      existingIsRag ? input.batchJudge.retrievedChunkCount : 0,
    );
    // The new report's evidence isn't known until generated; the reconcile pass
    // enforces the hard rules afterward.
    const newEvidence = judgeEvidence(
      null,
      input.mode === "rag" ? input.batchJudge.retrievedChunkCount : 0,
    );
    const instructions = existingIsRag
      ? buildJudgeInstructions(newEvidence, existingEvidence)
      : buildJudgeInstructions(existingEvidence, newEvidence);

    judgeSection = `

${instructions}

Existing ${existingIsRag ? "RAG" : "no-RAG"} report to score:
${JSON.stringify(existingSummary)}

Also score the new ${input.mode === "rag" ? "RAG" : "no-RAG"} report you generate in this response, counting the citations and sources you actually include.`;
  }

  const ragInstructions = `${RAG_ANALYTICAL_TONE}

For every major section answer, implicitly: (a) what did people actually discuss, (b) what tension/disagreement/pattern appeared, and (c) which retrieved sources support it. Every section must name specific source titles, describe a concrete pattern, surface a tension or tradeoff, and cite its evidence.

Citation rules (CRITICAL):
- Put at least one inline citation on EVERY bullet/claim in executiveSummary, topThemes, excitedAbout, complaints, disagreements, and predictions.
- Citation format: [Source: <exact source title from the chunk header>, similarity <the similarity value shown>]. Use multiple citations when several chunks support a claim.
- Prefer concrete, specific topics (e.g. local/private AI coding workflows, agentic coding tools, local PR review tools, self-hosted analytics, open-source monetization, setup burden, AI reliability/trust, developer workflow friction). Avoid vague bullets like "AI coding assistants" or "open source sustainability" with no specifics.

predictions: 3-5 entries, each an OBJECT { prediction, why, sources } where "prediction" is a concise next-week forecast, "why" explains how it follows from THIS week's retrieved evidence, and "sources" is an array of inline [Source: ...] citations. Project from retrieved evidence, not broad industry guesses.

signals: 3-5 entries. Each is { signal, evidence, interpretation, sources } where "sources" is an array of inline [Source: ...] citations synthesizing across the retrieved chunks.`;

  const noRagInstructions = `No-RAG baseline: produce a plausible but clearly generic summary. Do NOT include any citations, do NOT invent specific HN thread titles, similarity scores, or quotes. Representative voices must be labeled as generic examples (set sourceTitle to "Generic illustrative voice, not retrieved from source data."). Omit the "signals" key.`;

  const prompt = `You are writing a Community Voices Document for: ${input.communityName}.
Coverage window: ${input.coverageWindow}.
Community: ${input.communityDescription}

Mode: ${input.mode === "rag" ? "RAG (retrieval-grounded)" : "No-RAG baseline"}.

${input.mode === "rag" ? ragInstructions : noRagInstructions}

Retrieved chunks:
${chunkContext}

Return JSON with keys: title, coverageWindow, executiveSummary, topThemes (string[]), excitedAbout (string[]), complaints (string[]), disagreements (string[]), representativeVoices ({quote, sourceTitle, sourceUrl, citation?}[]), predictions (${input.mode === "rag" ? "{prediction, why, sources: string[]}[]" : "string[]"}, required, 3-5 grounded next-week forecasts)${input.mode === "rag" ? ", signals ({signal, evidence, interpretation, sources: string[]}[], 3-5 entries)" : ""}, methodology, mode, citations (string[]${input.mode === "rag" ? ", one [Source: ...] per distinct retrieved source actually used" : ", empty for no-RAG"})${input.batchJudge ? ', rubricJudge ({ noRag: {...}, rag: {...} })' : ""}.${judgeSection}`;

  const response = await createChatCompletionWithRetry({
    model,
    messages: [
      {
        role: "system",
        content:
          "You produce structured community research reports. Return valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsedRaw = JSON.parse(raw) as Record<string, unknown> & {
    rubricJudge?: unknown;
  };
  let content = normalizeReportContent(parsedRaw, input.mode);

  if (input.retrievedChunks?.length) {
    content = enrichVoicesFromChunks(content, input.retrievedChunks);
    content = enrichTopThemeCitations(
      content,
      input.retrievedChunks.map((chunk) => ({
        sourceTitle: chunk.sourceTitle,
        similarity: chunk.similarity,
      })),
    );
  }

  let judgeScores = parseRubricJudgeScores(parsedRaw.rubricJudge) ?? undefined;
  if (judgeScores && input.batchJudge) {
    const { reconcileJudgeScores } = await import("@/lib/rubric");
    const ragContent =
      input.mode === "rag" ? content : input.batchJudge.compareContent;
    const noRagContent =
      input.mode === "no_rag" ? content : input.batchJudge.compareContent;
    judgeScores = reconcileJudgeScores(
      judgeScores,
      ragContent,
      noRagContent,
      input.batchJudge.retrievedChunkCount,
    );
  }

  return {
    content,
    markdown: reportContentToMarkdown(content),
    judgeScores,
  };
}

async function generateOpenAIComparePair(
  input: GenerateComparePairInput,
): Promise<GenerateComparePairResult> {
  const { parseRubricJudgeScores, reconcileJudgeScores, buildJudgeInstructions, judgeEvidence } =
    await import("@/lib/rubric");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const promptChunks = limitChunksForPrompt(input.retrievedChunks);

  const chunkContext = promptChunks
    .map(
      (c, i) =>
        `[${i + 1}] Source: ${c.sourceTitle} (${c.sourceUrl}, similarity ${c.similarity.toFixed(2)})\n${stripHtml(c.text)}`,
    )
    .join("\n\n");

  // Evidence is self-assessed by the model here (reports are generated in the
  // same call); the deterministic reconcile pass below enforces the hard rules.
  const judgeInstructions = buildJudgeInstructions(
    judgeEvidence(null, 0),
    judgeEvidence(null, input.retrievedChunks.length),
  );

  const prompt = `You are writing Community Voices Documents for: ${input.communityName}.
Coverage window: ${input.coverageWindow}.
Community: ${input.communityDescription}

In ONE batched response, generate BOTH reports and score them on the rubric.

Retrieved chunks (for the RAG report only):
${chunkContext}

Return JSON with this EXACT shape:
{
  "noRag": { "title": string, "coverageWindow": string, "executiveSummary": string, "topThemes": string[], "excitedAbout": string[], "complaints": string[], "disagreements": string[], "representativeVoices": [{ "quote": string, "sourceTitle": string, "sourceUrl": string, "citation": string }], "predictions": string[], "methodology": string, "mode": "no_rag" },
  "rag": { "title": string, "coverageWindow": string, "executiveSummary": string, "topThemes": string[], "excitedAbout": string[], "complaints": string[], "disagreements": string[], "representativeVoices": [{ "quote": string, "sourceTitle": string, "sourceUrl": string, "citation": string }], "predictions": [{ "prediction": string, "why": string, "sources": string[] }], "signals": [{ "signal": string, "evidence": string, "interpretation": string, "sources": string[] }], "methodology": string, "mode": "rag", "citations": string[] },
  "rubricJudge": {
    "noRag": { "groundedness": number, "specificity": number, "citationQuality": number, "coverage": number, "predictionQuality": number, "insightfulness": number, "clarity": number },
    "rag": { "groundedness": number, "specificity": number, "citationQuality": number, "coverage": number, "predictionQuality": number, "insightfulness": number, "clarity": number }
  }
}

representativeVoices MUST be objects with non-empty "quote" and "sourceTitle". Provide at least 3 voices per report. Each report MUST include 3-5 non-empty predictions.

No-RAG rules: plausible but generic. NO citations anywhere. Do NOT invent specific HN thread titles, similarity scores, or quotes. Set every representativeVoices "sourceTitle" to "Generic illustrative voice, not retrieved from source data.", with empty "citation" and "sourceUrl". Omit "signals". (No-RAG predictions may be plain strings.)

RAG rules (source-grounded research memo, not a blog summary):
${RAG_ANALYTICAL_TONE}
- Use ONLY the retrieved chunks; never invent titles/quotes/facts.
- Put at least one inline [Source: <exact chunk title>, similarity <value>] citation on EVERY bullet/claim in executiveSummary, topThemes, excitedAbout, complaints, disagreements, and predictions.
- Be specific (local/private AI coding workflows, agentic coding tools, local PR review, self-hosted analytics, open-source monetization, setup burden, AI reliability/trust, workflow friction). Avoid vague one-liners.
- Each prediction is an object { prediction, why, sources }: a concise forecast, WHY it follows from THIS week's retrieved evidence, and an array of inline [Source: ...] citations.
- "signals" has 3-5 entries; "sources" is an array of inline [Source: ...] citations.
- "citations" lists one [Source: ...] per distinct retrieved source actually used.
- representativeVoices: quote retrieved chunks; set "sourceTitle", "sourceUrl" (HN item URL from the chunk header), and "citation".

${judgeInstructions}
Base your rubric scores on what you ACTUALLY wrote: count the citations and distinct sources you included in each report.
Context: RAG report used ${input.retrievedChunks.length} retrieved chunks (${promptChunks.length} shown in prompt).`;

  const response = await createChatCompletionWithRetry({
    model,
    messages: [
      {
        role: "system",
        content:
          "You produce structured community research reports and rubric scores. Return valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as {
    noRag: import("@/types").ReportContent;
    rag: import("@/types").ReportContent;
    rubricJudge?: unknown;
  };

  let noRag = normalizeReportContent(parsed.noRag, "no_rag");
  let rag = normalizeReportContent(parsed.rag, "rag");

  noRag = enrichVoicesFromChunks(noRag, input.retrievedChunks);
  rag = enrichVoicesFromChunks(rag, input.retrievedChunks);
  rag = enrichTopThemeCitations(
    rag,
    input.retrievedChunks.map((chunk) => ({
      sourceTitle: chunk.sourceTitle,
      similarity: chunk.similarity,
    })),
  );

  const rawJudge = parseRubricJudgeScores(parsed.rubricJudge);
  if (!rawJudge) {
    throw new Error("Batched compare generation did not return rubricJudge scores");
  }
  const judgeScores = reconcileJudgeScores(
    rawJudge,
    rag,
    noRag,
    input.retrievedChunks.length,
  );

  return {
    noRag,
    rag,
    noRagMarkdown: reportContentToMarkdown(noRag),
    ragMarkdown: reportContentToMarkdown(rag),
    judgeScores,
  };
}

/**
 * Defensively coerce a model-generated report into the exact ReportContent shape
 * the UI expects. Handles representativeVoices returned as strings or with
 * alternate keys, and drops empty voices so no blank quote cards render.
 */
function normalizeReportContent(
  raw: unknown,
  mode: "rag" | "no_rag",
): import("@/types").ReportContent {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const toStringArray = (value: unknown): string[] => parseStringArray(value);

  const voicesRaw = Array.isArray(obj.representativeVoices)
    ? obj.representativeVoices
    : [];
  const representativeVoices = voicesRaw
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          quote: entry,
          sourceTitle: "",
          sourceUrl: undefined as string | undefined,
          citation: undefined as string | undefined,
        };
      }
      const v = (entry ?? {}) as Record<string, unknown>;
      const quote = String(v.quote ?? v.text ?? v.voice ?? v.body ?? "");
      const sourceTitle = String(v.sourceTitle ?? v.source ?? v.title ?? v.author ?? "");
      const citationVal = v.citation ?? v.cite ?? v.source_citation;
      const sourceUrlVal = v.sourceUrl ?? v.url ?? v.source_url ?? v.link;
      return {
        quote,
        sourceTitle,
        sourceUrl: sourceUrlVal ? String(sourceUrlVal) : undefined,
        citation: citationVal ? String(citationVal) : undefined,
      };
    })
    .filter((v) => v.quote.trim().length > 0);

  return ensureReportPredictions({
    title: String(obj.title ?? "Community Voices — Weekly Report"),
    coverageWindow: String(obj.coverageWindow ?? ""),
    executiveSummary: String(obj.executiveSummary ?? ""),
    topThemes: toStringArray(obj.topThemes),
    excitedAbout: toStringArray(obj.excitedAbout),
    complaints: toStringArray(obj.complaints),
    disagreements: toStringArray(obj.disagreements),
    representativeVoices,
    predictions: extractPredictions(obj),
    signals: mode === "rag" ? parseSignals(obj.signals) : [],
    methodology: String(obj.methodology ?? ""),
    mode,
    citations: toStringArray(obj.citations),
  });
}

export function reportContentToMarkdown(content: import("@/types").ReportContent): string {
  const sections = [
    `# ${content.title}`,
    `**Coverage:** ${content.coverageWindow}`,
    `**Mode:** ${content.mode === "rag" ? "RAG-powered" : "No-RAG baseline"}`,
    "",
    "## Executive Summary",
    content.executiveSummary,
    "",
    "## Top Themes",
    ...content.topThemes.map((t) => `- ${t}`),
    "",
    "## What People Were Excited About",
    ...content.excitedAbout.map((t) => `- ${t}`),
    "",
    "## Complaints & Pain Points",
    ...content.complaints.map((t) => `- ${t}`),
    "",
    "## Notable Disagreements",
    ...content.disagreements.map((t) => `- ${t}`),
    "",
    "## Representative Voices",
    ...content.representativeVoices.map((v) => {
      const attribution = v.sourceUrl
        ? `[${v.sourceTitle}](${v.sourceUrl})`
        : v.sourceTitle;
      return `> ${v.quote}\n>\n> — ${attribution}${v.citation ? ` ${v.citation}` : ""}`;
    }),
    "",
    "## Predictions for Next Week",
    ...content.predictions.map((item) => {
      const p = normalizePrediction(item);
      const why = p.why ? ` — ${p.why}` : "";
      const sources = p.sources && p.sources.length > 0 ? ` ${p.sources.join(" ")}` : "";
      return `- ${p.prediction}${why}${sources}`;
    }),
  ];

  if (content.signals && content.signals.length > 0) {
    sections.push(
      "",
      "## Signals from the Community",
      "| Signal | Evidence | Interpretation | Sources |",
      "|--------|----------|----------------|---------|",
      ...content.signals.map(
        (s) =>
          `| ${s.signal} | ${s.evidence} | ${s.interpretation} | ${s.sources.join("; ")} |`,
      ),
    );
  }

  sections.push("", "## Source Coverage / Methodology", content.methodology);

  if (content.citations && content.citations.length > 0) {
    sections.push(
      "",
      "### Citations",
      ...content.citations.map((c) => `- ${c}`),
    );
  }

  return sections.join("\n");
}
