# Exocortex

Exocortex is a wearable-first agent runtime. The host can be an Expo device or an Electron/Unix device, while sensors and actuators are connected through serial, USB serial, network protocols, browser sessions, computer sessions, native device APIs, and ESP-class hardware bridges.

The core idea is that an agent session does not receive one generic input stream. It perceives many first-class modalities:

- `app_input_text`
- `device_mic_stt_input_text`
- `ext_mic_1_stt_input_text`
- `ext_mic_2_stt_input_text`
- cameras, EEG, ultrasound, lights/lasers, speakers, haptics, browser screens, and computer sessions

Every observation and action keeps its source modality explicit so the agent can reason about provenance, trust, latency, and routing.

## Workspace

- `apps/electron` - desktop/Unix host shell
- `apps/expo` - wearable/mobile host shell
- `packages/protocol` - shared event, artifact, command, modality, and session types
- `packages/models` - interchangeable model providers for local rules, Ollama, llama.cpp CLI, and OpenAI-compatible APIs
- `packages/media` - STT/TTS providers for OpenAI-compatible audio, local command STT, and macOS speech output
- `packages/transports` - serial framing and Unix serial transport
- `packages/hardware` - head bridge ADC, analog mux, and actuator configuration models
- `packages/calibration` - calibration profiles, sample conversion, and calibration artifacts
- `packages/safety` - actuator arming, power limits, pulse limits, and cooldown gates
- `packages/session` - concurrent agent session manager, modality binding, and in-memory event/artifact store
- `packages/peripherals` - device/modality registry and hardware/host bridge abstractions
- `packages/browser-session` - browser session control abstractions
- `packages/computer-session` - projected computer session control abstractions
- `apps/hardware-cli` - serial hardware inspection, ping/listen, and validated actuation
- `docs/architecture.md` - architecture articulation and naming rationale
- `docs/objectives.md` - durable objective ledger for product, hardware, model, and runtime scope
- `firmware/esp32-head-bridge` - ESP32 firmware for serial JSON frames, analog mux scanning, ADC sampling, and actuator control

## Commands

```sh
npm install
npm run validate
npm run dev:electron
npm run dev:expo
```

The reference repository is expected to live at `refs/command-agi-gamma`. It is ignored by Git and should not be committed.

The session package also includes a JSONL file-backed store for local durable event/artifact logs and an event bus for host subscriptions.
