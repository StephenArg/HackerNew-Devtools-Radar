import type { ReportContent, ReportMethodologyStats } from "@/types";
import {
  CitationChip,
  CitationList,
  CitedClaim,
  CitedText,
  dedupeCitations,
  extractCitations,
  stripCitations,
  type SourceUrlMap,
} from "@/components/citation";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { normalizePrediction } from "@/lib/report-content";
import { stripHtml } from "@/lib/utils";

function clean(text: string): string {
  return stripHtml(text);
}

/** Bulleted list where each item shows its citations cleanly below the claim. */
function CitedBulletList({
  items,
  prefix,
  sourceUrlMap,
}: {
  items: string[];
  prefix: string;
  sourceUrlMap?: SourceUrlMap;
}) {
  return (
    <ul className="space-y-3 text-sm text-slate-700">
      {items.map((item, idx) => (
        <li key={`${prefix}-${idx}`} className="flex min-w-0 gap-2">
          <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" />
          <div className="min-w-0 flex-1">
            <CitedClaim text={item} sourceUrlMap={sourceUrlMap} compact />
          </div>
        </li>
      ))}
    </ul>
  );
}

function MethodologyStats({ stats }: { stats: ReportMethodologyStats }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "HN threads / sources", value: String(stats.sources) },
    { label: "Community documents", value: String(stats.documents) },
    { label: "Embedded snippets", value: String(stats.embeddedSnippets) },
    { label: "Retrieved snippets used", value: String(stats.retrievedChunks) },
    { label: "Inline citations", value: String(stats.inlineCitations) },
    { label: "Unique cited sources", value: String(stats.uniqueCitedSources) },
    { label: "Coverage window", value: stats.coverageWindow || "—" },
    { label: "Report mode", value: stats.mode === "rag" ? "RAG-powered" : "No-RAG baseline" },
  ];

  return (
    <div className="mt-4 rounded-lg border border-border bg-slate-50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        This report was generated from
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col">
            <dt className="text-xs text-muted">{row.label}</dt>
            <dd className="font-semibold text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ReportView({
  content,
  sourceUrlMap,
  methodologyStats,
}: {
  content: ReportContent;
  sourceUrlMap?: SourceUrlMap;
  methodologyStats?: ReportMethodologyStats | null;
}) {
  const isRag = content.mode === "rag";

  return (
    <div className="min-w-0 space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold text-foreground">{clean(content.title)}</h2>
        <Badge variant={isRag ? "rag" : "noRag"}>
          {isRag ? "RAG-powered" : "No-RAG baseline"}
        </Badge>
      </div>
      <p className="text-sm text-muted">Coverage: {content.coverageWindow}</p>

      {!isRag && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          <p className="font-semibold">No-RAG Baseline — generated without retrieval</p>
          <p className="mt-1 text-orange-700">
            This report uses only the community description and general model
            knowledge. It has no citations and cannot reference specific Hacker
            News threads; representative voices are generic illustrative examples,
            not retrieved from source data.
          </p>
        </div>
      )}

      <Card>
        <CardHeader title="Executive Summary" />
        <p className="text-sm leading-relaxed text-slate-700">
          <CitedText text={content.executiveSummary} sourceUrlMap={sourceUrlMap} />
        </p>
      </Card>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Top Themes" />
          <CitedBulletList items={content.topThemes} prefix="theme" sourceUrlMap={sourceUrlMap} />
        </Card>

        <Card className="min-w-0">
          <CardHeader title="What People Were Excited About" />
          <CitedBulletList items={content.excitedAbout} prefix="excited" sourceUrlMap={sourceUrlMap} />
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Complaints & Pain Points" />
          <CitedBulletList items={content.complaints} prefix="complaint" sourceUrlMap={sourceUrlMap} />
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Notable Disagreements" />
          <CitedBulletList items={content.disagreements} prefix="disagreement" sourceUrlMap={sourceUrlMap} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Representative Voices" />
        <div className="space-y-4">
          {content.representativeVoices.map((voice, idx) => (
            <blockquote
              key={`${voice.sourceTitle}-${idx}`}
              className="rounded-lg border border-border bg-slate-50 p-4 text-sm text-slate-700"
            >
              <p className="italic">&ldquo;{clean(voice.quote)}&rdquo;</p>
              <footer className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted">
                <span>—</span>
                {voice.sourceUrl ? (
                  <a
                    href={voice.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open source: ${clean(voice.sourceTitle) || "Hacker News thread"}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {clean(voice.sourceTitle) || "View on Hacker News"}
                  </a>
                ) : (
                  <span>{clean(voice.sourceTitle)}</span>
                )}
                {voice.citation && (
                  <CitationChip label={voice.citation} sourceUrlMap={sourceUrlMap} />
                )}
              </footer>
            </blockquote>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Predictions for Next Week"
          description={
            isRag
              ? "Projections grounded in this week's retrieved evidence, with supporting sources."
              : undefined
          }
        />
        <div className="grid gap-3 lg:grid-cols-2">
          {content.predictions.map((item, idx) => {
            const p = normalizePrediction(item);
            // Show each source once: strip inline [Source: ...] pills from the
            // prose and collect all citations into a single deduped Sources row.
            const sources = dedupeCitations([
              ...extractCitations(p.prediction),
              ...(p.why ? extractCitations(p.why) : []),
              ...(p.sources ?? []),
            ]);
            return (
              <div
                key={`prediction-${idx}`}
                className="min-w-0 rounded-lg border border-border bg-slate-50 p-4 text-sm leading-relaxed text-slate-700"
              >
                <p className="font-medium text-foreground">
                  {stripCitations(p.prediction)}
                </p>
                {p.why && stripCitations(p.why) && (
                  <p className="mt-2 text-slate-600">
                    <span className="font-semibold text-muted">Why: </span>
                    {stripCitations(p.why)}
                  </p>
                )}
                {sources.length > 0 && (
                  <CitationList citations={sources} sourceUrlMap={sourceUrlMap} compact />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {isRag && content.signals && content.signals.length > 0 && (
        <Card>
          <CardHeader
            title="Signals from the Community"
            description="Synthesized patterns across the retrieved evidence."
          />
          {/* Card layout (wraps cleanly on narrow widths instead of overflowing). */}
          <div className="space-y-4">
            {content.signals.map((signal, idx) => (
              <div
                key={`signal-${idx}`}
                className="min-w-0 rounded-lg border border-border bg-slate-50 p-4"
              >
                <p className="text-sm font-semibold text-foreground">
                  {clean(signal.signal)}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Evidence
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{clean(signal.evidence)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Interpretation
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {clean(signal.interpretation)}
                    </p>
                  </div>
                </div>
                <CitationList citations={signal.sources} sourceUrlMap={sourceUrlMap} compact />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Source Coverage / Methodology" />
        <p className="text-sm leading-relaxed text-slate-700">
          {clean(content.methodology)}
        </p>
        {methodologyStats && isRag && <MethodologyStats stats={methodologyStats} />}
        {content.citations && content.citations.length > 0 && (
            <div className="mt-4 min-w-0 max-w-full">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Cited sources
              </p>
              <div className="flex min-w-0 max-w-full flex-wrap gap-1">
              {content.citations.map((citation, idx) => (
                <CitationChip
                  key={`citation-${idx}`}
                  label={citation}
                  sourceUrlMap={sourceUrlMap}
                />
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
