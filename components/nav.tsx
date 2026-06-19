"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/report", label: "Report" },
  { href: "/compare", label: "Compare" },
  { href: "/embeddings", label: "Embeddings" },
  { href: "/sources", label: "Sources" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link href="/">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              Community Voices
            </p>
            <h1 className="text-lg font-bold text-foreground">
              HN Devtools Radar
            </h1>
          </div>
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          <ThemeToggle />
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname === link.href
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
