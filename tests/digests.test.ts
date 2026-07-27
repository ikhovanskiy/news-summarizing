import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  digestPath,
  isMissingFileError,
  readDigest,
  writeDigest,
} from '../src/lib/server/news/digests'

describe('digest storage', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'news-digests-test-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  test('identifies a missing digest', async () => {
    let failure: unknown

    try {
      await readDigest('world', dataDir)
    } catch (error) {
      failure = error
    }

    expect(isMissingFileError(failure)).toBe(true)
  })

  test('writes and reads the exact Markdown with a stable ETag', async () => {
    const body = Buffer.from('# World news — 2026-07-27\n\nA digest.')

    await writeDigest('world', body, dataDir)
    const record = await readDigest('world', dataDir)

    expect(record.body.equals(body)).toBe(true)
    expect(record.etag).toBe(
      `"${createHash('sha256').update(body).digest('hex')}"`,
    )
    expect(await readFile(digestPath('world', dataDir), 'utf8')).toBe(
      body.toString(),
    )
  })

  test('atomically replaces an existing digest without leaving temporary files', async () => {
    const original = Buffer.from('# Crypto news\n\nOld contents.')
    const replacement = Buffer.from(
      '# Crypto news\n\nNew contents that must replace the whole file.',
    )

    await writeDigest('crypto', original, dataDir)
    await writeDigest('crypto', replacement, dataDir)

    expect(await readFile(digestPath('crypto', dataDir), 'utf8')).toBe(
      replacement.toString(),
    )
    expect((await readdir(dataDir)).sort()).toEqual(['crypto-news.md'])
  })
})
