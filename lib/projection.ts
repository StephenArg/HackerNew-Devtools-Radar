import { UMAP } from "umap-js";

export interface Point2D {
  x: number;
  y: number;
}

function cosineDistance(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function normalizeVector(v: number[]): number[] {
  const norm = Math.hypot(...v);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function topEigenpair(
  matrix: number[][],
  maxIter = 200,
): { eigenvalue: number; eigenvector: number[] } {
  const n = matrix.length;
  let v = normalizeVector(Array.from({ length: n }, (_, i) => (i + 1) / n));

  for (let iter = 0; iter < maxIter; iter++) {
    const av = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) av[i] += matrix[i][j] * v[j];
    }
    const norm = Math.hypot(...av);
    if (norm === 0) break;
    v = av.map((x) => x / norm);
  }

  const av = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) av[i] += matrix[i][j] * v[j];
  }

  return { eigenvalue: dot(v, av), eigenvector: v };
}

function deflateMatrix(
  matrix: number[][],
  eigenvector: number[],
  eigenvalue: number,
): number[][] {
  const n = matrix.length;
  return matrix.map((row, i) =>
    row.map((value, j) => value - eigenvalue * eigenvector[i] * eigenvector[j]),
  );
}

export function projectEmbeddingsPCA(vectors: number[][]): Point2D[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];

  const d = vectors[0]?.length ?? 0;
  if (d === 0) return vectors.map(() => ({ x: 0, y: 0 }));

  const mean = new Array(d).fill(0);
  for (const vector of vectors) {
    for (let j = 0; j < d; j++) mean[j] += vector[j];
  }
  for (let j = 0; j < d; j++) mean[j] /= n;

  const centered = vectors.map((vector) =>
    vector.map((value, j) => value - mean[j]),
  );

  const gram = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const value = dot(centered[i], centered[j]);
      gram[i][j] = value;
      gram[j][i] = value;
    }
  }

  const first = topEigenpair(gram);
  const deflated = deflateMatrix(gram, first.eigenvector, first.eigenvalue);
  const second = topEigenpair(deflated);

  const scaleX = Math.sqrt(Math.max(first.eigenvalue, 0));
  const scaleY = Math.sqrt(Math.max(second.eigenvalue, 0));

  return Array.from({ length: n }, (_, i) => ({
    x: first.eigenvector[i] * scaleX,
    y: second.eigenvector[i] * scaleY,
  }));
}

export function projectEmbeddingsUMAP(vectors: number[][]): Point2D[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  if (n === 2) {
    return [
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
    ];
  }

  const nNeighbors = Math.min(15, Math.max(2, n - 1));
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist: 0.1,
    spread: 1,
    distanceFn: cosineDistance,
    random: seededRandom(42),
    nEpochs: n <= 40 ? 250 : undefined,
  });

  return umap.fit(vectors).map(([x, y]) => ({ x, y }));
}

export function projectAllEmbeddings(vectors: number[][]): {
  pca: Point2D[];
  umap: Point2D[];
} {
  return {
    pca: projectEmbeddingsPCA(vectors),
    umap: projectEmbeddingsUMAP(vectors),
  };
}
