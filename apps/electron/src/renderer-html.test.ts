import assert from "node:assert/strict";
import { renderHtml } from "./renderer-html.js";

const html = renderHtml();

assert.match(html, /<main class="app">/);
for (const tab of ["timeline", "modalities", "browser", "media", "safety", "calibration", "graph", "artifacts"]) {
  assert.match(html, new RegExp(`data-tab="${tab}"`));
  assert.match(html, new RegExp(`id="view-${tab}"`));
}

for (const action of [
  "select-session",
  "stop-session",
  "create-browser",
  "capture-browser",
  "navigate-browser",
  "capture-image",
  "capture-audio",
  "capture-video",
  "synthesize-speech",
  "transcribe-artifact",
  "arm-actuator",
  "send-action",
  "accept-calibration",
  "apply-graph-filter"
]) {
  assert.match(html, new RegExp(`data-action="${action}"`));
}

for (const preloadApi of [
  "createSession",
  "stopSession",
  "listSessions",
  "listEvents",
  "listBindings",
  "listArtifacts",
  "listMediaProviders",
  "captureMedia",
  "synthesizeSpeech",
  "transcribeArtifact",
  "listModels",
  "listModalities",
  "transportHealth",
  "listContinuityObjects",
  "listContinuityRelations",
  "listContinuityEvents",
  "injectAppText",
  "sendModalityAction",
  "armActuator",
  "listActuatorSafety",
  "listCalibrationProfiles",
  "acceptCalibrationProfile",
  "createBrowserSession",
  "listBrowserSessions",
  "browserDispatch",
  "browserCapture",
  "onSessionEvent",
  "onContinuityEvent",
  "onBrowserEvent"
]) {
  assert.ok(html.includes(`window.exocortex.${preloadApi}`), `expected renderer to call ${preloadApi}`);
}

assert.doesNotMatch(html, /<pre id=/);
