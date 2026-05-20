import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase, Statement } from "better-sqlite3";
import type {
  ContinuityBranch,
  ContinuityEdge,
  ContinuityEdgeKind,
  ContinuityEdgeRevision,
  ContinuityNode,
  ContinuityNodeRevision,
  ContinuityPatch,
  ContinuityPatchOp,
  ContinuityStore
} from "./types.js";

export interface SQLiteContinuityStoreOptions {
  wal?: boolean;
}

export class SQLiteContinuityStore implements ContinuityStore {
  private readonly db: SqliteDatabase;
  private readonly statements: Record<string, Statement>;

  constructor(dbPath: string, options: SQLiteContinuityStoreOptions = {}) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    if (options.wal ?? dbPath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
    this.statements = this.prepareStatements();
  }

  close(): void {
    this.db.close();
  }

  putBranch(branch: ContinuityBranch): void {
    this.statements.putBranch.run(rowWithJson(branch));
  }

  getBranch(id: string): ContinuityBranch | undefined {
    return parseRow<ContinuityBranch>(this.statements.getBranch.get(id));
  }

  listBranches(): ContinuityBranch[] {
    return parseRows<ContinuityBranch>(this.statements.listBranches.all());
  }

  putPatch(patch: ContinuityPatch): void {
    this.statements.putPatch.run(rowWithJson(patch));
  }

  getPatch(id: string): ContinuityPatch | undefined {
    return parseRow<ContinuityPatch>(this.statements.getPatch.get(id));
  }

  listPatches(branchId: string): ContinuityPatch[] {
    return parseRows<ContinuityPatch>(this.statements.listPatches.all(branchId));
  }

  putPatchOp(op: ContinuityPatchOp): void {
    this.statements.putPatchOp.run({
      id: op.id,
      patchId: op.patchId,
      op: op.op,
      targetNodeId: op.targetNodeId,
      targetEdgeId: op.targetEdgeId,
      createdAt: op.createdAt,
      payloadJson: JSON.stringify(op)
    });
  }

  listPatchOps(patchId: string): ContinuityPatchOp[] {
    return parseRows<ContinuityPatchOp>(this.statements.listPatchOps.all(patchId));
  }

  putNode(node: ContinuityNode): void {
    this.statements.putNode.run(rowWithJson(node));
  }

  putNodeRevision(revision: ContinuityNodeRevision): void {
    this.statements.putNodeRevision.run(rowWithJson(revision));
  }

  getNode(id: string): ContinuityNode | undefined {
    return parseRow<ContinuityNode>(this.statements.getNode.get(id));
  }

  findNodeByStableKey(branchId: string, stableKey: string): ContinuityNode | undefined {
    return parseRow<ContinuityNode>(this.statements.findNodeByStableKey.get(branchId, stableKey));
  }

  listNodes(branchId: string): ContinuityNode[] {
    return parseRows<ContinuityNode>(this.statements.listNodes.all(branchId));
  }

  putEdge(edge: ContinuityEdge): void {
    this.statements.putEdge.run(rowWithJson(edge));
  }

  putEdgeRevision(revision: ContinuityEdgeRevision): void {
    this.statements.putEdgeRevision.run(rowWithJson(revision));
  }

  getEdge(id: string): ContinuityEdge | undefined {
    return parseRow<ContinuityEdge>(this.statements.getEdge.get(id));
  }

  listEdges(query: { branchId: string; fromNodeId?: string; toNodeId?: string; kind?: ContinuityEdgeKind }): ContinuityEdge[] {
    return parseRows<ContinuityEdge>(
      this.statements.listEdges.all({
        branchId: query.branchId,
        fromNodeId: query.fromNodeId ?? null,
        toNodeId: query.toNodeId ?? null,
        kind: query.kind ?? null
      })
    );
  }

  getProjectionOffset(branchId: string, projectorId: string): number {
    const row = this.statements.getProjectionOffset.get(branchId, projectorId) as { sequence: number } | undefined;
    return row?.sequence ?? 0;
  }

  setProjectionOffset(branchId: string, projectorId: string, sequence: number): void {
    this.statements.setProjectionOffset.run({ branchId, projectorId, sequence });
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS continuity_branches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_branch_id TEXT,
        forked_from_event_id TEXT,
        forked_from_patch_id TEXT,
        status TEXT NOT NULL,
        created_for TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS continuity_patches (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS continuity_patches_branch_idx ON continuity_patches (branch_id, created_at);

      CREATE TABLE IF NOT EXISTS continuity_patch_ops (
        id TEXT PRIMARY KEY,
        patch_id TEXT NOT NULL,
        op TEXT NOT NULL,
        target_node_id TEXT,
        target_edge_id TEXT,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS continuity_patch_ops_patch_idx ON continuity_patch_ops (patch_id, created_at, id);

      CREATE TABLE IF NOT EXISTS continuity_nodes (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        stable_key TEXT NOT NULL,
        current_revision_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (branch_id, stable_key)
      );

      CREATE INDEX IF NOT EXISTS continuity_nodes_branch_idx ON continuity_nodes (branch_id, created_at);

      CREATE TABLE IF NOT EXISTS continuity_node_revisions (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        patch_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (node_id, version)
      );

      CREATE TABLE IF NOT EXISTS continuity_edges (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS continuity_edges_query_idx ON continuity_edges (branch_id, from_node_id, to_node_id, kind);

      CREATE TABLE IF NOT EXISTS continuity_edge_revisions (
        id TEXT PRIMARY KEY,
        edge_id TEXT NOT NULL,
        patch_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (edge_id, version)
      );

      CREATE TABLE IF NOT EXISTS continuity_projection_offsets (
        branch_id TEXT NOT NULL,
        projector_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        PRIMARY KEY (branch_id, projector_id)
      );

      CREATE TABLE IF NOT EXISTS continuity_tasks (node_id TEXT PRIMARY KEY, state TEXT NOT NULL, priority INTEGER NOT NULL, owner_agent_session_id TEXT, due_at TEXT);
      CREATE TABLE IF NOT EXISTS continuity_claims (node_id TEXT PRIMARY KEY, claim_type TEXT NOT NULL, truth_status TEXT NOT NULL, confidence REAL, last_evaluated_at TEXT);
      CREATE TABLE IF NOT EXISTS continuity_evidence (node_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, observed_at TEXT NOT NULL, content_hash TEXT);
      CREATE TABLE IF NOT EXISTS continuity_capabilities (node_id TEXT PRIMARY KEY, capability_kind TEXT NOT NULL, provider TEXT NOT NULL, version TEXT, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS continuity_policies (node_id TEXT PRIMARY KEY, policy_kind TEXT NOT NULL, enabled INTEGER NOT NULL, risk_level TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS continuity_approvals (node_id TEXT PRIMARY KEY, approval_kind TEXT NOT NULL, subject_node_id TEXT, approved_by TEXT NOT NULL, expires_at TEXT);
      CREATE TABLE IF NOT EXISTS continuity_failures (node_id TEXT PRIMARY KEY, failure_code TEXT NOT NULL, severity TEXT NOT NULL, recoverable INTEGER NOT NULL, occurrence_count INTEGER NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS continuity_evaluations (node_id TEXT PRIMARY KEY, subject_node_id TEXT NOT NULL, score REAL, passed INTEGER, evaluator TEXT NOT NULL, evaluated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS continuity_agent_versions (node_id TEXT PRIMARY KEY, runtime_id TEXT NOT NULL, model_id TEXT, prompt_hash TEXT, toolset_hash TEXT, policy_hash TEXT, created_at TEXT NOT NULL);
    `);
  }

  private prepareStatements(): Record<string, Statement> {
    return {
      putBranch: this.db.prepare(`INSERT INTO continuity_branches (id, name, parent_branch_id, forked_from_event_id, forked_from_patch_id, status, created_for, created_at, payload_json)
        VALUES (@id, @name, @parentBranchId, @forkedFromEventId, @forkedFromPatchId, @status, @createdFor, @createdAt, @payloadJson)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_branch_id=excluded.parent_branch_id, forked_from_event_id=excluded.forked_from_event_id, forked_from_patch_id=excluded.forked_from_patch_id, status=excluded.status, created_for=excluded.created_for, created_at=excluded.created_at, payload_json=excluded.payload_json`),
      getBranch: this.db.prepare(`SELECT payload_json FROM continuity_branches WHERE id = ?`),
      listBranches: this.db.prepare(`SELECT payload_json FROM continuity_branches ORDER BY created_at, id`),
      putPatch: this.db.prepare(`INSERT INTO continuity_patches (id, branch_id, status, risk_level, reason, created_at, payload_json)
        VALUES (@id, @branchId, @status, @riskLevel, @reason, @createdAt, @payloadJson)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload_json=excluded.payload_json`),
      getPatch: this.db.prepare(`SELECT payload_json FROM continuity_patches WHERE id = ?`),
      listPatches: this.db.prepare(`SELECT payload_json FROM continuity_patches WHERE branch_id = ? ORDER BY created_at, id`),
      putPatchOp: this.db.prepare(`INSERT INTO continuity_patch_ops (id, patch_id, op, target_node_id, target_edge_id, created_at, payload_json)
        VALUES (@id, @patchId, @op, @targetNodeId, @targetEdgeId, @createdAt, @payloadJson)
        ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json`),
      listPatchOps: this.db.prepare(`SELECT payload_json FROM continuity_patch_ops WHERE patch_id = ? ORDER BY created_at, id`),
      putNode: this.db.prepare(`INSERT INTO continuity_nodes (id, branch_id, kind, stable_key, current_revision_id, status, created_at, payload_json)
        VALUES (@id, @branchId, @kind, @stableKey, @currentRevisionId, @status, @createdAt, @payloadJson)
        ON CONFLICT(id) DO UPDATE SET current_revision_id=excluded.current_revision_id, status=excluded.status, payload_json=excluded.payload_json`),
      putNodeRevision: this.db.prepare(`INSERT INTO continuity_node_revisions (id, node_id, patch_id, version, created_at, payload_json)
        VALUES (@id, @nodeId, @patchId, @version, @createdAt, @payloadJson)
        ON CONFLICT(node_id, version) DO UPDATE SET patch_id=excluded.patch_id, created_at=excluded.created_at, payload_json=excluded.payload_json`),
      getNode: this.db.prepare(`SELECT payload_json FROM continuity_nodes WHERE id = ?`),
      findNodeByStableKey: this.db.prepare(`SELECT payload_json FROM continuity_nodes WHERE branch_id = ? AND stable_key = ?`),
      listNodes: this.db.prepare(`SELECT payload_json FROM continuity_nodes WHERE branch_id = ? ORDER BY created_at, id`),
      putEdge: this.db.prepare(`INSERT INTO continuity_edges (id, branch_id, from_node_id, to_node_id, kind, status, created_at, payload_json)
        VALUES (@id, @branchId, @fromNodeId, @toNodeId, @kind, @status, @createdAt, @payloadJson)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload_json=excluded.payload_json`),
      putEdgeRevision: this.db.prepare(`INSERT INTO continuity_edge_revisions (id, edge_id, patch_id, version, created_at, payload_json)
        VALUES (@id, @edgeId, @patchId, @version, @createdAt, @payloadJson)
        ON CONFLICT(edge_id, version) DO UPDATE SET patch_id=excluded.patch_id, created_at=excluded.created_at, payload_json=excluded.payload_json`),
      getEdge: this.db.prepare(`SELECT payload_json FROM continuity_edges WHERE id = ?`),
      listEdges: this.db.prepare(`SELECT payload_json FROM continuity_edges WHERE branch_id = @branchId AND (@fromNodeId IS NULL OR from_node_id = @fromNodeId) AND (@toNodeId IS NULL OR to_node_id = @toNodeId) AND (@kind IS NULL OR kind = @kind) ORDER BY created_at, id`),
      getProjectionOffset: this.db.prepare(`SELECT sequence FROM continuity_projection_offsets WHERE branch_id = ? AND projector_id = ?`),
      setProjectionOffset: this.db.prepare(`INSERT INTO continuity_projection_offsets (branch_id, projector_id, sequence) VALUES (@branchId, @projectorId, @sequence) ON CONFLICT(branch_id, projector_id) DO UPDATE SET sequence=excluded.sequence`)
    };
  }
}

function rowWithJson<T extends object>(value: T): Record<string, unknown> {
  return {
    ...value,
    parentBranchId: "parentBranchId" in value ? value.parentBranchId : null,
    forkedFromEventId: "forkedFromEventId" in value ? value.forkedFromEventId : null,
    forkedFromPatchId: "forkedFromPatchId" in value ? value.forkedFromPatchId : null,
    currentRevisionId: "currentRevisionId" in value ? value.currentRevisionId : null,
    payloadJson: JSON.stringify(value)
  };
}

function parseRow<T>(row: unknown): T | undefined {
  if (!row || typeof row !== "object" || !("payload_json" in row)) return undefined;
  return JSON.parse((row as { payload_json: string }).payload_json) as T;
}

function parseRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => {
    const parsed = parseRow<T>(row);
    if (!parsed) throw new Error("Continuity SQLite row missing payload_json");
    return parsed;
  });
}
