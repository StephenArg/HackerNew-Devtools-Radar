import { config } from "dotenv";
import { ingestLastSevenDays } from "../lib/ingest";

config();

async function main() {
  const result = await ingestLastSevenDays();
  console.log("Ingest complete:", result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
