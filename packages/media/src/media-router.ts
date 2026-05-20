import {
  LocalCommandAudioCaptureProvider,
  LocalCommandImageCaptureProvider,
  LocalCommandVideoCaptureProvider,
  localCommandCaptureConfigFromEnv
} from "./local-command-capture.js";
import { LocalCommandAudioPlaybackProvider, MacOSSayTTSProvider, localCommandAudioPlaybackConfigFromEnv } from "./local-command-audio.js";
import { OpenAISTTProvider, OpenAITTSProvider } from "./openai-audio.js";
import type { AudioCaptureProvider, AudioPlaybackProvider, ImageCaptureProvider, STTProvider, TTSProvider, VideoCaptureProvider } from "./types.js";

export class MediaRouter {
  private readonly sttProviders = new Map<string, STTProvider>();
  private readonly ttsProviders = new Map<string, TTSProvider>();
  private readonly imageCaptureProviders = new Map<string, ImageCaptureProvider>();
  private readonly audioCaptureProviders = new Map<string, AudioCaptureProvider>();
  private readonly videoCaptureProviders = new Map<string, VideoCaptureProvider>();
  private readonly audioPlaybackProviders = new Map<string, AudioPlaybackProvider>();

  constructor() {
    this.registerSTT(new OpenAISTTProvider({ id: "openai-stt" }));
    this.registerTTS(new OpenAITTSProvider({ id: "openai-tts" }));
    if (process.platform === "darwin") this.registerTTS(new MacOSSayTTSProvider());
    const imageCapture = localCommandCaptureConfigFromEnv("image");
    if (imageCapture) this.registerImageCapture(new LocalCommandImageCaptureProvider(imageCapture));
    const audioCapture = localCommandCaptureConfigFromEnv("audio");
    if (audioCapture) this.registerAudioCapture(new LocalCommandAudioCaptureProvider(audioCapture));
    const videoCapture = localCommandCaptureConfigFromEnv("video");
    if (videoCapture) this.registerVideoCapture(new LocalCommandVideoCaptureProvider(videoCapture));
    const audioPlayback = localCommandAudioPlaybackConfigFromEnv();
    if (audioPlayback) this.registerAudioPlayback(new LocalCommandAudioPlaybackProvider(audioPlayback));
  }

  registerSTT(provider: STTProvider): void {
    this.sttProviders.set(provider.id, provider);
  }

  registerTTS(provider: TTSProvider): void {
    this.ttsProviders.set(provider.id, provider);
  }

  registerImageCapture(provider: ImageCaptureProvider): void {
    this.imageCaptureProviders.set(provider.id, provider);
  }

  registerAudioCapture(provider: AudioCaptureProvider): void {
    this.audioCaptureProviders.set(provider.id, provider);
  }

  registerVideoCapture(provider: VideoCaptureProvider): void {
    this.videoCaptureProviders.set(provider.id, provider);
  }

  registerAudioPlayback(provider: AudioPlaybackProvider): void {
    this.audioPlaybackProviders.set(provider.id, provider);
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

  imageCapture(id = process.env.EXOCORTEX_IMAGE_CAPTURE_PROVIDER ?? "local-command-image"): ImageCaptureProvider {
    const provider = this.imageCaptureProviders.get(id);
    if (!provider) throw new Error(`Unknown image capture provider: ${id}`);
    return provider;
  }

  audioCapture(id = process.env.EXOCORTEX_AUDIO_CAPTURE_PROVIDER ?? "local-command-audio"): AudioCaptureProvider {
    const provider = this.audioCaptureProviders.get(id);
    if (!provider) throw new Error(`Unknown audio capture provider: ${id}`);
    return provider;
  }

  videoCapture(id = process.env.EXOCORTEX_VIDEO_CAPTURE_PROVIDER ?? "local-command-video"): VideoCaptureProvider {
    const provider = this.videoCaptureProviders.get(id);
    if (!provider) throw new Error(`Unknown video capture provider: ${id}`);
    return provider;
  }

  audioPlayback(id = process.env.EXOCORTEX_AUDIO_PLAYBACK_PROVIDER ?? (process.platform === "darwin" ? "macos-afplay" : "local-command-audio-playback")): AudioPlaybackProvider {
    const provider = this.audioPlaybackProviders.get(id);
    if (!provider) throw new Error(`Unknown audio playback provider: ${id}`);
    return provider;
  }

  list(): { stt: string[]; tts: string[]; imageCapture: string[]; audioCapture: string[]; videoCapture: string[]; audioPlayback: string[] } {
    return {
      stt: [...this.sttProviders.keys()],
      tts: [...this.ttsProviders.keys()],
      imageCapture: [...this.imageCaptureProviders.keys()],
      audioCapture: [...this.audioCaptureProviders.keys()],
      videoCapture: [...this.videoCaptureProviders.keys()],
      audioPlayback: [...this.audioPlaybackProviders.keys()]
    };
  }
}
