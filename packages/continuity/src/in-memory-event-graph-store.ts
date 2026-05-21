import type { ContinuityEvent, EventSourcedGraphStore } from "./event-graph-types.js";

export class InMemoryEventSourcedGraphStore implements EventSourcedGraphStore {
  private readonly events = new Map<string, ContinuityEvent[]>();

  appendEvent(event: ContinuityEvent): void {
    const runEvents = this.events.get(event.runId) ?? [];
    if (runEvents.some((candidate) => candidate.id === event.id || candidate.sequence === event.sequence)) return;
    runEvents.push(structuredClone(event));
    runEvents.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    this.events.set(event.runId, runEvents);
  }

  listEvents(runId: string): ContinuityEvent[] {
    return (this.events.get(runId) ?? []).map((event) => structuredClone(event));
  }

  listRuns(): string[] {
    return [...this.events.keys()].sort();
  }

  transaction<T>(fn: () => T): T {
    return fn();
  }
}
