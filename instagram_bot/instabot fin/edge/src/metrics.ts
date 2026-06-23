const counters: Record<string, number> = {};
const latencies: Record<string, { count: number; totalMs: number; lastMs: number }> = {};
const timestamps: Record<string, string> = {};

export const metrics = {
  inc(name: string, by = 1) {
    counters[name] = (counters[name] ?? 0) + by;
  },

  observeLatency(name: string, ms: number) {
    const l = (latencies[name] ??= { count: 0, totalMs: 0, lastMs: 0 });
    l.count += 1;
    l.totalMs += ms;
    l.lastMs = ms;
  },

  markTimestamp(name: string) {
    timestamps[name] = new Date().toISOString();
  },

  snapshot() {
    return {
      uptimeSec: Math.round(process.uptime()),
      counters,
      latencies: Object.fromEntries(
        Object.entries(latencies).map(([k, v]) => [
          k,
          {
            count: v.count,
            avgMs: Math.round(v.totalMs / v.count),
            lastMs: Math.round(v.lastMs),
          },
        ]),
      ),
      timestamps,
    };
  },
};
