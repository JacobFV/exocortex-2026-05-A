import type { AgentSessionEvent } from "@exocortex/protocol";
import { EventSourcedGraph } from "./event-graph.js";
import { ReactiveGraphRuntime, type GraphBehavior, type RelationBehavior } from "./reactive-runtime.js";
import { stableHash } from "./event-graph-ids.js";
import type { GraphObject, GraphRelation, GraphSnapshot } from "./event-graph-types.js";

export interface EventGraphKernelOptions {
  graph: EventSourcedGraph;
  behaviors?: GraphBehavior[];
  relationBehaviors?: RelationBehavior[];
}

export class EventGraphKernel {
  private readonly runtime: ReactiveGraphRuntime;

  constructor(private readonly options: EventGraphKernelOptions) {
    this.runtime = new ReactiveGraphRuntime({ graph: options.graph, behaviors: options.behaviors, relationBehaviors: options.relationBehaviors });
  }

  get graph(): EventSourcedGraph {
    return this.options.graph;
  }

  appendSessionEvent(event: AgentSessionEvent): void {
    const raw = this.graph.emit("agent_session.event", { event }, { actor: "agent-session-manager", createdAt: new Date(event.createdAt) });
    this.projectSessionEvent(event, raw.id);
  }

  async runUntilIdle(): Promise<void> {
    await this.runtime.runUntilIdle();
  }

  close(): void {
    this.runtime.close();
  }

  listObjects(type?: string): GraphObject[] {
    return this.graph.findObjects({ type });
  }

  listRelations(type?: string): GraphRelation[] {
    return this.graph.findRelations({ type });
  }

  snapshot(): GraphSnapshot {
    return this.graph.snapshot();
  }

  private projectSessionEvent(event: AgentSessionEvent, causedBy: string): void {
    switch (event.type) {
      case "session.created": {
        const session = this.upsertObject(`agent_session:${event.sessionId}`, "agent_session", { sessionId: event.sessionId, goal: event.goal, runtime: event.runtime }, causedBy);
        const goal = this.upsertObject(`goal:${event.sessionId}:primary`, "goal", { sessionId: event.sessionId, text: event.goal }, causedBy);
        this.ensureRelation(session.id, goal.id, "has_goal", {}, causedBy);
        if (event.runtime) {
          const agentVersion = this.upsertObject(`agent_version:${event.sessionId}:${stableHash(event.runtime)}`, "agent_version", { sessionId: event.sessionId, runtime: event.runtime, runtimeHash: stableHash(event.runtime) }, causedBy);
          this.ensureRelation(session.id, agentVersion.id, "uses", {}, causedBy);
        }
        break;
      }
      case "session.modality_bound": {
        const session = this.upsertObject(`agent_session:${event.sessionId}`, "agent_session", { sessionId: event.sessionId }, causedBy);
        const modality = this.upsertObject(`modality_binding:${event.bindingId}`, "modality", { bindingId: event.bindingId, key: event.key }, causedBy);
        this.ensureRelation(session.id, modality.id, "uses", {}, causedBy);
        break;
      }
      case "modality.observation": {
        const evidence = this.upsertObject(`evidence:${event.id}`, "evidence", { observationType: event.observationType, bindingId: event.bindingId, value: event.value, valueHash: stableHash(event.value), sourceTimestamp: event.sourceTimestamp }, causedBy);
        const modality = this.upsertObject(`modality_binding:${event.bindingId}`, "modality", { bindingId: event.bindingId }, causedBy);
        const session = this.upsertObject(`agent_session:${event.sessionId}`, "agent_session", { sessionId: event.sessionId }, causedBy);
        this.ensureRelation(evidence.id, modality.id, "observed_from", {}, causedBy);
        this.ensureRelation(evidence.id, session.id, "produced_by", {}, causedBy);
        break;
      }
      case "modality.action": {
        const action = this.upsertObject(`modality_action:${event.id}`, "action", { actionType: event.actionType, bindingId: event.bindingId, value: event.value, valueHash: stableHash(event.value), hazardous: event.actionType.includes("actuator") }, causedBy);
        const modality = this.upsertObject(`modality_binding:${event.bindingId}`, "modality", { bindingId: event.bindingId }, causedBy);
        this.ensureRelation(action.id, modality.id, "uses", {}, causedBy);
        break;
      }
      case "message.delta":
      case "message.completed": {
        this.upsertObject(`message:${event.id}`, "message", { role: event.role, text: event.text, source: event.source, completed: event.type === "message.completed", metadata: event.metadata }, causedBy);
        break;
      }
      case "tool_call.started": {
        const tool = this.upsertObject(`tool:${event.name}`, "tool", { name: event.name }, causedBy);
        const call = this.upsertObject(`tool_call:${event.toolCallId}`, "tool_call", { toolCallId: event.toolCallId, name: event.name, input: event.input, metadata: event.metadata, status: "started" }, causedBy);
        this.ensureRelation(call.id, tool.id, "uses", {}, causedBy);
        break;
      }
      case "tool_call.completed": {
        const result = this.upsertObject(`tool_result:${event.toolCallId}`, "tool_result", { toolCallId: event.toolCallId, output: event.output, outputHash: stableHash(event.output), metadata: event.metadata }, causedBy);
        const call = this.upsertObject(`tool_call:${event.toolCallId}`, "tool_call", { toolCallId: event.toolCallId, status: "completed" }, causedBy);
        this.ensureRelation(result.id, call.id, "produced_by", {}, causedBy);
        break;
      }
      case "tool_call.failed": {
        const failure = this.upsertObject(`failure:tool:${event.toolCallId}:${event.code}`, "failure", { toolCallId: event.toolCallId, code: event.code, message: event.message, metadata: event.metadata }, causedBy);
        const call = this.upsertObject(`tool_call:${event.toolCallId}`, "tool_call", { toolCallId: event.toolCallId, status: "failed" }, causedBy);
        this.ensureRelation(failure.id, call.id, "produced_by", {}, causedBy);
        break;
      }
      case "artifact.created": {
        const artifact = this.upsertObject(`artifact:${event.artifactId}`, "artifact", { artifactId: event.artifactId, artifact: event.artifact }, causedBy);
        const session = this.upsertObject(`agent_session:${event.sessionId}`, "agent_session", { sessionId: event.sessionId }, causedBy);
        this.ensureRelation(artifact.id, session.id, "produced_by", {}, causedBy);
        break;
      }
      case "browser.created":
        this.upsertObject(`browser_session:${event.browserSessionId}`, "browser_session", { browserSessionId: event.browserSessionId }, causedBy);
        break;
      case "computer.created":
        this.upsertObject(`computer_session:${event.computerSessionId}`, "computer_session", { computerSessionId: event.computerSessionId }, causedBy);
        break;
      case "browser.projection_frame":
      case "computer.projection_frame": {
        const frame = event.type === "browser.projection_frame" ? event.frame : event.frame;
        this.upsertObject(`${event.type}:${event.id}`, "projection_frame", { frame, width: frame.width, height: frame.height, mimeType: frame.mimeType }, causedBy);
        break;
      }
      case "session.error": {
        const failure = this.upsertObject(`failure:session:${event.sessionId}:${event.code}:${event.id}`, "failure", { sessionId: event.sessionId, code: event.code, message: event.message, recoverable: event.recoverable }, causedBy);
        const session = this.upsertObject(`agent_session:${event.sessionId}`, "agent_session", { sessionId: event.sessionId }, causedBy);
        this.ensureRelation(failure.id, session.id, "produced_by", {}, causedBy);
        break;
      }
    }
  }

  private upsertObject(stableKey: string, type: string, data: Record<string, unknown>, causedBy: string): GraphObject {
    const existing = this.graph.findObjects({ type, where: { stableKey } })[0];
    if (existing) {
      this.graph.patchObject(existing.id, { ...data, stableKey }, { actor: "event-projector", causedBy });
      return this.graph.getObject(existing.id)!;
    }
    return this.graph.addObject(type, { ...data, stableKey }, { actor: "event-projector", causedBy });
  }

  private ensureRelation(sourceId: string, targetId: string, type: string, data: Record<string, unknown>, causedBy: string): GraphRelation {
    const existing = this.graph.findRelations({ sourceId, targetId, type })[0];
    return existing ?? this.graph.addRelation(sourceId, targetId, type, data, { actor: "event-projector", causedBy });
  }
}
