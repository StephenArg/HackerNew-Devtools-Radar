"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { TOPIC_COLORS } from "@/lib/constants";
import type { EmbeddingPoint } from "@/types";
import { cn, truncate } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";

type ProjectionMode = "pca" | "umap";

type ScatterPoint = EmbeddingPoint & { x: number; y: number };

const PROJECTION_COPY: Record<
  ProjectionMode,
  { label: string; description: string }
> = {
  pca: {
    label: "PCA",
    description:
      "Linear projection onto the two directions of greatest variance. Good for seeing broad spread and outliers.",
  },
  umap: {
    label: "UMAP",
    description:
      "Nonlinear layout that preserves local neighborhoods. Nearby dots tend to be semantically similar.",
  },
};

export function EmbeddingMap({ points }: { points: EmbeddingPoint[] }) {
  const [projection, setProjection] = useState<ProjectionMode>("umap");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const topics = useMemo(
    () => [...new Set(points.map((p) => p.topic))],
    [points],
  );

  const scatterData = useMemo<ScatterPoint[]>(
    () =>
      points.map((point) => {
        const coords = projection === "pca" ? point.pca : point.umap;
        return { ...point, x: coords.x, y: coords.y };
      }),
    [points, projection],
  );

  const selected = useMemo(
    () => points.find((point) => point.id === selectedId) ?? null,
    [points, selectedId],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Embedding Map"
          description={PROJECTION_COPY[projection].description}
        />
        <div className="mb-4 inline-flex rounded-lg border border-border bg-slate-50 p-1">
          {(Object.keys(PROJECTION_COPY) as ProjectionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setProjection(mode)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                projection === mode
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              {PROJECTION_COPY[mode].label}
            </button>
          ))}
        </div>
        <div className="h-[480px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" hide />
              <YAxis type="number" dataKey="y" hide />
              <ZAxis dataKey="retrievalCount" range={[60, 200]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]?.payload) return null;
                  const point = payload[0].payload as ScatterPoint;
                  return (
                    <div className="max-w-xs rounded-lg border border-border bg-white p-3 text-xs shadow-lg">
                      <p className="font-semibold">{point.topic}</p>
                      <p className="mt-1 text-muted">{point.sourceTitle}</p>
                      <p className="mt-2">{truncate(point.text, 140)}</p>
                      <p className="mt-2 text-muted">
                        Retrievals: {point.retrievalCount}
                      </p>
                    </div>
                  );
                }}
              />
              {topics.map((topic) => (
                <Scatter
                  key={topic}
                  name={topic}
                  data={scatterData.filter((point) => point.topic === topic)}
                  fill={TOPIC_COLORS[topic] ?? TOPIC_COLORS.General}
                  onClick={(data) => {
                    const point = data as ScatterPoint;
                    setSelectedId(point.id);
                  }}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {topics.map((topic) => (
            <div key={topic} className="flex items-center gap-2 text-xs">
              <span
                className="h-3 w-3 rounded-full"
                style={{
                  backgroundColor: TOPIC_COLORS[topic] ?? TOPIC_COLORS.General,
                }}
              />
              {topic}
            </div>
          ))}
        </div>
      </Card>

      {selected && (
        <Card>
          <CardHeader title="Selected Chunk" />
          <p className="text-sm font-medium text-foreground">{selected.topic}</p>
          {selected.sourceUrl ? (
            <a
              href={selected.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open source: ${selected.sourceTitle}`}
              className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
            >
              {selected.sourceTitle}
            </a>
          ) : (
            <p className="mt-1 text-xs text-muted">{selected.sourceTitle}</p>
          )}
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            {selected.text}
          </p>
          <p className="mt-3 text-xs text-muted">
            Retrieval count: {selected.retrievalCount}
          </p>
        </Card>
      )}
    </div>
  );
}
