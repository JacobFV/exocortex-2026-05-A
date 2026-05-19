import assert from "node:assert/strict";
import { parseHardwareCliArgs } from "./index.js";

assert.deepEqual(parseHardwareCliArgs(["config"]), { name: "config" });

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
