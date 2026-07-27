import type { RequestHandler } from './$types'

import {
  collectionJobNotFound,
  collectionService,
  jsonResponse,
  methodNotAllowed,
  publicCollectionJob,
  responseWithoutBody,
} from '$lib/server/news'

const getCurrentJob: RequestHandler = () => {
  const job = collectionService.current()
  if (!job) return collectionJobNotFound()
  return jsonResponse(publicCollectionJob(job))
}

export const GET = getCurrentJob

export const HEAD: RequestHandler = async (event) =>
  responseWithoutBody(await getCurrentJob(event))

export const fallback: RequestHandler = () =>
  methodNotAllowed('GET, HEAD')
