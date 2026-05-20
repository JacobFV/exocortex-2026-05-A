# EventGraph Continuity Kernel

This is the durable architectural spec for Exocortex continuity. It supersedes the earlier branch/node/edge table design.

## Objective

Exocortex needs a persistent, reactive, inspectable, evolving state substrate for long-running wearable agents. The primitive is not chat memory. It is continuity:

- events capture what happened
- graph objects and relations represent what is
- patches capture proposed and accepted state changes
- frames scope work, constraints, budgets, and behavior sets
- behaviors react to events and graph shape
- capability, safety, calibration, modality, browser, and session state live in the same operational graph

The system follows the useful ActiveGraph insight that tasks, claims, evidence, decisions, tools, policies, failures, approvals, capabilities, and self-modifications should not be separate memory modules. They are all objects and relations in one evolving operational substrate, with an event log that can replay how each fact came to exist.

## Rejected Legacy Design

The earlier table-backed graph model was removed. It kept a second durable graph database beside the event log and forced branch-specific mutation APIs into code that should only append events.

The accepted design has one durable source of truth: `ContinuityEvent[]`.

SQLite tables are allowed for event storage, but not as independent truth for objects, relations, patches, or operational state. The graph is replayed from events.

## Runtime Components

- `EventSourcedGraph` appends events and projects them into in-memory objects, relations, patches, frames, and views.
- `EventSourcedGraphStore` persists events. Implementations are `InMemoryEventSourcedGraphStore` and `SQLiteEventSourcedGraphStore`.
- `EventGraphKernel` is the host-facing continuity boundary. It ingests `AgentSessionEvent` values and projects them into operational graph state.
- `ReactiveGraphRuntime` subscribes to graph events and runs object behaviors and relation behaviors.
- `EventGraphCapabilityRegistry` registers tools, modalities, devices, models, policies, and behaviors as graph capability objects.
- `operational-state` accepts calibration profiles, safety policies, safety grants, approvals, and supersession lineage directly into the event graph.

## Core Event Types

The continuity event envelope is:

```ts
interface ContinuityEvent {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  actor?: string;
  frameId?: string;
  causedBy?: string;
  createdAt: string;
}
```

Core event types currently emitted by the runtime:

- `agent_session.event`
- `object.created`
- `relation.created`
- `patch.proposed`
- `patch.applied`
- `patch.rejected`
- `frame.created`
- `behavior.failed`

## Graph Objects

Objects are open typed records. We do not maintain a closed enum ontology because new sensors, actuators, tools, policies, behaviors, documents, and self-modifications need to enter the system without schema rewrites.

Required object types include:

- `agent_session`
- `goal`
- `agent_version`
- `modality`
- `device`
- `capability`
- `policy`
- `safety_grant`
- `approval`
- `calibration_profile`
- `evidence`
- `message`
- `action`
- `tool`
- `tool_call`
- `tool_result`
- `failure`
- `artifact`
- `browser_session`
- `computer_session`
- `projection_frame`
- `task`
- `claim`
- `decision`
- `evaluation`
- `behavior`

Every object carries provenance:

- actor that created it
- causing event
- frame id when scoped
- creation timestamp
- evidence event ids

## Relations

Relations make the operational graph useful. Required relation names include:

- `has_goal`
- `uses`
- `produced_by`
- `observed_from`
- `supports`
- `contradicts`
- `depends_on`
- `unblocks`
- `supersedes`
- `approved_by`
- `derived_from`
- `evaluated_by`
- `failed_under`
- `proposes_change_to`

Relation behaviors are first-class. A relation such as `depends_on` can drive unblocking when the target object changes state; `contradicts` can drive review work; `approved_by` can unlock bounded hazardous actions.

## Patches

Patches are graph events, not records in a separate patch table.

A patch includes:

- target object id
- expected object version
- updates
- status: proposed, applied, or rejected
- proposed actor
- reason
- provenance

Patch application enforces expected-version checks. Mismatches reject the patch and preserve the failed proposal in the event log. This keeps self-modification, policy changes, and risky memory updates inspectable.

## Frames

Frames scope a run of work:

- goal
- constraints
- budget
- behavior names
- creation timestamp

Frames are the substrate for retries, simulations, evaluations, and self-improvement experiments. A frame does not fork a second durable store; it scopes events and lets views compare the graph state caused by different behaviors and constraints.

## Session Projection

`EventGraphKernel.appendSessionEvent` appends the raw session event as `agent_session.event`, then projects it into graph state.

Projection rules:

- `session.created` creates `agent_session`, `goal`, and `agent_version`.
- `session.modality_bound` creates or updates the `modality` object and links it to the session.
- `modality.observation` creates `evidence`, links it to the modality, and preserves source value hash and timestamp.
- `modality.action` creates `action`, marks hazardous actuator-like actions, and links to the modality.
- messages create `message`.
- tool starts create `tool` and `tool_call`.
- tool completion creates `tool_result` and links it to the call.
- tool failure creates `failure` and links it to the call.
- artifacts create `artifact` and link to the session.
- browser and computer events create projected session and frame objects.
- session errors create `failure` linked to the session.

## Capabilities

Capabilities are graph objects, not side tables. A model turn records:

- selected model id
- runtime id
- system prompt hash
- policy hash
- enabled capability set hash
- capability object id and hash for each tool call

Disabled tool capabilities are not sent to model requests, and emitted calls for disabled or absent tools are rejected before execution.

Capability kinds:

- `tool`
- `modality`
- `model`
- `device`
- `policy`
- `behavior`

## Safety And Calibration

Safety and calibration are operational graph state:

- safety policies are `policy` objects with `policyKind: "safety"`
- actuator arm grants are `safety_grant` objects
- grant approvals are `approval` objects linked with `approved_by`
- calibration profiles are `calibration_profile` objects
- profile replacement uses `supersedes`

The actuator safety gate reads active graph grants before hazardous output. Hardware commands still pass duty, pulse, and cooldown checks before serial output.

## Branching And Alternatives

The implementation no longer exposes branch-specific table APIs. Alternatives are represented with frames, event causality, and graph views. The runtime must support comparing outcomes by frame, behavior set, policy hash, capability set hash, and evaluation objects.

If full divergent replay becomes necessary, it must fork an event stream by `runId` and keep causality explicit through `derived_from` relations. It must not reintroduce mutable branch graph tables.

## Package Boundaries

- `@exocortex/continuity` owns event graph, event storage, reactive runtime, capabilities, safety/calibration graph state, and session projection.
- `@exocortex/session` owns session lifecycle and emits session events into an attached `EventGraphKernel`.
- `@exocortex/modalities` owns device/modality registry and bridge abstractions.
- `@exocortex/models` owns interchangeable local and hosted streaming models.
- `@exocortex/safety` owns last-mile actuator gates.
- Electron and Expo hosts construct the runtime and bind available modalities into sessions.

## Non-Negotiable Invariants

- The event log is append-only.
- Graph state must be replayable from events.
- Modalities remain first-class and source-specific.
- User input is just another modality.
- Browser/computer sessions are projected controllable environments.
- Local offline and hosted models share one runtime interface.
- Safety, calibration, capabilities, policies, and approvals are graph state.
- Legacy branch/node/edge store APIs must not return.
