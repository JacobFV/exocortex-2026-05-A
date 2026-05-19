import { createReadStream, createWriteStream, type ReadStream, type WriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { encodeSerialFrame, SerialFrameDecoder, type SerialFrame } from "./serial-framing.js";

export interface NodeSerialTransportOptions {
  path: string;
  baudRate: number;
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

  constructor(private readonly options: NodeSerialTransportOptions) {
    super();
  }

  async open(): Promise<void> {
    await configureSerialDevice(this.options);
    this.readStream = createReadStream(this.options.path, { encoding: "utf8" });
    this.writeStream = createWriteStream(this.options.path, { encoding: "utf8" });
    this.readStream.on("data", (chunk) => {
      try {
        for (const frame of this.decoder.push(chunk.toString())) this.emit("frame", frame);
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.readStream.on("error", (error) => this.emit("error", error));
    this.readStream.on("close", () => this.emit("close"));
    this.writeStream.on("error", (error) => this.emit("error", error));
  }

  write(frame: SerialFrame): Promise<void> {
    if (!this.writeStream) throw new Error("Serial transport is not open");
    return new Promise((resolve, reject) => {
      this.writeStream!.write(encodeSerialFrame(frame), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const streams = [this.readStream, this.writeStream].filter(Boolean);
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
