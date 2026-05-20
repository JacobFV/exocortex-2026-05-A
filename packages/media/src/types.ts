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

export interface AudioPlaybackResult {
  playedAt: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CapturedMedia {
  data: Uint8Array;
  filePath: string;
  mimeType: string;
  filename?: string;
  capturedAt: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface MediaCaptureOptions {
  deviceId?: string;
  durationMs?: number;
  outputPath?: string;
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

export interface AudioPlaybackProvider {
  readonly id: string;
  playAudio(input: AudioInput, signal?: AbortSignal): Promise<AudioPlaybackResult>;
}

export interface ImageCaptureProvider {
  readonly id: string;
  captureImage(options?: MediaCaptureOptions, signal?: AbortSignal): Promise<CapturedMedia>;
}

export interface AudioCaptureProvider {
  readonly id: string;
  captureAudio(options?: MediaCaptureOptions, signal?: AbortSignal): Promise<CapturedMedia>;
}

export interface VideoCaptureProvider {
  readonly id: string;
  captureVideo(options?: MediaCaptureOptions, signal?: AbortSignal): Promise<CapturedMedia>;
}
