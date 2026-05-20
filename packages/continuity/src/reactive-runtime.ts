import type { ContinuityEvent, GraphRelation, GraphViewSpec } from "./event-graph-types.js";
import { EventSourcedGraph } from "./event-graph.js";

export interface BehaviorContext {
  graph: EventSourcedGraph;
  event: ContinuityEvent;
  view: ReturnType<EventSourcedGraph["view"]>;
}

export interface GraphBehavior {
  name: string;
  on: string[];
  where?: Record<string, unknown>;
  view?: GraphViewSpec;
  activateAfter?: number;
  run(context: BehaviorContext): void | Promise<void>;
}

export interface RelationBehavior {
  name: string;
  relationType: string;
  on: string[];
  where?: Record<string, unknown>;
  view?: GraphViewSpec;
  run(relation: GraphRelation, context: BehaviorContext): void | Promise<void>;
}

export interface ReactiveGraphRuntimeOptions {
  graph: EventSourcedGraph;
  behaviors?: GraphBehavior[];
  relationBehaviors?: RelationBehavior[];
  maxEvents?: number;
}

interface QueuedEvent {
  event: ContinuityEvent;
  availableAtSequence: number;
}

export class ReactiveGraphRuntime {
  private readonly queue: QueuedEvent[] = [];
  private readonly unsubscribe: () => void;
  private running = false;

  constructor(private readonly options: ReactiveGraphRuntimeOptions) {
    this.unsubscribe = options.graph.subscribe((event) => this.queue.push({ event, availableAtSequence: event.sequence }));
  }

  close(): void {
    this.unsubscribe();
  }

  async runUntilIdle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let processed = 0;
    try {
      while (this.queue.length) {
        if (processed >= (this.options.maxEvents ?? 1000)) {
          this.options.graph.emit("runtime.budget_exhausted", { maxEvents: this.options.maxEvents ?? 1000 }, { actor: "runtime" });
          break;
        }
        const nextIndex = this.queue.findIndex((item) => item.availableAtSequence <= this.options.graph.snapshot().events.length);
        if (nextIndex < 0) break;
        const [{ event }] = this.queue.splice(nextIndex, 1);
        await this.dispatch(event);
        processed += 1;
      }
      this.options.graph.emit("runtime.idle", { processed }, { actor: "runtime" });
    } finally {
      this.running = false;
    }
  }

  private async dispatch(event: ContinuityEvent): Promise<void> {
    for (const behavior of this.options.behaviors ?? []) {
      if (!matchesBehavior(behavior, event)) continue;
      if (behavior.activateAfter && behavior.activateAfter > 0) {
        this.options.graph.emit("behavior.scheduled", { behaviorName: behavior.name, triggeringEventId: event.id, activateAfter: behavior.activateAfter }, { actor: "runtime", causedBy: event.id });
        this.queue.push({ event, availableAtSequence: event.sequence + behavior.activateAfter });
        continue;
      }
      await this.invokeBehavior(behavior, event);
    }
    for (const relationBehavior of this.options.relationBehaviors ?? []) {
      if (!matchesBehavior(relationBehavior, event)) continue;
      for (const relation of this.matchingRelations(relationBehavior, event)) await this.invokeRelationBehavior(relationBehavior, relation, event);
    }
  }

  private async invokeBehavior(behavior: GraphBehavior, event: ContinuityEvent): Promise<void> {
    this.options.graph.emit("behavior.started", { behaviorName: behavior.name, triggeringEventId: event.id }, { actor: "runtime", causedBy: event.id });
    try {
      await behavior.run({ graph: this.options.graph, event, view: this.options.graph.view(behavior.view) });
      this.options.graph.emit("behavior.completed", { behaviorName: behavior.name, triggeringEventId: event.id }, { actor: "runtime", causedBy: event.id });
    } catch (error) {
      this.options.graph.emit("behavior.failed", { behaviorName: behavior.name, triggeringEventId: event.id, errorType: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) }, { actor: "runtime", causedBy: event.id });
    }
  }

  private async invokeRelationBehavior(behavior: RelationBehavior, relation: GraphRelation, event: ContinuityEvent): Promise<void> {
    this.options.graph.emit("relation_behavior.started", { behaviorName: behavior.name, relationId: relation.id, triggeringEventId: event.id }, { actor: "runtime", causedBy: event.id });
    try {
      await behavior.run(relation, { graph: this.options.graph, event, view: this.options.graph.view(behavior.view) });
      this.options.graph.emit("relation_behavior.completed", { behaviorName: behavior.name, relationId: relation.id, triggeringEventId: event.id }, { actor: "runtime", causedBy: event.id });
    } catch (error) {
      this.options.graph.emit("relation_behavior.failed", { behaviorName: behavior.name, relationId: relation.id, triggeringEventId: event.id, errorType: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) }, { actor: "runtime", causedBy: event.id });
    }
  }

  private matchingRelations(behavior: RelationBehavior, event: ContinuityEvent): GraphRelation[] {
    const values = collectStrings(event.payload);
    return this.options.graph.findRelations({ type: behavior.relationType }).filter((relation) => values.has(relation.sourceId) || values.has(relation.targetId));
  }
}

function matchesBehavior(behavior: { on: string[]; where?: Record<string, unknown> }, event: ContinuityEvent): boolean {
  if (behavior.on.length && !behavior.on.includes("*") && !behavior.on.includes(event.type)) return false;
  if (!behavior.where) return true;
  return Object.entries(behavior.where).every(([key, expected]) => event.payload[key] === expected);
}

function collectStrings(value: unknown): Set<string> {
  const out = new Set<string>();
  walk(value, out);
  return out;
}

function walk(value: unknown, out: Set<string>): void {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) for (const item of value) walk(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item, out);
}
