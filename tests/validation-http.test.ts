import { randomUUID } from 'node:crypto'

import { describe, expect, test } from 'vitest'

import {
  ApiResponseError,
  isCategory,
  isCollectionJobId,
  isIsoDate,
  readRequestBody,
} from '../src/lib/server/news'

describe('request validation', () => {
  test.each(['world', 'crypto', 'invest'])(
    'accepts the %s category',
    (category) => {
      expect(isCategory(category)).toBe(true)
    },
  )

  test.each([undefined, '', 'World', 'business', '../world'])(
    'rejects invalid category %s',
    (category) => {
      expect(isCategory(category)).toBe(false)
    },
  )

  test.each(['2026-07-27', '2024-02-29', '2000-01-01'])(
    'accepts ISO date %s',
    (date) => {
      expect(isIsoDate(date)).toBe(true)
    },
  )

  test.each([
    undefined,
    null,
    20260727,
    '',
    '2026-7-27',
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    'not-a-date',
  ])('rejects invalid ISO date %s', (date) => {
    expect(isIsoDate(date)).toBe(false)
  })

  test('validates collection job identifiers', () => {
    expect(isCollectionJobId(randomUUID())).toBe(true)
    expect(isCollectionJobId('too-short')).toBe(false)
    expect(isCollectionJobId(undefined)).toBe(false)
  })
})

describe('request body size enforcement', () => {
  test('returns an empty buffer when the request has no body', async () => {
    const body = await readRequestBody(new Request('http://news.test/'))
    expect(body.length).toBe(0)
  })

  test('accepts a body exactly at the configured byte limit', async () => {
    const request = new Request('http://news.test/api/digests/world', {
      method: 'PUT',
      body: '12345',
    })

    expect((await readRequestBody(request, 5)).toString()).toBe('12345')
  })

  test('rejects a body over the byte limit, including multibyte text', async () => {
    const request = new Request('http://news.test/api/digests/world', {
      method: 'PUT',
      body: 'ééé',
    })

    let failure: unknown
    try {
      await readRequestBody(request, 5)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(ApiResponseError)
    expect(failure).toMatchObject({
      status: 413,
      message: 'Digest is too large',
    })
  })
})
