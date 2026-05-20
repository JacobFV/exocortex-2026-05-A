import assert from "node:assert/strict";
import { NodeSerialTransport } from "./node-serial-transport.js";
import { encodeSerialFrame, SerialFrameDecoder } from "./serial-framing.js";

const decoder = new SerialFrameDecoder();
const frame = { channel: "ext_mic_1_stt_input_text", type: "text.final", value: { text: "hello" } };
const encoded = encodeSerialFrame(frame);

assert.equal(encoded.endsWith("\n"), true);
assert.deepEqual(decoder.push(encoded.slice(0, 10)), []);
assert.deepEqual(decoder.push(encoded.slice(10)), [frame]);

const recoveryDecoder = new SerialFrameDecoder();
assert.deepEqual(recoveryDecoder.push("not-json\n"), []);
assert.equal(recoveryDecoder.framingErrors, 1);
assert.deepEqual(recoveryDecoder.push(encoded), [frame]);

const transport = new NodeSerialTransport({ path: "/dev/does-not-exist", baudRate: 115200, maxWriteQueue: 2 });
assert.deepEqual(transport.health(), {
  path: "/dev/does-not-exist",
  baudRate: 115200,
  open: false,
  framesReceived: 0,
  framesSent: 0,
  framingErrors: 0,
  reconnectAttempts: 0,
  writeQueueDepth: 0,
  lastFrameAt: undefined,
  lastError: undefined,
  deviceIdentity: undefined
});
