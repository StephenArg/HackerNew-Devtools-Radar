import { config } from "dotenv";
import { generateRagReport } from "../lib/reports";

config();

async function main() {
  const result = await generateRagReport();
  console.log("RAG report generated:", result.reportId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
