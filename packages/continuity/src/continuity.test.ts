import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createId, type AgentSessionEvent, type AgentSessionEventPayload, type AgentSessionId } from "@exocortex/protocol";
import { ContinuityKernel } from "./kernel.js";
import { acceptPatch, ensureMainBranch, proposePatch, rejectPatch } from "./patch.js";
import { InMemoryContinuityStore } from "./in-memory-store.js";
import { SQLiteContinuityStore } from "./sqlite-store.js";
import { createFailureReviewBehavior, createUnsupportedClaimBehavior } from "./behaviors.js";
import { diffBranch, proposeBranchMerge } from "./branching.js";
import type { ContinuityPatch, ContinuityPatchOp, ContinuityStore } from "./types.js";

const sessionId = createId<"AgentSessionId">("sess");
const created: AgentSessionEvent = baseEvent(sessionId, 1, { type: "session.created", goal: "Build continuity" });
const observation: AgentSessionEvent = baseEvent(sessionId, 2, {
  type: "modality.observation",
  bindingId: createId<"AgentSessionModalityId">("bind"),
  modalityId: createId<"AgentSessionModalityId">("bind"),
  observationType: "text.final",
  value: { text: "battery profile is active" }
});
const failed: AgentSessionEvent = baseEvent(sessionId, 3, {
  type: "tool_call.failed",
  toolCallId: createId<"ToolCallId">("tool"),
  code: "tool_failed",
  message: "command failed"
});

await runStoreContract(new InMemoryContinuityStore());

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-continuity-"));
try {
  const sqlite = new SQLiteContinuityStore(join(tempRoot, "continuity.db"));
  await runStoreContract(sqlite);
  sqlite.close();
  const reopened = new SQLiteContinuityStore(join(tempRoot, "continuity.db"));
  assert.ok(reopened.findNodeByStableKey("main", `session:${sessionId}`));
  assert.ok(reopened.listNodes("main").some((node) => node.kind === "failure"));
  reopened.close();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

async function runStoreContract(store: ContinuityStore): Promise<void> {
  ensureMainBranch(store, new Date("2026-05-19T00:00:00.000Z"));
  const kernel = new ContinuityKernel({ store });
  const changes: string[] = [];
  kernel.subscribe((change) => changes.push(change.patchId));

  kernel.appendEvent(created, "main", new Date("2026-05-19T00:00:01.000Z"));
  kernel.appendEvent(observation, "main", new Date("2026-05-19T00:00:02.000Z"));
  kernel.appendEvent(failed, "main", new Date("2026-05-19T00:00:03.000Z"));
  kernel.appendEvent(failed, "main", new Date("2026-05-19T00:00:03.000Z"));

  assert.equal(changes.length, 3);
  assert.ok(store.findNodeByStableKey("main", `session:${sessionId}`));
  assert.ok(store.findNodeByStableKey("main", `goal:${sessionId}:primary`));
  assert.ok(store.listNodes("main").some((node) => node.kind === "evidence"));
  assert.ok(store.listNodes("main").some((node) => node.kind === "failure"));
  assert.equal(store.getProjectionOffset("main", "core-event-projector"), 3);

  const branch = kernel.createBranch({ id: "branch_retry", parentBranchId: "main", createdFor: "retry failed command", now: new Date("2026-05-19T00:00:04.000Z") });
  assert.equal(branch.status, "active");

  const patch = manualPatch("branch_retry");
  const op = manualNodeOp(patch);
  proposePatch(store, patch, [op]);
  assert.equal(store.getNode("node_branch_manual"), undefined);
  rejectPatch(store, patch.id, "test", new Date("2026-05-19T00:00:05.000Z"));
  assert.equal(store.getNode("node_branch_manual"), undefined);

  const patch2 = { ...manualPatch("branch_retry"), id: "patch_manual_accepted", createdAt: "2026-05-19T00:00:06.000Z" };
  const op2 = { ...manualNodeOp(patch2), id: "op_manual_accepted" };
  proposePatch(store, patch2, [op2]);
  acceptPatch(store, patch2.id, "test", new Date("2026-05-19T00:00:07.000Z"));
  assert.equal(store.getNode("node_branch_manual")?.kind, "task");
  assert.equal(store.findNodeByStableKey("main", "task:manual"), undefined);
  const diff = diffBranch(store, "branch_retry", "main");
  assert.deepEqual(diff.addedNodes.map((node) => node.stableKey), ["task:manual"]);
  const merge = proposeBranchMerge(store, { branchId: "branch_retry", baseBranchId: "main", now: new Date("2026-05-19T00:00:07.500Z") });
  assert.equal(merge.diff.conflicts.length, 0);
  assert.equal(merge.ops.filter((op) => op.op === "create_node").length, 1);

  const failureChange = {
    branchId: "main",
    patchId: "patch_failure_change",
    nodeIds: store.listNodes("main").filter((node) => node.kind === "failure").map((node) => node.id),
    edgeIds: [],
    changedAt: "2026-05-19T00:00:08.000Z"
  };
  const proposed = await createFailureReviewBehavior().evaluate(failureChange, { store, now: new Date("2026-05-19T00:00:08.000Z") });
  assert.equal(proposed.length, 1);
  proposePatch(store, proposed[0]!.patch, proposed[0]!.ops);
  acceptPatch(store, proposed[0]!.patch.id, "test", new Date("2026-05-19T00:00:09.000Z"));
  assert.ok(store.listNodes("main").some((node) => node.kind === "task" && node.stableKey.startsWith("task:review_failure:")));

  const claimPatch = manualClaimPatch("main");
  proposePatch(store, claimPatch.patch, claimPatch.ops);
  acceptPatch(store, claimPatch.patch.id, "test", new Date("2026-05-19T00:00:10.000Z"));
  const claimChange = { branchId: "main", patchId: claimPatch.patch.id, nodeIds: ["node_claim_manual"], edgeIds: [], changedAt: "2026-05-19T00:00:10.000Z" };
  const claimProposals = await createUnsupportedClaimBehavior().evaluate(claimChange, { store, now: new Date("2026-05-19T00:00:11.000Z") });
  assert.equal(claimProposals.length, 1);
}

function baseEvent(payloadSessionId: AgentSessionId, sequence: number, payload: AgentSessionEventPayloadWithoutBase): AgentSessionEvent {
  return {
    ...payload,
    id: createId("evt"),
    sessionId: payloadSessionId,
    sequence,
    createdAt: "2026-05-19T00:00:00.000Z"
  } as unknown as AgentSessionEvent;
}

type AgentSessionEventPayloadWithoutBase = AgentSessionEventPayload;

function manualPatch(branchId: string): ContinuityPatch {
  return {
    id: "patch_manual",
    branchId,
    status: "proposed",
    riskLevel: "low",
    reason: "manual branch task",
    createdAt: "2026-05-19T00:00:05.000Z"
  };
}

function manualNodeOp(patch: ContinuityPatch): ContinuityPatchOp {
  return {
    id: "op_manual",
    patchId: patch.id,
    op: "create_node",
    createdAt: patch.createdAt,
    payload: {
      id: "node_branch_manual",
      branchId: patch.branchId,
      kind: "task",
      stableKey: "task:manual",
      status: "active",
      createdByPatchId: patch.id,
      createdAt: patch.createdAt,
      metadata: {},
      revision: {
        id: "rev_branch_manual",
        nodeId: "node_branch_manual",
        patchId: patch.id,
        version: 1,
        title: "Manual branch task",
        createdAt: patch.createdAt,
        metadata: {}
      }
    }
  };
}

function manualClaimPatch(branchId: string): { patch: ContinuityPatch; ops: ContinuityPatchOp[] } {
  const patch: ContinuityPatch = {
    id: "patch_claim_manual",
    branchId,
    status: "proposed",
    riskLevel: "medium",
    reason: "manual unsupported claim",
    createdAt: "2026-05-19T00:00:10.000Z"
  };
  return {
    patch,
    ops: [
      {
        id: "op_claim_manual",
        patchId: patch.id,
        op: "create_node",
        createdAt: patch.createdAt,
        payload: {
          id: "node_claim_manual",
          branchId,
          kind: "claim",
          stableKey: "claim:manual",
          status: "active",
          createdByPatchId: patch.id,
          createdAt: patch.createdAt,
          metadata: {},
          revision: {
            id: "rev_claim_manual",
            nodeId: "node_claim_manual",
            patchId: patch.id,
            version: 1,
            title: "Manual claim",
            createdAt: patch.createdAt,
            metadata: {}
          }
        }
      }
    ]
  };
}
