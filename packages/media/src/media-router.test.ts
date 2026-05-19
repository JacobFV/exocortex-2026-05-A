import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalCommandAudioCaptureProvider,
  LocalCommandImageCaptureProvider,
  LocalCommandVideoCaptureProvider,
  localCommandCaptureConfigFromEnv
} from "./local-command-capture.js";
import { MediaRouter } from "./media-router.js";

const router = new MediaRouter();
assert.ok(router.list().stt.includes("openai-stt"));
assert.ok(router.list().tts.includes("openai-tts"));
if (process.platform === "darwin") assert.ok(router.list().tts.includes("macos-say"));

const fixtureDir = mkdtempSync(join(tmpdir(), "exocortex-media-test-"));
try {
  const writeFixture = "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], Buffer.from(`capture:${process.argv[2] ?? ''}:${process.argv[3] ?? ''}`));";

  const imageProvider = new LocalCommandImageCaptureProvider({
    id: "test-image",
    command: process.execPath,
    args: ["-e", writeFixture, "{output}", "{durationMs}", "{deviceId}"],
    mimeType: "image/png"
  });
  const image = await imageProvider.captureImage({ durationMs: 1250, deviceId: "camera-1", outputPath: join(fixtureDir, "image.png") });
  assert.equal(image.mimeType, "image/png");
  assert.equal(image.filename, "image.png");
  assert.equal(new TextDecoder().decode(image.data), "capture:1250:camera-1");
  assert.equal(image.durationMs, 1250);
  assert.equal(image.metadata?.deviceId, "camera-1");

  const audioProvider = new LocalCommandAudioCaptureProvider({
    id: "test-audio",
    command: process.execPath,
    args: ["-e", writeFixture],
    mimeType: "audio/wav"
  });
  const audio = await audioProvider.captureAudio({ outputPath: join(fixtureDir, "audio.wav") });
  assert.equal(audio.mimeType, "audio/wav");
  assert.equal(new TextDecoder().decode(audio.data), "capture::");

  const videoProvider = new LocalCommandVideoCaptureProvider({
    id: "test-video",
    command: process.execPath,
    args: ["-e", writeFixture, "{output}", "{durationSeconds}", "{deviceId}"],
    mimeType: "video/mp4"
  });
  const video = await videoProvider.captureVideo({ durationMs: 2500, deviceId: "screen-1", outputPath: join(fixtureDir, "video.mp4") });
  assert.equal(video.mimeType, "video/mp4");
  assert.equal(new TextDecoder().decode(video.data), "capture:2.5:screen-1");

  router.registerImageCapture(imageProvider);
  router.registerAudioCapture(audioProvider);
  router.registerVideoCapture(videoProvider);
  assert.equal(router.imageCapture("test-image"), imageProvider);
  assert.equal(router.audioCapture("test-audio"), audioProvider);
  assert.equal(router.videoCapture("test-video"), videoProvider);
  assert.ok(router.list().imageCapture.includes("test-image"));
  assert.ok(router.list().audioCapture.includes("test-audio"));
  assert.ok(router.list().videoCapture.includes("test-video"));

  const envConfig = localCommandCaptureConfigFromEnv("image", {
    EXOCORTEX_IMAGE_CAPTURE_COMMAND: process.execPath,
    EXOCORTEX_IMAGE_CAPTURE_ARGS: JSON.stringify(["-e", writeFixture, "{output}"]),
    EXOCORTEX_IMAGE_CAPTURE_MIME_TYPE: "image/jpeg",
    EXOCORTEX_IMAGE_CAPTURE_EXTENSION: "jpg"
  });
  assert.equal(envConfig?.command, process.execPath);
  assert.equal(envConfig?.mimeType, "image/jpeg");
  assert.deepEqual(envConfig?.args, ["-e", writeFixture, "{output}"]);
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
