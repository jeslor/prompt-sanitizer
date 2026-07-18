/**
 * Pluggable persistence for session vaults.
 *
 * A Vault normally lives only in process memory — it's gone on restart,
 * worker swap, or serverless cold start. A VaultStore lets `Session`
 * reattach to a previously-persisted vault by `sessionId`, so a multi-turn
 * conversation's PII mapping survives beyond one process's lifetime.
 *
 * No store is active unless you explicitly pass one — this is opt-in and
 * changes nothing for existing callers. The bundled stores below write the
 * *actual original values* (that's the point — restoration needs them), so
 * treat the underlying file/db with the same sensitivity as the source PII.
 */
import type { VaultData } from "./vault.js";
import { VaultStoreError } from "./exceptions.js";

/** The current on-disk/on-wire shape of a persisted vault. Bump on breaking changes. */
export const VAULT_SNAPSHOT_VERSION = 1;

export interface VaultSnapshot extends VaultData {
  version: number;
  sessionId: string;
  updatedAt: string;
}

export interface VaultStore {
  /** Load a previously-saved snapshot, or `undefined` if none exists. */
  load(sessionId: string): Promise<VaultSnapshot | undefined>;
  /** Persist (overwrite) the snapshot for `sessionId`. */
  save(sessionId: string, snapshot: VaultSnapshot): Promise<void>;
  /** Remove any persisted snapshot for `sessionId`. */
  delete(sessionId: string): Promise<void>;
}

/** Build a fresh {@link VaultSnapshot} envelope around a vault's data. */
export function toVaultSnapshot(sessionId: string, data: VaultData): VaultSnapshot {
  return {
    version: VAULT_SNAPSHOT_VERSION,
    sessionId,
    updatedAt: new Date().toISOString(),
    ...data,
  };
}

/** Throws if `snapshot.version` isn't one this build of the library understands. */
export function assertSupportedVersion(snapshot: VaultSnapshot): void {
  if (snapshot.version !== VAULT_SNAPSHOT_VERSION) {
    throw new VaultStoreError(
      `Vault snapshot for session "${snapshot.sessionId}" has version ` +
        `${snapshot.version}, but this build of prompt-sanitizer only ` +
        `understands version ${VAULT_SNAPSHOT_VERSION}.`,
    );
  }
}

/**
 * Same-process-only reference store — a plain Map keyed by sessionId.
 * Useful for reattaching a session by id within one long-lived process
 * (e.g. a server holding many users' sessions) or in tests. Does NOT
 * survive a process restart; for that, use {@link FileVaultStore} or
 * implement `VaultStore` against your own infrastructure (Redis, a
 * database, etc. — the interface is intentionally three methods wide).
 */
export class InMemoryVaultStore implements VaultStore {
  private readonly _snapshots = new Map<string, VaultSnapshot>();

  async load(sessionId: string): Promise<VaultSnapshot | undefined> {
    const snapshot = this._snapshots.get(sessionId);
    return snapshot ? { ...snapshot } : undefined;
  }

  async save(sessionId: string, snapshot: VaultSnapshot): Promise<void> {
    this._snapshots.set(sessionId, { ...snapshot });
  }

  async delete(sessionId: string): Promise<void> {
    this._snapshots.delete(sessionId);
  }
}

/**
 * File-backed reference store — one JSON file per session under `dir`.
 * Uses only Node's `fs/promises`, `path`, and `crypto` builtins (dynamically
 * imported, so simply importing this module doesn't require a Node runtime
 * — only calling these methods does), so there's no new dependency to
 * install and nothing to run.
 *
 * `sessionId` is hashed into the filename (rather than used directly) so an
 * arbitrary/attacker-influenced session id can't be used for path traversal.
 *
 * For real production deployments with multiple processes/servers, prefer
 * implementing `VaultStore` against infrastructure you already run (Redis,
 * Postgres, etc.) — the interface is intentionally three methods wide.
 */
export class FileVaultStore implements VaultStore {
  constructor(private readonly dir: string) {}

  private async _pathFor(sessionId: string): Promise<string> {
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(sessionId).digest("hex");
    return join(this.dir, `${digest}.json`);
  }

  async load(sessionId: string): Promise<VaultSnapshot | undefined> {
    const fs = await import("node:fs/promises");
    const path = await this._pathFor(sessionId);
    try {
      const raw = await fs.readFile(path, "utf-8");
      return JSON.parse(raw) as VaultSnapshot;
    } catch (err: any) {
      if (err?.code === "ENOENT") return undefined;
      throw new VaultStoreError(
        `Failed to load vault snapshot for session "${sessionId}" from ${path}`,
        { cause: err },
      );
    }
  }

  async save(sessionId: string, snapshot: VaultSnapshot): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await this._pathFor(sessionId);
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(path, JSON.stringify(snapshot), "utf-8");
    } catch (err) {
      throw new VaultStoreError(
        `Failed to save vault snapshot for session "${sessionId}" to ${path}`,
        { cause: err },
      );
    }
  }

  async delete(sessionId: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await this._pathFor(sessionId);
    try {
      await fs.unlink(path);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw new VaultStoreError(
          `Failed to delete vault snapshot for session "${sessionId}" at ${path}`,
          { cause: err },
        );
      }
    }
  }
}
