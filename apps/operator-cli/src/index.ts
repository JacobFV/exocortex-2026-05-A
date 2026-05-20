#!/usr/bin/env node
import { EventSourcedGraph, type ContinuityRunExportFilter, exportContinuityRunFromStore, SQLiteEventSourcedGraphStore, writeContinuityRunExport } from "@exocortex/continuity";

export type OperatorCliCommand =
  | { name: "continuity-runs"; db: string }
  | { name: "continuity-summary"; db: string; run: string }
  | { name: "continuity-export"; db: string; run: string; output: string; filter: ContinuityRunExportFilter };

export function parseOperatorCliArgs(argv: string[]): OperatorCliCommand {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  switch (command) {
    case "continuity-runs":
      return { name: "continuity-runs", db: required(options, "db") };
    case "continuity-summary":
      return { name: "continuity-summary", db: required(options, "db"), run: required(options, "run") };
    case "continuity-export":
      return { name: "continuity-export", db: required(options, "db"), run: required(options, "run"), output: required(options, "output"), filter: exportFilterFromOptions(options) };
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
    const exported = exportContinuityRunFromStore(store, command.run, new Date(), command.filter);
    writeContinuityRunExport(command.output, exported);
    writeLine(JSON.stringify({ status: "ok", output: command.output, runId: command.run, eventCount: exported.summary.eventCount }));
  } finally {
    store.close();
  }
}

function exportFilterFromOptions(options: Record<string, string | undefined>): ContinuityRunExportFilter {
  return {
    objectTypes: commaList(options["object-type"]),
    eventTypes: commaList(options["event-type"]),
    recentEvents: options["recent-events"] ? Number(options["recent-events"]) : undefined,
    relationTypes: commaList(options["relation-type"]),
    sessionIds: commaList(options["session-id"]),
    modalityKeys: commaList(options["modality-key"]),
    frameIds: commaList(options["frame-id"]),
    createdAfter: options["created-after"],
    createdBefore: options["created-before"],
    objectData: keyValueFilter(options["object-data"])
  };
}

function commaList(value: string | undefined): string[] | undefined {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}

function keyValueFilter(value: string | undefined): Record<string, string | number | boolean> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    value.split(",").map((pair) => {
      const [key, rawValue] = pair.split("=");
      if (!key || rawValue === undefined) throw new Error("--object-data must use key=value pairs separated by commas");
      return [key.trim(), parseScalar(rawValue.trim())];
    })
  );
}

function parseScalar(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return value !== "" && Number.isFinite(number) ? number : value;
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
  exocortex-operator continuity-export --db continuity-events.db --run main --output continuity-run-main.json [--object-type task,evidence] [--event-type object.created] [--relation-type supports] [--session-id sess_...] [--modality-key app_input_text] [--frame-id frame_...] [--created-after 2026-05-20T00:00:00.000Z] [--created-before 2026-05-21T00:00:00.000Z] [--object-data status=open] [--recent-events 100]`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOperatorCli(parseOperatorCliArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
