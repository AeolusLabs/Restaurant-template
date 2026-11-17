import { describe, expect, test, vi } from "vitest";
import { runJobsOnce, startWorker, type Job } from "../src/jobs/worker";

const silent = { error: () => undefined };

describe("runJobsOnce", () => {
  test("runs every job and returns after all have finished", async () => {
    const ran: string[] = [];
    const jobs: Job[] = [
      { name: "a", everyMs: 1, run: async () => void ran.push("a") },
      { name: "b", everyMs: 1, run: async () => void ran.push("b") },
    ];
    await runJobsOnce(jobs, silent);
    expect(ran.sort()).toEqual(["a", "b"]);
  });

  test("a job that throws is reported and does not stop the others", async () => {
    const errors: string[] = [];
    const ran: string[] = [];
    await runJobsOnce(
      [
        { name: "bad", everyMs: 1, run: async () => Promise.reject(new Error("boom")) },
        { name: "good", everyMs: 1, run: async () => void ran.push("good") },
      ],
      { error: (m) => void errors.push(m) },
    );
    expect(ran).toEqual(["good"]);
    expect(errors.join(" ")).toMatch(/bad.*boom/);
  });
});

describe("startWorker", () => {
  test("runs each job on its own interval, and stop() halts them", async () => {
    vi.useFakeTimers();
    try {
      let fast = 0;
      let slow = 0;
      const w = startWorker(
        [
          { name: "fast", everyMs: 100, run: async () => void fast++ },
          { name: "slow", everyMs: 1000, run: async () => void slow++ },
        ],
        silent,
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(fast).toBe(10);
      expect(slow).toBe(1);
      await w.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fast).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a job still running is not started again", async () => {
    vi.useFakeTimers();
    try {
      let starts = 0;
      let release!: () => void;
      const w = startWorker(
        [{ name: "slow", everyMs: 100, run: () => (starts++, new Promise<void>((r) => (release = r))) }],
        silent,
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(starts).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(100);
      expect(starts).toBe(2);
      await vi.advanceTimersByTimeAsync(0);
      release();
      await w.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  test("stop() waits for a job that is mid-run", async () => {
    vi.useFakeTimers();
    try {
      let finished = false;
      const w = startWorker(
        [{ name: "j", everyMs: 100, run: () => new Promise<void>((r) => setTimeout(() => ((finished = true), r()), 50)) }],
        silent,
      );
      await vi.advanceTimersByTimeAsync(110); // started at 100, finishes at 150
      const stopping = w.stop();
      await vi.advanceTimersByTimeAsync(50);
      await stopping;
      expect(finished).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
