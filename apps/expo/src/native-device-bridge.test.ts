import assert from "node:assert/strict";
import type { ModalityInstance } from "@exocortex/protocol";
import { ModalityRegistry } from "@exocortex/modalities";
import {
  createExpoCameraBridge,
  createExpoMicrophoneBridge,
  createExpoNativeDeviceBridges,
  createExpoSpeakerBridge,
  type ExpoPermissionResponse
} from "./native-device-bridge";

const registry = new ModalityRegistry();
const modalities = registry.createDefaultExpoGraph();

const microphone = requireModality("expo_device_microphone_audio");
const camera = requireModality("expo_device_camera_video");
const speaker = requireModality("expo_device_speaker_audio");

async function main(): Promise<void> {
  const unavailableObservations: unknown[] = [];
  const unavailableMic = createExpoMicrophoneBridge(microphone);
  unavailableMic.subscribe((observation) => unavailableObservations.push(observation));
  await unavailableMic.start();
  await unavailableMic.send("recording.start", {});
  assert.equal(unavailableObservations.length, 2);
  assert.equal((unavailableObservations[0] as { observationType: string }).observationType, "device.capability");
  assert.equal((unavailableObservations[1] as { observationType: string }).observationType, "device.action_unavailable");

  let permissionRequested = false;
  let cameraCaptured = false;
  const granted: ExpoPermissionResponse = { status: "granted", granted: true, canAskAgain: false };
  const cameraBridge = createExpoCameraBridge(camera, {
    getCameraPermissionsAsync: async () => granted,
    requestCameraPermissionsAsync: async () => {
      permissionRequested = true;
      return granted;
    },
    takePictureAsync: async () => {
      cameraCaptured = true;
      return { uri: "file:///real-capture.jpg" };
    }
  });
  await cameraBridge.start();
  await cameraBridge.send("permission.request", undefined);
  await cameraBridge.send("image.capture", { quality: 0.5 });
  assert.equal(permissionRequested, true);
  assert.equal(cameraCaptured, true);

  const cameraUnsupportedObservations: unknown[] = [];
  cameraBridge.subscribe((observation) => cameraUnsupportedObservations.push(observation));
  await cameraBridge.send("preview.set_enabled", true);
  assert.equal(
    (cameraUnsupportedObservations.at(-1) as { observationType: string }).observationType,
    "device.action_unavailable"
  );

  let speakerPlayed = false;
  const speakerBridge = createExpoSpeakerBridge(speaker, {
    playAsync: async (value) => {
      speakerPlayed = (value as { uri?: string }).uri === "file:///clip.wav";
    }
  });
  await speakerBridge.start();
  await speakerBridge.send("audio.play", { uri: "file:///clip.wav" });
  assert.equal(speakerPlayed, true);

  assert.equal(createExpoNativeDeviceBridges(modalities).length, 3);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function requireModality(key: string): ModalityInstance {
  const modality = modalities.find((candidate) => candidate.key === key);
  assert.ok(modality);
  return modality;
}
