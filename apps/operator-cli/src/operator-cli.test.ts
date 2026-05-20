import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventSourcedGraph, readContinuityRunExport, SQLiteEventSourcedGraphStore } from "@exocortex/continuity";
import { parseOperatorCliArgs, runOperatorCli } from "./index.js";

assert.deepEqual(parseOperatorCliArgs(["continuity-runs", "--db", "graph.db"]), { name: "continuity-runs", db: "graph.db" });
assert.deepEqual(parseOperatorCliArgs(["continuity-summary", "--db", "graph.db", "--run", "main"]), { name: "continuity-summary", db: "graph.db", run: "main" });
assert.deepEqual(parseOperatorCliArgs(["continuity-export", "--db", "graph.db", "--run", "main", "--output", "main.json"]), { name: "continuity-export", db: "graph.db", run: "main", output: "main.json" });
assert.throws(() => parseOperatorCliArgs(["continuity-export", "--db", "graph.db", "--run", "main"]), /Missing --output/);

const tempRoot = mkdtempSync(join(tmpdir(), "exocortex-operator-cli-"));
try {
  const dbPath = join(tempRoot, "continuity-events.db");
  const exportPath = join(tempRoot, "main.json");
  const store = new SQLiteEventSourcedGraphStore(dbPath);
  const graph = new EventSourcedGraph({ runId: "main", store, clock: () => new Date("2026-05-20T00:00:00.000Z") });
  graph.addObject("task", { stableKey: "task:operator_cli", status: "open" }, { actor: "test" });
  store.close();

  const runsLines: string[] = [];
  await runOperatorCli({ name: "continuity-runs", db: dbPath }, (line) => runsLines.push(line));
  assert.deepEqual(JSON.parse(runsLines[0] ?? "{}"), { runs: ["main"] });

  const summaryLines: string[] = [];
  await runOperatorCli({ name: "continuity-summary", db: dbPath, run: "main" }, (line) => summaryLines.push(line));
  assert.equal(JSON.parse(summaryLines[0] ?? "{}").objectCount, 1);

  const exportLines: string[] = [];
  await runOperatorCli({ name: "continuity-export", db: dbPath, run: "main", output: exportPath }, (line) => exportLines.push(line));
  assert.equal(JSON.parse(exportLines[0] ?? "{}").status, "ok");
  assert.match(readFileSync(exportPath, "utf8"), /exocortex\.continuity\.run_export\.v1/);
  assert.equal(readContinuityRunExport(exportPath).summary.objectCount, 1);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
