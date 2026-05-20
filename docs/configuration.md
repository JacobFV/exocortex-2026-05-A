# Configuration

Runtime secrets and machine-specific settings live outside committed source.

## Local Env

Use `config/local/.env` for local-only values. Start from:

```sh
cp config/examples/env.example config/local/.env
chmod 600 config/local/.env
```

Load it before running live model, media, or hardware commands:

```sh
set -a
. config/local/.env
set +a
npm run dev:electron
```

`config/local/` and root `.env*` files are ignored by Git. Keep API keys, serial paths, and machine-local database/blob paths there.

## Important Keys

- `OPENAI_API_KEY` enables OpenAI-compatible model, STT, and TTS providers.
- `EXOCORTEX_OLLAMA_MODEL` selects the default Ollama model.
- `EXOCORTEX_LLAMA_CPP_COMMAND` and `EXOCORTEX_LLAMA_CPP_ARGS` enable llama.cpp CLI models.
- `EXOCORTEX_HEAD_BRIDGE_SERIAL` and `EXOCORTEX_HEAD_BRIDGE_BAUD` attach the live ESP/head bridge.
- `EXOCORTEX_IMAGE_CAPTURE_COMMAND`, `EXOCORTEX_AUDIO_CAPTURE_COMMAND`, and `EXOCORTEX_VIDEO_CAPTURE_COMMAND` register command-backed capture providers.
- `EXOCORTEX_AUDIO_PLAYBACK_COMMAND` registers command-backed audio playback for host speaker actions.
- `EXOCORTEX_STT_BRIDGE_ENABLED=1` starts the Electron continuous STT bridge, using configured audio capture and STT providers to feed microphone transcript modalities.
- `EXOCORTEX_EVENT_GRAPH_DB`, `EXOCORTEX_AGENT_SESSION_DB`, and `EXOCORTEX_ARTIFACT_BLOB_DIR` override durable local storage paths.

## Credential Hygiene

If a key is ever printed in logs or chat, rotate it. Provider errors are redacted in code, but shell commands and malformed env files can still leak raw values before the runtime sees them.
