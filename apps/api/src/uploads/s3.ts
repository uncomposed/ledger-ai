import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignResult, UploadDescriptor, UploadsProvider } from "./provider.js";

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
};

export class S3UploadsProvider implements UploadsProvider {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3Config) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
    });
  }

  private key(entityId: string, storageKey: string): string {
    return `${entityId}/${storageKey}`;
  }

  async presignPut(input: Omit<UploadDescriptor, "storageKey"> & { storageKey: string }): Promise<PresignResult> {
    const key = this.key(input.entityId, input.storageKey);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      Metadata: {
        sha256: input.sha256,
        "size-bytes": String(input.sizeBytes),
      },
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: 10 * 60 });
    return {
      storageKey: input.storageKey,
      method: "PUT",
      url,
      headers: {
        "content-type": input.contentType,
        "x-amz-meta-sha256": input.sha256,
        "x-amz-meta-size-bytes": String(input.sizeBytes),
      },
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async verifyUploaded(input: UploadDescriptor): Promise<void> {
    const key = this.key(input.entityId, input.storageKey);
    const head = await this.client
      .send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      )
      .catch((e: any) => {
        const status = Number(e?.$metadata?.httpStatusCode ?? 0);
        if (status === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") throw new Error("upload not found");
        throw e;
      });

    const contentLength = Number(head.ContentLength ?? -1);
    if (contentLength !== input.sizeBytes) throw new Error("upload size mismatch");

    const sha256 = String(head.Metadata?.sha256 ?? "");
    if (sha256 !== input.sha256) throw new Error("upload sha256 mismatch");

    if (head.ContentType && head.ContentType !== input.contentType) throw new Error("upload content-type mismatch");
  }
}
