import { MacOSSayTTSProvider } from "./local-command-audio.js";
import { OpenAISTTProvider, OpenAITTSProvider } from "./openai-audio.js";
import type { STTProvider, TTSProvider } from "./types.js";

export class MediaRouter {
  private readonly sttProviders = new Map<string, STTProvider>();
  private readonly ttsProviders = new Map<string, TTSProvider>();

  constructor() {
    this.registerSTT(new OpenAISTTProvider({ id: "openai-stt" }));
    this.registerTTS(new OpenAITTSProvider({ id: "openai-tts" }));
    if (process.platform === "darwin") this.registerTTS(new MacOSSayTTSProvider());
  }

  registerSTT(provider: STTProvider): void {
    this.sttProviders.set(provider.id, provider);
  }

  registerTTS(provider: TTSProvider): void {
    this.ttsProviders.set(provider.id, provider);
  }

  stt(id = process.env.EXOCORTEX_STT_PROVIDER ?? "openai-stt"): STTProvider {
    const provider = this.sttProviders.get(id);
    if (!provider) throw new Error(`Unknown STT provider: ${id}`);
    return provider;
  }

  tts(id = process.env.EXOCORTEX_TTS_PROVIDER ?? (process.platform === "darwin" ? "macos-say" : "openai-tts")): TTSProvider {
    const provider = this.ttsProviders.get(id);
    if (!provider) throw new Error(`Unknown TTS provider: ${id}`);
    return provider;
  }

  list(): { stt: string[]; tts: string[] } {
    return {
      stt: [...this.sttProviders.keys()],
      tts: [...this.ttsProviders.keys()]
    };
  }
}
