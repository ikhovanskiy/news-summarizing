import type { RequestHandler } from './$types'

import { jsonResponse, responseWithoutBody } from '$lib/server/news'

const health: RequestHandler = () => jsonResponse({ status: 'ok' })

export const GET = health

export const HEAD: RequestHandler = async (event) =>
  responseWithoutBody(await health(event))

export const fallback = health
