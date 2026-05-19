# Exocortex Objectives

This file is the durable scope ledger for Exocortex. It exists so the system objective survives context resets and implementation sessions.

## Product

Exocortex is a wearable, agent-managed computing system. A Unix-like host runs an Expo or Electron app and coordinates a head-mounted device tree of microcontrollers, sensors, and actuators.

The application is an agent runtime first. The frontend is another agent-managed modality, not the center of the architecture.

## Host Apps

- Electron host for desktop-class Unix devices.
- Expo host for mobile/head-worn devices.
- Shared protocol and runtime packages used by both hosts.
- Multiple concurrent agent sessions.
- Host APIs for sessions, events, artifacts, modality bindings, browser sessions, and hardware bridge state.
- Frontend event subscription rather than polling-only behavior.

## Agent Core

- `agent_sessions` as the unit of execution.
- `agent_session_events` as append-only event logs.
- `agent_session_artifacts` as durable outputs.
- Long-running sessions that can receive observations after startup.
- Streaming assistant messages.
- Streaming tool calls, tool results, and tool failures.
- Tool definitions passed into model requests.
- Tool-call execution through a host-owned router.
- Tool results fed back into the agent conversation before the next model pass.
- Session state transitions: idle, starting, running, paused, waiting_confirm, waiting_answer, finished, stopped, error.
- Runtime interchangeability across local offline models and third-party hosted models.
- Model providers:
  - offline local rules model for baseline operation
  - Ollama local HTTP models
  - llama.cpp-style local CLI models
  - OpenAI-compatible hosted APIs
  - custom providers through the same interface
- HTTP model providers must consume streaming responses rather than blocking on full completions.

## Modalities

Modalities are first-class session objects. The same physical device can expose many modalities, and the same semantic value shape can come from many distinct sources.

Required default modalities:

- `app_input_text`
- `device_mic_stt_input_text`
- `ext_mic_1_stt_input_text`
- `ext_mic_2_stt_input_text`
- `browser_projected_screen`
- `browser_control_input`

Required modality categories:

- text
- audio
- video
- image
- sensor
- actuator
- browser
- computer
- haptic
- lighting
- laser
- ultrasound
- eeg
- serial
- system
- custom

Every observation and action must preserve:

- session id
- binding id
- modality instance id
- source device when present
- source modality key
- timestamp
- value
- metadata

## Hardware Device Tree

The hardware stack includes:

- Unix-like host device.
- ESP-class microcontrollers.
- ADCs.
- analog multiplexers.
- integrated host cameras, microphones, and speakers.
- external cameras.
- external microphones and speakers.
- EEG front ends.
- ultrasound transducers.
- headlamps and lasers.
- haptics and other actuators.
- other head-mounted sensors.

The host must support:

- serial transport
- USB serial transport
- BLE-capable transport boundary
- framed JSON messages
- per-channel routing into modality observations
- outbound actuator actions
- explicit failure when a configured physical device is unavailable
- operator CLI access for config inspection, frame listening, bridge ping/inspection, and validated actuator commands.

## ESP Bridge Firmware

The ESP bridge firmware must:

- speak the same newline-delimited JSON frame protocol as the host.
- scan analog channels through configurable analog multiplexers.
- sample ADC channels.
- publish sensor frames with channel keys matching host modality keys.
- accept actuator commands for digital outputs, PWM outputs, lasers, headlamps, haptics, and ultrasound trigger pins.
- emit heartbeat frames.
- report boot and configuration state.
- use generated configuration from the host hardware package so firmware constants and host modality keys do not drift.

## Browser And Computer Sessions

Agents must manage projected controllable sessions:

- browser sessions
- computer sessions
- screen projection frames
- pointer events
- touch events
- keyboard events
- text input
- navigation
- JavaScript evaluation where appropriate
- browser create/list/navigate/click/type/key/scroll/evaluate/capture tools exposed to model-driven agents.

The current Electron host must use a real Electron browser controller, not synthetic screen data.

## Storage

The system must support:

- in-memory stores for tests.
- JSONL file-backed event and artifact stores for local durable operation.
- session artifacts for text, JSON, images, audio, video, screenshots, browser recordings, sensor logs, and calibration data.
- CI validation for monorepo build/tests, generated firmware config drift, and ESP32 firmware compilation.

## Calibration And Safety

The system must store calibration artifacts for:

- analog channel scaling.
- ADC conversion.
- analog multiplexer maps.
- EEG channel maps.
- ultrasound timing and trigger parameters.
- light/laser output limits.
- screen projection dimensions.
- pointer/touch coordinate maps.

Laser, headlamp, ultrasound, and other actuator outputs must be command-gated through explicit modality actions and must be represented in the event log.

The calibration runtime must provide:

- versioned calibration profiles per physical device.
- linear analog transforms with clamping.
- ADC reference conversion.
- EEG baseline and gain conversion.
- firmware sample normalization before agent perception.
- actuator safety overlays that can only reduce configured output power.
- projection and pointer coordinate calibration.
- session artifacts that persist the calibration profile used by an agent run.

## Reference Architecture

`refs/command-agi-gamma` is the local reference checkout. It is not committed into this repository.

Adopted architecture principles:

- separate static type definitions from runtime instances.
- route all capabilities through explicit runtime objects.
- keep event logs append-only.
- preserve multimodal provenance.
- model browser/computer sessions as controllable projected environments.
- support local and hosted agent execution under one protocol.
