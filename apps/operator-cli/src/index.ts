#!/usr/bin/env node
import { EventSourcedGraph, exportContinuityRunFromStore, SQLiteEventSourcedGraphStore, writeContinuityRunExport } from "@exocortex/continuity";

export type OperatorCliCommand =
  | { name: "continuity-runs"; db: string }
  | { name: "continuity-summary"; db: string; run: string }
  | { name: "continuity-export"; db: string; run: string; output: string };

export function parseOperatorCliArgs(argv: string[]): OperatorCliCommand {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  switch (command) {
    case "continuity-runs":
      return { name: "continuity-runs", db: required(options, "db") };
    case "continuity-summary":
      return { name: "continuity-summary", db: required(options, "db"), run: required(options, "run") };
    case "continuity-export":
      return { name: "continuity-export", db: required(options, "db"), run: required(options, "run"), output: required(options, "output") };
    default:
      throw new Error(usage(command));
  }
}

export async function runOperatorCli(command: OperatorCliCommand, writeLine: (line: string) => void = console.log): Promise<void> {
  const store = new SQLiteEventSourcedGraphStore(command.db);
  try {
    if (command.name === "continuity-runs") {
      writeLine(JSON.stringify({ runs: store.listRuns() }));
      return;
    }
    if (command.name === "continuity-summary") {
      const graph = new EventSourcedGraph({ runId: command.run, store });
      const snapshot = graph.snapshot();
      writeLine(
        JSON.stringify({
          runId: command.run,
          eventCount: snapshot.events.length,
          objectCount: snapshot.objects.length,
          relationCount: snapshot.relations.length,
          patchCount: snapshot.patches.length,
          frameCount: snapshot.frames.length
        })
      );
      return;
    }
    const exported = exportContinuityRunFromStore(store, command.run);
    writeContinuityRunExport(command.output, exported);
    writeLine(JSON.stringify({ status: "ok", output: command.output, runId: command.run, eventCount: exported.summary.eventCount }));
  } finally {
    store.close();
  }
}

function parseOptions(argv: string[]): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) options[key] = "true";
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function required(options: Record<string, string | undefined>, key: string): string {
  const value = options[key];
  if (!value) throw new Error(`Missing --${key}`);
  return value;
}

function usage(command?: string): string {
  const prefix = command ? `Unknown command: ${command}\n` : "";
  return `${prefix}Usage:
  exocortex-operator continuity-runs --db continuity-events.db
  exocortex-operator continuity-summary --db continuity-events.db --run main
  exocortex-operator continuity-export --db continuity-events.db --run main --output continuity-run-main.json`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOperatorCli(parseOperatorCliArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
