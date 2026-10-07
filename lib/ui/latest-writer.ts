// Saves a settings object so that the LAST value asked for is the one stored,
// whatever order the network answers in: at most one request is in flight;
// clicks made meanwhile collapse into one pending value (the newest), sent
// when the current request ends. Only the newest write reports "saved" or
// "failed"; older ones report "superseded". On failure the caller gets the
// last value the server confirmed, to show it again.
export type WriteOutcome<T> =
  | { status: "saved"; value: T }
  | { status: "superseded" }
  | { status: "failed"; error: Error; confirmed: T };

export function createLatestWriter<In, T>(send: (value: In) => Promise<T>, initial: T) {
  let confirmed = initial;
  let running = false;
  let queued: { value: In; resolve: (o: WriteOutcome<T>) => void } | null = null;

  async function drain() {
    running = true;
    while (queued) {
      const job = queued; queued = null;
      try {
        confirmed = await send(job.value);
        job.resolve(queued ? { status: "superseded" } : { status: "saved", value: confirmed });
      } catch (e) {
        job.resolve(queued ? { status: "superseded" } : { status: "failed", error: e instanceof Error ? e : new Error(String(e)), confirmed });
      }
    }
    running = false;
  }

  return {
    write(value: In): Promise<WriteOutcome<T>> {
      return new Promise(resolve => {
        queued?.resolve({ status: "superseded" });
        queued = { value, resolve };
        if (!running) void drain();
      });
    },
    confirmed: () => confirmed,
  };
}
