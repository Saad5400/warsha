import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import type { Env } from '../env.js'
import type { BlobStorage } from './types.js'

export interface S3Options {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

export function s3OptionsFromEnv(env: Env): S3Options {
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  }
}

/** S3-compatible object storage. Endpoint/region/credentials all come from env. */
export function createS3Storage(opts: S3Options): BlobStorage {
  const config: S3ClientConfig = {
    endpoint: opts.endpoint,
    region: opts.region,
    forcePathStyle: opts.forcePathStyle,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
    },
  }
  const client = new S3Client(config)

  return {
    async put(key: string, bytes: Uint8Array): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: opts.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'application/octet-stream',
          ContentLength: bytes.byteLength,
        }),
      )
    },

    async get(key: string): Promise<Uint8Array | null> {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
        )
        if (!res.Body) return null
        const bytes = await res.Body.transformToByteArray()
        return bytes
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }))
      } catch (err) {
        // S3 DELETE is idempotent, but tolerate a missing object regardless.
        if (isNotFound(err)) return
        throw err
      }
    },
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.Code === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  )
}
