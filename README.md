# Exocortex

Exocortex is a wearable-first agent runtime. The host can be an Expo device or an Electron/Unix device, while sensors and actuators are connected through serial, BLE, network protocols, browser sessions, native device APIs, and future hardware bridges.

The core idea is that an agent session does not receive one generic input stream. It perceives many first-class modalities:

- `app_input_text`
- `device_mic_stt_input_text`
- `ext_mic_1_stt_input_text`
- `ext_mic_2_stt_input_text`
- cameras, EEG, ultrasound, lights/lasers, speakers, haptics, browser screens, and future computer sessions

Every observation and action keeps its source modality explicit so the agent can reason about provenance, trust, latency, and routing.

## Workspace

- `apps/electron` - desktop/Unix host shell
- `apps/expo` - wearable/mobile host shell
- `packages/protocol` - shared event, artifact, command, modality, and session types
- `packages/session` - concurrent agent session manager, modality binding, and in-memory event/artifact store
- `packages/peripherals` - device/modality registry and hardware/host bridge abstractions
- `packages/browser-session` - browser/computer-session control abstractions
- `docs/architecture.md` - architecture articulation and naming rationale

## Commands

```sh
npm install
npm run validate
npm run dev:electron
npm run dev:expo
```

The reference repository is expected to live at `refs/command-agi-gamma`. It is ignored by Git and should not be committed.
