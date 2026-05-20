import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createId, type AgentSession, type AgentSessionArtifact, type AgentSessionArtifactId, type AgentSessionId } from "@exocortex/protocol";

export interface StoredArtifactBlob {
  artifact: AgentSessionArtifact;
  path: string;
  sha256: string;
}

export interface ArtifactBlobIntegrityResult {
  artifactId: AgentSessionArtifactId;
  path: string;
  ok: boolean;
  actualSha256: string;
  expectedSha256?: string;
  bytes: number;
  expectedBytes?: number;
}

export interface ArtifactBlobReadOptions {
  verifyIntegrity?: boolean;
}

export interface ArtifactBlobGarbageCollectOptions {
  artifacts: readonly AgentSessionArtifact[];
  maxArtifactAgeMs: number;
  now?: Date | string | number;
  sessions?: readonly Pick<AgentSession, "id" | "state" | "createdAt" | "updatedAt" | "finishedAt">[];
  retainSessionIds?: readonly AgentSessionId[];
}

export interface ArtifactBlobGarbageCollectResult {
  checked: number;
  retained: number;
  deleted: Array<{
    artifactId: AgentSessionArtifactId;
    sessionId: AgentSessionId;
    path: string;
    reason: "expired";
  }>;
  missing: Array<{
    artifactId: AgentSessionArtifactId;
    sessionId: AgentSessionId;
    path: string;
  }>;
  errors: Array<{
    artifactId: AgentSessionArtifactId;
    sessionId: AgentSessionId;
    path?: string;
    message: string;
  }>;
}

type SessionRetentionMetadata = Pick<AgentSession, "id" | "state" | "createdAt" | "updatedAt" | "finishedAt">;

interface ClassifiedArtifactBlob {
  artifact: AgentSessionArtifact;
  path: string;
}

export class FileArtifactBlobStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
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
    const sha256 = hashSha256(bytes);
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

  read(artifact: AgentSessionArtifact, options: ArtifactBlobReadOptions = {}): Buffer {
    const path = this.pathForArtifact(artifact);
    const bytes = readFileSync(path);
    if (options.verifyIntegrity ?? true) this.assertIntegrity(artifact, path, bytes);
    return bytes;
  }

  verify(artifact: AgentSessionArtifact): ArtifactBlobIntegrityResult {
    const path = this.pathForArtifact(artifact);
    const bytes = readFileSync(path);
    const actualSha256 = hashSha256(bytes);
    const expectedSha256 = storedSha256(artifact);
    return {
      artifactId: artifact.id,
      path,
      ok: expectedSha256 === actualSha256,
      actualSha256,
      expectedSha256,
      bytes: bytes.byteLength,
      expectedBytes: artifact.bytes
    };
  }

  garbageCollect(options: ArtifactBlobGarbageCollectOptions): ArtifactBlobGarbageCollectResult {
    if (!Number.isFinite(options.maxArtifactAgeMs) || options.maxArtifactAgeMs < 0) {
      throw new Error(`Artifact blob retention age must be a non-negative number: ${options.maxArtifactAgeMs}`);
    }

    const cutoffMs = timeMs(options.now ?? new Date(), "now") - options.maxArtifactAgeMs;
    const sessions = new Map((options.sessions ?? []).map((session) => [session.id, session]));
    const retainSessionIds = new Set(options.retainSessionIds ?? []);
    const candidates: ClassifiedArtifactBlob[] = [];
    const retainedPaths = new Set<string>();
    const deletedPaths = new Set<string>();
    const result: ArtifactBlobGarbageCollectResult = {
      checked: options.artifacts.length,
      retained: 0,
      deleted: [],
      missing: [],
      errors: []
    };

    for (const artifact of options.artifacts) {
      let path: string;
      try {
        path = this.pathForArtifact(artifact, { requireInsideRoot: true });
      } catch (error) {
        result.errors.push({ artifactId: artifact.id, sessionId: artifact.sessionId, message: errorMessage(error) });
        continue;
      }

      let shouldRetain: boolean;
      try {
        shouldRetain = this.shouldRetainArtifact(artifact, cutoffMs, retainSessionIds, sessions);
      } catch (error) {
        result.errors.push({ artifactId: artifact.id, sessionId: artifact.sessionId, path, message: errorMessage(error) });
        continue;
      }

      if (shouldRetain) {
        result.retained += 1;
        retainedPaths.add(path);
      } else {
        candidates.push({ artifact, path });
      }
    }

    for (const candidate of candidates) {
      if (retainedPaths.has(candidate.path)) {
        result.retained += 1;
        continue;
      }
      if (deletedPaths.has(candidate.path)) continue;

      try {
        rmSync(candidate.path);
        deletedPaths.add(candidate.path);
        result.deleted.push({
          artifactId: candidate.artifact.id,
          sessionId: candidate.artifact.sessionId,
          path: candidate.path,
          reason: "expired"
        });
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          result.missing.push({ artifactId: candidate.artifact.id, sessionId: candidate.artifact.sessionId, path: candidate.path });
        } else {
          result.errors.push({
            artifactId: candidate.artifact.id,
            sessionId: candidate.artifact.sessionId,
            path: candidate.path,
            message: errorMessage(error)
          });
        }
      }
    }

    return result;
  }

  private assertIntegrity(artifact: AgentSessionArtifact, path: string, bytes: Buffer): void {
    const expectedSha256 = storedSha256(artifact);
    if (!expectedSha256) return;

    const actualSha256 = hashSha256(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`Artifact blob integrity check failed for ${artifact.id}: expected sha256 ${expectedSha256}, got ${actualSha256}`);
    }
  }

  private shouldRetainArtifact(
    artifact: AgentSessionArtifact,
    cutoffMs: number,
    retainSessionIds: ReadonlySet<AgentSessionId>,
    sessions: ReadonlyMap<AgentSessionId, SessionRetentionMetadata>
  ): boolean {
    if (retainSessionIds.has(artifact.sessionId)) return true;
    const session = sessions.get(artifact.sessionId);
    if (session && isActiveSession(session)) return true;
    if (session && sessionRetentionTimeMs(session) > cutoffMs) return true;

    const createdAtMs = timeMs(artifact.createdAt, `artifact ${artifact.id} createdAt`);
    return createdAtMs > cutoffMs;
  }

  private pathForArtifact(artifact: AgentSessionArtifact, options: { requireInsideRoot?: boolean } = {}): string {
    const relativePath = typeof artifact.metadata?.relativePath === "string" ? artifact.metadata.relativePath : undefined;
    if (relativePath) return this.resolveInsideRoot(relativePath);
    if (!artifact.uri) throw new Error(`Artifact has no blob uri: ${artifact.id}`);

    const path = resolve(artifact.uri);
    if (options.requireInsideRoot) this.assertInsideRoot(path);
    return path;
  }

  private resolveInsideRoot(path: string): string {
    const absolutePath = resolve(this.rootDir, path);
    this.assertInsideRoot(absolutePath);
    return absolutePath;
  }

  private assertInsideRoot(path: string): void {
    const relativePath = relative(this.rootDir, path);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Artifact blob path is outside the blob store root: ${path}`);
    }
  }
}

function storedSha256(artifact: AgentSessionArtifact): string | undefined {
  return typeof artifact.metadata?.sha256 === "string" ? artifact.metadata.sha256 : undefined;
}

function hashSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function timeMs(value: Date | string | number, label: string): number {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${label} timestamp`);
  return timestamp;
}

function isActiveSession(session: SessionRetentionMetadata): boolean {
  return session.state !== "finished" && session.state !== "stopped" && session.state !== "error";
}

function sessionRetentionTimeMs(session: SessionRetentionMetadata): number {
  return timeMs(session.finishedAt ?? session.updatedAt, `session ${session.id} retention timestamp`);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
