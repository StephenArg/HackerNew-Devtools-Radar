import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Embeddings",
};

export default function EmbeddingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
