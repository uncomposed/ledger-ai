import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PresignResult, UploadDescriptor, UploadsProvider } from "./provider.js";

export class LocalUploadsProvider implements UploadsProvider {
  constructor(private readonly rootDir: string) {}

  async presignPut(input: Omit<UploadDescriptor, "storageKey"> & { storageKey: string }): Promise<PresignResult> {
    return {
      storageKey: input.storageKey,
      method: "PUT",
      url: `/uploads/${input.storageKey}`,
      headers: { "content-type": input.contentType },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async verifyUploaded(input: UploadDescriptor): Promise<void> {
    const path = join(this.rootDir, input.entityId, input.storageKey);
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) throw new Error("upload not found");
    if (bytes.length !== input.sizeBytes) throw new Error("upload size mismatch");
    const have = createHash("sha256").update(bytes).digest("hex");
    if (have !== input.sha256) throw new Error("upload sha256 mismatch");
  }

  async writeUploaded(input: { entityId: string; storageKey: string; bytes: Buffer }): Promise<void> {
    const entityDir = join(this.rootDir, input.entityId);
    await mkdir(entityDir, { recursive: true });
    const dest = join(entityDir, input.storageKey);
    const alreadyExists = await stat(dest)
      .then(() => true)
      .catch((e: any) => {
        if (e?.code === "ENOENT") return false;
        throw e;
      });
    if (alreadyExists) throw new Error("upload already exists");
    await writeFile(dest, input.bytes);
  }
}
