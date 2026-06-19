import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "All Reports",
};

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
