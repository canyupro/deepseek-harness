/**
 * The sidebar's Workspace projection as a spec drives it: the
 * `ctx.workspaces.list` source the card's picker lists, plus the add / remove
 * / reorder operations the sidebar itself performs on the same rows.
 */

import type {
  WorkspaceId, WorkspaceListPhase, WorkspaceSnapshot, WorkspaceSource, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Brand one Workspace identity the way the sidebar publishes it.
 * @param id - opaque identity the projections agree on.
 * @returns the branded identity.
 */
export function workspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/**
 * One Workspace row the sidebar lists.
 * @param id - Workspace identity.
 * @param title - title the sidebar shows.
 * @param path - canonical directory path.
 * @param sessionIds - Sessions accounted to the Workspace, in sidebar order.
 * @returns the projected row.
 */
export function workspaceRow(
  id: string,
  title: string,
  path: string,
  sessionIds: readonly SessionId[] = [],
): WorkspaceView {
  return {
    workspaceId: workspaceId(id),
    title,
    path,
    sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** The Workspace source a spec edits the way the sidebar edits its rows. */
export interface ScriptedWorkspaces extends WorkspaceSource {
  /**
   * Replace the listed rows and phase, as adding, removing, or reordering a
   * Workspace in the sidebar does.
   * @param rows - rows the sidebar now lists.
   * @param phase - list arrival phase; 'pending' is a sidebar that has not answered yet.
   */
  set(rows: readonly WorkspaceView[], phase?: WorkspaceListPhase): void
  /** Publish the current rows to every subscriber, as the sidebar does after a change. */
  notify(): void
}

/**
 * @param rows - Workspaces the sidebar lists, in its order.
 * @param phase - list arrival phase; 'pending' is a client that has not answered.
 * @returns a source reading those rows, over the sidebar's own edit operations.
 */
export function workspaceSource(
  rows: readonly WorkspaceView[] = [],
  phase: WorkspaceListPhase = 'ready',
): ScriptedWorkspaces {
  let items = rows
  let listPhase = phase
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): WorkspaceSnapshot => ({
      items,
      archivedSessionIds: [],
      pinnedSessionIds: [],
      state: 'idle',
      phase: listPhase,
      error: null,
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next, nextPhase = listPhase) => {
      items = next
      listPhase = nextPhase
    },
    notify: () => { for (const listener of [...listeners]) listener() },
  }
}
