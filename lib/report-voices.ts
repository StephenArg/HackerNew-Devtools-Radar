import prisma from "@/lib/db";
import { parseCitation } from "@/components/citation";
import { normalizeSourceTitle, stripHtml } from "@/lib/utils";
import type { ReportContent } from "@/types";

export interface ChunkSourceRef {
  sourceTitle: string;
  sourceUrl: string;
}

function buildUrlLookup(chunks: ChunkSourceRef[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const chunk of chunks) {
    const key = normalizeSourceTitle(chunk.sourceTitle);
    if (key && chunk.sourceUrl && !lookup.has(key)) {
      lookup.set(key, chunk.sourceUrl);
    }
  }
  return lookup;
}

/**
 * Resolve a source title to a URL. Exact (normalized) match first; the
 * substring fallback only returns a URL when it is unambiguous (exactly one
 * candidate) and the key is long enough — so we never attach a wrong link.
 */
function resolveUrl(
  sourceTitle: string,
  lookup: Map<string, string>,
): string | undefined {
  const key = normalizeSourceTitle(sourceTitle);
  if (!key) return undefined;

  const exact = lookup.get(key);
  if (exact) return exact;

  if (key.length < 12) return undefined;
  const candidates = new Set<string>();
  for (const [title, url] of lookup) {
    if (title.length < 12) continue;
    if (title.includes(key) || key.includes(title)) candidates.add(url);
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

export function enrichVoicesFromChunks(
  content: ReportContent,
  chunks: ChunkSourceRef[],
): ReportContent {
  if (chunks.length === 0) return content;
  const lookup = buildUrlLookup(chunks);

  return {
    ...content,
    representativeVoices: content.representativeVoices.map((voice) => ({
      ...voice,
      sourceUrl:
        resolveUrl(voice.sourceTitle, lookup) ??
        voice.sourceUrl ??
        undefined,
    })),
  };
}

// Capture the FULL cited title (handling titles that contain commas) exactly
// the way the CitationChip parser does, so map keys match what the pill looks
// up. Stops the title before an optional ", similarity <n>" suffix or the "]".
const INLINE_CITATION_RE = /\[Source:\s*(.*?)(?:,\s*similarity\s*[\d.]+)?\s*\]/gi;

/** Collect every cited/source title referenced anywhere in a report. */
function collectCitedTitles(content: ReportContent): string[] {
  const titles = new Set<string>();
  const add = (raw?: string) => {
    const t = raw ? stripHtml(raw).trim() : "";
    if (t) titles.add(t);
  };

  const scanInline = (text?: string) => {
    if (!text) return;
    const re = new RegExp(INLINE_CITATION_RE);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) add(match[1]);
  };

  const addCitationLabel = (raw?: string) => {
    if (!raw) return;
    const cleaned = stripHtml(raw).trim();
    if (!cleaned) return;
    scanInline(cleaned);
    const { title } = parseCitation(cleaned);
    if (title && title.toLowerCase() !== "source") add(title);
  };

  scanInline(content.executiveSummary);
  for (const arr of [
    content.topThemes,
    content.excitedAbout,
    content.complaints,
    content.disagreements,
  ]) {
    for (const line of arr) scanInline(line);
  }
  for (const p of content.predictions) {
    if (typeof p === "string") {
      scanInline(p);
    } else {
      scanInline(p.prediction);
      scanInline(p.why);
      for (const src of p.sources ?? []) addCitationLabel(src);
    }
  }
  for (const voice of content.representativeVoices) {
    add(voice.sourceTitle);
    addCitationLabel(voice.citation);
  }
  for (const signal of content.signals ?? []) {
    for (const src of signal.sources) addCitationLabel(src);
  }
  for (const citation of content.citations ?? []) addCitationLabel(citation);

  return [...titles];
}

/**
 * Build a normalized-title -> source URL lookup for every source cited in the
 * report. Used to make citation/source pills clickable in the UI.
 *
 * Sources are matched by `normalizeSourceTitle` (not an exact DB `in` query) so
 * model-generated citation text resolves to the correct source despite case,
 * dash, quote, punctuation, or truncated-title differences. Only confident
 * matches are included — we never guess, so a pill is either correct or not a
 * link.
 */
export async function buildCitationUrlMap(
  content: ReportContent,
): Promise<Record<string, string>> {
  const titles = collectCitedTitles(content);
  if (titles.length === 0) return {};

  const sources = await prisma.source.findMany({
    select: { title: true, url: true },
  });

  const dbByNorm = new Map<string, string>();
  for (const source of sources) {
    if (!source.url) continue;
    const key = normalizeSourceTitle(source.title);
    if (key && !dbByNorm.has(key)) dbByNorm.set(key, source.url);
  }

  const map: Record<string, string> = {};
  for (const title of titles) {
    const key = normalizeSourceTitle(title);
    const url = resolveUrl(title, dbByNorm);
    if (key && url) map[key] = url;
  }
  // Voice URLs from stored report JSON may be stale (e.g. external link from
  // pre-backfill ingest). DB titles win; voices only fill unresolved keys.
  for (const voice of content.representativeVoices) {
    if (voice.sourceUrl && voice.sourceTitle) {
      const key = normalizeSourceTitle(voice.sourceTitle);
      if (key && !map[key]) map[key] = voice.sourceUrl;
    }
  }
  return map;
}

export async function enrichReportVoiceUrls(
  content: ReportContent,
): Promise<ReportContent> {
  const hasTitles = content.representativeVoices.some((voice) =>
    voice.sourceTitle.trim(),
  );
  if (!hasTitles) return content;

  // Match against all sources by normalized title (robust to case/dash/punct
  // differences in model-generated voice attributions).
  const sources = await prisma.source.findMany({
    select: { title: true, url: true },
  });

  const lookup = new Map<string, string>();
  for (const source of sources) {
    if (!source.url) continue;
    const key = normalizeSourceTitle(source.title);
    if (key && !lookup.has(key)) lookup.set(key, source.url);
  }

  return {
    ...content,
    representativeVoices: content.representativeVoices.map((voice) => ({
      ...voice,
      sourceUrl:
        resolveUrl(voice.sourceTitle, lookup) ??
        voice.sourceUrl ??
        undefined,
    })),
  };
}
