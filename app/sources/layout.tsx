import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sources",
};

export default function SourcesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
