/**
 * The fold: replay every readable session log once and reduce the recorded
 * `assistant/message` usage into the cross-session figures the dashboard
 * renders. Pure — it reads no service and touches no clock except the `now`
 * its caller supplies, so every streak and boundary is testable.
 *
 * @module @deepseek-ai/dsh-token-usage/aggregate
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  TokenUsageBucketRow, TokenUsageDashboard, TokenUsageModelRow, TokenUsageSessionRow, TokenUsageTotals,
} from './types.ts'

/** One session's log, reduced to the fields the fold needs. */
export interface UsageSessionObservation {
  /** Session the log belongs to. */
  sessionId: string
  /** Working directory recorded in the header, empty when absent. */
  cwd: string
  /** Session creation time, used when the log holds no event. */
  createdAt: number
  /** Contiguous raw events from the observed log. */
  events: readonly SessionEvent[]
}

/** Largest number of session rows one dashboard carries. */
export const SESSION_ROW_LIMIT = 50

const MILLISECONDS_PER_DAY = 86_400_000

/** A zeroed totals accumulator. */
export function zeroTotals(): TokenUsageTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    reasoningTokens: 0, totalTokens: 0, calls: 0,
  }
}

/**
 * Add one provider usage report into an accumulator. `totalTokens` is summed
 * from the four billed counters rather than read from the provider total,
 * because adapters omit that field when their own total is untrustworthy.
 * Reasoning tokens are tracked apart: they are already inside `outputTokens`.
 * @param accumulator - running totals mutated in place.
 * @param usage - provider report, absent on calls that recorded none.
 */
export function addUsage(accumulator: TokenUsageTotals, usage: TokenUsage | undefined): void {
  if (usage === undefined) return
  accumulator.inputTokens += usage.inputTokens
  accumulator.outputTokens += usage.outputTokens
  accumulator.cacheReadTokens += usage.cacheReadTokens ?? 0
  accumulator.cacheWriteTokens += usage.cacheWriteTokens ?? 0
  accumulator.reasoningTokens += usage.reasoningTokens ?? 0
  accumulator.totalTokens += usage.inputTokens + usage.outputTokens
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Local calendar day of an instant, as `YYYY-MM-DD`.
 * @param time - epoch milliseconds.
 * @returns the local day key.
 */
export function localDayKey(time: number): string {
  const date = new Date(time)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Local hour bucket of an instant, as `YYYY-MM-DDTHH`.
 * @param time - epoch milliseconds.
 * @returns the local hour key.
 */
export function localHourKey(time: number): string {
  return `${localDayKey(time)}T${pad(new Date(time).getHours())}`
}

/**
 * Split a local `YYYY-MM-DD` key into its numeric parts. Keys originate from
 * {@link localDayKey}, so the split is total; the defaults only keep a
 * hand-typed key from producing `NaN`.
 * @param day - local day key.
 * @returns year, 1-based month, and day-of-month.
 */
function dayParts(day: string): [number, number, number] {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  return [year, month, date]
}

/**
 * Days since the epoch for a local day key. Reading the key back through
 * `Date.UTC` keeps streak arithmetic independent of the runtime's UTC offset:
 * consecutive local days always differ by exactly one.
 * @param day - local `YYYY-MM-DD` key.
 * @returns whole days since 1970-01-01.
 */
export function dayIndex(day: string): number {
  const [year, month, date] = dayParts(day)
  return Math.floor(Date.UTC(year, month - 1, date) / MILLISECONDS_PER_DAY)
}

/**
 * Week bucket of a local day key, as the UTC epoch of that ISO week's Monday.
 * @param day - local `YYYY-MM-DD` key.
 * @returns the Monday epoch in milliseconds.
 */
export function weekStartKey(day: string): string {
  const [year, month, date] = dayParts(day)
  const utc = Date.UTC(year, month - 1, date)
  const weekday = (new Date(utc).getUTCDay() + 6) % 7
  return String(utc - weekday * MILLISECONDS_PER_DAY)
}

function modelRow(key: string, provider: string, model: string): TokenUsageModelRow {
  return { key, provider, model, ...zeroTotals() }
}

function bucketRow(key: string): TokenUsageBucketRow {
  return { key, ...zeroTotals() }
}

/** Consecutive-day runs over the active day keys. */
interface Streaks {
  current: number
  longest: number
  first: number | null
  last: number | null
}

/**
 * Longest and current runs of consecutive active days. The current run
 * survives a day that has not produced a call yet by also accepting yesterday
 * as its end, so a streak does not appear broken every morning.
 * @param activeDays - active local day keys in any order.
 * @param now - epoch milliseconds anchoring "today".
 * @returns the two run lengths and the first/last active day indexes.
 */
export function computeStreaks(activeDays: readonly string[], now: number): Streaks {
  if (activeDays.length === 0) return { current: 0, longest: 0, first: null, last: null }
  const indexes = [...new Set(activeDays.map(dayIndex))].sort((a, b) => a - b)
  let longest = 1
  let run = 1
  let previous = indexes.at(0) ?? 0
  for (const index of indexes.slice(1)) {
    run = index === previous + 1 ? run + 1 : 1
    if (run > longest) longest = run
    previous = index
  }
  const last = indexes.at(-1) ?? 0
  const today = dayIndex(localDayKey(now))
  let current = 0
  if (last === today || last === today - 1) {
    current = 1
    let cursor = last
    for (const index of indexes.slice(0, -1).reverse()) {
      if (cursor !== index + 1) break
      current += 1
      cursor = index
    }
  }
  return { current, longest, first: indexes.at(0) ?? null, last: indexes.at(-1) ?? null }
}

/**
 * Reduce every observed session log into the cross-session usage dashboard.
 * Sessions whose log could not be read contribute nothing but still count
 * toward `sessionCount`, so a partially readable corpus stays visible as such.
 * @param sessions - logs the Host read, in listing order.
 * @param sessionCount - sessions the Host listed, readable or not.
 * @param now - epoch milliseconds anchoring the current streak.
 * @returns the whole-corpus figures the client renders.
 */
export function aggregateUsage(
  sessions: readonly UsageSessionObservation[],
  sessionCount: number,
  now: number,
): TokenUsageDashboard {
  const total = zeroTotals()
  const models = new Map<string, TokenUsageModelRow>()
  const byDay = new Map<string, Map<string, TokenUsageModelRow>>()
  const byHour = new Map<string, Map<string, TokenUsageBucketRow>>()
  const bySession: TokenUsageSessionRow[] = []
  let scanned = 0
  let longestChatMs = 0

  for (const session of sessions) {
    if (session.events.length === 0) continue
    scanned += 1
    const perSession = zeroTotals()
    let firstAt = Number.POSITIVE_INFINITY
    let lastAt = 0

    for (const event of session.events) {
      const time = event.time
      if (time < firstAt) firstAt = time
      if (time > lastAt) lastAt = time
      if (event.type !== 'assistant/message') continue

      perSession.calls += 1
      total.calls += 1
      addUsage(perSession, event.data.usage)
      addUsage(total, event.data.usage)

      const source = event.data.message.source
      if (source.kind !== 'model') continue
      const key = `${source.provider}::${source.model}`

      const route = models.get(key) ?? modelRow(key, source.provider, source.model)
      models.set(key, route)
      route.calls += 1
      addUsage(route, event.data.usage)

      const day = byDay.get(localDayKey(time)) ?? new Map<string, TokenUsageModelRow>()
      byDay.set(localDayKey(time), day)
      const daily = day.get(key) ?? modelRow(key, source.provider, source.model)
      day.set(key, daily)
      daily.calls += 1
      addUsage(daily, event.data.usage)

      const hour = localHourKey(time)
      const hourly = byHour.get(hour) ?? new Map<string, TokenUsageBucketRow>()
      byHour.set(hour, hourly)
      const bucket = hourly.get(key) ?? bucketRow(key)
      hourly.set(key, bucket)
      bucket.calls += 1
      addUsage(bucket, event.data.usage)
    }

    if (firstAt !== Number.POSITIVE_INFINITY && lastAt >= firstAt) {
      longestChatMs = Math.max(longestChatMs, lastAt - firstAt)
    }
    bySession.push({
      sessionId: session.sessionId,
      cwd: session.cwd,
      createdAt: session.createdAt,
      firstAt: firstAt === Number.POSITIVE_INFINITY ? session.createdAt : firstAt,
      lastAt,
      ...perSession,
    })
  }

  const activeDays = [...byDay.keys()].sort()
  const streaks = computeStreaks(activeDays, now)

  const byWeek = new Map<string, Map<string, TokenUsageModelRow>>()
  for (const [day, rows] of byDay) {
    const week = weekStartKey(day)
    const bucket = byWeek.get(week) ?? new Map<string, TokenUsageModelRow>()
    byWeek.set(week, bucket)
    for (const [key, row] of rows) {
      const weekly = bucket.get(key) ?? modelRow(key, row.provider, row.model)
      bucket.set(key, weekly)
      weekly.calls += row.calls
      addUsage(weekly, row)
    }
  }

  bySession.sort((a, b) => b.totalTokens - a.totalTokens)

  return {
    total,
    byModel: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens).map(row => ({ ...row })),
    peakTokens: bySession.at(0)?.totalTokens ?? 0,
    longestChatMs,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    firstDay: streaks.first,
    lastDay: streaks.last,
    activeDays,
    byDay: Object.fromEntries([...byDay].map(([day, rows]) => [day, [...rows.values()].map(row => ({ ...row }))])),
    byWeek: Object.fromEntries([...byWeek].map(([week, rows]) => [week, [...rows.values()].map(row => ({ ...row }))])),
    byHour: Object.fromEntries([...byHour].map(([hour, rows]) => [hour, [...rows.values()].map(row => ({ ...row }))])),
    bySession: bySession.slice(0, SESSION_ROW_LIMIT).map(row => ({ ...row })),
    scanned,
    sessionCount,
  }
}
