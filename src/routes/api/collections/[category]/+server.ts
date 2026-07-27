import type { RequestHandler } from './$types'

import {
  apiRouteNotFound,
  collectionService,
  isCategory,
  isIsoDate,
  jsonResponse,
  methodNotAllowed,
  publicCollectionJob,
  readRequestBody,
} from '$lib/server/news'

function field(input: unknown, name: string): unknown {
  if (typeof input !== 'object' || input === null) return undefined
  return Reflect.get(input, name)
}

export const POST: RequestHandler = async ({ params, request }) => {
  if (!isCategory(params.category)) return apiRouteNotFound()

  let input: unknown
  try {
    input = JSON.parse((await readRequestBody(request)).toString('utf8'))
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400)
  }

  const dateFrom = field(input, 'dateFrom')
  const dateTo = field(input, 'dateTo')
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
    return jsonResponse(
      {
        error:
          'dateFrom and dateTo must be valid YYYY-MM-DD dates in ascending order',
      },
      400,
    )
  }

  const started = collectionService.start({
    category: params.category,
    dateFrom,
    dateTo,
  })
  if (!started.ok) {
    return jsonResponse(
      { error: 'Another collection is already running' },
      429,
    )
  }

  return jsonResponse(publicCollectionJob(started.job), 202)
}

export const fallback: RequestHandler = ({ params }) =>
  isCategory(params.category)
    ? methodNotAllowed('POST')
    : apiRouteNotFound()
