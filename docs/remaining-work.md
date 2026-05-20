# Remaining Work Ledger

This file is the durable backlog for Exocortex. Keep it concrete and git-referentiable so context loss does not erase scope.

## Recently Closed Foundations

These are implemented and covered by repository validation, but still need product hardening in real deployments:

- EventGraph context assembly for agents, scoped by session, goal, modality, frame, capability kind, and recent causality.
- Evaluation objects, frame comparison, and self-modification proposal/promotion with passing-evaluation provenance.
- Additional EventGraph behaviors for self-modification evaluation, failed evaluations, safety denials, uncalibrated sensor evidence, and media artifacts missing durable blobs.
- Electron operator dashboard for sessions, events, modalities, browser projection, media, safety audit, calibration profiles, transport health, graph inspection, and artifacts.
- SQLite-backed Electron agent sessions plus file-backed artifact blob storage.
- Operator CLI filtered continuity exports.
- Runtime attachment of accepted graph calibration profiles to the live head-bridge serial source.
- Safety denial audit objects for rejected actuator actions.
- Serial transport health counters, framing error recovery, bounded write queue, optional reconnect, and device identity capture.
- Expo live views for sessions, events, modalities, artifacts, and EventGraph state.
- Local env layout: real secrets live in ignored `config/local/.env`; tracked examples live in `config/examples/env.example`.

## Remaining Work

### Runtime Intelligence

- Make graph context assembly configurable per model/runtime policy instead of the current fixed Electron context provider.
- Add scored evaluation suites for model/tool selection that run repeatable fixtures across local-rules, Ollama, llama.cpp, and OpenAI-compatible providers.
- Add automated retry/simulation frames that can re-run a task under alternate capabilities or policies and record evaluations without manual orchestration.
- Add a guarded operator approval step before promotion applies self-modification patches in production, even when an evaluation passes.
- Add retention/compaction policies for graph context so long-running sessions do not overfill prompts.

### Host Experience

- Replace the inline string-rendered Electron dashboard with a real renderer bundle, component tests, and browser-level smoke tests.
- Add modality routing controls that can enable/disable bindings, change observe/control policy, and show route health per session.
- Add graph-backed approval UI for hazardous actions before execution, not just grant/denial audit views after arming or rejection.
- Add richer graph inspection: saved filters, object detail drill-down, relation traversal, frame/evaluation comparison views, and export from UI.
- Expand Expo parity beyond JSON views: wearable-usable navigation, live event subscriptions that do not require manual refresh, graph/safety/artifact detail screens, and media controls.

### Models And Media

- Replace the invalid local `OPENAI_API_KEY` in `config/local/.env`; live OpenAI-compatible model test currently fails with `401 invalid_api_key`.
- Add live-model smoke commands that can be run intentionally against configured providers without leaking secrets.
- Add real microphone STT bridges for `device_mic_stt_input_text`, `ext_mic_1_stt_input_text`, and `ext_mic_2_stt_input_text`; current STT is provider-level and artifact transcription, not continuous bridge ingestion.
- Add real TTS/speaker output modality sinks for Electron and Expo.
- Add Electron and Expo camera/video/image capture bridges that emit modality observations and persisted artifacts automatically.
- Add browser screenshot/recording artifacts from projected browser sessions, not only manual capture artifacts.

### Physical Device Bring-Up

- Bench validate against actual ESP-class boards, ADCs, analog multiplexers, microphones, speakers, cameras, EEG front ends, ultrasound triggers, headlamps, lasers, and haptics.
- Validate calibrated samples flowing from firmware to serial frames to modality observations to EventGraph evidence.
- Validate gated actuator actions flowing from session events through safety grants and firmware commands.
- Add hardware-in-the-loop tests for firmware protocol compatibility, framing error recovery, reconnects, and actuator safety limits.
- Add operator-visible device identity and transport health workflows for multiple physical bridge devices.

### Storage And Operations

- Add real schema migration steps beyond version markers, including forward migrations for existing development databases.
- Add artifact garbage collection and retention policies tied to event/graph provenance.
- Add blob integrity verification and repair tooling using stored SHA-256 hashes.
- Add encrypted-at-rest option for local blobs and SQLite databases where platform support exists.
- Add richer continuity export filters by object data fields, relation type, frame id, session id, modality key, and time window.
- Add CI/live-check separation: normal CI remains deterministic; opt-in live checks cover model providers, media commands, and attached hardware.

### Safety And Calibration

- Add a pre-execution approval workflow for hazardous actuator commands, including explicit operator confirmation, expiry, and revocation.
- Add calibration acceptance UX that previews profile diffs, supersession lineage, and affected channels before accepting.
- Add runtime enforcement of actuator safety calibration overlays, not just analog sample calibration and safety gate defaults.
- Add audit views for command limits, pulse limits, cooldown decisions, grant use, grant expiry, revocation, and denied commands.

## Recommended Next Steps

1. Rotate and replace the exposed OpenAI key in `config/local/.env`, then run an opt-in live model smoke check.
2. Add a real Electron renderer bundle and Playwright smoke tests for session creation, model health, browser projection, media capture, calibration acceptance, and safety audit views.
3. Build continuous STT/TTS modality bridges and route them through session observations/actions with persisted media artifacts.
4. Bring up one physical ESP head bridge on the bench and validate calibrated input plus one safe actuator output end to end.
5. Implement graph-backed hazardous-action approval before execution, using safety grants as one input rather than the whole workflow.

## Acceptance Bar

- `npm run validate` passes.
- `npm run generate:head-bridge-config` produces no firmware header diff.
- No secrets are committed; local secrets remain under ignored `config/local/`.
- No legacy shim packages or old continuity store APIs.
- All host-observed values preserve modality provenance.
- Hazardous actuator output cannot bypass validation, graph-backed grants, and the approval workflow once implemented.
- EventGraph state is replayable from append-only events.
