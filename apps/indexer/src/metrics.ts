/**
 * Lightweight, dependency-free metrics registry for the indexer.
 *
 * The indexer is a money-path service: it ingests oracle submissions and
 * resolves markets. We expose counters/gauges as Prometheus text so ops can
 * alert on the E2E oracle-submit -> indexed-resolution path without leaking
 * secrets (labels are restricted to stable, non-sensitive identifiers).
 */

export type MetricKind = "counter" | "gauge";

interface MetricSample {
  kind: MetricKind;
  help: string;
  values: Map<string, number>;
}

/**
 * Stable error codes surfaced by the indexer entrypoints. Kept in sync with
 * the oracle submit path so failures are observable and actionable.
 */
export const INDEXER_ERROR_CODES = {
  UNAUTHORIZED: "INDEXER_UNAUTHORIZED",
  INVALID_PAYLOAD: "INDEXER_INVALID_PAYLOAD",
  DUPLICATE_SUBMISSION: "INDEXER_DUPLICATE_SUBMISSION",
  DEPENDENCY_UNAVAILABLE: "INDEXER_DEPENDENCY_UNAVAILABLE",
  INTERNAL: "INDEXER_INTERNAL",
} as const;

export type IndexerErrorCode =
  (typeof INDEXER_ERROR_CODES)[keyof typeof INDEXER_ERROR_CODES];

const registry = new Map<string, MetricSample>();

function getOrCreate(name: string, kind: MetricKind, help: string): MetricSample {
  const existing = registry.get(name);
  if (existing) return existing;
  const sample: MetricSample = { kind, help, values: new Map() };
  registry.set(name, sample);
  return sample;
}

function labelKey(labels?: Record<string, string>): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}="${labels[k]}"`).join(",");
}

/** Increment a counter by `value` (default 1). */
export function incrementCounter(
  name: string,
  labels?: Record<string, string>,
  value = 1,
  help = "",
): void {
  const sample = getOrCreate(name, "counter", help);
  const key = labelKey(labels);
  sample.values.set(key, (sample.values.get(key) ?? 0) + value);
}

/** Set a gauge to an absolute value. */
export function setGauge(
  name: string,
  value: number,
  labels?: Record<string, string>,
  help = "",
): void {
  const sample = getOrCreate(name, "gauge", help);
  sample.values.set(labelKey(labels), value);
}

/**
 * Record an oracle submission outcome on the E2E path. `outcome` is a stable
 * enum-like string (accepted|duplicate|rejected|error) and `code` is an
 * optional stable error code from INDEXER_ERROR_CODES.
 */
export function recordOracleSubmission(
  outcome: "accepted" | "duplicate" | "rejected" | "error",
  code?: IndexerErrorCode,
): void {
  incrementCounter(
    "vatix_indexer_oracle_submissions_total",
    code ? { outcome, code } : { outcome },
    1,
    "Total oracle submissions processed by the indexer, by outcome.",
  );
}

/**
 * Record a market resolution observed on the indexed path. `status` is a
 * stable string (resolved|pending|failed).
 */
export function recordMarketResolution(status: "resolved" | "pending" | "failed"): void {
  incrementCounter(
    "vatix_indexer_market_resolutions_total",
    { status },
    1,
    "Total market resolutions indexed, by status.",
  );
}

/** Render the registry in Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, sample] of registry) {
    if (sample.help) lines.push(`# HELP ${name} ${sample.help}`);
    lines.push(`# TYPE ${name} ${sample.kind}`);
    if (sample.values.size === 0) {
      lines.push(`${name} 0`);
      continue;
    }
    for (const [labels, value] of sample.values) {
      lines.push(labels ? `${name}{${labels}} ${value}` : `${name} ${value}`);
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

/** Test/ops helper: reset all metrics. */
export function resetMetrics(): void {
  registry.clear();
}
