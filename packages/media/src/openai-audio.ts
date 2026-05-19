import type { AudioInput, SpeechOutput, STTProvider, TranscriptResult, TTSProvider } from "./types.js";

export interface OpenAIAudioConfig {
  id: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  sttModel?: string;
  ttsModel?: string;
  voice?: string;
}

export class OpenAISTTProvider implements STTProvider {
  readonly id: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: OpenAIAudioConfig) {
    this.id = config.id;
    this.apiKey = config.apiKey ?? process.env[config.apiKeyEnv ?? "OPENAI_API_KEY"];
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.sttModel ?? "gpt-4o-mini-transcribe";
  }

  async transcribe(input: AudioInput, signal?: AbortSignal): Promise<TranscriptResult> {
    if (!this.apiKey) throw new Error(`Missing API key for STT provider ${this.id}`);
    const form = new FormData();
    form.set("model", this.model);
    const bytes = new Uint8Array(input.data);
    form.set("file", new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: input.mimeType }), input.filename ?? "audio.wav");
    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal
    });
    if (!response.ok) throw new Error(`STT failed: ${response.status} ${await response.text()}`);
    const payload = (await response.json()) as { text?: string; language?: string; duration?: number };
    return {
      text: payload.text ?? "",
      language: payload.language,
      durationMs: payload.duration ? payload.duration * 1000 : undefined
    };
  }
}

export class OpenAITTSProvider implements TTSProvider {
  readonly id: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly voice: string;

  constructor(config: OpenAIAudioConfig) {
    this.id = config.id;
    this.apiKey = config.apiKey ?? process.env[config.apiKeyEnv ?? "OPENAI_API_KEY"];
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.ttsModel ?? "gpt-4o-mini-tts";
    this.voice = config.voice ?? "alloy";
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SpeechOutput> {
    if (!this.apiKey) throw new Error(`Missing API key for TTS provider ${this.id}`);
    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: this.model, voice: this.voice, input: text, format: "wav" }),
      signal
    });
    if (!response.ok) throw new Error(`TTS failed: ${response.status} ${await response.text()}`);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      mimeType: "audio/wav"
    };
  }
}
