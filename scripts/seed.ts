import { config } from "dotenv";
import { seedDemoData } from "../lib/seed";

config();

async function main() {
  const result = await seedDemoData();
  console.log("Seed complete:", result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
