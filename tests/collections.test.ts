import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  createCollectionService,
  MAX_RETAINED_COLLECTIONS,
} from '../src/lib/server/news'
import type {
  CollectionJob,
  CollectionRunner,
} from '../src/lib/server/news'

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  description: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }

  throw new Error(`Timed out waiting for ${description}`)
}

function completedJob(
  id: string,
  createdAt: string,
  rawDir: string,
): CollectionJob {
  return {
    id,
    category: 'world',
    dateFrom: '2026-07-26',
    dateTo: '2026-07-26',
    status: 'completed',
    createdAt,
    finishedAt: createdAt,
    rawDir,
    result: Buffer.from(`# ${id}`),
  }
}

describe('collection service', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'news-collections-test-'))
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('completes a job, records its summary, and removes its raw directory', async () => {
    const calls: Parameters<CollectionRunner>[0][] = []
    const runner: CollectionRunner = async (input) => {
      calls.push(input)
      await mkdir(input.rawDir, { recursive: true })
      await writeFile(path.join(input.rawDir, 'marker'), 'temporary')
      return {
        body: '# Raw world\n',
        stdout:
          'collector starting\n' +
          'category=world channels=13 messages=42 date_from=2026-07-26 date_to=2026-07-27',
        stderr: '',
      }
    }
    const service = createCollectionService({
      collectionRunner: runner,
      collectionTempRoot: tempRoot,
    })

    const started = service.start({
      category: 'world',
      dateFrom: '2026-07-26',
      dateTo: '2026-07-27',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('Expected collection to start')

    await waitFor(
      async () =>
        started.job.status === 'completed' &&
        Boolean(started.job.finishedAt) &&
        !(await pathExists(started.job.rawDir)),
      'successful job cleanup',
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      category: 'world',
      dateFrom: '2026-07-26',
      dateTo: '2026-07-27',
      rawDir: started.job.rawDir,
    })
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(started.job.messages).toBe(42)
    expect(started.job.summary).toBe(
      'category=world channels=13 messages=42 date_from=2026-07-26 date_to=2026-07-27',
    )
    expect(started.job.result?.toString()).toBe('# Raw world\n')
    expect(started.job.error).toBeUndefined()
    expect(service.get(started.job.id)).toBe(started.job)
  })

  test('marks runner failures and retains stderr details', async () => {
    const runner: CollectionRunner = async ({ rawDir }) => {
      await mkdir(rawDir, { recursive: true })
      throw Object.assign(new Error('collector failed'), {
        stderr: 'telegram unavailable',
      })
    }
    const service = createCollectionService({
      collectionRunner: runner,
      collectionTempRoot: tempRoot,
    })

    const started = service.start({
      category: 'crypto',
      dateFrom: '2026-07-27',
      dateTo: '2026-07-27',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('Expected collection to start')

    await waitFor(
      async () =>
        started.job.status === 'failed' &&
        Boolean(started.job.finishedAt) &&
        !(await pathExists(started.job.rawDir)),
      'failed job cleanup',
    )

    expect(started.job.error).toBe(
      'collector failed\ntelegram unavailable',
    )
    expect(started.job.result).toBeUndefined()
  })

  test('cancels a running collection before starting a newer one', async () => {
    let observedAbort = false
    const runner: CollectionRunner = async (input) => {
      if (input.category === 'invest') {
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true
              reject(new Error('collector aborted'))
            },
            { once: true },
          )
        })
      }
      return { body: '# Completed replacement\n' }
    }
    const service = createCollectionService({
      collectionRunner: runner,
      collectionTempRoot: tempRoot,
    })

    const first = service.start({
      category: 'invest',
      dateFrom: '2026-07-27',
      dateTo: '2026-07-27',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('Expected first collection to start')

    const second = service.start({
      category: 'world',
      dateFrom: '2026-07-27',
      dateTo: '2026-07-27',
    })
    expect(second.ok).toBe(true)
    expect(second.replacedJobIds).toEqual([first.job.id])
    expect(first.job.status).toBe('cancelled')
    expect(first.job.error).toBe(
      'Cancelled by a newer collection request',
    )
    expect(service.jobs.size).toBe(2)

    await waitFor(
      () =>
        observedAbort &&
        first.job.status === 'cancelled' &&
        second.job.status === 'completed',
      'cancelled job and completed replacement',
    )
  })

  test('prunes the oldest completed job before retaining a new one', async () => {
    const jobs = new Map<string, CollectionJob>()
    for (let index = 0; index < MAX_RETAINED_COLLECTIONS; index += 1) {
      const id = `completed-${index}`
      jobs.set(
        id,
        completedJob(
          id,
          new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
          path.join(tempRoot, id),
        ),
      )
    }

    const service = createCollectionService({
      jobs,
      collectionRunner: async () => ({ body: '# New raw digest\n' }),
      collectionTempRoot: tempRoot,
    })
    const started = service.start({
      category: 'world',
      dateFrom: '2026-07-27',
      dateTo: '2026-07-27',
    })

    expect(started.ok).toBe(true)
    expect(jobs.size).toBe(MAX_RETAINED_COLLECTIONS)
    expect(jobs.has('completed-0')).toBe(false)
    expect(jobs.has('completed-1')).toBe(true)
    if (!started.ok) throw new Error('Expected collection to start')
    expect(jobs.has(started.job.id)).toBe(true)
    await waitFor(
      () => started.job.status === 'completed',
      'new retained job completion',
    )
  })
})
