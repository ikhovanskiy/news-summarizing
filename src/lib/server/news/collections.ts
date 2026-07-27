import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { MAX_RETAINED_COLLECTIONS } from './constants'
import { defaultCollectionRunner } from './collector'
import { resolveNewsRuntimePaths } from './paths'
import type {
  CollectionJob,
  CollectionRunner,
  PublicCollectionJob,
  StartCollectionInput,
  StartCollectionResult,
} from './types'

export interface CollectionService {
  readonly jobs: Map<string, CollectionJob>
  get(id: string): CollectionJob | undefined
  current(): CollectionJob | undefined
  start(input: StartCollectionInput): StartCollectionResult
}

export interface CollectionServiceOptions {
  jobs?: Map<string, CollectionJob>
  collectionRunner?: CollectionRunner
  collectionTempRoot?: string
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export function publicCollectionJob(job: CollectionJob): PublicCollectionJob {
  return {
    id: job.id,
    category: job.category,
    dateFrom: job.dateFrom,
    dateTo: job.dateTo,
    status: job.status,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null,
    messages: job.messages ?? null,
    summary: job.summary || null,
    error: job.error || null,
    progress: job.progress || null,
  }
}

export function pruneCollectionJobs(
  jobs: Map<string, CollectionJob>,
): void {
  const completed = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  while (jobs.size >= MAX_RETAINED_COLLECTIONS && completed.length > 0) {
    const oldest = completed.shift()
    if (oldest) jobs.delete(oldest.id)
  }
}

function errorDetails(error: unknown): string {
  const failure = error as { message?: unknown; stderr?: unknown }
  return [failure?.message, failure?.stderr]
    .filter(Boolean)
    .map(String)
    .join('\n')
    .slice(0, 4000)
}

export async function executeCollectionJob(
  job: CollectionJob,
  collectionRunner: CollectionRunner,
): Promise<void> {
  try {
    const signal =
      job.abortController?.signal ?? new AbortController().signal
    const result = await collectionRunner({
      category: job.category,
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      rawDir: job.rawDir,
      signal,
      onProgress(progress) {
        if (job.status !== 'running') return
        job.progress = progress
        job.messages = progress.messages
      },
    })
    if (job.status === 'cancelled' || signal.aborted) return

    const body = Buffer.isBuffer(result.body)
      ? result.body
      : Buffer.from(result.body || '')
    if (!body.length) throw new Error('Collector returned an empty raw digest')

    const summaryLines = String(result.stdout || '')
      .trim()
      .split('\n')
      .filter(Boolean)
    const summary = summaryLines.at(-1) || null
    const messageMatch = summary?.match(/\bmessages=(\d+)\b/)

    job.result = body
    job.messages = messageMatch ? Number(messageMatch[1]) : null
    job.summary = summary
    job.status = 'completed'
  } catch (error) {
    if (job.status !== 'cancelled') {
      job.error = errorDetails(error) || 'Collection failed'
      job.status = 'failed'
    }
  } finally {
    job.finishedAt ??= new Date().toISOString()
    job.abortController = undefined
    await rm(job.rawDir, { recursive: true, force: true }).catch((error) => {
      console.error('Could not remove collection temporary directory', error)
    })
  }
}

export function createCollectionService(
  options: CollectionServiceOptions = {},
): CollectionService {
  const jobs = options.jobs ?? new Map<string, CollectionJob>()
  const collectionRunner =
    options.collectionRunner ?? defaultCollectionRunner
  const collectionTempRoot =
    options.collectionTempRoot ??
    resolveNewsRuntimePaths().collectionTempRoot

  return {
    jobs,
    get(id) {
      return jobs.get(id)
    },
    current() {
      return [...jobs.values()]
        .filter((job) => job.status === 'running')
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        )[0]
    },
    start(input) {
      const replacedJobIds: string[] = []
      for (const activeJob of jobs.values()) {
        if (activeJob.status !== 'running') continue

        activeJob.status = 'cancelled'
        activeJob.error = 'Cancelled by a newer collection request'
        activeJob.finishedAt = new Date().toISOString()
        activeJob.abortController?.abort()
        replacedJobIds.push(activeJob.id)
      }

      pruneCollectionJobs(jobs)
      const id = randomUUID()
      const abortController = new AbortController()
      const job: CollectionJob = {
        id,
        category: input.category,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        status: 'running',
        createdAt: new Date().toISOString(),
        rawDir: path.join(collectionTempRoot, id),
        abortController,
      }
      jobs.set(id, job)
      void executeCollectionJob(job, collectionRunner)

      return { ok: true, job, replacedJobIds }
    },
  }
}

type NewsGlobalScope = typeof globalThis & {
  __newsCollectionJobsV1?: Map<string, CollectionJob>
}

const newsGlobalScope = globalThis as NewsGlobalScope

export const globalCollectionJobs =
  newsGlobalScope.__newsCollectionJobsV1 ??
  (newsGlobalScope.__newsCollectionJobsV1 = new Map<string, CollectionJob>())

export const collectionService = createCollectionService({
  jobs: globalCollectionJobs,
})
