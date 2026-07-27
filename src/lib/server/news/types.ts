import type { Category } from './constants'

export type CollectionJobStatus = 'running' | 'completed' | 'failed'

export interface CollectionRunnerInput {
  category: Category
  dateFrom: string
  dateTo: string
  rawDir: string
}

export interface CollectionRunnerResult {
  body: Buffer | Uint8Array | string
  stdout?: Buffer | string
  stderr?: Buffer | string
}

export type CollectionRunner = (
  input: CollectionRunnerInput,
) => Promise<CollectionRunnerResult>

export interface CollectionJob {
  id: string
  category: Category
  dateFrom: string
  dateTo: string
  status: CollectionJobStatus
  createdAt: string
  rawDir: string
  finishedAt?: string
  messages?: number | null
  summary?: string | null
  error?: string | null
  result?: Buffer
}

export interface PublicCollectionJob {
  id: string
  category: Category
  dateFrom: string
  dateTo: string
  status: CollectionJobStatus
  createdAt: string
  finishedAt: string | null
  messages: number | null
  summary: string | null
  error: string | null
}

export interface StartCollectionInput {
  category: Category
  dateFrom: string
  dateTo: string
}

export type StartCollectionResult =
  | { ok: true; job: CollectionJob }
  | { ok: false; reason: 'busy' }
