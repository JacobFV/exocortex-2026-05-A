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
- Runtime/model-specific graph context policies, retention limits, compaction reports, and prompt budget pruning.
- Evaluation suites and suite-run comparisons for repeatable model/tool/runtime scoring fixtures.
- Live modality route controls in Electron; policies can switch between observe, control, duplex, and disabled.
- Opt-in live model smoke command via `npm run smoke:live -w @exocortex/models`.
- Opt-in continuous Electron STT bridge from configured audio capture and STT providers into microphone transcript modalities.
- Browser projection captures are persisted as image artifacts.
- Artifact blob integrity verification and age/session-aware garbage collection.
- SQLite forward migrations with versioned migration records and query-index migration steps.
- Opt-in actuator approval lifecycle in `@exocortex/safety`, plus Electron pre-execution approval UI/API required by default for actuator commands.
- Hardware CLI `bench-smoke` command for attached ESP/head-bridge validation runs.
- ESP32-S3 devkit firmware environment with USB CDC serial enabled and configured head I/O disabled for protocol bring-up.
- Real ESP32-S3 devkit bench smoke passed on `/dev/ttyACM0`: ping, pong, heartbeat frames, zero framing errors.
- OpenAI-compatible live model smoke passed with the rotated local key.
- Host media modalities for microphone audio, camera image/video, and speaker audio are registered and bound to sessions.
- Electron media capture emits modality observations and persisted artifacts; host speaker actions support TTS synthesis and command-backed audio playback.
- Blob repair tooling can rebuild artifact blobs from replacement data or trusted existing data.
- Continuity exports filter by object data, relation type, frame id, session id, modality key, event type, object type, and time window.
- Self-modification promotion requires an approved operator approval object.
- Simulation/retry frames and simulation run records are graph-native.

## Remaining Work

### Runtime Intelligence

- Wire evaluation suites to real provider execution harnesses for Ollama, llama.cpp, and OpenAI-compatible models after valid local/provider configuration is present.

### Host Experience

- Replace the inline string-rendered Electron dashboard with a real renderer bundle, component tests, and browser-level smoke tests.
- Add richer graph inspection: saved filters, object detail drill-down, relation traversal, frame/evaluation comparison views, and export from UI.
- Expand Expo parity beyond JSON views: wearable-usable navigation, live event subscriptions that do not require manual refresh, graph/safety/artifact detail screens, and media controls.

### Models And Media

- Add TTS/speaker output modality sinks for Expo session actions.
- Add Expo camera/video/image capture bridges that emit modality observations and persisted artifacts automatically.
- Add browser recording artifacts from projected browser sessions.

### Physical Device Bring-Up

- Run `exocortex-hardware bench-smoke` against the production head bridge pin map with actual ADCs, analog multiplexers, microphones, speakers, cameras, EEG front ends, ultrasound triggers, headlamps, lasers, and haptics.
- Validate calibrated samples flowing from firmware to serial frames to modality observations to EventGraph evidence.
- Validate gated actuator actions flowing from session events through safety grants and firmware commands.
- Add hardware-in-the-loop tests for firmware protocol compatibility, framing error recovery, reconnects, and actuator safety limits.
- Add operator-visible device identity and transport health workflows for multiple physical bridge devices.

### Storage And Operations

- Add encrypted-at-rest option for local blobs and SQLite databases where platform support exists.
- Add opt-in live checks for media commands and attached hardware; model live checks and hardware bench smoke commands now exist.

### Safety And Calibration

- Add calibration acceptance UX that previews profile diffs, supersession lineage, and affected channels before accepting.
- Add runtime enforcement of actuator safety calibration overlays, not just analog sample calibration and safety gate defaults.
- Add audit views for command limits, pulse limits, cooldown decisions, grant use, grant expiry, revocation, and denied commands.

## Recommended Next Steps

1. Add a real Electron renderer bundle and Playwright smoke tests for session creation, model health, browser projection, media capture, calibration acceptance, and safety audit views.
2. Build Expo TTS/speaker action sinks and Expo camera/video/image artifact observation bridges.
3. Bring up one physical ESP head bridge with `exocortex-hardware bench-smoke`, then validate calibrated input plus one safe actuator output end to end.
4. Wire evaluation suites into automated provider/tool/policy execution harnesses.
5. Add encrypted-at-rest storage options and live checks for configured media commands.

## Acceptance Bar

- `npm run validate` passes.
- `npm run generate:head-bridge-config` produces no firmware header diff.
- No secrets are committed; local secrets remain under ignored `config/local/`.
- No legacy shim packages or old continuity store APIs.
- All host-observed values preserve modality provenance.
- Hazardous actuator output cannot bypass validation, graph-backed grants, and the approval workflow.
- EventGraph state is replayable from append-only events.
