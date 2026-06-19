import { config } from "dotenv";
import { generateNoRagReport } from "../lib/reports";

config();

async function main() {
  const result = await generateNoRagReport();
  console.log("No-RAG report generated:", result.reportId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
