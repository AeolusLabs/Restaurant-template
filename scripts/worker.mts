import "dotenv/config";
import { closePools } from "@/db/context";
import { jobs } from "@/jobs";
import { startWorker } from "@/jobs/worker";
import { validateBoot } from "@/lib/boot";

validateBoot();
const worker = startWorker(jobs);
console.log(`Worker running ${jobs.map((j) => j.name).join(", ")}. Press Ctrl+C to stop.`);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await closePools();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
