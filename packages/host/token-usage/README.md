---
description: "Cross-session token usage Remote that folds durable session logs into the figures the usage dashboard renders."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-token-usage

English | [中文](README.zh.md)

## Summary

`host-token-usage` serves the usage dashboard. One Host Remote folds every durable session log the Host can read into token figures — totals, per-route rows, day and hour buckets, session rows, and streaks — and a browser renders them without reading a log itself. The fold lives in the Host because only the Host reads durable logs. Figures are cached per process; a `force` query re-reads every log, and concurrent force queries share one read so a page of panels cannot multiply that work.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the controller as a `cordis.yml` row. It injects `sessionQuery`, and the fiber stays pending without that service, so a mounted controller always has a corpus to read instead of answering "unavailable".

The class registers the generated `ctx.remote.tokenUsage` namespace. A client calls `ctx.remote.tokenUsage.query({ force?: boolean })` and receives `TokenUsageResponse`: the dashboard plus `cachedAt` and `cached`. `force` bypasses the in-process cache and re-reads every readable log.

The browser half is `@deepseek-ai/dsh-client-ui-usage`, which calls this Remote and renders the figures.

## Understand the implementation

`aggregateUsage` adds the token counters each provider reports on every assistant message: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and `reasoningTokens`. `totalTokens` sums the four billed counters rather than trusting a provider total.

Day and hour keys are local to the Host, and streak and week arithmetic treats a local day key as a UTC day index so the results do not shift with the runtime's UTC offset. A streak counts consecutive active days ending today or yesterday. Session rows carry the session id, working directory, creation time, and first and last event times, capped at `SESSION_ROW_LIMIT` (50).

## Further exploration

- The response and row types are in `src/types.ts`.
- The fold, the bucket boundaries, and the streak arithmetic are in `src/aggregate.ts`, with their tests beside them.

## Model Experience

None, as the package is a host-side usage projection over durable session logs that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only what the logs record is counted** — a provider call that never enters a session log, such as an approval review, is invisible here, so these totals can differ from a provider's own invoice.
- **Hit rate is the client's arithmetic** — the response carries the counters; the panel derives a cache hit ratio from them, and no ratio is stored.
- **Session rows are capped at 50** — a corpus above that shows the largest rows plus whole-corpus totals, not every session.
- **Buckets follow the Host's zone** — a client in another timezone reads the Host's day and hour boundaries.
- **The cache is per process** — nothing watches the logs, so figures move only when a caller passes `force`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
