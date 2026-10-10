/** Deterministic keyless adapter proving one teammate can run on its own LLM route. */

import { ToolCallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

const ROUTE_PROVIDER = 'deepseek-official'
const ROUTE_MODEL = 'team-route-model'
const PRESET_MODEL = 'team-preset-model'

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
    const id = ToolCallId(`route-fixture-${++nextCall}`)
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
 * Lead: delegate two units of work — one on a route named in the call, one on
 * the route configured for its name — then confirm both teammates finished.
 */
function lead(messages) {
  const names = calls(messages)
  const last = latestAssistantCalls(messages)
  if (!names.includes('spawn_teammate')) {
    return toolChunks([
      {
        name: 'spawn_teammate',
        args: {
          name: 'explicit-owner',
          description: 'Own the explicitly routed work.',
          prompt: 'ROUTE_EXPLICIT_MARK: report your own completion and finish.',
          context: 'fresh',
          provider: ROUTE_PROVIDER,
          model: ROUTE_MODEL,
        },
      },
      {
        name: 'spawn_teammate',
        args: {
          name: 'preset-owner',
          description: 'Own the configured work.',
          prompt: 'ROUTE_PRESET_MARK: report your own completion and finish.',
          context: 'fresh',
        },
      },
    ])
  }
  if (!names.includes('list_agents')) {
    // Each teammate already asserted its own route in `stream`; a spawn receipt
    // reports a model only while that member is loaded, so it is not asserted here.
    return toolChunks([{ name: 'list_agents', args: {} }])
  }
  if (last.includes('list_agents')) {
    // A finished teammate is released, so only its status remains observable here;
    // the receipts above and the durable descriptors carry the routes.
    const inactive = (latestToolText(messages).match(/"status":"inactive"/gu) ?? []).length
    if (inactive >= 2) return textChunks('TEAM_ROUTE_OK')
    return toolChunks([{ name: 'wait_agent', args: { timeout_ms: 10000 } }])
  }
  return toolChunks([{ name: 'list_agents', args: {} }])
}

class TeamRouteAdapter extends LlmAdapter {
  async * stream(options) {
    const initial = options.messages.findLast(message => message.role === 'user' && message.source.kind === 'user')
    const identity = initial?.content[0]?.text?.trimEnd() ?? ''
    const teammateRoute = identity.includes('"explicit-owner"')
      ? ROUTE_MODEL
      : identity.includes('"preset-owner"')
        ? PRESET_MODEL
        : undefined
    if (teammateRoute !== undefined && options.model !== teammateRoute) {
      throw new Error(`teammate ran on "${options.model}" instead of "${teammateRoute}"`)
    }
    if (teammateRoute === undefined && (options.model === ROUTE_MODEL || options.model === PRESET_MODEL)) {
      throw new Error('the Lead request was routed onto a teammate route')
    }
    const chunks = teammateRoute === undefined ? lead(options.messages) : textChunks('Route teammate complete.')
    for (const chunk of chunks) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

/** Cordis plugin name. */
export const name = 'team-route-fixture-llm'
/** LLM registry dependency. */
export const inject = ['llm']

/** Register the keyless adapter on the shipped default provider route. */
export function apply(ctx) {
  ctx.llm.registerAdapter([ROUTE_PROVIDER], new TeamRouteAdapter())
}
