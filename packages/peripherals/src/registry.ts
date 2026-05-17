import {
  createId,
  defaultTextInputModalities,
  type AgentSessionModality,
  type AgentSessionModalityId
} from "@exocortex/protocol";

export type ModalityDefinition = Omit<AgentSessionModality, "id"> & {
  id?: AgentSessionModalityId;
};

export class ModalityRegistry {
  private readonly modalities = new Map<AgentSessionModalityId, AgentSessionModality>();
  private readonly idsByKey = new Map<string, AgentSessionModalityId>();

  register(definition: ModalityDefinition): AgentSessionModality {
    const id = definition.id ?? createId<"AgentSessionModalityId">("mod");
    if (this.idsByKey.has(definition.key)) {
      throw new Error(`Modality key already registered: ${definition.key}`);
    }

    const modality: AgentSessionModality = { ...definition, id };
    this.modalities.set(id, modality);
    this.idsByKey.set(modality.key, id);
    return modality;
  }

  registerDefaults(): AgentSessionModality[] {
    return defaultTextInputModalities.map((definition) => this.register(definition));
  }

  get(id: AgentSessionModalityId): AgentSessionModality | undefined {
    const modality = this.modalities.get(id);
    return modality ? { ...modality, capabilities: [...modality.capabilities] } : undefined;
  }

  getByKey(key: string): AgentSessionModality | undefined {
    const id = this.idsByKey.get(key);
    return id ? this.get(id) : undefined;
  }

  list(): AgentSessionModality[] {
    return [...this.modalities.values()].map((modality) => ({ ...modality, capabilities: [...modality.capabilities] }));
  }
}
