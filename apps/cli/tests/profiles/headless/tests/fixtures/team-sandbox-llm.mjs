/** Deterministic keyless adapter proving a roster member's sandbox scope reaches only that member. */

import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

const ROUTE_PROVIDER = 'deepseek-official'
const ROUTE_MODEL = 'team-sandbox-model'

let nextCall = 0

function calls(messages) {
  return messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'tool-call').map(block => block.name)
    : [])
}

function latestAssistantCalls(messages) {
  const assistant = messages.findLast(message => message.role === 'assistant')
  return assistant?.content.filter(block => block.type === 'tool-call').map(block => block.name) ?? []
}

function latestToolText(messages) {
  const message = messages.findLast(candidate => candidate.role === 'tool')
  if (message === undefined) return ''
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function toolChunks(specs) {
  const chunks = []
  for (const [index, spec] of specs.entries()) {
    const id = ToolCallId(`sandbox-fixture-${++nextCall}`)
    const args = JSON.stringify(spec.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name: spec.name, argumentsDelta: args },
      { type: 'block-end', index, block: { type: 'tool-call', id, name: spec.name, arguments: args } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Lead: create the whole configured roster, then confirm both members finished.
 * The roster is what carries a member's declared sandbox scope, so the fixture
 * deliberately goes through `spawn_team` rather than `spawn_teammate`.
 */
function lead(messages) {
  const names = calls(messages)
  const last = latestAssistantCalls(messages)
  if (!names.includes('spawn_team')) {
    return toolChunks([{ name: 'spawn_team', args: {} }])
  }
  if (!names.includes('list_agents')) {
    return toolChunks([{ name: 'list_agents', args: {} }])
  }
  if (last.includes('list_agents')) {
    const inactive = (latestToolText(messages).match(/"status":"inactive"/gu) ?? []).length
    if (inactive >= 2) return textChunks('TEAM_SANDBOX_OK')
    return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
  }
  return toolChunks([{ name: 'list_agents', args: {} }])
}

class TeamSandboxAdapter extends LlmAdapter {
  async * stream(options) {
    const initial = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const identity = initial?.content[0]?.text?.trimEnd() ?? ''
    // A roster member is identifiable by the reminder naming it; each just
    // finishes, so the durable policy events its spawn wrote are the evidence.
    // Only the members are pinned: the Lead keeps whatever the profile default is.
    const isTeammate = identity.startsWith('<system-reminder>')
    if (isTeammate && options.model !== ROUTE_MODEL) {
      throw new Error(`teammate ran on "${options.model}" instead of "${ROUTE_MODEL}"`)
    }
    const chunks = isTeammate ? textChunks('Roster teammate complete.') : lead(options.messages)
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'team-sandbox-fixture-llm'
/** LLM registry dependency. */
export const inject = ['llm']

/** Register the keyless adapter on the shipped default provider route. */
export function apply(ctx) {
  ctx.llm.registerAdapter([ROUTE_PROVIDER], new TeamSandboxAdapter())
}