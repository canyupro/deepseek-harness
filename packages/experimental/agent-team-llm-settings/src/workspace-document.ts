/** Location and durable storage of `<projectRoot>/.dsh/team.json`. */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { TeamDocumentError } from './document.ts'
import type { TeamDocument } from './types.ts'

/** Directory under the project root that holds Harness-owned project files. */
export const TEAM_DOCUMENT_DIRECTORY = '.dsh'

/** File name of the workspace Agent Teams document. */
export const TEAM_DOCUMENT_FILE = 'team.json'

/** Ownership bits stamped on the document; it carries member prompts. */
const DOCUMENT_MODE = 0o600

/**
 * Walk upward from one directory to the nearest ancestor holding a `.git`
 * entry, matching the project-root rule instruction discovery uses. A `.git`
 * file counts, so a linked worktree keeps its own root.
 * @param root - directory the walk starts from.
 * @returns the nearest marked ancestor, or undefined when no ancestor has one.
 */
export function findProjectRoot(root: string): string | undefined {
  let current = resolve(root)
  for (;;) {
    if (statSync(join(current, '.git'), { throwIfNoEntry: false }) !== undefined) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/**
 * Absolute path of the workspace document for one project root.
 * @param projectRoot - directory that owns the `.dsh` directory.
 * @returns the document path, always under that root.
 */
export function teamDocumentPath(projectRoot: string): string {
  return join(projectRoot, TEAM_DOCUMENT_DIRECTORY, TEAM_DOCUMENT_FILE)
}

/**
 * Read and JSON-decode one document without validating its fields.
 * @param path - absolute document path.
 * @returns the decoded JSON, or undefined when no document exists there.
 * @throws TeamDocumentError when the file exists but is not JSON.
 */
export function readDocumentFile(path: string): unknown {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new TeamDocumentError(`${path} is not JSON: ${(error as Error).message}`)
  }
}

/**
 * Replace one document atomically: a reader sees the old or the new complete
 * content, never a partial write.
 * @param path - absolute document path.
 * @param document - validated document to serialize.
 */
export async function writeDocumentFile(path: string, document: TeamDocument): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`, { mode: DOCUMENT_MODE })
}
