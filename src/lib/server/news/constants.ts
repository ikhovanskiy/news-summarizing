export const CATEGORIES = ['world', 'crypto', 'invest'] as const

export type Category = (typeof CATEGORIES)[number]

export const MAX_DIGEST_BYTES = 2 * 1024 * 1024
export const MAX_RETAINED_COLLECTIONS = 20
export const COLLECTION_TIMEOUT_MS = 30 * 60 * 1000
export const COLLECTION_MAX_BUFFER_BYTES = 4 * 1024 * 1024

export const COLLECTION_JOB_ID_PATTERN = /^[0-9a-f-]{36}$/

const CATEGORY_SET = new Set<string>(CATEGORIES)

export function isCategory(value: string | undefined): value is Category {
  return typeof value === 'string' && CATEGORY_SET.has(value)
}

export function isCollectionJobId(value: string | undefined): value is string {
  return typeof value === 'string' && COLLECTION_JOB_ID_PATTERN.test(value)
}
