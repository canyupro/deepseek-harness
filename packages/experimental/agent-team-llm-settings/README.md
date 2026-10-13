---
description: "Team-owned child LLM routes for Agent Teams teammates: two settings layers, a fixed roster, and per-name presets."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-agent-team-llm-settings

English | [中文](README.zh.md)

## Summary

`agent-team-llm-settings` owns which LLM routes Agent Teams teammates may run on and which teammates a Lead may create. Settings arrive from two layers: a deployment base under a user settings document, reached through `current()`, and `<projectRoot>/.dsh/team.json`, found by walking up from the session working directory to the nearest ancestor holding `.git`. `resolveFor(workspaceRoot)` overlays them field by field — a declared field wins and the rest inherit — while `members` merges by name. An enabled result must be self-consistent, and every route is validated against the live LLM adapter before any teammate exists.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known limitations and deferred work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service next to `@deepseek-ai/dsh-experimental-agent-team` and `@deepseek-ai/dsh-experimental-tool-agent-team`. It reads `ctx.get('workspaceRegistry')` whenever a workspace document is read or written, so a composition that mounts no Workspace registry keeps the service loadable and refuses only those two calls. `@deepseek-ai/dsh-experimental-agent-team-profile` already mounts it.

```yaml
- id: agent-team-llm-settings
  name: '@deepseek-ai/dsh-experimental-agent-team-llm-settings'
  config:
    enabled: true
    maxMembers: 8
    allowedRoutes:
      - provider: deepseek-official
        model: deepseek-v4-flash
      - provider: commandcode
        model: deepseek/deepseek-v4.1-flash
    defaultProvider: deepseek-official
    defaultModel: deepseek-v4-flash
    roleRoutes:
      - name: recon
        provider: deepseek-official
        model: deepseek-v4-flash
    members:
      - name: recon
        description: Maps the tree before anything changes.
        prompt: Start by reading the repository layout.
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Whether configured routes apply |
| `allowedRoutes` | `[]` | Exact routes a teammate may be routed to |
| `defaultProvider` | `''` | Provider of the route used when neither the name nor the caller names one |
| `defaultModel` | `''` | Model of the route used when neither the name nor the caller names one |
| `roleRoutes` | `[]` | Per-teammate-name preset routes |
| `members` | `[]` | Fixed roster inherited by a workspace that declares no `members` |
| `maxMembers` | `8` | Inclusive cap on roster entries in either layer |

`enabled`, `allowedRoutes`, `roleRoutes`, and `members` are user-owned settings; an edit through the settings document overrides the deployment base.

`spawn_teammate` resolves one teammate's route in this order:

1. `provider`, `model`, and `reasoning_effort` supplied in the call
2. the `roleRoutes` preset whose `name` equals the teammate name
3. the configured default route, when both `defaultProvider` and `defaultModel` are set
4. the Lead's route, when the settings are disabled or name no route

A route supplied in the call must be one of `allowedRoutes` while the settings are enabled.

### The workspace document

A project pins its own team by committing `<projectRoot>/.dsh/team.json`:

```json
{
  "version": 1,
  "members": [
    { "name": "recon", "description": "Maps the tree before anything changes." },
    { "name": "reviewer", "description": "Reads the diff.", "context": "fork", "provider": "deepseek-official", "model": "deepseek-v4-flash" }
  ]
}
```

The workspace layer is resolved from a Workspace identity: the browser sends the identity of one Workspace the sidebar lists, and the Host reads that Workspace's canonical directory from its registry and walks up to the nearest ancestor holding `.git`. The directory never crosses the wire, so a caller can only name a Workspace the Host itself minted.

Every field except `version` is optional and overrides only the global field it names; an omitted field inherits the global value. `members` is the exception: it merges by name, so a declared member replaces the global member of that name and a new name appends after the global roster, while a document that declares no `members` keeps the global roster unchanged. `members` entries take `name` and `description`, and optionally `prompt`, `context` (`fresh` by default), `sandboxMode` (`read-only`, `workspace-write`, or `danger-full-access`) with `approvalPolicy` (`ask` or `never`) as the permission pair, `provider`, `model`, and `reasoningEffort`; omission of either permission knob keeps the team's own default. A declared `provider` needs its `model`. Each `allowedRoutes` and `roleRoutes` entry also takes an optional `reasoningEffort`. A member's own route takes precedence over the name preset for that member. `description` must be a non-empty string in both layers, so a `team.json` carrying an empty description is now rejected and has to be corrected.

### What you get

The service `ctx.agentTeamLlm` exposes `current()` for the global layer, `resolveFor(workspaceRoot)` for the merged value, `readWorkspaceDocument(root)` and `saveWorkspaceDocument(root, document)` for the document itself, and `teamRouteFor(settings, name)` for one teammate's route within a settings value the caller already read. Two `agentTeamLlm` Remotes serve the browser: `readTeamDocument` and `saveTeamDocument`. Both take a Workspace identity, resolve that Workspace's canonical directory from the registry, derive `<directory>/.dsh/team.json` on the Host, and never accept a path from the wire; the read answers with a null path when the Workspace has no `.git` ancestor and the write refuses it. A composition that mounts no Workspace registry keeps the service loadable and refuses these two calls. A third Remote, `listMemberPermissionPresets`, answers with the configured permission presets and the sandbox mode and approval policy each one writes, plus the permission domain's value for a pair that matches no preset; it resolves them from the composed `permissionPresets` service and answers with no preset when that service is absent, so the settings card shows a roster member's permissions as a preset name instead of a raw knob pair. Teammates keep their own durable route, so a preset applies to every future creation of that name and a teammate resumes on the route its descriptor recorded.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

`current()` resolves the reasoning-effort brand and validates the global document: a member name that is malformed, reserved for the Lead, or repeated rejects, a roster above `maxMembers` rejects, and an enabled document rejects an empty allowed list or a preset route outside it. `teamRouteFor(settings, name)` reads the settings value its caller passes and behaves as disabled when that value is disabled, so a deployment that never enables settings keeps the Lead's route.

The workspace document is decoded by hand rather than through a schema library, because every rejection must name its field and an unknown field must reject instead of being dropped. `resolveFor` walks up from the given directory to the nearest `.git` entry — a worktree's `.git` file counts — and returns the global value unchanged when there is none or when the project root holds no document. Merging keeps the global roster as the base and replaces or appends by name, so a project can retune one member without restating the rest. Writes replace the target through a random-suffix sibling, so a concurrent reader sees the old or the new complete document and a rejected document never replaces a good one.

The package owns configuration only. Route resolution into child options and the live-adapter preflight stay in [`@deepseek-ai/dsh-experimental-tool-agent-team`](../tool-agent-team/README.md), which passes the preset as the configured layer the Subagent seam merges under the call's own fields.

</details>

-----

<a id="further-exploration"></a>
## Further exploration

- [Experimental packages](../README.md) — incubation status and publication rules.
- [Agent Teams service](../agent-team/README.md) — durable roster, messages, and task board.
- [Agent Teams tools](../tool-agent-team/README.md) — the Team-scoped model tool surface.

-----

<a id="model-experience"></a>
## Model Experience

### Team LLM routes

#### What the model sees

Nothing. The document changes which LLM each teammate runs on; it adds no prompt text, tool schema, or tool result. `list_agents` reports a teammate's model while that member is loaded.

#### Token effect

None. The package contributes no model-visible content.

#### KV Cache effect

A teammate whose preset route differs from the Lead's no longer shares the Lead's request prefix. Teammates on the same route as before keep the same prefix.

### Fixed roster

#### What the model sees

The Lead reads each roster member's `name` and `description` when it composes the team, and a member's `prompt` becomes that member's own opening instructions. A roster declared in either layer therefore adds model-visible text on the next team composition call; a deployment with no `members` in either layer adds none.

#### Token effect

One `name` and `description` per member in the Lead's tool result, plus the member's `prompt` once in its own first request. Both are absent when neither layer declares `members`.

#### KV Cache effect

A member's `prompt` is a prefix of that member's own first request only, and stays cached across that member's later turns. Editing it invalidates that member's prefix; the Lead's own prefix is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Web-only editing** — outside a Web or Desktop client the settings document is the only interface; a headless deployment edits it in `cordis.patch.yml` or commits `<projectRoot>/.dsh/team.json`.
- **Exact routes only** — a preset names one provider and model, with no capability-based or cheapest-model selection.
- **No per-task routing** — a preset keys on the teammate name, so a task-shaped roster needs one name per route.
- **Whole-list route overrides** — a workspace document replaces the global `allowedRoutes` or `roleRoutes` list it declares instead of extending it, so a project cannot add one route to a deployment's list; `members` merges by name instead.
- **Roster cap is per layer** — `maxMembers` bounds each layer on its own, so a workspace document declaring a full roster of names the global roster does not carry merges into it and the composed team can reach twice that cap; `spawn_team` applies no further limit.
- **The picker lists registered Workspaces only** — a directory that only ever ran Sessions without being registered as a Workspace offers no row, so its team document is editable only after the sidebar adopts it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
