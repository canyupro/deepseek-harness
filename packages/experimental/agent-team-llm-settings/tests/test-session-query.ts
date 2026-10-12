/**
 * Session query whose corpus is whatever the owning test scripted.
 *
 * The settings service reads only `listSessions`, so the scripted records are
 * the whole contract under test; the search faces are outside these tests and
 * reject rather than answer.
 */

import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

/** The records `listSessions` answers with; replaceable between assertions. */
let records: readonly SessionRecord[] = []

/**
 * Replace the corpus the next `listSessions` call answers with.
 * @param next - Records the query reports as the complete logical corpus.
 */
export function setSessionRecords(next: readonly SessionRecord[]): void {
  records = next
}

/**
 * One top-level Session record the settings service may offer as a workspace.
 * @param id - Session identity.
 * @param options - Header fields the candidate rules read.
 * @returns A corpus record carrying that header.
 */
export function topLevelSession(
  id: string,
  options: { cwd?: string; createdAt?: number } = {},
): SessionRecord {
  return sessionRecord(id, options)
}

/**
 * One teammate child Session record, which a workspace candidate never is.
 * @param id - Session identity.
 * @param parent - The Session it was forked from.
 * @param options - Header fields the candidate rules read.
 * @returns A corpus record carrying that header.
 */
export function childSession(
  id: string,
  parent: string,
  options: { cwd?: string; createdAt?: number } = {},
): SessionRecord {
  return sessionRecord(id, options, parent)
}

/** Shared header construction for the two scripted record kinds. */
function sessionRecord(
  id: string,
  options: { cwd?: string; createdAt?: number },
  parentSession?: string,
): SessionRecord {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: options.createdAt ?? 0,
    isSeeded: false,
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...parentSession === undefined ? {} : { parentSession: SessionId(parentSession) },
  }
  return { header, live: true, persisted: false }
}

/** Session query whose corpus is scripted and whose search faces are out of scope. */
export class TestSessionQuery extends SessionQueryEngine {
  override listSessions(): Promise<SessionRecord[]> {
    return Promise.resolve([...records])
  }

  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}
