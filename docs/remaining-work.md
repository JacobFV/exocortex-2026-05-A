# Remaining Work Ledger

This file is the durable backlog for Exocortex. Keep it concrete and git-referentiable so context loss does not erase scope.

## Runtime Intelligence

- Expand EventGraph-native behaviors beyond the implemented unsupported-claim, contradiction, stale-evidence, hazardous-action, failure-review, and dependency-unblocking primitives.
- Evaluation objects and frame/run comparison for retries, simulations, policy experiments, and model/tool selection experiments.
- Promotion flow for self-modification: propose prompt/policy/behavior changes, run comparison frames, record evaluation, apply the winning patch with provenance.
- Rich graph views for agent context assembly: scoped by session, goal, modality, frame, capability set, and recent causality.

## Host Experience

- Production Electron UI for live sessions, streaming events, graph inspection, modality routing, browser projection, safety grants, calibration state, and artifacts.
- Expo UI parity for wearable/mobile operation.
- Push/event subscription path in the UI so host screens are not polling-only.

## Physical Device Bring-Up

- Bench validation against actual ESP-class boards, ADCs, analog multiplexers, microphones, speakers, cameras, EEG front ends, ultrasound triggers, headlamps, lasers, and haptics.
- Serial/BLE/USB transport hardening with reconnects, backpressure, device identity, framing error counters, and operator-visible health.
- End-to-end hardware tests for calibrated samples flowing into session observations and gated actuator actions flowing out to firmware.

## Media

- Real STT bridges for device mic and external mic text modalities.
- Real TTS/speaker output modalities.
- Camera/video/image capture bridges for Electron and Expo hosts.
- Artifact persistence for media clips, screenshots, browser recordings, sensor logs, and calibration outputs.

## Storage And Operations

- SQLite-backed artifact storage alongside event storage.
- Event graph export format and operator run-summary/export commands are implemented; add richer filtered exports.
- Migration strategy for local production databases while the schema is still moving quickly.
- CI coverage for firmware config drift and, when toolchains are installed, ESP32 firmware compilation.

## Safety And Calibration

- Operator workflows for accepting calibration profiles into the EventGraph.
- Runtime attachment of accepted calibration profiles to live serial modality bridges.
- Graph-backed approval UI for hazardous actions.
- Safety event audit views for grants, denials, command limits, pulse limits, and cooldowns.

## Acceptance Bar

- `npm run validate` passes.
- No legacy shim packages or old continuity store APIs.
- All host-observed values preserve modality provenance.
- Hazardous actuator output cannot bypass validation and graph-backed grants.
- EventGraph state is replayable from append-only events.
