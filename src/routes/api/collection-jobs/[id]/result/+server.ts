import type { RequestHandler } from './$types'

import {
  apiRouteNotFound,
  collectionJobNotFound,
  collectionService,
  internalServerError,
  isCollectionJobId,
  jsonResponse,
  markdownResponse,
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

const getResult: RequestHandler = ({ params }) => {
  const found = findJob(params.id)
  if (found.kind === 'invalid') return apiRouteNotFound()
  if (found.kind === 'missing') return collectionJobNotFound()

  const { job } = found
  if (job.status !== 'completed') {
    return jsonResponse(
      {
        error:
          job.status === 'failed'
            ? 'Collection failed'
            : 'Collection is still running',
        job: publicCollectionJob(job),
      },
      409,
    )
  }
  if (!job.result) {
    return internalServerError(
      new Error(`Completed collection job ${job.id} has no result`),
    )
  }

  return markdownResponse(job.result)
}

export const GET = getResult

export const HEAD: RequestHandler = async (event) =>
  responseWithoutBody(await getResult(event))

export const fallback: RequestHandler = ({ params }) => {
  const found = findJob(params.id)
  if (found.kind === 'invalid') return apiRouteNotFound()
  if (found.kind === 'missing') return collectionJobNotFound()
  return methodNotAllowed('GET, HEAD')
}
