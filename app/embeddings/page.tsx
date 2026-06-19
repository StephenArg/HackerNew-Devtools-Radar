"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmbeddingMap } from "@/components/embedding-map";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Spinner } from "@/components/ui/stat";
import type { EmbeddingPoint, InfluentialSnippet } from "@/types";

export default function EmbeddingsPage() {
  const [points, setPoints] = useState<EmbeddingPoint[]>([]);
  const [topRetrieved, setTopRetrieved] = useState<InfluentialSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/embeddings");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load embeddings");
        setPoints(data.points);
        setTopRetrieved(data.topRetrieved);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <Spinner label="Loading embedding map…" />;

  if (error) {
    return (
      <EmptyState
        title="Embeddings unavailable"
        description={error}
        action={
          <Link href="/">
            <Button variant="secondary">Back to Dashboard</Button>
          </Link>
        }
      />
    );
  }

  if (points.length === 0) {
    return (
      <EmptyState
        title="No embeddings found"
        description="Run Ingest Last 7 Days on the Dashboard, then Generate Reports. The embedding map and retrieval stats populate after a RAG report is generated."
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
        <h2 className="text-3xl font-bold text-foreground">Embedding Visualization</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Switch between PCA and UMAP layouts to explore how comment chunks cluster
          in embedding space. Dot size reflects retrieval count during RAG report
          generation.
        </p>
      </div>

      <EmbeddingMap points={points} />

      <Card>
        <CardHeader
          title="Most Influential Source Snippets"
          description="These are the embedded community excerpts most often retrieved during RAG report generation. Higher retrieval counts indicate snippets that influenced multiple report sections."
        />
        {topRetrieved.length === 0 ? (
          <p className="text-sm text-muted">
            No snippets have been retrieved yet. Generate a RAG report (Dashboard
            → Generate Reports) to populate retrieval statistics.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Topic</th>
                  <th className="px-3 py-2 font-medium">Preview</th>
                  <th className="px-3 py-2 font-medium">Retrievals</th>
                  <th className="px-3 py-2 font-medium">Avg Similarity</th>
                  <th className="px-3 py-2 font-medium">Used In Sections</th>
                </tr>
              </thead>
              <tbody>
                {topRetrieved.map((snippet) => (
                  <tr key={snippet.id} className="border-b border-border/70">
                    <td className="px-3 py-3 align-top font-medium text-foreground">
                      {snippet.sourceUrl ? (
                        <a
                          href={snippet.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open source: ${snippet.sourceTitle}`}
                          className="text-accent hover:underline"
                        >
                          {snippet.sourceTitle}
                        </a>
                      ) : (
                        snippet.sourceTitle
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">{snippet.topic}</td>
                    <td className="max-w-md px-3 py-3 align-top text-slate-700">
                      {snippet.preview}
                    </td>
                    <td className="px-3 py-3 align-top font-semibold">
                      {snippet.retrievalCount}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {snippet.avgSimilarity != null
                        ? snippet.avgSimilarity.toFixed(2)
                        : "—"}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {snippet.usedInSections.length > 0
                        ? snippet.usedInSections.join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
