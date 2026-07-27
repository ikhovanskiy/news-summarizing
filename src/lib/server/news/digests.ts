import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Category } from './constants'
import { resolveNewsRuntimePaths } from './paths'

export interface DigestRecord {
  body: Buffer
  etag: string
}

export function digestPath(category: Category, dataDir?: string): string {
  const resolvedDataDir = dataDir ?? resolveNewsRuntimePaths().dataDir
  return path.join(resolvedDataDir, `${category}-news.md`)
}

export async function readDigest(
  category: Category,
  dataDir?: string,
): Promise<DigestRecord> {
  const body = await readFile(digestPath(category, dataDir))
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`
  return { body, etag }
}

export async function writeDigest(
  category: Category,
  body: Buffer,
  dataDir?: string,
): Promise<void> {
  const resolvedDataDir = dataDir ?? resolveNewsRuntimePaths().dataDir
  const target = digestPath(category, resolvedDataDir)

  await mkdir(resolvedDataDir, { recursive: true })
  const temporary = path.join(
    resolvedDataDir,
    `.${category}.${process.pid}.${randomUUID()}.tmp`,
  )
  let published = false

  try {
    await writeFile(temporary, body, { mode: 0o600 })
    await rename(temporary, target)
    published = true
  } finally {
    if (!published) {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}

export function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
