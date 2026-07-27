import type { Category } from './constants'

export type CollectionJobStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface CollectionProgress {
  currentChannel: string
  currentDate: string
  channelsCompleted: number
  channelsTotal: number
  messages: number
}

export interface CollectionRunnerInput {
  category: Category
  dateFrom: string
  dateTo: string
  rawDir: string
  signal: AbortSignal
  onProgress?: (progress: CollectionProgress) => void
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
  abortController?: AbortController
  progress?: CollectionProgress | null
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
  progress: CollectionProgress | null
}

export interface StartCollectionInput {
  category: Category
  dateFrom: string
  dateTo: string
}

export interface StartCollectionResult {
  ok: true
  job: CollectionJob
  replacedJobIds: string[]
}
