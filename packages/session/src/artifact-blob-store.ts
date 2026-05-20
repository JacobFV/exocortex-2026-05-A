import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createId, type AgentSessionArtifact, type AgentSessionArtifactId, type AgentSessionId } from "@exocortex/protocol";

export interface StoredArtifactBlob {
  artifact: AgentSessionArtifact;
  path: string;
  sha256: string;
}

export class FileArtifactBlobStore {
  constructor(private readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  put(input: {
    sessionId: AgentSessionId;
    kind: AgentSessionArtifact["kind"];
    title: string;
    data: Uint8Array | string;
    mimeType?: string;
    artifactId?: AgentSessionArtifactId;
    modalityId?: AgentSessionArtifact["modalityId"];
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }): StoredArtifactBlob {
    const bytes = typeof input.data === "string" ? Buffer.from(input.data) : Buffer.from(input.data);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const extension = extensionForMime(input.mimeType);
    const relativePath = join(input.sessionId, `${sha256}${extension}`);
    const absolutePath = join(this.rootDir, relativePath);
    mkdirSync(join(this.rootDir, input.sessionId), { recursive: true });
    writeFileSync(absolutePath, bytes);
    const artifact: AgentSessionArtifact = {
      id: input.artifactId ?? createId<"AgentSessionArtifactId">("art"),
      sessionId: input.sessionId,
      kind: input.kind,
      title: input.title,
      createdAt: input.createdAt ?? new Date().toISOString(),
      modalityId: input.modalityId,
      mimeType: input.mimeType,
      uri: absolutePath,
      bytes: bytes.byteLength,
      metadata: {
        ...input.metadata,
        sha256,
        storage: "file",
        relativePath
      }
    };
    return { artifact, path: absolutePath, sha256 };
  }

  read(artifact: AgentSessionArtifact): Buffer {
    if (!artifact.uri) throw new Error(`Artifact has no blob uri: ${artifact.id}`);
    return readFileSync(artifact.uri);
  }
}

function extensionForMime(mimeType?: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "audio/wav":
      return ".wav";
    case "audio/mpeg":
      return ".mp3";
    case "video/mp4":
      return ".mp4";
    case "application/json":
      return ".json";
    default:
      return "";
  }
}
