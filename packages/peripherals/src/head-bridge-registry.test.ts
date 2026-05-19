import assert from "node:assert/strict";
import { defaultHeadBridgeConfig } from "@exocortex/hardware";
import { ModalityRegistry } from "./registry.js";

const registry = new ModalityRegistry();
registry.registerDefaultCatalog();
const instances = registry.createHeadBridgeGraph(defaultHeadBridgeConfig());

assert.ok(instances.some((instance) => instance.key === "eeg_ch_0_raw" && instance.kind === "eeg"));
assert.ok(instances.some((instance) => instance.key === "headlamp_pwm" && instance.kind === "lighting"));
assert.ok(instances.some((instance) => instance.key === "laser_enable" && instance.kind === "laser"));
assert.ok(registry.listDeviceInstances().some((device) => device.key === "head_serial_bridge"));
