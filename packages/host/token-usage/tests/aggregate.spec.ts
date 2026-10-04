import { describe, expect, it } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import {
  aggregateUsage, computeStreaks, dayIndex, localDayKey, SESSION_ROW_LIMIT, weekStartKey, zeroTotals,
  type UsageSessionObservation,
} from '../src/aggregate.ts'

let seq = 0

/** A local-time instant, so assertions do not depend on the runner's offset. */
function local(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime()
}

function call(time: number, options: {
  provider?: string
  model?: string
  usage?: TokenUsage
} = {}): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(seq += 1),
    time,
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'reply' }],
        source: { kind: 'model', provider: options.provider ?? 'deepseek', model: options.model ?? 'v4' },
      }),
      ...options.usage === undefined ? {} : { usage: options.usage },
    },
  }
}

function session(id: string, events: SessionEvent[], cwd = ''): UsageSessionObservation {
  return { sessionId: id, cwd, createdAt: events.at(0)?.time ?? 0, events }
}

const FULL: TokenUsage = {
  inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3,
}

describe('token-usage day keys', () => {
  it('buckets an instant by its local day and hour', () => {
    expect(localDayKey(local(2026, 3, 9, 14))).toBe('2026-03-09')
    expect(localDayKey(local(2026, 3, 9, 0))).toBe('2026-03-09')
  })

  it('numbers consecutive local days by exactly one', () => {
    expect(dayIndex('2026-03-10') - dayIndex('2026-03-09')).toBe(1)
  })

  it('puts a day in the ISO week that starts on its Monday', () => {
    const monday = weekStartKey('2026-03-09')
    expect(weekStartKey('2026-03-15')).toBe(monday)
    expect(weekStartKey('2026-03-16')).not.toBe(monday)
  })
})

describe('token-usage streaks', () => {
  const now = local(2026, 3, 10, 9)

  it('reports nothing for an empty corpus', () => {
    expect(computeStreaks([], now)).toEqual({ current: 0, longest: 0, first: null, last: null })
  })

  it('counts a run ending today and the longest run ever', () => {
    const streaks = computeStreaks(
      ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-08', '2026-03-09', '2026-03-10'],
      now,
    )
    expect(streaks.current).toBe(3)
    expect(streaks.longest).toBe(3)
    expect(streaks.first).toBe(dayIndex('2026-03-01'))
    expect(streaks.last).toBe(dayIndex('2026-03-10'))
  })

  it('keeps a streak alive when only yesterday was active', () => {
    expect(computeStreaks(['2026-03-08', '2026-03-09'], now).current).toBe(2)
  })

  it('reports no current streak once two days have passed', () => {
    expect(computeStreaks(['2026-03-07', '2026-03-08'], now).current).toBe(0)
  })
})

describe('token-usage aggregation', () => {
  const now = local(2026, 3, 10, 9)

  it('folds every route, day, week, and hour', () => {
    const dashboard = aggregateUsage([
      session('a', [
        call(local(2026, 3, 9, 10), { usage: FULL }),
        call(local(2026, 3, 9, 15), { model: 'v4-pro', usage: { inputTokens: 5, outputTokens: 1 } }),
      ], '/repo/one'),
      session('b', [call(local(2026, 3, 10, 9), { usage: { inputTokens: 1, outputTokens: 1 } })], '/repo/two'),
    ], 2, now)

    expect(dashboard.total).toEqual({
      inputTokens: 16, outputTokens: 6, cacheReadTokens: 2, cacheWriteTokens: 1,
      reasoningTokens: 3, totalTokens: 25, calls: 3,
    })
    expect(dashboard.scanned).toBe(2)
    expect(dashboard.sessionCount).toBe(2)
    expect(dashboard.byModel.map(row => [row.key, row.totalTokens])).toEqual([
      ['deepseek::v4', 19], ['deepseek::v4-pro', 6],
    ])
    expect(dashboard.byDay['2026-03-09']?.map(row => row.model)).toEqual(['v4', 'v4-pro'])
    expect(Object.keys(dashboard.byHour)).toEqual(['2026-03-09T10', '2026-03-09T15', '2026-03-10T09'])
    expect(Object.keys(dashboard.byWeek)).toHaveLength(1)
    expect(dashboard.activeDays).toEqual(['2026-03-09', '2026-03-10'])
    expect(dashboard.peakTokens).toBe(23)
  })

  it('reports each session window and working directory', () => {
    const start = local(2026, 3, 9, 8)
    const dashboard = aggregateUsage([
      session('a', [call(start, { usage: FULL }), call(start + 3_600_000, { usage: FULL })], '/repo'),
    ], 1, now)

    expect(dashboard.bySession).toHaveLength(1)
    expect(dashboard.bySession[0]).toMatchObject({
      sessionId: 'a', cwd: '/repo', firstAt: start, lastAt: start + 3_600_000, calls: 2,
    })
    expect(dashboard.longestChatMs).toBe(3_600_000)
  })

  it('tolerates calls that recorded no usage', () => {
    const dashboard = aggregateUsage([session('a', [call(now)])], 1, now)
    expect(dashboard.total).toEqual({ ...zeroTotals(), calls: 1 })
    expect(dashboard.scanned).toBe(1)
  })

  it('skips empty logs but still counts them as listed', () => {
    const dashboard = aggregateUsage([session('a', [])], 7, now)
    expect(dashboard.scanned).toBe(0)
    expect(dashboard.sessionCount).toBe(7)
    expect(dashboard.peakTokens).toBe(0)
  })

  it('caps the session rows at the row limit, heaviest first', () => {
    const sessions = Array.from({ length: SESSION_ROW_LIMIT + 5 }, (_, index) =>
      session(`s${index}`, [call(now, { usage: { inputTokens: index + 1, outputTokens: 0 } })]))
    const dashboard = aggregateUsage(sessions, sessions.length, now)

    expect(dashboard.bySession).toHaveLength(SESSION_ROW_LIMIT)
    expect(dashboard.bySession[0]?.sessionId).toBe(`s${SESSION_ROW_LIMIT + 4}`)
    expect(dashboard.peakTokens).toBe(SESSION_ROW_LIMIT + 5)
  })

  it('adds the four billed counters and never trusts a provider total', () => {
    const dashboard = aggregateUsage([
      session('a', [call(now, { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 999 } })]),
    ], 1, now)
    expect(dashboard.total.totalTokens).toBe(3)
  })

  it('returns an empty dashboard for an empty corpus', () => {
    const dashboard = aggregateUsage([], 0, now)
    expect(dashboard.total).toEqual(zeroTotals())
    expect(dashboard.byModel).toEqual([])
    expect(dashboard.firstDay).toBeNull()
    expect(dashboard.lastDay).toBeNull()
  })
})
