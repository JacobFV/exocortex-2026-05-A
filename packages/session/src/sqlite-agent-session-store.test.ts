import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSessionArtifactId, type AgentSessionEventId, type AgentSessionId } from "@exocortex/protocol";
import { SQLiteAgentSessionStore } from "./event-store.js";
import { AgentSessionManager } from "./session-manager.js";

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-session-sqlite-"));
const dbPath = join(tempRoot, "sessions.db");

try {
  const store = new SQLiteAgentSessionStore(dbPath);
  const manager = new AgentSessionManager({ store });
  const session = manager.create({ goal: "Persist sqlite session" });

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
  assert.deepEqual(eventTypes, ["session.created", "artifact.created", "artifact.created"]);
  assert.deepEqual(
    manager.events(session.id).map((event) => event.sequence),
    [1, 2, 3]
  );
  assert.deepEqual(
    manager.artifacts(session.id).map((artifact) => artifact.title),
    ["First artifact", "Second artifact with same id"]
  );
  store.close();

  const reopenedStore = new SQLiteAgentSessionStore(dbPath);
  assert.deepEqual(
    reopenedStore.listEvents(session.id).map((event) => event.type),
    ["session.created", "artifact.created", "artifact.created"]
  );
  assert.deepEqual(
    reopenedStore.listArtifacts(session.id).map((artifact) => artifact.value),
    [{ ok: true }, { ok: "still appended" }]
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
  reopenedStore.close();
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
