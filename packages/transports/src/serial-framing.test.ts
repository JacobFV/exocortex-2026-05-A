import assert from "node:assert/strict";
import { encodeSerialFrame, SerialFrameDecoder } from "./serial-framing.js";

const decoder = new SerialFrameDecoder();
const frame = { channel: "ext_mic_1_stt_input_text", type: "text.final", value: { text: "hello" } };
const encoded = encodeSerialFrame(frame);

assert.equal(encoded.endsWith("\n"), true);
assert.deepEqual(decoder.push(encoded.slice(0, 10)), []);
assert.deepEqual(decoder.push(encoded.slice(10)), [frame]);
