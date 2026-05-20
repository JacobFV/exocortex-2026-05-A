import type { AgentSessionEvent } from "@exocortex/protocol";
import { continuityId, stableHash } from "./ids.js";
import type {
  ContinuityEdge,
  ContinuityNode,
  ContinuityNodeKind,
  ContinuityPatch,
  ContinuityPatchOp,
  ContinuityProjector,
  ContinuityProjectorContext,
  ContinuityRiskLevel
} from "./types.js";

export const CORE_PROJECTOR_ID = "core-event-projector";

export class CoreContinuityProjector implements ContinuityProjector {
  project(event: AgentSessionEvent, context: ContinuityProjectorContext): Array<{ patch: ContinuityPatch; ops: ContinuityPatchOp[]; autoAccept: boolean }> {
    const now = context.now.toISOString();
    const patch = basePatch(event, context.branchId, now);
    const ops: ContinuityPatchOp[] = [];
    const node = (kind: ContinuityNodeKind, stableKey: string, metadata: Record<string, unknown> = {}, title?: string, body?: string): ContinuityNode => {
      const id = continuityId("node", context.branchId, stableKey);
      const revisionId = continuityId("rev", patch.id, stableKey, "v1");
      ops.push({
        id: continuityId("op", patch.id, ops.length, "node", stableKey),
        patchId: patch.id,
        op: "create_node",
        createdAt: now,
        payload: {
          id,
          branchId: context.branchId,
          kind,
          stableKey,
          currentRevisionId: revisionId,
          status: "active",
          createdByEventId: event.id,
          createdByPatchId: patch.id,
          createdAt: now,
          metadata,
          revision: { id: revisionId, nodeId: id, patchId: patch.id, version: 1, title, body, createdAt: now, metadata }
        }
      });
      return { id, branchId: context.branchId, kind, stableKey, currentRevisionId: revisionId, status: "active", createdByEventId: event.id, createdByPatchId: patch.id, createdAt: now, metadata };
    };
    const edge = (from: string, to: string, kind: ContinuityEdge["kind"], metadata: Record<string, unknown> = {}) => {
      const id = continuityId("edge", context.branchId, from, kind, to);
      ops.push({
        id: continuityId("op", patch.id, ops.length, "edge", id),
        patchId: patch.id,
        op: "create_edge",
        createdAt: now,
        payload: {
          id,
          branchId: context.branchId,
          fromNodeId: from,
          toNodeId: to,
          kind,
          status: "active",
          createdByEventId: event.id,
          createdByPatchId: patch.id,
          createdAt: now,
          metadata,
          revision: { id: continuityId("erev", patch.id, id, "v1"), edgeId: id, patchId: patch.id, version: 1, status: "active", createdAt: now, metadata }
        }
      });
    };

    switch (event.type) {
      case "session.created": {
        const session = node("session", `session:${event.sessionId}`, { sessionId: event.sessionId }, "Agent session", event.goal);
        const goal = node("goal", `goal:${event.sessionId}:primary`, { sessionId: event.sessionId }, "Session goal", event.goal);
        edge(session.id, goal.id, "uses");
        break;
      }
      case "session.modality_bound": {
        const session = node("session", `session:${event.sessionId}`, { sessionId: event.sessionId });
        const modality = node("modality", `modality:${event.key}`, { bindingId: event.bindingId, key: event.key }, event.key);
        edge(session.id, modality.id, "uses");
        break;
      }
      case "modality.observation": {
        const evidence = node(
          "evidence",
          `evidence:${event.id}`,
          { observationType: event.observationType, bindingId: event.bindingId, valueHash: stableHash(event.value), value: event.value },
          `Observation ${event.observationType}`
        );
        const modality = node("modality", `modality_binding:${event.bindingId}`, { bindingId: event.bindingId });
        const session = node("session", `session:${event.sessionId}`, { sessionId: event.sessionId });
        edge(evidence.id, modality.id, "observed_from");
        edge(evidence.id, session.id, "produced_by");
        break;
      }
      case "tool_call.started": {
        const tool = node("tool", `tool:${event.name}`, { name: event.name }, event.name);
        const toolUse = node("evidence", `tool_use:${event.toolCallId}`, { toolCallId: event.toolCallId, input: event.input }, `Tool call ${event.name}`);
        edge(toolUse.id, tool.id, "uses");
        break;
      }
      case "tool_call.completed": {
        const result = node("evidence", `tool_result:${event.toolCallId}`, { toolCallId: event.toolCallId, outputHash: stableHash(event.output), output: event.output }, "Tool result");
        const toolUse = node("evidence", `tool_use:${event.toolCallId}`, { toolCallId: event.toolCallId });
        edge(result.id, toolUse.id, "produced_by");
        break;
      }
      case "tool_call.failed": {
        const failure = node("failure", `failure:${event.toolCallId}:${event.code}`, { code: event.code, message: event.message, recoverable: true }, event.code, event.message);
        const toolUse = node("evidence", `tool_use:${event.toolCallId}`, { toolCallId: event.toolCallId });
        edge(failure.id, toolUse.id, "produced_by");
        break;
      }
      case "artifact.created": {
        const artifact = node("artifact", `artifact:${event.artifactId}`, { artifact: event.artifact }, event.artifact.title);
        const session = node("session", `session:${event.sessionId}`, { sessionId: event.sessionId });
        edge(artifact.id, session.id, "produced_by");
        break;
      }
      case "browser.created": {
        node("browser_session", `browser_session:${event.browserSessionId}`, { browserSessionId: event.browserSessionId }, "Browser session");
        break;
      }
      case "computer.created": {
        node("computer_session", `computer_session:${event.computerSessionId}`, { computerSessionId: event.computerSessionId }, "Computer session");
        break;
      }
      case "browser.action":
      case "computer.action": {
        const targetId = event.type === "browser.action" ? event.browserSessionId : event.computerSessionId;
        const action = node("evidence", `${event.type}:${event.id}`, { action: event.action }, event.type);
        const target = node(event.type === "browser.action" ? "browser_session" : "computer_session", `${event.type === "browser.action" ? "browser_session" : "computer_session"}:${targetId}`, { sessionId: targetId });
        edge(action.id, target.id, "uses");
        break;
      }
      case "browser.projection_frame":
      case "computer.projection_frame": {
        const frame = event.type === "browser.projection_frame" ? event.frame : event.frame;
        const evidence = node("evidence", `${event.type}:${event.id}`, { width: frame.width, height: frame.height, mimeType: frame.mimeType }, event.type);
        const targetId = "browserSessionId" in frame ? frame.browserSessionId : frame.computerSessionId;
        const target = node("browserSessionId" in frame ? "browser_session" : "computer_session", `${"browserSessionId" in frame ? "browser_session" : "computer_session"}:${targetId}`, { sessionId: targetId });
        edge(evidence.id, target.id, "observed_from");
        break;
      }
      case "session.error": {
        const failure = node("failure", `failure:${event.sessionId}:${event.code}:${event.id}`, { code: event.code, message: event.message, recoverable: event.recoverable }, event.code, event.message);
        const session = node("session", `session:${event.sessionId}`, { sessionId: event.sessionId });
        edge(failure.id, session.id, "produced_by");
        break;
      }
      default:
        return [];
    }
    return ops.length ? [{ patch, ops, autoAccept: true }] : [];
  }
}

function basePatch(event: AgentSessionEvent, branchId: string, createdAt: string): ContinuityPatch {
  return {
    id: continuityId("patch", branchId, event.sequence, event.id, event.type),
    branchId,
    status: "proposed",
    proposedByEventId: event.id,
    riskLevel: riskForEvent(event),
    reason: `Project ${event.type} into continuity graph`,
    createdAt,
    metadata: { eventType: event.type, sessionId: event.sessionId, sequence: event.sequence }
  };
}

function riskForEvent(event: AgentSessionEvent): ContinuityRiskLevel {
  if (event.type === "modality.action" && String(event.actionType).includes("actuator")) return "high";
  if (event.type === "session.error" || event.type === "tool_call.failed") return "medium";
  return "low";
}
