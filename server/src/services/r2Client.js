import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../utils/config.js';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
  forcePathStyle: false,
});

export async function uploadStreamToR2({ key, body, contentType }) {
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: config.r2.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
    leavePartsOnError: false,
  });
  return upload.done();
}

export async function generateSignedDownloadUrl(key, ttlSeconds) {
  const cmd = new GetObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
  });
  return getSignedUrl(r2Client, cmd, { expiresIn: ttlSeconds });
}

export async function deleteR2Object(key) {
  const cmd = new DeleteObjectCommand({
    Bucket: config.r2.bucketName,
    Key: key,
  });
  await r2Client.send(cmd);
}
