"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Spinner } from "@/components/ui/stat";
import type { SourceRow } from "@/types";
import { cn, formatDate } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
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

function categoryLabel(category: string | null): string {
  if (!category) return "Uncategorized";
  return CATEGORY_LABELS[category] ?? category;
}

type SortKey =
  | "title"
  | "category"
  | "score"
  | "author"
  | "created"
  | "points"
  | "comments"
  | "chunks";

type SortDir = "asc" | "desc";

const SORT_COLUMNS: Array<{ key: SortKey; label: string; defaultDir: SortDir }> = [
  { key: "title", label: "Title", defaultDir: "asc" },
  { key: "category", label: "Category", defaultDir: "asc" },
  { key: "score", label: "Score", defaultDir: "desc" },
  { key: "author", label: "Author", defaultDir: "asc" },
  { key: "created", label: "Created", defaultDir: "desc" },
  { key: "points", label: "Points", defaultDir: "desc" },
  { key: "comments", label: "Comments", defaultDir: "desc" },
  { key: "chunks", label: "Chunks", defaultDir: "desc" },
];

function compareNullableNumber(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function compareNullableString(
  a: string | null,
  b: string | null,
  dir: SortDir,
): number {
  const av = (a ?? "").trim().toLowerCase();
  const bv = (b ?? "").trim().toLowerCase();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv);
  return dir === "asc" ? cmp : -cmp;
}

function sortSources(
  rows: SourceRow[],
  key: SortKey,
  dir: SortDir,
): SourceRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (key) {
      case "title":
        return compareNullableString(a.title, b.title, dir);
      case "category":
        return compareNullableString(
          categoryLabel(a.relevanceCategory),
          categoryLabel(b.relevanceCategory),
          dir,
        );
      case "score":
        return compareNullableNumber(a.relevanceScore, b.relevanceScore, dir);
      case "author":
        return compareNullableString(a.author, b.author, dir);
      case "created": {
        const av = new Date(a.createdAtExternal).getTime();
        const bv = new Date(b.createdAtExternal).getTime();
        return dir === "asc" ? av - bv : bv - av;
      }
      case "points":
        return compareNullableNumber(a.points, b.points, dir);
      case "comments":
        return compareNullableNumber(a.numComments, b.numComments, dir);
      case "chunks":
        return compareNullableNumber(a.chunkCount, b.chunkCount, dir);
      default:
        return 0;
    }
  });
  return sorted;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2 font-medium" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
          active ? "text-foreground" : "text-muted",
        )}
      >
        {label}
        <span aria-hidden className="inline-block w-3 text-center text-xs">
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedSources = useMemo(
    () => sortSources(sources, sortKey, sortDir),
    [sources, sortKey, sortDir],
  );

  function handleSort(key: SortKey) {
    const column = SORT_COLUMNS.find((col) => col.key === key);
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(column?.defaultDir ?? "asc");
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/sources");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load sources");
        setSources(data.sources);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <Spinner label="Loading sources…" />;

  if (error) {
    return (
      <EmptyState
        title="Sources unavailable"
        description={error}
        action={
          <Link href="/">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        title="No sources found"
        description="Run Ingest Last 7 Days from the dashboard to populate the source catalog."
        action={
          <Link href="/">
            <Button>Go to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-foreground">Ingested Sources</h2>
        <p className="mt-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
          Only HN items that passed the devtools/builder relevance filter are
          stored and embedded.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {sources.length} Hacker News threads that passed the devtools/builder
          relevance filter. Each row shows the matched relevance category, the
          deterministic relevance score, and the reason it was kept — so reviewers
          can confirm this app is not ingesting random Hacker News content.
        </p>
      </div>

      <Card>
        <CardHeader title="Source Catalog" />
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                {SORT_COLUMNS.map((column) => (
                  <SortHeader
                    key={column.key}
                    label={column.label}
                    active={sortKey === column.key}
                    dir={sortDir}
                    onClick={() => handleSort(column.key)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSources.map((source) => (
                <tr key={source.id} className="border-b border-border/70">
                  <td className="max-w-sm px-3 py-3 align-top">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open source: ${source.title}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {source.title}
                    </a>
                    {source.relevanceReason && (
                      <details className="mt-1 text-xs text-muted">
                        <summary className="cursor-pointer select-none hover:text-foreground">
                          Why kept
                        </summary>
                        <p className="mt-1 leading-relaxed">
                          {source.relevanceReason}
                        </p>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span title={source.relevanceReason ?? undefined}>
                      <Badge
                        variant={
                          source.relevanceCategory &&
                          source.relevanceCategory !== "not_relevant"
                            ? "accent"
                            : "warning"
                        }
                      >
                        {categoryLabel(source.relevanceCategory)}
                      </Badge>
                    </span>
                  </td>
                  <td
                    className="px-3 py-3 align-top font-medium"
                    title={source.relevanceReason ?? undefined}
                  >
                    {source.relevanceScore != null
                      ? source.relevanceScore.toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-3 py-3 align-top">{source.author ?? "—"}</td>
                  <td className="px-3 py-3 align-top">
                    {formatDate(source.createdAtExternal)}
                  </td>
                  <td className="px-3 py-3 align-top">{source.points ?? "—"}</td>
                  <td className="px-3 py-3 align-top">
                    {source.numComments ?? "—"}
                  </td>
                  <td className="px-3 py-3 align-top font-semibold">
                    {source.chunkCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
