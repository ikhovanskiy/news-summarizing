import type { RequestHandler } from './$types'

import {
  apiRouteNotFound,
  collectionJobNotFound,
  collectionService,
  isCollectionJobId,
  jsonResponse,
  methodNotAllowed,
  publicCollectionJob,
  responseWithoutBody,
} from '$lib/server/news'

function findJob(id: string | undefined) {
  if (!isCollectionJobId(id)) return { kind: 'invalid' } as const
  const job = collectionService.get(id)
  if (!job) return { kind: 'missing' } as const
  return { kind: 'found', job } as const
}

const getJob: RequestHandler = ({ params }) => {
  const found = findJob(params.id)
  if (found.kind === 'invalid') return apiRouteNotFound()
  if (found.kind === 'missing') return collectionJobNotFound()
  return jsonResponse(publicCollectionJob(found.job))
}

export const GET = getJob

export const HEAD: RequestHandler = async (event) =>
  responseWithoutBody(await getJob(event))

export const fallback: RequestHandler = ({ params }) => {
  const found = findJob(params.id)
  if (found.kind === 'invalid') return apiRouteNotFound()
  if (found.kind === 'missing') return collectionJobNotFound()
  return methodNotAllowed('GET, HEAD')
}
