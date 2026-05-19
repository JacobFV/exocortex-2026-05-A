import assert from "node:assert/strict";
import { defaultHeadBridgeConfig, validateActuatorCommand } from "@exocortex/hardware";
import { ActuatorSafetyGate } from "./actuator-safety.js";

const config = defaultHeadBridgeConfig();
const gate = ActuatorSafetyGate.fromHeadBridgeConfig(config);

assert.throws(
  () => gate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T00:00:00.000Z")),
  /not armed/
);

const grant = gate.arm("laser_enable", "bench alignment", new Date("2026-05-19T00:00:00.000Z"));
assert.equal(grant.channel, "laser_enable");
assert.doesNotThrow(() =>
  gate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T00:00:01.000Z"))
);
assert.throws(
  () => gate.validate("ultrasound_trigger", validateActuatorCommand(config, "ultrasound_trigger", { enabled: true, duty: 1, pulse_us: 20000 }), new Date("2026-05-19T00:00:00.000Z")),
  /maxPulseUs/
);
assert.ok(gate.listPolicies().some((policy) => policy.channel === "ultrasound_trigger" && policy.requiresArm));
