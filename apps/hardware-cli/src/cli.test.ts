import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultCalibrationProfile } from "@exocortex/calibration";
import { defaultHeadBridgeConfig } from "@exocortex/hardware";
import { parseHardwareCliArgs, runHardwareCli } from "./index.js";

assert.deepEqual(parseHardwareCliArgs(["config"]), { name: "config" });

assert.deepEqual(parseHardwareCliArgs(["calibration-derive-linear", "--profile", "profile.json", "--channel", "battery_voltage", "--input-unit", "raw", "--output-unit", "volts", "--points", "0:0,2000:4"]), {
  name: "calibration-derive-linear",
  profile: "profile.json",
  output: undefined,
  channel: "battery_voltage",
  inputUnit: "raw",
  outputUnit: "volts",
  points: [
    { raw: 0, expected: 0 },
    { raw: 2000, expected: 4 }
  ]
});

assert.deepEqual(parseHardwareCliArgs(["listen", "--port", "/dev/cu.usbserial"]), {
  name: "listen",
  port: "/dev/cu.usbserial",
  baudRate: 115200
});

assert.deepEqual(parseHardwareCliArgs(["inspect", "--port", "/dev/cu.usbserial", "--duration-ms", "250"]), {
  name: "inspect",
  port: "/dev/cu.usbserial",
  baudRate: 115200,
  durationMs: 250
});

assert.deepEqual(parseHardwareCliArgs(["actuate", "--port", "/dev/cu.usbserial", "--channel", "headlamp_pwm", "--enabled", "true", "--duty", "0.25"]), {
  name: "actuate",
  port: "/dev/cu.usbserial",
  baudRate: 115200,
  channel: "headlamp_pwm",
  value: { enabled: true, duty: 0.25 },
  durationMs: 500
});

assert.throws(() => parseHardwareCliArgs(["actuate", "--port", "/dev/cu.usbserial", "--channel", "headlamp_pwm", "--duty", "1"]), /maxDuty/);
assert.throws(() => parseHardwareCliArgs(["listen"]), /Missing --port/);

const dir = mkdtempSync(join(tmpdir(), "exocortex-hardware-cli-"));
try {
  const profilePath = join(dir, "profile.json");
  await runHardwareCli({ name: "calibration-template", output: profilePath }, () => {});
  const template = JSON.parse(readFileSync(profilePath, "utf8")) as { deviceKey?: string };
  assert.equal(template.deviceKey, "head_serial_bridge");

  const lines: string[] = [];
  await runHardwareCli({ name: "calibration-validate", profile: profilePath }, (line) => lines.push(line));
  assert.match(lines[0] ?? "", /"status":"ok"/);

  writeFileSync(profilePath, JSON.stringify(defaultCalibrationProfile(defaultHeadBridgeConfig())), "utf8");
  await runHardwareCli({
    name: "calibration-derive-linear",
    profile: profilePath,
    channel: "battery_voltage",
    inputUnit: "raw",
    outputUnit: "volts",
    points: [
      { raw: 0, expected: 0 },
      { raw: 2000, expected: 4 }
    ]
  });
  const sampleLines: string[] = [];
  await runHardwareCli({ name: "calibration-apply-sample", profile: profilePath, channel: "battery_voltage", raw: 1000, value: 1000, unit: "raw", sampleCount: 8 }, (line) => sampleLines.push(line));
  assert.equal(JSON.parse(sampleLines[0] ?? "{}").value, 2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
