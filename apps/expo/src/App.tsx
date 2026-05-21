import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { EventGraphKernel, EventSourcedGraph, InMemoryEventSourcedGraphStore, createDefaultContinuityBehaviors, createDefaultContinuityRelationBehaviors } from "@exocortex/continuity/mobile";
import { ModalityRegistry } from "@exocortex/modalities/mobile";
import type { AgentSessionId } from "@exocortex/protocol";
import { AgentSessionManager, ModalityObservationRouter } from "@exocortex/session/mobile";
import { createExpoNativeDeviceBridges } from "./native-device-bridge";

export default function App() {
  const registry = useMemo(() => {
    const next = new ModalityRegistry();
    next.createDefaultExpoGraph();
    return next;
  }, []);
  const eventGraph = useMemo(() => new EventSourcedGraph({ runId: "expo", store: new InMemoryEventSourcedGraphStore() }), []);
  const eventGraphKernel = useMemo(() => new EventGraphKernel({
    graph: eventGraph,
    behaviors: createDefaultContinuityBehaviors(),
    relationBehaviors: createDefaultContinuityRelationBehaviors()
  }), [eventGraph]);
  const manager = useMemo(() => new AgentSessionManager({ eventGraphKernel }), [eventGraphKernel]);
  const observationRouter = useMemo(() => new ModalityObservationRouter(manager), [manager]);
  const nativeBridges = useMemo(() => createExpoNativeDeviceBridges(registry.listModalityInstances()), [registry]);
  const nativeBridgesAttached = useRef(false);
  const [goal, setGoal] = useState("Run wearable exocortex agent session.");
  const [selectedView, setSelectedView] = useState<"sessions" | "events" | "modalities" | "graph" | "artifacts">("sessions");
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const refresh = () => setSnapshot(buildSnapshot());
    const unsubscribeSession = manager.subscribe("*", refresh);
    const unsubscribeGraph = eventGraph.subscribe(refresh);
    refresh();
    return () => {
      unsubscribeSession();
      unsubscribeGraph();
      eventGraphKernel.close();
    };
  }, [eventGraph, eventGraphKernel, manager]);

  async function startSession() {
    const session = manager.create({ goal, runtime: { provider: "local", model: "local-rules", driver: "model-driven-agent-runtime" } });
    for (const modality of registry.listModalityInstances()) {
      manager.bindModality(session.id, registry.bindToSession({ sessionId: session.id, modalityInstanceId: modality.id }));
    }
    if (!nativeBridgesAttached.current) {
      for (const bridge of nativeBridges) {
        observationRouter.attachBridge(bridge);
      }
      nativeBridgesAttached.current = true;
    }
    observationRouter.bindSession(session.id, manager.listBindings(session.id));
    await manager.start(session.id);
    await Promise.all(nativeBridges.map((bridge) => bridge.refreshCapability()));
    setActiveSessionId(session.id);
    setSnapshot(buildSnapshot(session.id));
  }

  function buildSnapshot(sessionId = activeSessionId): Record<string, unknown> {
    return {
      sessions: manager.list(),
      events: sessionId ? manager.events(sessionId as AgentSessionId) : [],
      artifacts: sessionId ? manager.artifacts(sessionId as AgentSessionId) : [],
      devices: registry.listDeviceInstances(),
      modalities: registry.listModalityInstances(),
      graph: eventGraph.snapshot()
    };
  }

  function visibleSnapshot(): unknown {
    if (selectedView === "sessions") return { sessions: snapshot.sessions };
    if (selectedView === "events") return { events: snapshot.events };
    if (selectedView === "artifacts") return { artifacts: snapshot.artifacts };
    if (selectedView === "modalities") return { devices: snapshot.devices, modalities: snapshot.modalities };
    return snapshot.graph;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#101418" }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Text style={{ color: "#eef2f4", fontSize: 28, fontWeight: "700" }}>Exocortex</Text>
          <TextInput
            value={goal}
            onChangeText={setGoal}
            multiline
            style={{ minHeight: 92, color: "#eef2f4", borderColor: "#2b333a", borderWidth: 1, padding: 10 }}
          />
          <Button title="Start agent session" onPress={startSession} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(["sessions", "events", "modalities", "graph", "artifacts"] as const).map((view) => (
              <Button key={view} title={view} onPress={() => setSelectedView(view)} />
            ))}
          </View>
          <View style={{ borderColor: "#2b333a", borderWidth: 1, padding: 12 }}>
            <Text style={{ color: "#eef2f4", fontFamily: "Courier" }}>{JSON.stringify(visibleSnapshot(), null, 2)}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
