# Exocortex Handoff

This file exists because chat context is disposable. Treat it as the compact project memory for continuing work from another machine.

## North Star

Exocortex is a wearable-first, agent-managed computing system. A Unix-like host, through Electron or Expo, coordinates a head-mounted device tree of microcontrollers, sensors, and actuators: microphones, cameras, speakers, EEG, ADCs, analog muxes, ultrasound triggers, headlamps, lasers, haptics, browser sessions, and projected computer sessions.

The product is not a chat app with hardware bolted on. It is a persistent agent runtime whose frontend, typed user input, microphones, cameras, browser screens, serial sensors, and actuators are all first-class modalities.

## Architectural Commitments

- The durable source of truth is append-only events.
- Graph state is replayed from events.
- The continuity substrate is EventGraph: objects, relations, patches, frames, capabilities, policies, safety grants, calibration profiles, evidence, failures, tasks, evaluations, and artifacts all live in one operational graph.
- User input is just another modality.
- Modalities are first-class and source-specific. `app_input_text`, `device_mic_stt_input_text`, `ext_mic_1_stt_input_text`, and `ext_mic_2_stt_input_text` may all produce text, but must remain distinct sources.
- Browser and computer sessions are projected controllable environments, not phone-control abstractions.
- Models must be interchangeable across local offline and hosted providers.
- Safety and calibration are operational graph state, not ad hoc side channels.
- No legacy compatibility layer should be preserved when it conflicts with the correct architecture.

## Things Not To Reintroduce

- Do not bring back `@exocortex/peripherals`; the package is `@exocortex/modalities`.
- Do not bring back the old `ContinuityStore`, `ContinuityKernel`, or mutable continuity node/edge/patch tables.
- Do not re-center the app around chat messages.
- Do not flatten different input sources into one generic user text stream.
- Do not let hazardous actuator output bypass modality actions, safety validation, and graph-backed grants.

## Current Implemented State

The repo currently includes:

- Electron and Expo host apps.
- Shared protocol package for sessions, events, artifacts, modalities, browser/computer sessions, and IDs.
- Concurrent agent session manager with event/artifact stores and event bus.
- Model runtime with local rules, Ollama, llama.cpp CLI, and OpenAI-compatible streaming providers.
- Tool routing with model-visible tool definitions and tool-call events.
- Browser session manager and Electron browser tools.
- Computer session abstraction.
- Device/modality registry and host/head-bridge modality bridges.
- Serial framing and Unix serial transport.
- Hardware config for ESP-style head bridge, ADCs, analog muxes, and actuators.
- Calibration profiles, sample conversion, actuator safety overlays, and calibration artifacts.
- Actuator safety gate.
- EventGraph continuity runtime:
  - `EventSourcedGraph`
  - `EventGraphKernel`
  - SQLite and in-memory event stores
  - graph objects, relations, patches, frames, snapshots, views
  - session-event projection into graph state
  - capability registry
  - operational safety/calibration state
  - default continuity behaviors
- Graph context assembly is wired into Electron model turns.
- Evaluation objects, frame comparison, and self-modification promotion primitives are implemented.
- Electron uses SQLite-backed session persistence and file-backed artifact blob storage.
- Electron operator dashboard includes sessions, events, modalities, browser projection, media, safety audit, calibration, transport health, graph inspection, and artifacts.
- Expo has live views for sessions, events, modalities, graph state, and artifacts.
- Serial transport exposes health counters, framing error recovery, bounded write queue, optional reconnect, and device identity capture.
- Operator CLI for continuity run listing, summaries, and export files.
- Hardware CLI for config, serial inspection, ping/listen, actuation, and calibration operations.
- Electron push events for session and continuity updates.
- ESP32-S3 devkit firmware environment supports USB CDC protocol bring-up with configured head I/O disabled.

## Current Important Commits

Recent architectural commits:

```txt
22da402 Tighten secret redaction
63cfda7 Redact provider secret errors
1ecbc69 Add filtered exports and Expo graph views
cf7df41 Harden serial transport health
5023f61 Wire Electron media artifacts
1018ef5 Add artifact blobs and schema migrations
5cee09a Expand continuity behavior coverage
c875bf5 Add graph context and evaluation promotion
6683318 Audit rejected actuator actions
d292983 Attach graph calibration to serial bridge
ffb7d98 Expose real model health
64c3ed7 Record operator browser actions
2daddb3 Split Electron renderer HTML
3bf9920 Persist Electron agent sessions
d690616 Build Electron operator dashboard
9291add Push Electron session and continuity events
c65d5e5 Add operator continuity CLI
c262962 Add continuity run export format
dafe448 Add event graph continuity behaviors
b9177c5 Record remaining implementation ledger
088d3b0 Update README continuity description
a83d243 Harden event graph projection invariants
13a2451 Rename modalities and refresh continuity spec
10fa0d8 Cut continuity runtime to event graph
d95a212 Add event-sourced continuity graph runtime
```

## Durable Docs

Read these before making large changes:

- `docs/objectives.md`
- `docs/configuration.md`
- `docs/architecture.md`
- `docs/continuity-kernel.md`
- `docs/remaining-work.md`
- `README.md`

## Remaining Work

The durable backlog is `docs/remaining-work.md`. The highest-leverage next work is:

1. Replace inline Electron HTML with a real renderer bundle and browser-level smoke tests.
2. Build Expo TTS/speaker action sinks plus Expo camera/video/image artifact observation bridges.
3. Bring up the production head bridge pin map with actual sensors/actuators, then validate calibrated samples plus gated actuator output end to end.
4. Wire evaluation suites into automated provider/tool/policy execution harnesses.
5. Add encrypted-at-rest storage options and live checks for configured media commands.
6. Add richer graph inspection UI with saved filters, object detail drill-down, relation traversal, and frame/evaluation comparison views.

Recent local commits after the configuration cleanup:

```txt
be16633 Require self-mod approval and simulation runs
0b64d0a Add artifact repair and export filters
c7b46a5 Add host media modality actions
6b2e342 Require Electron actuator approvals
302186f Add hardware bench smoke command
b0a4b46 Add SQLite forward migrations
53b7e71 Wire browser artifacts and STT bridge
86786b5 Add artifact integrity and retention
dd47292 Add runtime context policies and eval suites
57af0ce Add actuator approval lifecycle
fb795ae Add opt-in live model smoke check
b6ca07c Add live modality route controls
b09e7cd Use runtime SQLite without fallback stores
a70d634 Make Expo Android bundle mobile-safe
```

Latest local hardware validation:

- Flashed ESP32-S3 devkit on `/dev/ttyACM0` with the `esp32s3` PlatformIO environment.
- `bench-smoke` received `system.pong` plus heartbeat frames with zero framing errors.
- Android USB testing is still blocked by host enumeration: `adb devices -l` is empty and `lsusb` does not show an Android device.

## Local Configuration

Local secrets are in ignored `config/local/.env`. Use `config/examples/env.example` as the template. Do not reintroduce a root committed `.env`.

## Validation Habit

Before stopping work:

```sh
npm run validate
git status --short --branch
```

Commit and push. Chat is not durable.
