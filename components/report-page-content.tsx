"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SourceUrlMap } from "@/components/citation";
import { ReportView } from "@/components/report-view";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/stat";
import type { ReportContent, ReportMethodologyStats } from "@/types";

export function ReportPageContent({
  reportId,
  emptyTitle = "No report generated yet",
  emptyDescription = "Go to Dashboard, click Ingest Last 7 Days, then Generate Reports.",
}: {
  reportId?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [content, setContent] = useState<ReportContent | null>(null);
  const [sourceUrlMap, setSourceUrlMap] = useState<SourceUrlMap>({});
  const [methodologyStats, setMethodologyStats] =
    useState<ReportMethodologyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const url = reportId
          ? `/api/reports/${reportId}`
          : "/api/reports/latest";
        const res = await fetch(url);
        if (res.status === 404) {
          setContent(null);
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load report");
        setContent(data.report.contentJson as ReportContent);
        setSourceUrlMap((data.sourceUrlMap ?? {}) as SourceUrlMap);
        setMethodologyStats(
          (data.methodologyStats ?? null) as ReportMethodologyStats | null,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [reportId]);

  if (loading) {
    return (
      <Spinner label={reportId ? "Loading report…" : "Loading latest report…"} />
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Could not load report"
        description={error}
        action={
          <Link href="/">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  if (!content) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={
          <Link href="/">
            <Button>Go to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ReportView
      content={content}
      sourceUrlMap={sourceUrlMap}
      methodologyStats={methodologyStats}
    />
  );
}
