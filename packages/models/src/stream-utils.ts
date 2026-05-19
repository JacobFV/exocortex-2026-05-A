export async function* streamUtf8Lines(body: ReadableStream<Uint8Array> | null): AsyncIterable<string> {
  if (!body) throw new Error("Model response did not include a readable body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index).trimEnd();
      buffer = buffer.slice(index + 1);
      if (line.trim()) yield line;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield buffer.trimEnd();
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
