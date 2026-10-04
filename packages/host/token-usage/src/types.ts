/**
 * Cross-session token usage figures: the request a client sends, the
 * aggregation the Host returns, and the row types the dashboard renders.
 *
 * Every timestamp is a millisecond epoch in the Host's local zone, and every
 * `YYYY-MM-DD` key is a local calendar day. Streak and week arithmetic treat a
 * local day key as a UTC day index so the results do not shift with the
 * runtime's offset.
 *
 * @module @deepseek-ai/dsh-token-usage/types
 */

/** Additive token counts for one bucket, session, or the whole corpus. */
export interface TokenUsageTotals {
  /** Prompt tokens reported by the provider. */
  inputTokens: number
  /** Completion tokens reported by the provider. */
  outputTokens: number
  /** Prompt tokens served from the provider's cache. */
  cacheReadTokens: number
  /** Prompt tokens written to the provider's cache. */
  cacheWriteTokens: number
  /** Reasoning tokens inside the completion count. */
  reasoningTokens: number
  /** Sum of the four billed token counters, absent a trustworthy provider total. */
  totalTokens: number
  /** Model calls contributing to this bucket. */
  calls: number
}

/** One provider/model route's totals. */
export interface TokenUsageModelRow extends TokenUsageTotals {
  /** `provider::model` identity, stable across days. */
  key: string
  /** Provider that served the route. */
  provider: string
  /** Model identifier within the provider. */
  model: string
}

/** One route's totals inside an hour bucket, which carries no route metadata. */
export interface TokenUsageBucketRow extends TokenUsageTotals {
  /** `provider::model` identity, stable across hours. */
  key: string
}

/** One session's totals and activity window. */
export interface TokenUsageSessionRow extends TokenUsageTotals {
  /** Session the row aggregates. */
  sessionId: string
  /** Working directory the session ran in, empty when the header omits it. */
  cwd: string
  /** Session creation time. */
  createdAt: number
  /** First event time in the observed log. */
  firstAt: number
  /** Last event time in the observed log, or 0 for an empty log. */
  lastAt: number
}

/** Whole-corpus usage across every session the Host can read. */
export interface TokenUsageDashboard {
  /** Totals over every scanned session. */
  total: TokenUsageTotals
  /** Per-route totals, highest total first. */
  byModel: TokenUsageModelRow[]
  /** Largest single-session total, or 0 when no session has events. */
  peakTokens: number
  /** Longest wall time between a session's first and last event. */
  longestChatMs: number
  /** Consecutive active days ending today or yesterday, or 0 when neither is active. */
  currentStreak: number
  /** Longest run of consecutive active days ever recorded. */
  longestStreak: number
  /** UTC day index of the first active day, or null when nothing is active. */
  firstDay: number | null
  /** UTC day index of the last active day, or null when nothing is active. */
  lastDay: number | null
  /** Active local day keys, ascending. */
  activeDays: string[]
  /** Per-day per-route rows, keyed by local `YYYY-MM-DD`. */
  byDay: Record<string, TokenUsageModelRow[]>
  /** Per-week per-route rows, keyed by the UTC epoch of that week's Monday. */
  byWeek: Record<string, TokenUsageModelRow[]>
  /** Per-hour per-route rows, keyed by local `YYYY-MM-DDTHH`. */
  byHour: Record<string, TokenUsageBucketRow[]>
  /** Heaviest sessions, highest total first. */
  bySession: TokenUsageSessionRow[]
  /** Sessions whose log was read and held at least one event. */
  scanned: number
  /** Sessions the Host listed, including any whose log could not be read. */
  sessionCount: number
}

/** Client request for the usage dashboard. */
export interface TokenUsageQuery {
  /** Bypass the in-process cache and re-read every session log. */
  force?: boolean
}

/** Dashboard plus the cache facts a client shows next to its figures. */
export interface TokenUsageResponse extends TokenUsageDashboard {
  /** When the aggregation behind these figures was computed. */
  cachedAt: number
  /** Whether these figures came from the in-process cache. */
  cached: boolean
}
