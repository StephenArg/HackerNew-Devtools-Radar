import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export const metadata: Metadata = {
  title: {
    default: "Community Voices — HN Devtools Radar",
    template: "%s — HN Devtools Radar",
  },
  description:
    "RAG-powered weekly digest of Hacker News devtools, AI coding, databases, and indie product discussions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Nav />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
