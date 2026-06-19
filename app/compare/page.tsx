"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ReportView } from "@/components/report-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Spinner } from "@/components/ui/stat";
import type { SourceUrlMap } from "@/components/citation";
import type {
  CompareMetrics,
  ReportContent,
  ReportMethodologyStats,
  RubricEvaluation,
} from "@/types";

interface CompareResponse {
  rag: { contentJson: ReportContent } | null;
  noRag: { contentJson: ReportContent } | null;
  metrics: CompareMetrics;
  rubric: RubricEvaluation;
  sourceUrlMap?: SourceUrlMap;
  methodologyStats?: ReportMethodologyStats | null;
}

function MetricBar({
  label,
  rag,
  noRag,
  format = (v: number) => `${Math.round(v * 100)}%`,
}: {
  label: string;
  rag: number;
  noRag: number;
  format?: (value: number) => string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">
          No-RAG {format(noRag)} · RAG {format(rag)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="h-2 rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-orange-400"
            style={{ width: `${Math.min(noRag * 100, 100)}%` }}
          />
        </div>
        <div className="h-2 rounded-full bg-slate-100">
          <div
            className="h-2 rounded-full bg-indigo-500"
            style={{ width: `${Math.min(rag * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/reports/compare");
        const json = (await res.json()) as CompareResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Compare failed");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Compare failed");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <Spinner label="Loading comparison and rubric evaluation…" />
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Comparison unavailable"
        description={error}
        action={
          <Link href="/">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  if (!data?.rag && !data?.noRag) {
    return (
      <EmptyState
        title="No reports to compare yet"
        description="Go to Dashboard, click Ingest Last 7 Days, then Generate Reports to produce a no-RAG baseline and a RAG report side-by-side."
        action={
          <Link href="/">
            <Button>Go to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  const ragContent = data.rag?.contentJson ?? null;
  const noRagContent = data.noRag?.contentJson ?? null;
  const rubric = data.rubric;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-foreground">A/B Comparison</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Side-by-side evaluation of retrieval-grounded synthesis vs a generic
          no-RAG baseline. Heuristics run on every load; LLM judge scores are
          batched into report generation (zero extra calls on this page). The
          rubric table and the quick metrics below read from the same scoring
          object, so the numbers never contradict each other.
        </p>
      </div>

      {data.rag && data.noRag && (
        <Card>
          <CardHeader title="Why RAG performed better" />
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>
              Claims are backed by retrieved community sources, not general model
              knowledge.
            </li>
            <li>Inline citations appear across every major section.</li>
            <li>
              Specific retrieved evidence (real thread titles, quotes, similarity
              scores) replaces vague summaries.
            </li>
            <li>
              Predictions project from observed weekly patterns rather than broad
              industry guesses.
            </li>
            <li>
              Representative voices come from actual ingested discussions instead
              of generic illustrative examples.
            </li>
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title="RAG Evaluation Rubric"
          description={rubric.scoringMethod}
          action={
            rubric.judgeUsed ? (
              <Badge variant="success">
                {rubric.judgeBatched ? "Heuristic + batched judge" : "Heuristic + LLM judge"}
              </Badge>
            ) : (
              <Badge variant="warning">Heuristic only</Badge>
            )
          }
        />

        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm text-muted">No-RAG Total</p>
            <p className="text-3xl font-bold text-orange-700">
              {rubric.totals.noRag}
              <span className="text-base font-normal text-muted">
                {" "}
                / {rubric.totals.max}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              Heuristic {rubric.totals.noRagHeuristic}
              {rubric.totals.noRagJudge !== null &&
                ` · Judge ${rubric.totals.noRagJudge}`}
            </p>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <p className="text-sm text-muted">RAG Total</p>
            <p className="text-3xl font-bold text-indigo-700">
              {rubric.totals.rag}
              <span className="text-base font-normal text-muted">
                {" "}
                / {rubric.totals.max}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              Heuristic {rubric.totals.ragHeuristic}
              {rubric.totals.ragJudge !== null &&
                ` · Judge ${rubric.totals.ragJudge}`}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Max Points</th>
                <th className="px-3 py-2 font-medium">No-RAG Score</th>
                <th className="px-3 py-2 font-medium">RAG Score</th>
                <th className="px-3 py-2 font-medium">
                  Why RAG performed better or worse
                </th>
              </tr>
            </thead>
            <tbody>
              {rubric.categories.map((row) => (
                <tr key={row.id} className="border-b border-border/70 align-top">
                  <td className="px-3 py-3">
                    <p className="font-medium text-foreground">{row.name}</p>
                    <p className="mt-1 text-xs text-muted">{row.description}</p>
                  </td>
                  <td className="px-3 py-3">{row.maxPoints}</td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-orange-700">
                      {row.noRagScore}
                    </span>
                    <p className="mt-1 text-xs text-muted">
                      H {row.noRagHeuristic}
                      {row.noRagJudge !== null && ` · J ${row.noRagJudge}`}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-semibold text-indigo-700">
                      {row.ragScore}
                    </span>
                    <p className="mt-1 text-xs text-muted">
                      H {row.ragHeuristic}
                      {row.ragJudge !== null && ` · J ${row.ragJudge}`}
                    </p>
                  </td>
                  <td className="max-w-md px-3 py-3 text-slate-700">
                    {row.comparison}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-3">Total</td>
                <td className="px-3 py-3">{rubric.totals.max}</td>
                <td className="px-3 py-3 text-orange-700">{rubric.totals.noRag}</td>
                <td className="px-3 py-3 text-indigo-700">{rubric.totals.rag}</td>
                <td className="px-3 py-3 text-slate-700">
                  {(() => {
                    const delta = rubric.totals.rag - rubric.totals.noRag;
                    if (delta > 0) {
                      return `RAG leads by ${delta} points overall when averaged across heuristic and judge scoring.`;
                    }
                    if (delta < 0) {
                      return `No-RAG leads by ${Math.abs(delta)} points overall — RAG did not outperform on this run.`;
                    }
                    return "Both reports tied on the combined heuristic and judge scoring.";
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Quick Comparison Metrics"
          description="Read directly from the rubric scores above (same source of truth) plus raw retrieval counts."
        />
        <div className="space-y-5">
          <p className="text-xs text-muted">
            <span className="text-orange-600">Orange</span> = No-RAG ·{" "}
            <span className="text-indigo-600">Blue</span> = RAG
          </p>
          {["groundedness", "specificity", "citationQuality", "coverage"].map(
            (id) => {
              const cat = rubric.categories.find((c) => c.id === id);
              if (!cat) return null;
              return (
                <MetricBar
                  key={id}
                  label={cat.name}
                  rag={cat.ragScore / cat.maxPoints}
                  noRag={cat.noRagScore / cat.maxPoints}
                  format={(v) => `${Math.round(v * cat.maxPoints)}/${cat.maxPoints}`}
                />
              );
            },
          )}

          <div className="grid gap-4 rounded-lg border border-border bg-slate-50 p-4 text-sm md:grid-cols-2">
            <div className="flex justify-between">
              <span className="font-medium">Inline citations</span>
              <span className="text-muted">
                No-RAG {data.metrics.citationCount.noRag} · RAG{" "}
                {data.metrics.citationCount.rag}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Retrieved chunks</span>
              <span className="text-muted">
                No-RAG {data.metrics.retrievedChunks.noRag} · RAG{" "}
                {data.metrics.retrievedChunks.rag}
              </span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">
                Repeated themes (No-RAG)
              </p>
              <div className="flex flex-wrap gap-2">
                {data.metrics.repeatedThemes.noRag.map((theme) => (
                  <Badge key={theme} variant="noRag">
                    {theme}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Repeated themes (RAG)</p>
              <div className="flex flex-wrap gap-2">
                {data.metrics.repeatedThemes.rag.map((theme) => (
                  <Badge key={theme} variant="rag">
                    {theme}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-8 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2">
            <h3 className="text-lg font-semibold">No-RAG Baseline</h3>
            <Badge variant="noRag">Generic</Badge>
          </div>
          {noRagContent ? (
            <ReportView content={noRagContent} />
          ) : (
            <EmptyState
              title="No no-RAG report"
              description="Generate a no-RAG baseline from the dashboard."
            />
          )}
          {/* No-RAG has no retrieval, so no sourceUrlMap/methodologyStats apply. */}
        </div>
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2">
            <h3 className="text-lg font-semibold">RAG Report</h3>
            <Badge variant="rag">Grounded</Badge>
          </div>
          {ragContent ? (
            <ReportView
              content={ragContent}
              sourceUrlMap={data.sourceUrlMap}
              methodologyStats={data.methodologyStats}
            />
          ) : (
            <EmptyState
              title="No RAG report"
              description="Generate a RAG report from the dashboard."
            />
          )}
        </div>
      </div>
    </div>
  );
}
