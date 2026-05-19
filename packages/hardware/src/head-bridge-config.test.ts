import assert from "node:assert/strict";
import { actuatorCommandFrame, analogSampleFrame, defaultHeadBridgeConfig, validateHeadBridgeConfig } from "./head-bridge-config.js";

const config = defaultHeadBridgeConfig();
validateHeadBridgeConfig(config);

assert.equal(config.muxes[0]?.channels[0]?.key, "eeg_ch_0_raw");
assert.equal(analogSampleFrame("battery_voltage", { raw: 1234, value: 1.234, unit: "volts", sampleCount: 8 }).type, "sensor.analog_sample");
assert.equal(actuatorCommandFrame("laser_enable", { enabled: true }).type, "actuator.command");

assert.throws(() => validateHeadBridgeConfig({ ...config, baudRate: 0 }), /baudRate/);
