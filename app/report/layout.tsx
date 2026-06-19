import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Report",
};

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
