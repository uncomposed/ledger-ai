export type PresignResult = {
  storageKey: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type UploadDescriptor = {
  entityId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export interface UploadsProvider {
  presignPut(input: Omit<UploadDescriptor, "storageKey"> & { storageKey: string }): Promise<PresignResult>;
  verifyUploaded(input: UploadDescriptor): Promise<void>;
}

