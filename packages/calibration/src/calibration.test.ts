import assert from "node:assert/strict";
import { defaultHeadBridgeConfig } from "@exocortex/hardware";
import { createId } from "@exocortex/protocol";
import {
  applyAnalogCalibration,
  calibrationProfileArtifact,
  defaultCalibrationProfile,
  deriveLinearCalibration,
  mergeActuatorSafety,
  replaceChannelCalibration,
  validateCalibrationProfile,
  type CalibrationProfile
} from "./index.js";

const now = "2026-05-19T00:00:00.000Z";
const profile: CalibrationProfile = {
  id: "head_profile_rev_a",
  name: "Head bridge revision A",
  deviceKey: "head_serial_bridge",
  createdAt: now,
  updatedAt: now,
  calibrations: [
    {
      kind: "adc_reference",
      channel: "battery_voltage",
      referenceMillivolts: 3300,
      resolutionBits: 12
    },
    {
      kind: "analog_linear",
      channel: "battery_voltage",
      inputUnit: "millivolts",
      outputUnit: "volts",
      scale: 0.002,
      offset: 0,
      clampMin: 0,
      clampMax: 8.4
    },
    {
      kind: "eeg_channel",
      channel: "eeg_ch_0_raw",
      microvoltsPerCount: 0.25,
      baselineMicrovolts: 12.5,
      notchHz: 60,
      bandpassHz: { low: 0.5, high: 40 }
    },
    {
      kind: "actuator_safety",
      channel: "headlamp_pwm",
      maxDuty: 0.35,
      requiresUserArmed: true
    }
  ]
};

const config = defaultHeadBridgeConfig();
validateCalibrationProfile(profile, config);

const battery = applyAnalogCalibration(profile, "battery_voltage", {
  raw: 2048,
  value: 2048,
  unit: "raw",
  sampleCount: 8
});
assert.equal(battery.unit, "volts");
assert.equal(Number(battery.value.toFixed(3)), 3.301);
assert.deepEqual(battery.calibrationIds, ["adc_reference:battery_voltage", "analog_linear:battery_voltage"]);

const eeg = applyAnalogCalibration(profile, "eeg_ch_0_raw", {
  raw: 100,
  value: 100,
  unit: "raw",
  sampleCount: 4
});
assert.equal(eeg.unit, "microvolts");
assert.equal(eeg.value, 12.5);

const saferConfig = mergeActuatorSafety(config, profile);
assert.equal(saferConfig.actuators.find((actuator) => actuator.key === "headlamp_pwm")?.maxDuty, 0.35);

const artifact = calibrationProfileArtifact({
  artifactId: createId("artifact"),
  sessionId: createId("session"),
  profile
});
assert.equal(artifact.kind, "calibration");
assert.equal(artifact.metadata?.calibrationCount, 4);

assert.throws(
  () =>
    validateCalibrationProfile(
      {
        ...profile,
        calibrations: [{ kind: "actuator_safety", channel: "missing", maxDuty: 0.5 }]
      },
      config
    ),
  /not in hardware config/
);

const derived = deriveLinearCalibration({
  channel: "battery_voltage",
  inputUnit: "raw",
  outputUnit: "volts",
  points: [
    { raw: 0, expected: 0 },
    { raw: 1000, expected: 2 },
    { raw: 2000, expected: 4 }
  ]
});
assert.equal(derived.scale, 0.002);
assert.equal(derived.offset, 0);

const template = defaultCalibrationProfile(config, new Date(now));
validateCalibrationProfile(template, config);
assert.ok(template.calibrations.some((calibration) => calibration.kind === "actuator_safety" && calibration.channel === "laser_enable"));
const replaced = replaceChannelCalibration(template, derived, new Date(now));
assert.equal(replaced.calibrations.filter((calibration) => calibration.channel === "battery_voltage" && calibration.kind === "analog_linear").length, 1);
