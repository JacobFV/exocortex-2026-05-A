import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { encodeSerialFrame, SerialFrameDecoder, type SerialFrame } from "./serial-framing.js";

export interface NodeSerialTransportOptions {
  path: string;
  baudRate: number;
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
  maxWriteQueue?: number;
}

export interface SerialTransportHealth {
  path: string;
  baudRate: number;
  open: boolean;
  framesReceived: number;
  framesSent: number;
  framingErrors: number;
  reconnectAttempts: number;
  writeQueueDepth: number;
  lastFrameAt?: string;
  lastError?: string;
  deviceIdentity?: string;
}

export interface NodeSerialTransportEvents {
  frame: [SerialFrame];
  error: [Error];
  close: [];
}

export class NodeSerialTransport extends EventEmitter<NodeSerialTransportEvents> {
  private readStream?: ReadStream;
  private writeStream?: WriteStream;
  private readonly decoder = new SerialFrameDecoder();
  private framesReceived = 0;
  private framesSent = 0;
  private reconnectAttempts = 0;
  private writeQueueDepth = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private manuallyClosed = false;
  private lastFrameAt?: string;
  private lastError?: string;
  private deviceIdentity?: string;

  constructor(private readonly options: NodeSerialTransportOptions) {
    super();
  }

  async open(): Promise<void> {
    this.manuallyClosed = false;
    await configureSerialDevice(this.options);
    this.readStream = createReadStream(this.options.path, { encoding: "utf8" });
    this.writeStream = createWriteStream(this.options.path, { encoding: "utf8" });
    this.readStream.on("data", (chunk) => {
      for (const frame of this.decoder.push(chunk.toString())) {
        this.framesReceived += 1;
        this.lastFrameAt = new Date().toISOString();
        if (frame.type === "device.identity" && frame.value && typeof frame.value === "object" && "deviceId" in frame.value) {
          const deviceId = (frame.value as { deviceId?: unknown }).deviceId;
          if (typeof deviceId === "string") this.deviceIdentity = deviceId;
        }
        this.emit("frame", frame);
      }
    });
    this.readStream.on("error", (error) => this.recordError(error));
    this.readStream.on("close", () => {
      this.emit("close");
      if (this.options.autoReconnect && !this.manuallyClosed) this.scheduleReconnect();
    });
    this.writeStream.on("error", (error) => this.recordError(error));
  }

  write(frame: SerialFrame): Promise<void> {
    if (!this.writeStream) throw new Error("Serial transport is not open");
    const maxWriteQueue = this.options.maxWriteQueue ?? 64;
    if (this.writeQueueDepth >= maxWriteQueue) throw new Error(`Serial write queue exceeded maxWriteQueue ${maxWriteQueue}`);
    this.writeQueueDepth += 1;
    const task = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.writeStream!.write(encodeSerialFrame(frame), (error) => {
            this.writeQueueDepth -= 1;
            if (error) {
              this.recordError(error);
              reject(error);
            } else {
              this.framesSent += 1;
              resolve();
            }
          });
        })
    );
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  health(): SerialTransportHealth {
    return {
      path: this.options.path,
      baudRate: this.options.baudRate,
      open: Boolean(this.readStream && this.writeStream),
      framesReceived: this.framesReceived,
      framesSent: this.framesSent,
      framingErrors: this.decoder.framingErrors,
      reconnectAttempts: this.reconnectAttempts,
      writeQueueDepth: this.writeQueueDepth,
      lastFrameAt: this.lastFrameAt,
      lastError: this.lastError,
      deviceIdentity: this.deviceIdentity
    };
  }

  private recordError(error: Error): void {
    this.lastError = error.message;
    this.emit("error", error);
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    setTimeout(() => {
      if (this.manuallyClosed) return;
      void this.open().catch((error) => this.recordError(error instanceof Error ? error : new Error(String(error))));
    }, this.options.reconnectDelayMs ?? 1000);
  }

  close(): Promise<void> {
    this.manuallyClosed = true;
    return new Promise((resolve) => {
      const streams = [this.readStream, this.writeStream].filter(Boolean);
      this.readStream = undefined;
      this.writeStream = undefined;
      if (!streams.length) {
        resolve();
        return;
      }
      let remaining = streams.length;
      for (const stream of streams) {
        const closeable = stream as EventEmitter & { destroy(): void };
        closeable.once("close", () => {
          remaining -= 1;
          if (remaining === 0) resolve();
        });
        closeable.destroy();
      }
    });
  }
}

async function configureSerialDevice(options: NodeSerialTransportOptions): Promise<void> {
  const flag = process.platform === "darwin" ? "-f" : "-F";
  await run("stty", [flag, options.path, String(options.baudRate), "raw", "-echo"]);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
