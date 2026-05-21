import { closeSync, constants as fsConstants, openSync, readSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { encodeSerialFrame, SerialFrameDecoder, type SerialFrame } from "./serial-framing.js";

export interface NodeSerialTransportOptions {
  path: string;
  baudRate: number;
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
  maxWriteQueue?: number;
  readIntervalMs?: number;
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
  private fd?: number;
  private readTimer?: NodeJS.Timeout;
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
    this.fd = openSync(this.options.path, serialOpenFlags());
    this.startReadLoop();
  }

  write(frame: SerialFrame): Promise<void> {
    if (this.fd === undefined) throw new Error("Serial transport is not open");
    const maxWriteQueue = this.options.maxWriteQueue ?? 64;
    if (this.writeQueueDepth >= maxWriteQueue) throw new Error(`Serial write queue exceeded maxWriteQueue ${maxWriteQueue}`);
    this.writeQueueDepth += 1;
    const task = this.writeChain.then(async () => {
      try {
        await this.writeBuffer(Buffer.from(encodeSerialFrame(frame), "utf8"));
        this.framesSent += 1;
      } finally {
        this.writeQueueDepth -= 1;
      }
    });
    this.writeChain = task.catch(() => undefined);
    return task;
  }

  health(): SerialTransportHealth {
    return {
      path: this.options.path,
      baudRate: this.options.baudRate,
      open: this.fd !== undefined,
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
    const nodeError = error as NodeJS.ErrnoException;
    if (this.manuallyClosed && nodeError.code === "EBADF") return;
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
    if (this.readTimer) {
      clearInterval(this.readTimer);
      this.readTimer = undefined;
    }
    const fd = this.fd;
    this.fd = undefined;
    if (fd !== undefined) this.closeFd(fd);
    this.emit("close");
    return Promise.resolve();
  }

  private closeFd(fd: number): void {
    try {
      closeSync(fd);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EBADF") this.recordError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private startReadLoop(): void {
    const buffer = Buffer.alloc(4096);
    this.readTimer = setInterval(() => this.readAvailable(buffer), this.options.readIntervalMs ?? 20);
  }

  private readAvailable(buffer: Buffer): void {
    const fd = this.fd;
    if (fd === undefined) return;
    while (this.fd !== undefined) {
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      } catch (error) {
        if (isWouldBlock(error)) return;
        this.recordError(error instanceof Error ? error : new Error(String(error)));
        this.handleUnexpectedClose();
        return;
      }
      if (bytesRead <= 0) return;
      for (const frame of this.decoder.push(buffer.subarray(0, bytesRead).toString("utf8"))) {
        this.framesReceived += 1;
        this.lastFrameAt = new Date().toISOString();
        if (frame.type === "device.identity" && frame.value && typeof frame.value === "object" && "deviceId" in frame.value) {
          const deviceId = (frame.value as { deviceId?: unknown }).deviceId;
          if (typeof deviceId === "string") this.deviceIdentity = deviceId;
        }
        this.emit("frame", frame);
      }
    }
  }

  private async writeBuffer(buffer: Buffer): Promise<void> {
    let offset = 0;
    while (offset < buffer.length) {
      const fd = this.fd;
      if (fd === undefined) throw new Error("Serial transport is not open");
      try {
        const bytesWritten = writeSync(fd, buffer, offset, buffer.length - offset);
        if (bytesWritten === 0) {
          await delay(10);
          continue;
        }
        offset += bytesWritten;
      } catch (error) {
        if (isWouldBlock(error)) {
          await delay(10);
          continue;
        }
        this.recordError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    }
  }

  private handleUnexpectedClose(): void {
    if (this.readTimer) {
      clearInterval(this.readTimer);
      this.readTimer = undefined;
    }
    const fd = this.fd;
    this.fd = undefined;
    if (fd !== undefined) this.closeFd(fd);
    this.emit("close");
    if (this.options.autoReconnect && !this.manuallyClosed) this.scheduleReconnect();
  }
}

function serialOpenFlags(): number {
  return fsConstants.O_RDWR | fsConstants.O_NONBLOCK | (fsConstants.O_NOCTTY ?? 0);
}

function isWouldBlock(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EAGAIN" || code === "EWOULDBLOCK";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
