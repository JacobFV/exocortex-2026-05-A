import { useMemo, useRef, useState } from "react";
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { ModalityRegistry } from "@exocortex/peripherals";
import { AgentSessionManager, ModalityObservationRouter } from "@exocortex/session";
import { createExpoNativeDeviceBridges } from "./native-device-bridge";

export default function App() {
  const registry = useMemo(() => {
    const next = new ModalityRegistry();
    next.createDefaultExpoGraph();
    return next;
  }, []);
  const manager = useMemo(() => new AgentSessionManager(), []);
  const observationRouter = useMemo(() => new ModalityObservationRouter(manager), [manager]);
  const nativeBridges = useMemo(() => createExpoNativeDeviceBridges(registry.listModalityInstances()), [registry]);
  const nativeBridgesAttached = useRef(false);
  const [goal, setGoal] = useState("Run wearable exocortex agent session.");
  const [snapshot, setSnapshot] = useState("");

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
    setSnapshot(JSON.stringify({
      sessions: manager.list(),
      events: manager.events(session.id),
      devices: registry.listDeviceInstances(),
      modalities: registry.listModalityInstances()
    }, null, 2));
  }

  return (
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
        <View style={{ borderColor: "#2b333a", borderWidth: 1, padding: 12 }}>
          <Text style={{ color: "#eef2f4", fontFamily: "Courier" }}>{snapshot || "No session yet."}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
