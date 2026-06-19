const TOPIC_RULES: Array<{ topic: string; keywords: string[] }> = [
  { topic: "AI Coding", keywords: ["ai", "llm", "gpt", "copilot", "cursor", "agent", "mcp", "coding assistant"] },
  { topic: "Databases", keywords: ["postgres", "postgresql", "sqlite", "mysql", "database", "sql", "redis", "pgvector"] },
  { topic: "Self-Hosting", keywords: ["self-host", "self host", "homelab", "on-prem", "docker compose", "kubernetes"] },
  { topic: "Open Source", keywords: ["open source", "oss", "mit license", "github", "fork"] },
  { topic: "SaaS", keywords: ["saas", "pricing", "subscription", "seat", "billing", "stripe"] },
  { topic: "Infrastructure", keywords: ["infra", "cloud", "aws", "terraform", "observability", "monitoring", "cdn"] },
  { topic: "Indie Products", keywords: ["indie", "bootstrapped", "show hn", "side project", "solo founder"] },
  { topic: "Developer Tools", keywords: ["devtools", "ide", "cli", "sdk", "api", "lint", "debug"] },
];

export function assignTopic(text: string, title = ""): string {
  const haystack = `${title} ${text}`.toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.topic;
    }
  }
  return "General";
}

export function extractThemes(texts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const topic = assignTopic(text);
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
}
