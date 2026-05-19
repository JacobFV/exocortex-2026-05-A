export interface SerialFrame {
  channel: string;
  type: string;
  value: unknown;
  timestamp?: string;
}

export function encodeSerialFrame(frame: SerialFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

export class SerialFrameDecoder {
  private buffer = "";

  push(chunk: string): SerialFrame[] {
    this.buffer += chunk;
    const frames: SerialFrame[] = [];
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) break;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      frames.push(parseSerialFrame(line));
    }
    return frames;
  }
}

export function parseSerialFrame(line: string): SerialFrame {
  const parsed = JSON.parse(line) as Partial<SerialFrame>;
  if (!parsed.channel || !parsed.type) throw new Error(`Invalid serial frame: ${line}`);
  const frame: SerialFrame = {
    channel: parsed.channel,
    type: parsed.type,
    value: parsed.value
  };
  if (parsed.timestamp) frame.timestamp = parsed.timestamp;
  return frame;
}
