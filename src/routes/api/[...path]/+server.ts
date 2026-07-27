import type { RequestHandler } from './$types'

import { apiRouteNotFound, responseWithoutBody } from '$lib/server/news'

const notFound: RequestHandler = () => apiRouteNotFound()

export const GET = notFound

export const HEAD: RequestHandler = async (event) =>
  responseWithoutBody(await notFound(event))

export const fallback = notFound
