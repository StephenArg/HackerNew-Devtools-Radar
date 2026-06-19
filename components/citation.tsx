import type { ReactNode } from "react";
import { cn, normalizeSourceTitle, stripHtml } from "@/lib/utils";

export type SourceUrlMap = Record<string, string>;

const CITATION_RE = /\[Source:[^\]]*\]/gi;

/**
 * Resolve a cited source title to a URL using the normalized-title lookup map.
 * Prefers an exact (normalized) match. The substring fallback only fires when
 * it points to a SINGLE unambiguous URL and the key is long enough to be
 * meaningful — so we never collapse many citations onto one wrong link.
 */
function resolveUrl(title: string, urlMap?: SourceUrlMap): string | undefined {
  if (!urlMap) return undefined;
  const key = normalizeSourceTitle(title);
  if (!key) return undefined;
  if (urlMap[key]) return urlMap[key];

  if (key.length < 12) return undefined;
  const candidates = new Set<string>();
  for (const [mapTitle, url] of Object.entries(urlMap)) {
    if (mapTitle.length < 12) continue;
    if (mapTitle.includes(key) || key.includes(mapTitle)) candidates.add(url);
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

interface ParsedCitation {
  title: string;
  similarity?: string;
}

const BRACKET_CITATION_RE =
  /\[Source:\s*(.*?)(?:,\s*similarity\s*([\d.]+))?\s*\]/i;
const BARE_CITATION_RE =
  /^Source:\s*(.+?)(?:,\s*similarity\s*([\d.]+))?\s*$/i;

/** Parse inline, bare, or plain-title citation strings from report JSON. */
export function parseCitation(label: string): ParsedCitation {
  const cleaned = stripHtml(label).trim();
  if (!cleaned) return { title: "source" };

  const bracketMatch = cleaned.match(BRACKET_CITATION_RE);
  if (bracketMatch) {
    const title = bracketMatch[1]?.trim();
    if (title) return { title, similarity: bracketMatch[2] };
  }

  const bareMatch = cleaned.match(BARE_CITATION_RE);
  if (bareMatch) {
    const title = bareMatch[1]?.trim();
    if (title) return { title, similarity: bareMatch[2] };
  }

  if (!/^source$/i.test(cleaned)) {
    return { title: cleaned };
  }

  return { title: "source" };
}

/** Extract raw `[Source: ...]` citation tokens from a block of text. */
export function extractCitations(text: string): string[] {
  return stripHtml(text).match(CITATION_RE) ?? [];
}

/** Remove inline `[Source: ...]` tokens, leaving clean prose. */
export function stripCitations(text: string): string {
  return stripHtml(text).replace(CITATION_RE, "").replace(/\s+/g, " ").trim();
}

/** De-duplicate citation tokens by their normalized source title. */
export function dedupeCitations(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    if (!label || !label.trim()) continue;
    const key = normalizeSourceTitle(parseCitation(label).title);
    if (!key || key === "source" || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

const PILL_BASE =
  "inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full bg-accent-soft px-2 py-0.5 align-baseline text-[11px] font-medium text-accent transition-colors";
const PILL_LINK =
  "hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1";

/**
 * One citation pill. Renders as a link opening the original source in a new tab
 * when a URL resolves, otherwise as plain (non-clickable) text.
 */
export function CitationChip({
  label,
  sourceUrlMap,
}: {
  label: string;
  sourceUrlMap?: SourceUrlMap;
}) {
  const { title, similarity } = parseCitation(label);
  if (title.toLowerCase() === "source") return null;
  const url = resolveUrl(title, sourceUrlMap);
  const fullTitle = similarity ? `${title} · similarity ${similarity}` : title;

  const inner = (
    <>
      <span className="min-w-0 truncate">{title}</span>
      {similarity && <span className="shrink-0 opacity-70">· {similarity}</span>}
    </>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open source: ${title}`}
        title={fullTitle}
        className={`${PILL_BASE} ${PILL_LINK}`}
      >
        {inner}
      </a>
    );
  }

  return (
    <span className={PILL_BASE} title={fullTitle}>
      {inner}
    </span>
  );
}

/** A wrapping row of citation pills. */
export function CitationList({
  citations,
  sourceUrlMap,
  label = "Sources",
  compact = false,
}: {
  citations: string[];
  sourceUrlMap?: SourceUrlMap;
  label?: string;
  compact?: boolean;
}) {
  const items = citations.filter((c) => {
    if (!c || !c.trim()) return false;
    const { title } = parseCitation(c);
    return title.toLowerCase() !== "source";
  });
  if (items.length === 0) return null;

  return (
    <div className={cn(compact ? "mt-2" : "mt-1", "min-w-0 max-w-full")}>
      {label && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
      )}
      <div className="flex min-w-0 max-w-full flex-wrap gap-1">
        {items.map((src, idx) => (
          <CitationChip key={`cite-${idx}`} label={src} sourceUrlMap={sourceUrlMap} />
        ))}
      </div>
    </div>
  );
}

/** Render text with inline [Source: ...] citations replaced by pills. */
export function CitedText({
  text,
  sourceUrlMap,
}: {
  text: string;
  sourceUrlMap?: SourceUrlMap;
}) {
  const value = stripHtml(text);
  const parts: ReactNode[] = [];
  const re = new RegExp(CITATION_RE);
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(value)) !== null) {
    if (match.index > last) parts.push(value.slice(last, match.index));
    parts.push(
      <span key={`cite-${i++}`} className="ml-1">
        <CitationChip label={match[0]} sourceUrlMap={sourceUrlMap} />
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

/**
 * A claim with its citations rendered cleanly below the text. In compact mode
 * (narrow cards) inline [Source: ...] markers are stripped from the prose and
 * shown as a wrapped "Sources:" pill row underneath instead of cramped inline.
 */
export function CitedClaim({
  text,
  sourceUrlMap,
  compact = false,
}: {
  text: string;
  sourceUrlMap?: SourceUrlMap;
  compact?: boolean;
}) {
  const value = stripHtml(text);

  if (!compact) {
    return <CitedText text={value} sourceUrlMap={sourceUrlMap} />;
  }

  const citations = value.match(CITATION_RE) ?? [];
  const claim = value.replace(CITATION_RE, "").replace(/\s+/g, " ").trim();

  return (
    <div className="min-w-0 max-w-full">
      <p className="text-sm leading-relaxed text-slate-700">{claim}</p>
      <CitationList citations={citations} sourceUrlMap={sourceUrlMap} compact />
    </div>
  );
}
