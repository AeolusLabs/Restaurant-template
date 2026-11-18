// A small job loop for the worker service. Each job runs on its own interval, never overlaps itself, and a
// failure in one job is logged without stopping the others. pg-boss replaces this when a job needs retries
// and backoff. Phase 4 did not need it: deliveries are database rows with their own attempts and backoff (see the
// Phase 4 plan, ruling 1), so the loop below is still all the worker is.

export type Job = { name: string; everyMs: number; run: () => Promise<unknown> };
export type JobLog = { error: (message: string) => void };

async function runSafely(job: Job, log: JobLog): Promise<void> {
  try {
    await job.run();
  } catch (err) {
    log.error(`job ${job.name} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Runs every job once and waits for all of them. */
export async function runJobsOnce(jobs: Job[], log: JobLog = console): Promise<void> {
  await Promise.all(jobs.map((j) => runSafely(j, log)));
}

export function startWorker(jobs: Job[], log: JobLog = console): { stop: () => Promise<void> } {
  const running = new Map<string, Promise<void>>();
  const timers = jobs.map((job) =>
    setInterval(() => {
      if (running.has(job.name)) return; // still busy with the last run
      const p = runSafely(job, log).finally(() => running.delete(job.name));
      running.set(job.name, p);
    }, job.everyMs),
  );
  return {
    async stop() {
      timers.forEach(clearInterval);
      await Promise.all(running.values());
    },
  };
}
