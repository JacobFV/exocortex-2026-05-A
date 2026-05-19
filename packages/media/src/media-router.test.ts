import assert from "node:assert/strict";
import { MediaRouter } from "./media-router.js";

const router = new MediaRouter();
assert.ok(router.list().stt.includes("openai-stt"));
assert.ok(router.list().tts.includes("openai-tts"));
if (process.platform === "darwin") assert.ok(router.list().tts.includes("macos-say"));
