---
description: "Settings card on the Plugins page for the Agent Teams child LLM routing document: allowed routes, default route, and per-teammate-name presets."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-agent-team-llm-settings

English | [中文](README.zh.md)

## Summary

This package is the browser half of `@deepseek-ai/dsh-experimental-agent-team-llm-settings`. It adds one editable card on the Plugins page for choosing which LLM routes teammates may run on, the fallback route for names without a preset, and each name's route, member composition, and permission scope. The card edits the deployment document over `ctx.configForms` and the open session's `<projectRoot>/.dsh/team.json` over the Host document Remotes; a workspace save is an overlay that writes only declared or changed fields. A session whose cwd has no project root leaves the workspace tab disabled.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside the Host package in a Web or Desktop composition. `@deepseek-ai/dsh-experimental-agent-team-profile` already mounts both. The card appears on the Plugins page under this bundle, and only while the Host serves the `agent-team-llm-settings` namespace.

The workspace layer follows the session the main view holds, because the Host derives the project root from that session's cwd. Where nothing holds main-view retention — the settings page itself — it falls back to the most recently updated session, since any session resolves a project root or none, and the resolved document path is shown so a wrong guess is visible. Switching to the workspace tab reads `<projectRoot>/.dsh/team.json`; a project that stores none is edited from an empty document. The tab says which boundary stopped it: no session to resolve, or a session that belongs to no project.

This package mounts the Host `agentTeamLlm` Remote contribution itself, the way the other experimental clients do, so the workspace layer needs no entry in the published `@deepseek-ai/dsh-api-remotes` assembly. The Host package is a peer dependency: without it mounted, the workspace tab answers a failed read instead of opening.

The model choices come from the deployment's live adapter directory, so the card lists exactly the providers and models this installation can reach. A stored route the directory no longer advertises stays visible and removable instead of being silently dropped.

## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

| File | Responsibility |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser entry: the generated Remote contribution and the mount call |
| [`src/client/mount.ts`](src/client/mount.ts) | `$mount` of that contribution, the dictionaries and the `plugins.item` registration behind `configForms.whileServed`, and the paired disposer |
| [`src/client/agent-team-llm-card-controller.ts`](src/client/agent-team-llm-card-controller.ts) | One staged draft per layer, Host-rule validation, catalog loading, the workspace read, and the revision-fenced save |
| [`src/client/team-document.ts`](src/client/team-document.ts) | The workspace document, its member rules, and the `readTeamDocument` / `saveTeamDocument` Remote slice |
| [`src/client/AgentTeamLlmCard.tsx`](src/client/AgentTeamLlmCard.tsx) | The card shell, the scope switch, and its one save footer |
| [`src/client/AgentTeamLlmFields.tsx`](src/client/AgentTeamLlmFields.tsx) | The switch, the authorized-route editor with hand-filled routes and efforts, the default route, and preset rows |
| [`src/client/AgentTeamLlmMembers.tsx`](src/client/AgentTeamLlmMembers.tsx) | The composition rows in both layers, with each one's prompt, route fields, and the rules it breaks |

The controller keeps one staged draft per layer, so editing the workspace composition never disturbs a global draft. The global layer reads through `ctx.configForms.get('agent-team-llm-settings')` and saves as one revision; the workspace layer reads and writes through the two Remotes. `problemsOf` mirrors the Host's routing validation and `agentTeamLlmMemberProblems` its member rules; the shell folds either into `invalid`, which blocks the save. A workspace save asks `documentScope` which optional fields the project already declared or the user changed, and leaves every other field out so the project keeps inheriting it.

`reasoningEffort` is part of equality, not just identity: `sameRoutes`, `sameRoles`, and `sameAgentTeamLlmMember` all compare it, so a draft that changes only an effort is dirty and its save stays available.

</details>

-----

<a id="further-exploration"></a>
## Further exploration

- [Agent Teams routing settings (Host)](../agent-team-llm-settings/README.md) — the document this card edits, its resolution order, and its validation.
- [Agent Teams tools](../tool-agent-team/README.md) — the model-facing surface that consumes the resolved route.
- [Experimental packages](../README.md) — incubation status and publication rules.

-----

<a id="model-experience"></a>
## Model Experience

### Team LLM routing card

#### What the model sees

Nothing. This package renders product-user UI only; it adds no prompt text, tool schema, or tool result. Which route a teammate runs on is decided by the Host service at creation time.

#### Token effect

None. The card writes only `agent-team-llm-settings` fields and `<projectRoot>/.dsh/team.json`, neither of which enters a model request.

#### KV Cache effect

None by itself. A route this card changes takes effect when the next teammate is created, and that teammate stops sharing the Lead's request prefix when the two routes differ.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No route test** — the card cannot try a route, so an adapter that is registered but unreachable is only discovered when a teammate first runs.
- **A workspace default route cannot be cleared** — the Host reads a present `defaultProvider`/`defaultModel` pair as two non-empty strings, so the workspace layer writes an unset default by omitting the pair. A project that set one keeps editing it until the document is edited directly.
- **The session fallback is a heuristic** — with no main-view retention the workspace layer resolves the most recently updated session, which is not necessarily the session the user means. The resolved document path is shown so the choice can be checked.
- **Member count cap is the Host's** — the deployment's `maxMembers` is not in the document the card reads, so an over-cap composition is refused by the write instead of by the editor.
- **Member routes are not checked against the allowlist here** — whether a member's route is authorized is decided by the Host when the member is created.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
