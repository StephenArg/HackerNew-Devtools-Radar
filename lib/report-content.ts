import type { ReportContent, ReportPrediction, ReportPredictionItem } from "@/types";

function stripCitationNoise(text: string): string {
  return text
    .replace(/\[Source:[^\]]+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

export function parseStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter(Boolean);
  }

  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      return trimmed ? [trimmed] : [];
    }
    if (item && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      const text = String(
        entry.prediction ??
          entry.text ??
          entry.item ??
          entry.title ??
          entry.content ??
          entry.summary ??
          "",
      ).trim();
      return text ? [text] : [];
    }
    return [];
  });
}

export type ReportSignal = NonNullable<ReportContent["signals"]>[number];

export function parseSignals(value: unknown): ReportSignal[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const signal = String(entry.signal ?? entry.title ?? entry.name ?? "").trim();
    const evidence = String(entry.evidence ?? entry.observation ?? "").trim();
    const interpretation = String(
      entry.interpretation ?? entry.meaning ?? entry.takeaway ?? "",
    ).trim();
    if (!signal && !evidence) return [];

    const sourcesRaw = entry.sources ?? entry.citations ?? entry.sourceTitles;
    const sources = parseStringArray(sourcesRaw);

    return [{ signal, evidence, interpretation, sources }];
  });
}

/** Normalize a single prediction (string or object) to a structured shape. */
export function normalizePrediction(item: ReportPredictionItem): ReportPrediction {
  if (typeof item === "string") {
    return { prediction: item.trim(), sources: [] };
  }
  return {
    prediction: (item.prediction ?? "").trim(),
    why: item.why?.trim() || undefined,
    sources: (item.sources ?? []).filter((s) => s && s.trim()),
  };
}

/** Flatten a prediction back to a single string (for citation counting/markdown). */
export function predictionToText(item: ReportPredictionItem): string {
  const p = normalizePrediction(item);
  return [p.prediction, p.why, ...(p.sources ?? [])].filter(Boolean).join(" ");
}

/** Parse predictions preserving structured { prediction, why, sources }. */
export function parsePredictions(value: unknown): ReportPrediction[] {
  if (typeof value === "string") {
    return parseStringArray(value).map((text) => ({ prediction: text, sources: [] }));
  }
  if (!Array.isArray(value)) return [];

  return value.flatMap<ReportPrediction>((item) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      return trimmed ? [{ prediction: trimmed, sources: [] }] : [];
    }
    if (item && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      const prediction = String(
        entry.prediction ?? entry.text ?? entry.item ?? entry.title ?? entry.forecast ?? "",
      ).trim();
      if (!prediction) return [];
      const why = String(
        entry.why ?? entry.reason ?? entry.rationale ?? entry.because ?? "",
      ).trim();
      const sources = parseStringArray(
        entry.sources ?? entry.citations ?? entry.sourceTitles,
      );
      return [{ prediction, why: why || undefined, sources }];
    }
    return [];
  });
}

export function extractPredictions(raw: Record<string, unknown>): ReportPrediction[] {
  for (const key of [
    "predictions",
    "predictionsForNextWeek",
    "nextWeekPredictions",
    "prediction",
    "forecasts",
    "forecast",
  ]) {
    const parsed = parsePredictions(raw[key]);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

export function fallbackPredictions(content: ReportContent): ReportPrediction[] {
  const themes = content.topThemes.map(stripCitationNoise).filter(Boolean);
  const excited = content.excitedAbout.map(stripCitationNoise).filter(Boolean);

  if (themes.length > 0) {
    const derived = [
      themes[0] &&
        `Expect more HN threads building on ${themes[0].toLowerCase()}.`,
      themes[1] &&
        `Discussion of ${themes[1].toLowerCase()} should carry into next week.`,
      excited[0] &&
        `Follow-up posts are likely on tools and ideas raised this week (e.g. ${excited[0].slice(0, 90)}${excited[0].length > 90 ? "…" : ""}).`,
      content.mode === "rag"
        ? "Ask HN pricing and build-vs-buy debates should continue across devtools threads."
        : "Community interest in developer tools and AI assistants will likely continue.",
    ].filter((item): item is string => Boolean(item));

    if (derived.length >= 2) {
      return derived.slice(0, 4).map((prediction) => ({ prediction, sources: [] }));
    }
  }

  const strings =
    content.mode === "rag"
      ? [
          "More Show HN launches around AI agent orchestration and MCP integrations.",
          "Continued debate on self-hosted observability stacks vs managed SaaS.",
          "Postgres extension ecosystem (pgvector, pg_cron) will stay active on HN.",
          "Indie founders will compare pricing models openly on Ask HN.",
        ]
      : [
          "Technology discussions will likely continue around AI and developer tools.",
          "Infrastructure and open source may remain popular topics.",
          "Community members will share new product launches.",
        ];

  return strings.map((prediction) => ({ prediction, sources: [] }));
}

export function ensureReportPredictions(content: ReportContent): ReportContent {
  if (content.predictions.length > 0) return content;
  return { ...content, predictions: fallbackPredictions(content) };
}

export interface ThemeCitationChunk {
  sourceTitle: string;
  similarity: number;
}

function hasInlineCitation(text: string): boolean {
  return /\[Source:/i.test(text);
}

function formatThemeCitation(chunk: ThemeCitationChunk): string {
  return `[Source: ${chunk.sourceTitle}, similarity ${chunk.similarity.toFixed(2)}]`;
}

/** Attach retrieved-source citations to Top Themes bullets that lack them. */
export function enrichTopThemeCitations(
  content: ReportContent,
  chunks: ThemeCitationChunk[],
  options?: { preferChunks?: ThemeCitationChunk[] },
): ReportContent {
  if (content.mode !== "rag" || content.topThemes.length === 0 || chunks.length === 0) {
    return content;
  }
  if (!content.topThemes.some((theme) => !hasInlineCitation(theme))) {
    return content;
  }

  const pool =
    options?.preferChunks && options.preferChunks.length > 0
      ? options.preferChunks
      : chunks;
  const sorted = [...pool].sort((a, b) => b.similarity - a.similarity);

  const topThemes = content.topThemes.map((theme, index) => {
    if (hasInlineCitation(theme)) return theme;
    const primary = sorted[index % sorted.length];
    const secondary = sorted[(index + 1) % sorted.length];
    const citations = [formatThemeCitation(primary)];
    if (secondary.sourceTitle !== primary.sourceTitle) {
      citations.push(formatThemeCitation(secondary));
    }
    return `${theme.trim()} ${citations.join(" ")}`;
  });

  return { ...content, topThemes };
}
