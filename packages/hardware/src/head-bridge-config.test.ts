import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateEsp32BridgeConfigHeader } from "./firmware-config.js";
import { actuatorCommandFrame, analogSampleFrame, defaultHeadBridgeConfig, validateActuatorCommand, validateHeadBridgeConfig } from "./head-bridge-config.js";

const config = defaultHeadBridgeConfig();
validateHeadBridgeConfig(config);

assert.equal(config.muxes[0]?.channels[0]?.key, "eeg_ch_0_raw");
assert.equal(analogSampleFrame("battery_voltage", { raw: 1234, value: 1.234, unit: "volts", sampleCount: 8 }).type, "sensor.analog_sample");
assert.equal(actuatorCommandFrame("laser_enable", { enabled: true }).type, "actuator.command");
assert.deepEqual(validateActuatorCommand(config, "headlamp_pwm", { enabled: true, duty: 0.5 }), { enabled: true, duty: 0.5 });
assert.throws(() => validateActuatorCommand(config, "headlamp_pwm", { enabled: true, duty: 1 }), /maxDuty/);

assert.throws(() => validateHeadBridgeConfig({ ...config, baudRate: 0 }), /baudRate/);

const generatedHeader = generateEsp32BridgeConfigHeader(config);
assert.match(generatedHeader, /#define EXOCORTEX_BRIDGE_ID "head_serial_bridge"/);
assert.match(generatedHeader, /"battery_voltage", 35, "volts", 0.001f, 0.0f, 8/);
assert.match(generatedHeader, /"ultrasound_trigger", 22, ActuatorKind::UltrasoundTrigger/);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const checkedInHeader = readFileSync(resolve(repoRoot, "firmware/esp32-head-bridge/include/bridge_config.h"), "utf8");
assert.equal(checkedInHeader, generatedHeader);
