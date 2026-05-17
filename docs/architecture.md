# Exocortex Architecture

## Goal

Exocortex is a wearable agent app. A Unix-like host, either Electron on a desktop-class device or Expo on a phone/head-worn device, coordinates agent sessions and hardware bridges. Microcontrollers fan out from the host over serial, BLE, USB, network, or custom protocols to cameras, microphones, speakers, EEG sensors, ultrasound transducers, headlamps/lasers, and other sensors and actuators mounted on the head.

The app is fundamentally an agent runtime with an agent-managed frontend. UI is not the center of the system; it is one modality among many. Text typed into the app, speech recognized from the device microphone, speech recognized from external microphones, browser screenshots, EEG windows, and actuator feedback are all explicit observations in the same event log.

## Reference Pattern

The accessible JacobFV AGI driver architecture uses:

- A self-contained driver/runtime that owns environment capture and action execution.
- Thin SDK or host wrappers that spawn/control the runtime and subscribe to events.
- A JSONL-style event protocol with state changes, thinking, actions, questions, confirmations, errors, and finished events.
- A clear state machine: idle, running, paused, waiting for confirm, waiting for answer, finished, stopped, error.
- A separation between agent, executor/session state, protocol, and environment/device control.

Exocortex keeps that shape, but generalizes "environment" into many typed modalities and allows multiple concurrent sessions.

## Core Data Model

### `agent_sessions`

An agent session is the unit of agent execution. It has a goal, lifecycle state, timestamps, model/runtime metadata, and a set of bound modalities.

Multiple sessions can run simultaneously. A session manager starts, pauses, resumes, stops, and lists sessions without assuming there is only one active agent.

### `agent_session_events`

The event log is append-only. It includes:

- Streaming assistant text deltas.
- Tool call start/delta/result/error events.
- Modality observations from sensors and UI inputs.
- Modality actions sent to outputs and actuators.
- Browser/computer-session projection and input events.
- State changes, confirmations, questions, artifacts, errors, and final results.

### `agent_session_artifacts`

Artifacts are durable products of a session: files, images, audio clips, transcripts, logs, screenshots, browser recordings, calibration data, and structured JSON.

### `agent_session_modalities`

The preferred name is `modalities`, not `peripherals`.

Reasoning:

- Some sources are not hardware peripherals. `app_input_text` is UI, browser screen projection is a session surface, and an LLM tool result can be virtual.
- Sensors and actuators should share one routing model.
- The same hardware can expose several modalities. A microphone can expose raw audio, VAD, diarization, and STT text.
- The agent needs provenance at the semantic channel level, not just at the device level.

Each modality has a direction:

- `input` - produces observations.
- `output` - receives actions.
- `duplex` - both.

Each modality also has a kind: text, audio, video, image, sensor, actuator, browser, computer, haptic, lighting, ultrasound, eeg, serial, system, or custom.

## Browser and Computer Sessions

Agents should be able to manage browser sessions now, with future support for other computer session types. The abstraction is not "phone control"; it is a projected controllable session:

- Capture/project screen frames.
- Receive pointer, touch, keyboard, and text input events from a host device.
- Execute browser actions such as navigation, click, type, key, scroll, and evaluate.
- Emit events back into the agent session with the browser session id and modality id.

This leaves room for future local desktop, remote VM, containerized browser, AR display, or embedded Linux computer sessions without changing the agent event model.
