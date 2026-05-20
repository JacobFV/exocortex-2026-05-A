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

## Continuity Kernel Direction

The current runtime is session-centered. The target architecture is continuity-centered. `AgentSessionManager` remains important, but it becomes one actor inside a `ContinuityKernel`.

The continuity kernel owns the event append path, patch proposal and acceptance, branch-scoped graph state, behavior dispatch, capability registry hooks, and policy/approval gates. Events record what happened. Accepted patches record what changed. The graph represents what is true for a branch. Behaviors react to accepted graph changes.

The detailed schema, rejected designs, package refactors, projection rules, behavior rules, branching model, and implementation plan are specified in [continuity-kernel.md](./continuity-kernel.md).

Current session integration is opt-in: `AgentSessionManager` can be constructed with a `ContinuityKernel`, and emitted session events project into the session's `branchId`.

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
- `expo_native_device` -> `expo_native` -> `expo_device_microphone_audio`
- `expo_native_device` -> `expo_native` -> `expo_device_camera_video`
- `expo_native_device` -> `expo_native` -> `expo_device_speaker_audio`
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
- `packages/models` owns interchangeable local and hosted model providers.
- `packages/media` owns STT, TTS, and host media capture providers. Local capture providers can wrap host commands for image, audio, or video capture using `{output}`, `{durationMs}`, `{durationSeconds}`, and `{deviceId}` argument templates.
- `packages/transports` owns serial framing and Unix serial device transport.
- `packages/hardware` owns typed head bridge configuration for ESPs, ADC channels, analog muxes, and actuator outputs.
- `packages/calibration` owns calibration profiles, raw-to-calibrated sample conversion, actuator safety overlays, projection/pointer calibration types, and calibration artifacts.
- `packages/safety` owns actuator arming, output power limits, pulse limits, and cooldown gates before host commands are written to hardware transports.
- `packages/peripherals` is currently the modality/device registry and bridge layer. The package name may later become `packages/modalities` or `packages/hardware`, but the code now models modalities as the first-class primitive.
- `packages/session` owns concurrent long-running agent sessions, lifecycle transitions, modality binding, observation/action event emission, artifact recording, event subscriptions, bridge routing, and the runtime callback interface.
- `packages/browser-session` owns projected controllable browser/computer-session abstractions, lifecycle events, action dispatch, and screen projection frames.
- `packages/computer-session` owns projected controllable non-browser computer sessions, pointer/keyboard actions, lifecycle events, and screen projection frames.
- `packages/continuity` owns the continuity kernel foundation: branch-scoped graph state, patch proposal and acceptance, in-memory and SQLite graph stores, event projection, and behavior hooks.
- Continuity behaviors currently include failure-review and unsupported-claim patch proposal primitives.
- `apps/hardware-cli` owns direct serial hardware operations for bench work: config printing, frame listening, bridge inspection/ping, and validated actuator commands.
- `apps/electron` and `apps/expo` are host shells that create a default host graph and bind every live modality into a new session.
- `firmware/esp32-head-bridge` is the ESP32 bridge firmware matching the host serial protocol and default hardware config.

## Expo Native Device Bridges

Expo native device integration is modeled as typed modality bridges owned by `apps/expo`. The bridge constructors accept concrete Expo/native modules by dependency injection and expose microphone, camera, and speaker modalities through the same `ModalityBridge` contract as hardware transports.

On startup each bridge emits a real `device.capability` observation and, when available, a `device.permission` observation from the underlying module. Missing native modules or unavailable capabilities are reported as unavailable observations; the app does not synthesize microphone samples, camera frames, or speaker playback results. Supported actions are routed to the injected module methods and emit completion or unavailable observations.

## Storage

Agent sessions can use in-memory stores for tests, JSONL stores for simple local durability, or `SQLiteAgentSessionStore` for production local persistence. The SQLite store initializes its schema on open, uses append-only `agent_session_events` and `agent_session_artifacts` tables, preserves event ordering by session sequence, and allows repeated artifact IDs because artifacts are an evented log, not a mutable key/value table.

## Calibration Operations

Calibration is both a runtime package and an operator workflow. `packages/calibration` can generate a default profile from the head bridge config, validate profile files, derive linear channel transforms from measured raw/expected pairs, replace per-channel calibrations, and apply profiles to raw samples. `apps/hardware-cli` exposes those operations as `calibration-template`, `calibration-validate`, `calibration-derive-linear`, and `calibration-apply-sample`.

## Hardware Bridge Protocol

ESP-class bridges use newline-delimited JSON frames over serial. Sensor frames and actuator commands share the same envelope:

```json
{"channel":"battery_voltage","type":"sensor.analog_sample","timestamp":"2026-05-19T00:00:00.000Z","value":{"raw":1234,"value":1.234,"unit":"volts","sampleCount":8}}
```

```json
{"channel":"headlamp_pwm","type":"actuator.command","timestamp":"2026-05-19T00:00:00.000Z","value":{"enabled":true,"duty":0.4}}
```

The host routes inbound frames by `channel` into matching modality instances. Outbound `modality.action` events are routed through registered action sinks and written back to the bridge.

Calibration is applied outside the serial envelope. The bridge remains a raw hardware transport, while `packages/calibration` records the profile used to convert raw ADC/mux/EEG samples into agent-visible values and to tighten actuator limits before commands reach the serial writer.

`HeadBridgeSerialSource` normalizes firmware sample payloads into host `AnalogSample` shape before events reach sessions. When constructed with a calibration profile it emits calibrated values and preserves raw values/calibration identifiers in the observation payload.

The checked-in ESP32 firmware header is generated from `packages/hardware` with `npm run generate:head-bridge-config`. `packages/hardware` tests compare the generated header against `firmware/esp32-head-bridge/include/bridge_config.h`, so host pin maps, channel keys, actuator limits, and firmware constants fail validation if they drift.

## Implemented Runtime Contract

The default runtime is a continuous local runtime. A started session stays running until stopped, and observations delivered through a bound modality are appended to the session event stream and delivered to the runtime. The runtime contract is intentionally host-agnostic:

- `start(context)` owns lifecycle and can block until the abort signal fires.
- `handleObservation(context, event)` receives modality observations.
- `handleActionResult(context, event)` is reserved for actuator/tool result delivery.

Production LLM runtimes plug into that contract without changing the session/event/modality model.

The Ollama and OpenAI-compatible providers consume real response streams. Text deltas are emitted as they arrive, and OpenAI-compatible streamed tool-call fragments are accumulated into tool-call events before the runtime marks the stream done.

Model-driven sessions use an `AgentToolRouter`. Tool definitions are supplied to each model turn, tool calls are recorded as `tool_call.started`, `tool_call.completed`, or `tool_call.failed`, and successful tool outputs are appended as tool messages before the next bounded model pass.

Electron installs concrete browser tools into that router. A model can create or select a projected Electron browser session, then call tools for navigation, clicks, typing, key presses, scrolling, JavaScript evaluation, and frame capture. Those tool calls also emit browser session events into the agent event log.

## Reference Learnings From `refs/command-agi-gamma`

The reference checkout is intentionally ignored by Git at `refs/command-agi-gamma`. The most important patterns adopted here are:

- Static type definitions and runtime instances should be separate.
- A session manager should support multiple simultaneous sessions instead of assuming one active agent.
- Tool execution and device/environment control should be routed through explicit runtime objects.
- Browser control should be modeled as a projected controllable session, not as phone control.
- Content/events should preserve multimodal provenance and artifacts.

The main intentional divergence is that Exocortex promotes modalities above tools. In command-agi-gamma, most capability structure is represented through peripherals and tool schemas. For Exocortex, a capability may still become a tool, but the raw sensory/actuator channel itself is a durable session object.

## Validation

Local validation is `npm run validate`. CI additionally regenerates the ESP32 bridge header and fails if it differs from the checked-in firmware header, then builds the PlatformIO ESP32 firmware.
