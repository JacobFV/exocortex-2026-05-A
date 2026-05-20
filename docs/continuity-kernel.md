# Exocortex Continuity Kernel Specification

This document is the durable specification for the next core architecture stage. It exists so the continuity substrate, schema, and package refactor intentions survive context resets.

## Executive Decision

Exocortex must be centered on a `ContinuityKernel`, not on `AgentSessionManager`.

An agent session is an actor operating inside the continuity substrate. It is not the substrate. Chat history is not the substrate. A session lifecycle is not the substrate.

The substrate is:

```txt
immutable events
  -> proposed and accepted patches
    -> branch-scoped continuity graph
      -> reactive behaviors
        -> commands, model turns, tool calls, and more events
```

The event log records what happened. Accepted patches record what changed. The graph represents what is true for a branch. Behaviors react to accepted graph changes. Branches represent alternate operational realities for retries, simulations, experiments, and policy comparison.

## Design Rejections

Reject `graph as memory`.

The continuity graph is not a memory feature. It is the operating reality of the system: goals, tasks, claims, evidence, capabilities, devices, modalities, policies, approvals, failures, artifacts, runtime versions, and branches.

Reject `graph as a query index over events`.

The graph is replayable from events and patches, but it is not merely an index. It is the materialized state that behaviors and agents operate against.

Reject `each subsystem owns its own truth`.

Browser sessions, computer sessions, calibration, safety, tools, artifacts, devices, modalities, and model/runtime versions must project into a shared continuity substrate. Subsystems may own adapters and controllers, but accepted operational truth belongs in the continuity graph.

Reject `untyped metadata-only graph`.

Generic `kind + metadata_json` nodes are useful for extensibility, but core operational concepts require typed overlays and constraints. Claims, tasks, policies, approvals, failures, capabilities, and evaluations must be queryable without parsing arbitrary JSON.

Reject `silent mutation`.

Risky belief changes, policy changes, calibration changes, capability changes, and self-modification must be represented as proposed patches that are accepted, rejected, superseded, or failed with lineage.

## Required Package Refactors

### Add `packages/continuity`

Owns the continuity types, patch model, graph stores, projection engine, behavior engine, branch operations, and graph queries.

### Recenter Runtime Around `ContinuityKernel`

`ContinuityKernel` owns:

- event append path
- patch proposal and acceptance path
- graph projection
- branch state
- behavior dispatch
- capability registry hooks
- policy and approval gates

`AgentSessionManager` becomes a subsystem using the kernel, not the root of the architecture.

### Rename `packages/peripherals` To `packages/modalities`

The code models modalities, not generic peripherals. Keeping the old package name preserves conceptual drift. The rename must be handled as a compatibility migration:

- create `packages/modalities`
- move registry and bridge code
- keep a temporary `@exocortex/peripherals` package that re-exports from `@exocortex/modalities`
- update imports package by package
- remove the compatibility package only after all local imports use `@exocortex/modalities`

### Split `packages/session`

Current `packages/session` mixes event stores, event bus, session manager, runtime, tool router, modality routers, and browser tools. The desired split is:

```txt
packages/events
  AgentEventStore
  SQLiteEventStore
  JsonlEventStore
  EventBus
  event sequencing

packages/continuity
  ContinuityKernel
  nodes, edges, revisions, patches, branches
  projection from events
  behavior engine
  graph queries

packages/agents
  AgentSessionManager
  AgentRuntime
  ModelDrivenAgentRuntime
  AgentToolRouter
```

This split should be incremental. The continuity package lands first. Package extraction happens once the kernel integration proves the new ownership boundaries.

### Move Browser And Computer Tools Out Of Session

Browser and computer tools are capabilities, not session internals. Move them into a capability package or near the browser/computer session packages:

```txt
packages/capabilities
  CapabilityRegistry
  tool definitions
  tool router
  browser tools
  computer tools
  hardware tools
  media tools
```

The agent runtime requests available capabilities from the kernel rather than importing every tool family directly.

## Core Concepts

### Event

An immutable fact that something happened operationally.

Examples:

- session created
- modality observation received
- tool call completed
- artifact created
- browser action dispatched
- actuator arm grant created
- calibration profile accepted
- session error emitted

Events are append-only and must never be edited.

### Patch

A proposed or accepted mutation to branch state.

Patch statuses:

- `proposed`
- `accepted`
- `rejected`
- `superseded`
- `failed`

Patches separate intent to change state from accepted operational truth.

### Graph

The materialized branch-scoped operational reality produced by accepted patches.

The graph contains both cognitive state and embodied state:

- goals
- tasks
- claims
- evidence
- decisions
- artifacts
- sessions
- modalities
- devices
- tools
- capabilities
- policies
- approvals
- failures
- evaluations
- calibration profiles
- safety grants
- browser sessions
- computer sessions
- agent/runtime versions

### Behavior

A deterministic or model-assisted reactor that subscribes to accepted graph changes and proposes new patches or emits commands.

Behaviors react to state changes, not raw chat messages.

### Branch

A named alternate graph reality.

Branches support:

- retrying from earlier assumptions
- comparing policies
- testing prompt/tool/runtime changes
- simulating risky plans
- evaluating alternate task strategies
- promoting accepted changes back to another branch

## Truth Classes

The kernel must distinguish three truth classes.

### Observed Truth

What an input source reported.

Examples:

- a microphone transcript
- an ADC raw sample
- a browser screenshot
- a user text observation
- a tool response payload

Observed truth is represented as evidence nodes with provenance to modality, tool, artifact, session, and event.

### Inferred Truth

What a model, tool, or projection inferred from observed truth.

Examples:

- calibrated voltage value
- a claim extracted from a document
- a contradiction between claims
- a task derived from a goal
- a stale-state inference

Inferred truth must carry confidence, producer, source evidence, and evaluation status.

### Accepted Operational Truth

State the system is allowed to act on.

Examples:

- active calibration profile
- active safety policy
- armed actuator approval
- enabled capability
- selected model provider
- accepted task priority
- promoted behavior patch

Accepted operational truth requires an accepted patch and lineage to its approving policy, user, runtime rule, or evaluator.

## Node Schema

### `continuity_nodes`

```txt
id TEXT PRIMARY KEY
branch_id TEXT NOT NULL
kind TEXT NOT NULL
stable_key TEXT NOT NULL
current_revision_id TEXT
status TEXT NOT NULL
created_by_event_id TEXT
created_by_patch_id TEXT
created_at TEXT NOT NULL
metadata_json TEXT NOT NULL
UNIQUE(branch_id, stable_key)
```

Required statuses:

- `active`
- `stale`
- `superseded`
- `rejected`
- `archived`

Required node kinds:

- `goal`
- `task`
- `claim`
- `evidence`
- `decision`
- `question`
- `answer`
- `artifact`
- `session`
- `modality`
- `device`
- `tool`
- `capability`
- `policy`
- `approval`
- `failure`
- `evaluation`
- `patch`
- `fork`
- `agent_version`
- `calibration_profile`
- `safety_grant`
- `browser_session`
- `computer_session`

### `continuity_node_revisions`

```txt
id TEXT PRIMARY KEY
node_id TEXT NOT NULL
patch_id TEXT NOT NULL
version INTEGER NOT NULL
title TEXT
body TEXT
confidence REAL
valid_from TEXT
valid_until TEXT
metadata_json TEXT NOT NULL
created_at TEXT NOT NULL
UNIQUE(node_id, version)
```

Node revisions prevent silent mutation. Every meaningful node update creates a new revision.

## Edge Schema

### `continuity_edges`

```txt
id TEXT PRIMARY KEY
branch_id TEXT NOT NULL
from_node_id TEXT NOT NULL
to_node_id TEXT NOT NULL
kind TEXT NOT NULL
status TEXT NOT NULL
created_by_event_id TEXT
created_by_patch_id TEXT
created_at TEXT NOT NULL
metadata_json TEXT NOT NULL
```

Required edge kinds:

- `supports`
- `contradicts`
- `depends_on`
- `blocks`
- `unblocks`
- `derived_from`
- `produced_by`
- `observed_from`
- `uses`
- `controls`
- `approved_by`
- `rejected_by`
- `invalidated_by`
- `supersedes`
- `forked_from`
- `evaluated_by`

### `continuity_edge_revisions`

```txt
id TEXT PRIMARY KEY
edge_id TEXT NOT NULL
patch_id TEXT NOT NULL
version INTEGER NOT NULL
status TEXT NOT NULL
metadata_json TEXT NOT NULL
created_at TEXT NOT NULL
UNIQUE(edge_id, version)
```

Edges can be updated, invalidated, superseded, or archived without erasing the prior relation.

## Patch Schema

### `continuity_patches`

```txt
id TEXT PRIMARY KEY
branch_id TEXT NOT NULL
status TEXT NOT NULL
proposed_by_event_id TEXT
proposed_by_tool_call_id TEXT
proposed_by_agent_version_id TEXT
risk_level TEXT NOT NULL
reason TEXT NOT NULL
created_at TEXT NOT NULL
decided_at TEXT
decided_by TEXT
metadata_json TEXT NOT NULL
```

Required risk levels:

- `low`
- `medium`
- `high`
- `hazardous`

### `continuity_patch_ops`

```txt
id TEXT PRIMARY KEY
patch_id TEXT NOT NULL
op TEXT NOT NULL
target_node_id TEXT
target_edge_id TEXT
payload_json TEXT NOT NULL
created_at TEXT NOT NULL
```

Required ops:

- `create_node`
- `update_node`
- `archive_node`
- `create_edge`
- `update_edge`
- `archive_edge`

Patch ops are replayable graph mutations.

## Branch Schema

### `continuity_branches`

```txt
id TEXT PRIMARY KEY
name TEXT NOT NULL
parent_branch_id TEXT
forked_from_event_id TEXT
forked_from_patch_id TEXT
status TEXT NOT NULL
created_for TEXT NOT NULL
created_at TEXT NOT NULL
metadata_json TEXT NOT NULL
```

Required statuses:

- `active`
- `merged`
- `abandoned`
- `archived`

The default branch is `main`.

## Typed Overlay Tables

Typed overlays make core concepts queryable and enforceable.

### `continuity_tasks`

```txt
node_id TEXT PRIMARY KEY
state TEXT NOT NULL
priority INTEGER NOT NULL
owner_agent_session_id TEXT
due_at TEXT
```

Task states:

- `open`
- `blocked`
- `running`
- `done`
- `failed`
- `abandoned`

### `continuity_claims`

```txt
node_id TEXT PRIMARY KEY
claim_type TEXT NOT NULL
truth_status TEXT NOT NULL
confidence REAL
last_evaluated_at TEXT
```

Truth statuses:

- `unknown`
- `supported`
- `contradicted`
- `retracted`
- `stale`

### `continuity_evidence`

```txt
node_id TEXT PRIMARY KEY
source_kind TEXT NOT NULL
source_id TEXT NOT NULL
observed_at TEXT NOT NULL
content_hash TEXT
```

Source kinds:

- `modality`
- `artifact`
- `tool`
- `user`
- `browser`
- `computer`
- `hardware`
- `runtime`

### `continuity_capabilities`

```txt
node_id TEXT PRIMARY KEY
capability_kind TEXT NOT NULL
provider TEXT NOT NULL
version TEXT
enabled INTEGER NOT NULL
```

Capability kinds:

- `tool`
- `modality`
- `model`
- `device`
- `policy`
- `behavior`

### `continuity_policies`

```txt
node_id TEXT PRIMARY KEY
policy_kind TEXT NOT NULL
enabled INTEGER NOT NULL
risk_level TEXT NOT NULL
```

### `continuity_approvals`

```txt
node_id TEXT PRIMARY KEY
approval_kind TEXT NOT NULL
subject_node_id TEXT
approved_by TEXT NOT NULL
expires_at TEXT
```

### `continuity_failures`

```txt
node_id TEXT PRIMARY KEY
failure_code TEXT NOT NULL
severity TEXT NOT NULL
recoverable INTEGER NOT NULL
occurrence_count INTEGER NOT NULL
last_seen_at TEXT NOT NULL
```

### `continuity_evaluations`

```txt
node_id TEXT PRIMARY KEY
subject_node_id TEXT NOT NULL
score REAL
passed INTEGER
evaluator TEXT NOT NULL
evaluated_at TEXT NOT NULL
```

### `continuity_agent_versions`

```txt
node_id TEXT PRIMARY KEY
runtime_id TEXT NOT NULL
model_id TEXT
prompt_hash TEXT
toolset_hash TEXT
policy_hash TEXT
created_at TEXT NOT NULL
```

## Projection Rules

Projection converts events into patches.

### `session.created`

Creates:

- `session` node
- `goal` node
- edge `session uses goal`

Patch risk: `low`.

### `session.modality_bound`

Creates or updates:

- `modality` node
- `capability` node for observed or controlled capability
- edge `session uses modality`

Patch risk: `low`.

### `modality.observation`

Creates:

- `evidence` node
- edge `evidence observed_from modality`
- edge `evidence produced_by session`

If the observation is structured text or a recognized claim payload, a behavior may propose a derived `claim` patch.

Patch risk: `low` for evidence. Derived claims are `medium` until evaluated.

### `tool_call.started`

Creates:

- tool-use trace node
- edge `tool_use uses capability`
- edge `tool_use produced_by session`

Patch risk: `low`.

### `tool_call.completed`

Creates:

- tool-result evidence node
- edge `tool_result produced_by tool_use`

Behaviors may derive claims, tasks, artifacts, failures, or decisions from the result.

Patch risk: `low` for result evidence. Derived operational state depends on content.

### `tool_call.failed`

Creates or updates:

- `failure` node
- edge `failure produced_by tool_use`
- edge `failure invalidated_by` if a later successful tool use supersedes it

Repeated failures must increment `occurrence_count`.

Patch risk: `low`.

### `artifact.created`

Creates:

- `artifact` node
- edge `artifact produced_by session` or tool-use node when present

Patch risk: `low`.

### `browser.created` And `computer.created`

Creates:

- browser or computer session node
- screen projection capability node
- control capability node

Patch risk: `low`.

### `browser.action` And `computer.action`

Creates:

- environment-action evidence node
- edge `action uses browser/computer capability`
- edge `action produced_by session`

Patch risk: `low` unless action is marked hazardous by policy.

### `browser.projection_frame` And `computer.projection_frame`

Creates:

- projection evidence node
- optional artifact node for stored frame
- edge `projection observed_from browser/computer session`

Patch risk: `low`.

### `session.error`

Creates or updates:

- `failure` node
- edge `failure produced_by session`

Patch risk: `low`.

### Calibration Profile Artifact

Creates:

- `calibration_profile` node
- policy/configuration node for active profile when accepted
- edge `calibration_profile controls modality/device`
- edge `calibration_profile supersedes prior profile` when replacing

Patch risk: `medium`; `high` for actuator-affecting calibration.

### Actuator Arm Grant

Creates:

- `approval` node
- `safety_grant` node
- edge `approval controls actuator capability`
- edge `approval approved_by operator/runtime policy`

Patch risk: `hazardous` for laser or ultrasound.

## Behavior Rules

Behaviors subscribe to accepted graph changes.

### Unsupported Claim Behavior

Trigger:

- a `claim` node has truth status `unknown`
- no incoming `supports` evidence edge exists

Action:

- propose `task` node for research or verification
- edge `task depends_on claim`

Acceptance:

- auto-accept for low-risk domains
- require approval for safety, legal, medical, or actuator-affecting domains

### Contradiction Review Behavior

Trigger:

- two active claims have a `contradicts` edge

Action:

- propose review task
- mark dependent claims or artifacts as `stale` when policy permits

### Completed Dependency Behavior

Trigger:

- task dependency changes to `done`

Action:

- unblock dependent tasks when all blockers are resolved

### Repeated Failure Behavior

Trigger:

- failure occurrence count crosses policy threshold

Action:

- propose policy, tool, prompt, or capability patch
- create evaluation task for branch comparison

### Stale Evidence Behavior

Trigger:

- evidence source is superseded, expired, invalidated, or contradicted

Action:

- mark derived claims and artifacts stale
- create revalidation task

### Hazardous Action Behavior

Trigger:

- proposed action controls hazardous capability

Action:

- require approval patch
- refuse action unless active approval and policy permit it

### Calibration Supersession Behavior

Trigger:

- accepted calibration profile targets same device/channel as active profile

Action:

- mark prior profile superseded
- update active configuration policy node
- record provenance from operator or agent session

## Kernel API Expectations

### `ContinuityKernel`

Required methods:

```ts
appendEvent(event): AgentSessionEvent
proposePatch(input): ContinuityPatch
acceptPatch(patchId, decision): ContinuityPatch
rejectPatch(patchId, decision): ContinuityPatch
applyAcceptedPatch(patch): void
projectEvent(event): ContinuityPatch[]
createBranch(input): ContinuityBranch
mergeBranch(input): ContinuityMergeResult
queryGraph(query): ContinuityQueryResult
subscribe(listener): Unsubscribe
```

`appendEvent` must persist the event, project patches, apply auto-accepted patches, and publish graph-change notifications in a deterministic order.

### `ContinuityStore`

Required implementations:

- `InMemoryContinuityStore`
- `SQLiteContinuityStore`

Required methods:

```ts
putBranch(branch): void
getBranch(id): ContinuityBranch | undefined
putPatch(patch): void
listPatches(branchId): ContinuityPatch[]
putPatchOp(op): void
listPatchOps(patchId): ContinuityPatchOp[]
putNode(node): void
putNodeRevision(revision): void
getNode(id): ContinuityNode | undefined
findNodeByStableKey(branchId, stableKey): ContinuityNode | undefined
putEdge(edge): void
putEdgeRevision(revision): void
listEdges(query): ContinuityEdge[]
transaction(fn): T
```

SQLite implementation must create schema on open, use transactions for patch application, and support deterministic replay.

### `ContinuityProjector`

Required methods:

```ts
project(event, context): ContinuityPatch[]
replay(sessionId | branchId): ProjectionReport
```

Projectors must be deterministic. Given the same ordered events and accepted patches, the graph must rebuild to the same state.

### `ContinuityBehavior`

Required shape:

```ts
interface ContinuityBehavior {
  id: string;
  reactsTo: ContinuityGraphChangePattern[];
  evaluate(change, context): Promise<ContinuityPatch[]>;
}
```

Behaviors must never mutate graph state directly. They propose patches.

## Branching Expectations

Every session gets a `branchId`. Default is `main`.

Branch operations:

- create branch from event id
- create branch from patch id
- replay graph at branch
- compare branch nodes and edges against parent
- propose merge patch
- accept merge patch
- abandon branch

Branch comparison must report:

- added nodes
- changed node revisions
- archived nodes
- added edges
- changed edge revisions
- archived edges
- conflicting patches
- evaluation outcomes

## Capability Registry Expectations

Capabilities are graph-native.

Capability nodes represent:

- tools
- modalities
- models
- devices
- policies
- behaviors

Every tool call must include:

- capability node id
- provider
- version
- input hash
- output hash when available
- producing agent version

Model turns must include:

- model provider
- model id
- system prompt hash
- available capability set hash
- policy hash
- branch id

This makes agent behavior inspectable across runtime changes.

## Safety And Calibration Graph Integration

Safety and calibration packages remain as executable libraries, but accepted operational state must live in continuity.

Safety gate reads:

- active safety policy nodes
- active approval nodes
- active safety grant nodes
- hazardous capability nodes

Calibration reads:

- active calibration profile node per device/channel
- supersession edges
- provenance edges to operator/tool/session/artifact

An actuator command path must be:

```txt
modality.action event
  -> hazardous action behavior checks graph policy
  -> approval/safety grant required when applicable
  -> safety gate validates command
  -> transport writes to hardware
  -> actuator applied frame becomes evidence
```

## Artifact Integration

Artifacts remain physically stored in the artifact store. Semantically, every artifact is a graph node.

Artifact node requirements:

- artifact id
- kind
- mime type
- URI or storage reference
- content hash when available
- producing session/tool/modality
- supporting or derived claims when applicable

Artifacts must be connectable by:

- `produced_by`
- `supports`
- `contradicts`
- `derived_from`
- `supersedes`
- `invalidated_by`

## Implementation Plan

### Stage 1: Continuity Package Foundation

Deliverables:

- `packages/continuity`
- TypeScript types for branches, nodes, revisions, edges, patches, patch ops, graph changes, behavior definitions
- `InMemoryContinuityStore`
- `SQLiteContinuityStore`
- schema creation and transaction support
- tests for node/edge/patch persistence
- tests for branch creation
- tests for deterministic patch replay

Acceptance:

- package builds under `npm run validate`
- SQLite store can close and reopen with graph state intact
- accepted patch ops materialize graph state
- rejected patch ops do not materialize graph state

Status: implemented in `@exocortex/continuity`. The package includes continuity types, deterministic ids, `InMemoryContinuityStore`, `SQLiteContinuityStore`, patch proposal/accept/reject/application helpers, main branch initialization, core event projection, `ContinuityKernel`, branch creation, graph-change subscriptions, and tests covering replay idempotency, branch isolation, accepted/rejected patches, and SQLite reopen persistence.

### Stage 2: Event Projection

Deliverables:

- `ContinuityProjector`
- projection rules for existing session, modality, tool, artifact, browser, computer, calibration, and safety events
- replay from `AgentSessionStore`
- projection offset tracking
- tests for event-to-patch projection
- tests for replay idempotency

Acceptance:

- replaying the same events twice produces the same graph
- projection offsets prevent duplicate patch application
- every existing event type either projects or is explicitly classified as no-op with reason in code

### Stage 3: Continuity Kernel

Deliverables:

- `ContinuityKernel`
- event append integration with store
- patch proposal, acceptance, rejection, and application
- graph change subscriptions
- transaction boundaries for event append plus patch projection
- tests for event append causing graph change

Acceptance:

- appending `session.created` creates session and goal graph nodes
- appending `modality.observation` creates evidence graph nodes
- appending `tool_call.failed` creates or updates failure graph node
- listeners receive graph changes after accepted patch application

### Stage 4: Agent Session Integration

Deliverables:

- sessions carry `branchId`
- `AgentSessionManager` can run through `ContinuityKernel`
- model runtime receives continuity query context
- tool calls are linked to capability nodes
- artifacts are graph nodes

Acceptance:

- starting a session creates session, goal, agent version, and capability graph nodes
- observations are visible both as events and evidence nodes
- tool results feed conversation history and graph state

Status: partially implemented. `AgentSession` now carries `branchId`, `AgentSessionManager` accepts an optional `ContinuityKernel`, and every emitted session event is projected into that session's branch. Tests cover session creation, modality binding, and modality observations creating graph nodes. Agent version and capability node projection remains part of Stage 7.

### Stage 5: Behaviors

Deliverables:

- behavior registry
- unsupported claim behavior
- contradiction review behavior
- completed dependency behavior
- repeated failure behavior
- stale evidence behavior
- hazardous action behavior
- calibration supersession behavior

Acceptance:

- behaviors propose patches, never mutate state directly
- accepted behavior patches include provenance to triggering graph change
- hazardous behavior prevents transport write without active approval

Status: partially implemented. `@exocortex/continuity` includes behavior primitives and tests for failure-review and unsupported-claim behaviors. They inspect accepted graph changes and propose task patches without direct mutation. Hazardous action, stale evidence, dependency unblocking, contradiction review, and calibration supersession behaviors remain to be implemented.

### Stage 6: Branch Operations

Deliverables:

- branch create from event
- branch create from patch
- branch graph replay
- branch diff
- merge patch proposal
- branch abandon/archive
- tests for branch divergence and merge

Acceptance:

- branch changes do not affect `main` until merge patch is accepted
- branch diff reports node and edge changes
- conflicting patches are reported before merge

### Stage 7: Capability Registry

Deliverables:

- graph-native capability registry
- tool capability nodes
- modality capability nodes
- model capability nodes
- policy capability nodes
- behavior capability nodes
- capability hash for model turns

Acceptance:

- model turn records the exact model, prompt hash, policy hash, and capability set hash
- tool call records capability node and version
- disabling a capability in graph removes it from model tool definitions

### Stage 8: Safety And Calibration Graph Integration

Deliverables:

- active safety policy graph nodes
- approval and safety grant graph nodes
- active calibration profile graph nodes
- safety gate graph reader
- calibration profile graph reader

Acceptance:

- laser/ultrasound commands require accepted approval node
- active calibration profile is selected by graph state
- superseded calibration profiles remain inspectable

### Stage 9: Package Boundary Cleanup

Deliverables:

- `packages/modalities`
- compatibility re-export from `@exocortex/peripherals`
- `packages/events`
- `packages/agents`
- `packages/capabilities`
- imports updated package by package

Acceptance:

- `npm run validate` passes after each package move
- compatibility package contains no runtime logic
- no local imports use old package name once migration completes

## Test Matrix

Required tests:

- in-memory continuity store
- SQLite continuity store
- patch acceptance/rejection
- node revision history
- edge revision history
- branch creation
- branch diff
- branch merge
- projection from every existing event type
- replay idempotency
- behavior patch proposal
- hazardous action approval flow
- calibration profile supersession
- capability disable removes tool definition
- artifact graph node creation
- model turn agent version lineage

## Documentation Requirements

Every implementation stage must update:

- `docs/continuity-kernel.md` when schema/API changes
- `docs/architecture.md` when package ownership changes
- `docs/objectives.md` when scope changes
- `README.md` when workspace/package list changes

No stage is complete without docs and tests.

## Final Target Architecture

```txt
apps/electron
apps/expo
apps/hardware-cli

packages/events
packages/continuity
packages/agents
packages/modalities
packages/capabilities
packages/protocol
packages/models
packages/media
packages/transports
packages/hardware
packages/calibration
packages/safety
packages/browser-session
packages/computer-session
```

The final center is:

```txt
ContinuityKernel
  event log
  patch log
  branch graph
  behavior engine
  capability registry
  policy and approval gates
```

The architectural rule is:

```txt
Events tell us what happened.
Patches tell us what changed.
The graph tells us what is.
Branches tell us what could be.
Behaviors tell us what should react.
Capabilities tell us what can act.
Policies tell us what may act.
```
