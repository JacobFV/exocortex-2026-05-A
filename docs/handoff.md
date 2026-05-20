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
- Operator CLI for continuity run listing, summaries, and export files.
- Hardware CLI for config, serial inspection, ping/listen, actuation, and calibration operations.
- Electron push events for session and continuity updates.

## Current Important Commits

Recent architectural commits:

```txt
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
- `docs/architecture.md`
- `docs/continuity-kernel.md`
- `docs/remaining-work.md`
- `README.md`

## Remaining Work

The durable backlog is `docs/remaining-work.md`. The highest-leverage next work is:

1. Build a real production Electron UI over the existing runtime.
2. Add richer graph context assembly for agents.
3. Add evaluation objects and frame/run comparison.
4. Implement self-modification promotion flow with provenance.
5. Bring up real physical devices and harden transports.
6. Build real STT/TTS/camera/media bridges.
7. Attach accepted calibration profiles to live serial modality bridges.
8. Add graph-backed approval UI and audit views for hazardous actions.
9. Add richer operator graph inspection and filtered exports.
10. Add production artifact blob/file storage.

## Validation Habit

Before stopping work:

```sh
npm run validate
git status --short --branch
```

Commit and push. Chat is not durable.
