/** Wire and value types for the workspace-owned Agent Teams document. */

import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** How a fixed member's Session starts. */
export type TeamMemberContext = 'fresh' | 'fork'

/** One exact child LLM route declared in the workspace document. */
export interface TeamRouteDocument {
  /** Registered LLM provider route. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
  /** Adapter-owned reasoning effort; omission uses the model default. */
  readonly reasoningEffort?: string
}

/** One teammate-name preset route declared in the workspace document. */
export interface TeamRoleRouteDocument extends TeamRouteDocument {
  /** Teammate name this preset applies to. */
  readonly name: string
}

/** Sandbox scope one fixed team member may run in. */
export type MemberSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Approval policy one fixed team member may run under. */
export type MemberApprovalPolicy = 'ask' | 'never'

/** One fixed team member declared in the workspace document. */
export interface TeamMemberDocument {
  /** Teammate name; lowercase kebab-case, unique in the document, never `lead`. */
  readonly name: string
  /** What this member is for; model-visible to the Lead when it composes the team. */
  readonly description: string
  /** Opening instructions this member always starts from. */
  readonly prompt?: string
  /** Whether the member starts a fresh Session or forks the Lead's. */
  readonly context?: TeamMemberContext
  /** Sandbox the member runs in; omission keeps the delegation's own default. */
  readonly sandboxMode?: MemberSandboxMode
  /** Approval policy the member runs under; omission keeps the delegation's own default. */
  readonly approvalPolicy?: MemberApprovalPolicy
  /** Registered LLM provider route, paired with {@link model}. */
  readonly provider?: string
  /** Provider-owned exact model id, paired with {@link provider}. */
  readonly model?: string
  /** Adapter-owned reasoning effort; omission uses the model default. */
  readonly reasoningEffort?: string
}

/** Contents of `<projectRoot>/.dsh/team.json`. */
export interface TeamDocument {
  /** Document format; only version 1 is accepted. */
  readonly version: 1
  /** Whether configured routes apply; omission inherits the global layer. */
  readonly enabled?: boolean
  /** Exact routes a teammate may be routed to; omission inherits the global layer. */
  readonly allowedRoutes?: readonly TeamRouteDocument[]
  /** Per-teammate-name preset routes; omission inherits the global layer. */
  readonly roleRoutes?: readonly TeamRoleRouteDocument[]
  /** Provider of the default route, paired with {@link defaultModel}. */
  readonly defaultProvider?: string
  /** Model of the default route, paired with {@link defaultProvider}. */
  readonly defaultModel?: string
  /** Fixed roster; omission leaves the team unrostered. */
  readonly members?: readonly TeamMemberDocument[]
}

/** One fixed member after both layers merged. */
export interface TeamMemberConfig {
  /** Teammate name the Lead spawns. */
  readonly name: string
  /** What this member is for. */
  readonly description: string
  /** Opening instructions this member always starts from. */
  readonly prompt?: string
  /** Resolved start mode; a document that omits it starts fresh. */
  readonly context: TeamMemberContext
  /** Sandbox the member runs in; omission keeps the team's own default. */
  readonly sandboxMode?: MemberSandboxMode
  /** Approval policy the member runs under; omission keeps the team's own default. */
  readonly approvalPolicy?: MemberApprovalPolicy
  /** Registered LLM provider route, paired with {@link model}. */
  readonly provider?: string
  /** Provider-owned exact model id, paired with {@link provider}. */
  readonly model?: string
  /** Adapter-owned reasoning effort; omission uses the model default. */
  readonly reasoningEffort?: ReasoningEffortId
}

/** Identity and display copy of one member permissions option. */
export interface TeamMemberPermissionOption {
  /** Option identity the selector carries. */
  readonly name: string
  /** Display label the permission domain owns. */
  readonly label: string
  /** One user-facing sentence on what the option means; omitted when the deployment configured none. */
  readonly description?: string
}

/** One configured preset a roster member may select, with the knobs it writes. */
export interface TeamMemberPermissionPreset extends TeamMemberPermissionOption {
  /** Sandbox the preset writes. */
  readonly sandbox: MemberSandboxMode
  /** Approval policy the preset writes. */
  readonly approval: MemberApprovalPolicy
}

/** The member permissions options the Host serves. */
export interface TeamMemberPermissionCatalog {
  /** Configured presets eligible as durable member permissions, in deployment order. */
  readonly presets: readonly TeamMemberPermissionPreset[]
  /** The derived value for a member whose knobs match no configured preset. */
  readonly custom: TeamMemberPermissionOption
}

/** One workspace document read: its location and contents. */
export interface TeamDocumentRead {
  /** Absolute document path, or null when the scope root has no project root. */
  readonly path: string | null
  /** Validated document, or null when the project root carries no document. */
  readonly document: TeamDocument | null
}

/** One workspace document written. */
export interface TeamDocumentPath {
  /** Absolute path the validated document replaced. */
  readonly path: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Workspace directory has no `.git` ancestor, so it owns no document path. */
    'team-document/no-project-root': { readonly workspaceRoot: string }
    /** The submitted document is not a valid version-1 document; its message names the field. */
    'team-document/invalid': { readonly path: string }
    /** The composition mounts no Workspace registry, so no Workspace identity resolves. */
    'team-document/no-workspace-registry': Record<string, never>
    /** The named Workspace is not registered. */
    'team-document/unknown-workspace': { readonly workspaceId: string }
  }
}
