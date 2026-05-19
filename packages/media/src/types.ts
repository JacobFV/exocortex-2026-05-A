export interface AudioInput {
  data: Uint8Array;
  mimeType: string;
  filename?: string;
}

export interface TranscriptResult {
  text: string;
  language?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface SpeechOutput {
  data?: Uint8Array;
  filePath?: string;
  mimeType: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface STTProvider {
  readonly id: string;
  transcribe(input: AudioInput, signal?: AbortSignal): Promise<TranscriptResult>;
}

export interface TTSProvider {
  readonly id: string;
  synthesize(text: string, signal?: AbortSignal): Promise<SpeechOutput>;
}
