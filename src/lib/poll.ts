/**
 * Repeating background refresh that respects the tab: it pauses while the tab
 * is hidden and catches up as soon as it is shown again.
 */

type Job = {
  run: () => Promise<unknown> | unknown;
  /** Milliseconds between runs; a function lets the pace follow the market. */
  every: number | (() => number);
  last: number;
  busy: boolean;
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
};

const jobs = new Set<Job>();
const ALIGN_MS = 5_000;

function schedule(job: Job): void {
  if (job.stopped) return;
  clearTimeout(job.timer);
  if (document.hidden) return;
  const every = typeof job.every === 'function' ? job.every() : job.every;
  let due = job.last + every;
  // Refreshes that fall due within a few seconds of each other run together (on a shared 5 s grid), so the
  // browser sends them as one /api/batch request. Rounding to the nearest slot keeps the average pace the same.
  if (every >= 20_000 && job.last > 0) due = Math.round(due / ALIGN_MS) * ALIGN_MS;
  const wait = Math.max(0, due - Date.now());
  job.timer = setTimeout(() => void tick(job), wait);
}

async function tick(job: Job): Promise<void> {
  if (job.stopped || job.busy) return;
  if (document.hidden) return;
  job.busy = true;
  try {
    await job.run();
  } catch (e) {
    console.warn('refresh failed', e);
  } finally {
    job.busy = false;
    job.last = Date.now();
    schedule(job);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      for (const job of jobs) clearTimeout(job.timer);
    } else {
      for (const job of jobs) schedule(job);
    }
  });
}

export type Poller = { stop(): void; now(): Promise<void> };

/** Start a job. It runs straight away unless `delay` is given. */
export function poll(run: Job['run'], every: Job['every'], delay = 0): Poller {
  const job: Job = { run, every, last: 0, busy: false, stopped: false };
  jobs.add(job);
  if (delay > 0) {
    const e = typeof every === 'function' ? every() : every;
    job.last = Date.now() - e + delay;
  }
  schedule(job);
  return {
    stop() {
      job.stopped = true;
      clearTimeout(job.timer);
      jobs.delete(job);
    },
    async now() {
      clearTimeout(job.timer);
      await tick(job);
    },
  };
}
