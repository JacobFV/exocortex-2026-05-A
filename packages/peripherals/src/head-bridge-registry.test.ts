import assert from "node:assert/strict";
import { defaultHeadBridgeConfig } from "@exocortex/hardware";
import { normalizeHeadBridgeFrameValue } from "./head-bridge-serial-source.js";
import { ModalityRegistry } from "./registry.js";

const registry = new ModalityRegistry();
registry.registerDefaultCatalog();
const instances = registry.createHeadBridgeGraph(defaultHeadBridgeConfig());

assert.ok(instances.some((instance) => instance.key === "eeg_ch_0_raw" && instance.kind === "eeg"));
assert.ok(instances.some((instance) => instance.key === "headlamp_pwm" && instance.kind === "lighting"));
assert.ok(instances.some((instance) => instance.key === "laser_enable" && instance.kind === "laser"));
assert.ok(registry.listDeviceInstances().some((device) => device.key === "head_serial_bridge"));
assert.ok(registry.listModalityTypes().some((type) => type.key === "computer_projected_screen" && type.kind === "computer"));

assert.deepEqual(
  normalizeHeadBridgeFrameValue({
    channel: "battery_voltage",
    type: "sensor.analog_sample",
    value: { raw: 2048, value: 2.048, unit: "volts", sample_count: 8 }
  }),
  { raw: 2048, value: 2.048, unit: "volts", sampleCount: 8 }
);

const calibrated = normalizeHeadBridgeFrameValue(
  {
    channel: "battery_voltage",
    type: "sensor.analog_sample",
    value: { raw: 2048, value: 2048, unit: "raw", sample_count: 8 }
  },
  {
    id: "profile",
    name: "profile",
    deviceKey: "head_serial_bridge",
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    calibrations: [{ kind: "analog_linear", channel: "battery_voltage", inputUnit: "raw", outputUnit: "volts", scale: 0.001, offset: 0 }]
  }
);
assert.equal(typeof calibrated, "object");
assert.equal((calibrated as { value: number }).value, 2.048);
