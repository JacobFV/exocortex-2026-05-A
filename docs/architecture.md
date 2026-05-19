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

### Devices, Modalities, Bindings

Command AGI has a strong `PeripheralType` / `PeripheralInstance` split. Exocortex keeps that split but makes the semantic channel more explicit because a head-mounted wearable will have too many sensors and actuators for "peripheral" to be precise enough.

The hierarchy is:

```txt
DeviceType
  -> DeviceInstance
      -> ModalityType
          -> ModalityInstance
              -> AgentSessionModalityBinding
```

Examples:

- `host_unix_device` -> `host` -> `app_input_text`
- `host_unix_device` -> `host` -> `device_mic_stt_input_text`
- `serial_microcontroller` -> `head_serial_bridge` -> `ext_mic_1_stt_input_text`
- `serial_microcontroller` -> `head_serial_bridge` -> `ext_mic_2_stt_input_text`
- `browser_session` -> `browser_...` -> `browser_projected_screen`
- `browser_session` -> `browser_...` -> `browser_control_input`

The binding is what an agent session actually receives or controls. It captures policy and provenance for that session: observe, control, observe-and-control, or disabled.

### `agent_session_modalities`

The preferred name is `modalities`, not `peripherals`.

Reasoning:

- Some sources are not hardware peripherals. `app_input_text` is UI, browser screen projection is a session surface, and an LLM tool result can be virtual.
- Sensors and actuators should share one routing model.
- The same hardware can expose several modalities. A microphone can expose raw audio, VAD, diarization, and STT text.
- The agent needs provenance at the semantic channel level, not just at the device level.

Each modality type and instance has a direction:

- `input` - produces observations.
- `output` - receives actions.
- `duplex` - both.

Each modality also has a kind: text, audio, video, image, sensor, actuator, browser, computer, haptic, lighting, laser, ultrasound, eeg, serial, system, or custom.

This lets the app preserve source separation even when values have the same semantic shape. `app_input_text`, `device_mic_stt_input_text`, `ext_mic_1_stt_input_text`, and `ext_mic_2_stt_input_text` can all deliver text observations, but they are different modality instances and session bindings. The event log records the binding on every observation.

## Browser and Computer Sessions

Agents manage browser and computer sessions as projected controllable environments. The abstraction is not "phone control"; it is a session surface:

- Capture/project screen frames.
- Receive pointer, touch, keyboard, and text input events from a host device.
- Execute browser actions such as navigation, click, type, key, scroll, and evaluate.
- Emit events back into the agent session with the browser session id and modality id.

The same event model covers local desktop, remote VM, containerized browser, AR display, and embedded Linux computer sessions.

## Current Package Mapping

- `packages/protocol` defines the durable protocol: devices, modality types/instances/bindings, sessions, events, artifacts, browser sessions, and IDs.
- `packages/peripherals` is currently the modality/device registry and bridge layer. The package name may later become `packages/modalities` or `packages/hardware`, but the code now models modalities as the first-class primitive.
- `packages/session` owns concurrent long-running agent sessions, lifecycle transitions, modality binding, observation/action event emission, artifact recording, event subscriptions, bridge routing, and the runtime callback interface.
- `packages/browser-session` owns projected controllable browser/computer-session abstractions, lifecycle events, action dispatch, and screen projection frames.
- `apps/electron` and `apps/expo` are host shells that create a default host graph and bind every live modality into a new session.

## Implemented Runtime Contract

The default runtime is a continuous local runtime. A started session stays running until stopped, and observations delivered through a bound modality are appended to the session event stream and delivered to the runtime. The runtime contract is intentionally host-agnostic:

- `start(context)` owns lifecycle and can block until the abort signal fires.
- `handleObservation(context, event)` receives modality observations.
- `handleActionResult(context, event)` is reserved for actuator/tool result delivery.

Production LLM runtimes plug into that contract without changing the session/event/modality model.

## Reference Learnings From `refs/command-agi-gamma`

The reference checkout is intentionally ignored by Git at `refs/command-agi-gamma`. The most important patterns adopted here are:

- Static type definitions and runtime instances should be separate.
- A session manager should support multiple simultaneous sessions instead of assuming one active agent.
- Tool execution and device/environment control should be routed through explicit runtime objects.
- Browser control should be modeled as a projected controllable session, not as phone control.
- Content/events should preserve multimodal provenance and artifacts.

The main intentional divergence is that Exocortex promotes modalities above tools. In command-agi-gamma, most capability structure is represented through peripherals and tool schemas. For Exocortex, a capability may still become a tool, but the raw sensory/actuator channel itself is a durable session object.
