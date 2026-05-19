import type { AgentSessionEventPayload } from "@exocortex/protocol";
import type { ToolCall, ToolDefinition } from "@exocortex/models";
import type { AgentRuntimeContext } from "./agent-runtime.js";

export interface AgentToolExecution {
  output: unknown;
  emittedEvents?: AgentSessionEventPayload[];
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, context: AgentRuntimeContext, call: ToolCall): Promise<AgentToolExecution> | AgentToolExecution;
}

export class AgentToolRouter {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: AgentTool): void {
    if (!tool.definition.name) throw new Error("Tool definition name is required");
    this.tools.set(tool.definition.name, tool);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      ...tool.definition,
      parameters: structuredClone(tool.definition.parameters)
    }));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(call: ToolCall, context: AgentRuntimeContext): Promise<AgentToolExecution> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new Error(`No tool is registered for ${call.name}`);
    return tool.execute(call.arguments, context, call);
  }
}
