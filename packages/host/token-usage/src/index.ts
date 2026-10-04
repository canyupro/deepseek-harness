/**
 * Cross-session token usage: one Remote that folds every readable session log
 * into the figures a dashboard renders. The Host owns the fold because only it
 * can read the durable logs; the client owns only presentation.
 *
 * Figures are cached per process. A caller that needs current numbers passes
 * `force`, which re-reads every log; concurrent force requests share one read
 * so a page full of panels cannot multiply the work.
 *
 * @module @deepseek-ai/dsh-token-usage
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-session-query'
import { aggregateUsage, type UsageSessionObservation } from './aggregate.ts'
import type { TokenUsageDashboard, TokenUsageQuery, TokenUsageResponse } from './types.ts'

export type * from './types.ts'
export { aggregateUsage, SESSION_ROW_LIMIT } from './aggregate.ts'
export type { UsageSessionObservation } from './aggregate.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host service owning the cross-session token usage fold. */
    tokenUsageController: TokenUsageController
  }
}

/**
 * Host service backing the generated `ctx.remote.tokenUsage` namespace.
 * Without `sessionQuery` the fiber stays pending, so a mounted controller
 * always has a corpus to read and never answers "unavailable".
 */
export class TokenUsageController extends TypertRemoteService {
  static inject = ['sessionQuery']

  private cached: { dashboard: TokenUsageDashboard; cachedAt: number } | null = null
  private reading: Promise<TokenUsageResponse> | null = null

  /** @param ctx - Host context carrying the session query engine. */
  constructor(ctx: Context) {
    super(ctx, 'tokenUsageController', { namespace: 'tokenUsage' })
  }

  /**
   * Read the whole-corpus usage dashboard, from cache unless forced.
   * @param request - whether to bypass the per-process cache.
   * @returns the figures plus when they were computed and whether they were cached.
   */
  @Remote('query')
  async query(request: TokenUsageQuery): Promise<TokenUsageResponse> {
    if (request.force !== true) {
      const cached = this.cached
      if (cached !== null) {
        return { ...cached.dashboard, cachedAt: cached.cachedAt, cached: true }
      }
      const started = this.reading
      if (started !== null) return started
    }
    const reading = this.read()
    this.reading = reading
    try {
      return await reading
    } finally {
      if (this.reading === reading) this.reading = null
    }
  }

  private async read(): Promise<TokenUsageResponse> {
    const signal = this.ctx.invocation?.signal
    const records = await this.ctx.sessionQuery.listSessions(signal)
    const sessions: UsageSessionObservation[] = []
    for (const record of records) {
      // A log the backend cannot replay contributes nothing; `sessionCount`
      // still reports it so a partially readable corpus stays visible.
      const log = await this.ctx.sessionQuery.readSession(record.header.id).catch(() => undefined)
      if (log === undefined) continue
      sessions.push({
        sessionId: String(record.header.id),
        cwd: log.session.cwd ?? '',
        createdAt: log.session.createdAt,
        events: log.events,
      })
    }
    const dashboard = aggregateUsage(sessions, records.length, Date.now())
    this.cached = { dashboard, cachedAt: Date.now() }
    return { ...dashboard, cachedAt: this.cached.cachedAt, cached: false }
  }
}

export default TokenUsageController
