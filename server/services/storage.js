// JL-137: Pluggable attachment storage backend.
//
// Two backends implement one interface:
//   put(key, buffer, contentType) -> Promise<void>
//   get(key)                      -> Promise<Buffer>
//   remove(key)                   -> Promise<void>
//   url(key)                      -> string   (best-effort locator)
//
// LocalStorage wraps the existing server/uploads disk logic (the DEFAULT).
// S3Storage uses @aws-sdk/client-s3 and is only used when S3 is configured.
// selectBackend(config) is a PURE function (unit-testable without AWS).

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getStorageConfig } from '../config.js'

const UPLOAD_DIR = fileURLToPath(new URL('../uploads/', import.meta.url))

/**
 * PURE: decide which storage backend to use given a config object.
 * Returns 's3' only when bucket, region, accessKeyId and secretAccessKey are
 * all present (endpoint is optional for S3-compatible providers). Otherwise
 * 'local'. No side effects, no AWS access — safe to unit test.
 */
export function selectBackend(config = {}) {
  const { bucket, region, accessKeyId, secretAccessKey } = config
  if (bucket && region && accessKeyId && secretAccessKey) return 's3'
  return 'local'
}

/** Local-disk backend — the default. Keys are basenames under server/uploads. */
export class LocalStorage {
  constructor({ dir = UPLOAD_DIR } = {}) {
    this.dir = dir
    this.backend = 'local'
  }

  _resolve(key) {
    // Guard against traversal: only ever use the basename.
    return path.join(this.dir, path.basename(key))
  }

  async put(key, buffer /*, contentType */) {
    await fs.mkdir(this.dir, { recursive: true })
    await fs.writeFile(this._resolve(key), buffer)
  }

  /*
   * JL-164: stream a body in without holding it in memory.
   *
   * The Document Store accepts files up to 100 MB. Reading one into a Buffer
   * just to hand it to put() would put the whole file on the heap for the
   * duration of the write, which is exactly what the multipart change was
   * made to avoid. pipeline() also destroys the source on failure, so a
   * broken upload does not leak the read handle.
   */
  async putStream(key, readable /*, contentType */) {
    await fs.mkdir(this.dir, { recursive: true })
    const { pipeline } = await import('node:stream/promises')
    const { createWriteStream } = await import('node:fs')
    await pipeline(readable, createWriteStream(this._resolve(key)))
  }

  async get(key) {
    return fs.readFile(this._resolve(key))
  }

  async remove(key) {
    await fs.unlink(this._resolve(key)).catch(() => {})
  }

  url(key) {
    return `/api/attachments/local/${encodeURIComponent(path.basename(key))}`
  }
}

/** S3-compatible backend. Only instantiated when S3 is configured. */
export class S3Storage {
  constructor(config, { client } = {}) {
    this.config = config
    this.bucket = config.bucket
    this.backend = 's3'
    this._client = client || null // lazily created to avoid SDK load when unused
  }

  async _getClient() {
    if (this._client) return this._client
    const { S3Client } = await import('@aws-sdk/client-s3')
    const opts = {
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    }
    if (this.config.endpoint) {
      opts.endpoint = this.config.endpoint
      opts.forcePathStyle = true // required by MinIO and most non-AWS providers
    }
    this._client = new S3Client(opts)
    return this._client
  }

  async put(key, buffer, contentType) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this._getClient()
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      }),
    )
  }

  /*
   * JL-164: PutObject accepts a stream body, so the same contract as
   * LocalStorage.putStream holds here and a large upload never lands on the
   * heap. ContentLength is passed when known because the SDK cannot infer it
   * from a stream and will otherwise buffer to find out.
   */
  async putStream(key, readable, contentType, contentLength) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this._getClient()
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: readable,
        ContentType: contentType || 'application/octet-stream',
        ...(contentLength ? { ContentLength: contentLength } : {}),
      }),
    )
  }

  async get(key) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this._getClient()
    const out = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    return streamToBuffer(out.Body)
  }

  async remove(key) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this._getClient()
    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    )
  }

  url(key) {
    if (this.config.endpoint) {
      return `${this.config.endpoint.replace(/\/$/, '')}/${this.bucket}/${key}`
    }
    return `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/${key}`
  }
}

/** Collect a Node/web stream (or Buffer) into a single Buffer. */
export async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  // Web ReadableStream (has getReader) — used by some SDK responses.
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray())
  }
  const chunks = []
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

let _cached = null

/**
 * Factory: return the active storage backend (S3 when configured, else Local).
 * Cached after first call. Pass a config to bypass the cache (used in tests).
 */
export function getStorage(config) {
  if (config) {
    return selectBackend(config) === 's3'
      ? new S3Storage(config)
      : new LocalStorage()
  }
  if (_cached) return _cached
  const cfg = getStorageConfig()
  _cached = selectBackend(cfg) === 's3' ? new S3Storage(cfg) : new LocalStorage()
  return _cached
}

/** Reset the cached backend (test helper). */
export function _resetStorage() {
  _cached = null
}
