import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSessionArtifactId, type AgentSessionEventId, type AgentSessionId } from "@exocortex/protocol";
import { ModalityRegistry } from "@exocortex/modalities";
import { SQLiteAgentSessionStore } from "./event-store.js";
import { FileArtifactBlobStore } from "./artifact-blob-store.js";
import { AgentSessionManager } from "./session-manager.js";

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-session-sqlite-"));
const dbPath = join(tempRoot, "sessions.db");

try {
  const store = new SQLiteAgentSessionStore(dbPath);
  assert.deepEqual(store.listMigrations().map((migration) => migration.version), [1, 2]);
  const manager = new AgentSessionManager({ store });
  const session = manager.create({ goal: "Persist sqlite session" });
  const registry = new ModalityRegistry();
  const modality = registry.createDefaultHostGraph()[0]!;
  const binding = registry.bindToSession({ sessionId: session.id, modalityInstanceId: modality.id });
  manager.bindModality(session.id, binding);

  manager.createArtifact({
    id: "art_fixed" as AgentSessionArtifactId,
    sessionId: session.id,
    kind: "json",
    title: "First artifact",
    value: { ok: true }
  });
  manager.createArtifact({
    id: "art_fixed" as AgentSessionArtifactId,
    sessionId: session.id,
    kind: "json",
    title: "Second artifact with same id",
    value: { ok: "still appended" }
  });

  const eventTypes = manager.events(session.id).map((event) => event.type);
  assert.deepEqual(eventTypes, ["session.created", "session.modality_bound", "artifact.created", "artifact.created"]);
  assert.deepEqual(
    manager.events(session.id).map((event) => event.sequence),
    [1, 2, 3, 4]
  );
  assert.deepEqual(
    manager.artifacts(session.id).map((artifact) => artifact.title),
    ["First artifact", "Second artifact with same id"]
  );
  store.close();

  const reopenedStore = new SQLiteAgentSessionStore(dbPath);
  assert.deepEqual(
    reopenedStore.listEvents(session.id).map((event) => event.type),
    ["session.created", "session.modality_bound", "artifact.created", "artifact.created"]
  );
  assert.deepEqual(reopenedStore.listSessionIds(), [session.id]);
  assert.deepEqual(
    reopenedStore.listArtifacts(session.id).map((artifact) => artifact.value),
    [{ ok: true }, { ok: "still appended" }]
  );

  const restoredManager = new AgentSessionManager({ store: reopenedStore });
  const restoredSession = restoredManager.get(session.id);
  assert.equal(restoredSession?.goal, "Persist sqlite session");
  assert.equal(restoredSession?.state, "idle");
  assert.equal(restoredManager.listBindings(session.id)[0]?.key, binding.key);
  restoredManager.createArtifact({
    sessionId: session.id,
    kind: "json",
    title: "Restored artifact",
    value: { restored: true }
  });
  assert.deepEqual(
    restoredManager.events(session.id).map((event) => event.sequence),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(reopenedStore.listEvents("missing_session" as AgentSessionId), []);
  assert.deepEqual(reopenedStore.listArtifacts("missing_session" as AgentSessionId), []);

  assert.throws(
    () =>
      reopenedStore.appendEvent({
        ...reopenedStore.listEvents(session.id)[0]!,
        id: "evt_duplicate_sequence" as AgentSessionEventId
      }),
    /UNIQUE constraint failed/
  );

  const blobStore = new FileArtifactBlobStore(join(tempRoot, "blobs"));
  const stored = blobStore.put({
    sessionId: session.id,
    kind: "image",
    title: "Frame",
    data: new Uint8Array([1, 2, 3, 4]),
    mimeType: "image/png"
  });
  assert.equal(stored.artifact.bytes, 4);
  assert.equal(stored.artifact.metadata?.sha256, stored.sha256);
  assert.equal(blobStore.verify(stored.artifact).ok, true);
  assert.deepEqual([...blobStore.read(stored.artifact)], [1, 2, 3, 4]);
  writeFileSync(stored.path, new Uint8Array([1, 2, 3, 5]));
  assert.equal(blobStore.verify(stored.artifact).ok, false);
  assert.throws(() => blobStore.read(stored.artifact), /Artifact blob integrity check failed/);
  const repaired = blobStore.repair(stored.artifact, { replacementData: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(repaired.artifact.id, stored.artifact.id);
  assert.equal(blobStore.verify(repaired.artifact).ok, true);
  assert.deepEqual([...blobStore.read(repaired.artifact)], [1, 2, 3, 4]);

  const dayMs = 24 * 60 * 60 * 1000;
  const expiredSessionId = "ses_expired_blob_gc" as AgentSessionId;
  const freshSessionId = "ses_fresh_blob_gc" as AgentSessionId;
  const activeSessionId = "ses_active_blob_gc" as AgentSessionId;
  const recentlyFinishedSessionId = "ses_recent_blob_gc" as AgentSessionId;
  const expiredBlob = blobStore.put({
    sessionId: expiredSessionId,
    kind: "file",
    title: "Expired blob",
    data: "expired",
    createdAt: "2026-04-01T00:00:00.000Z"
  });
  const freshBlob = blobStore.put({
    sessionId: freshSessionId,
    kind: "file",
    title: "Fresh blob",
    data: "fresh",
    createdAt: "2026-05-19T00:00:00.000Z"
  });
  const activeOldBlob = blobStore.put({
    sessionId: activeSessionId,
    kind: "file",
    title: "Active old blob",
    data: "active",
    createdAt: "2026-04-01T00:00:00.000Z"
  });
  const recentlyFinishedOldBlob = blobStore.put({
    sessionId: recentlyFinishedSessionId,
    kind: "file",
    title: "Recently finished old blob",
    data: "recently-finished",
    createdAt: "2026-04-01T00:00:00.000Z"
  });

  const gc = blobStore.garbageCollect({
    artifacts: [expiredBlob.artifact, freshBlob.artifact, activeOldBlob.artifact, recentlyFinishedOldBlob.artifact],
    maxArtifactAgeMs: 7 * dayMs,
    now: "2026-05-20T00:00:00.000Z",
    sessions: [
      {
        id: expiredSessionId,
        state: "finished",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        finishedAt: "2026-04-02T00:00:00.000Z"
      },
      {
        id: freshSessionId,
        state: "finished",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
        finishedAt: "2026-05-19T00:00:00.000Z"
      },
      {
        id: activeSessionId,
        state: "running",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-05-20T00:00:00.000Z"
      },
      {
        id: recentlyFinishedSessionId,
        state: "finished",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
        finishedAt: "2026-05-19T00:00:00.000Z"
      }
    ]
  });
  assert.equal(gc.checked, 4);
  assert.deepEqual(
    gc.deleted.map((entry) => entry.artifactId),
    [expiredBlob.artifact.id]
  );
  assert.equal(gc.retained, 3);
  assert.deepEqual(gc.missing, []);
  assert.deepEqual(gc.errors, []);
  assert.equal(existsSync(expiredBlob.path), false);
  assert.equal(existsSync(freshBlob.path), true);
  assert.equal(existsSync(activeOldBlob.path), true);
  assert.equal(existsSync(recentlyFinishedOldBlob.path), true);
  reopenedStore.close();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
