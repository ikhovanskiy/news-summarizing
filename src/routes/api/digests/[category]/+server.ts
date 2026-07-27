import type { RequestHandler } from './$types'

import {
  ApiResponseError,
  apiRouteNotFound,
  internalServerError,
  isCategory,
  isMissingFileError,
  jsonResponse,
  markdownResponse,
  methodNotAllowed,
  readDigest,
  readRequestBody,
  responseWithoutBody,
  writeDigest,
} from '$lib/server/news'

const getDigest: RequestHandler = async ({ params }) => {
  if (!isCategory(params.category)) return apiRouteNotFound()

  try {
    const { body, etag } = await readDigest(params.category)
    return markdownResponse(body, { ETag: etag })
  } catch (error) {
    if (isMissingFileError(error)) {
      return jsonResponse(
        { error: 'Digest not found', category: params.category },
        404,
      )
    }
    return internalServerError(error)
  }
}

export const GET = getDigest

export const HEAD: RequestHandler = async (event) =>
  responseWithoutBody(await getDigest(event))

export const PUT: RequestHandler = async ({ params, request }) => {
  if (!isCategory(params.category)) return apiRouteNotFound()

  try {
    const body = await readRequestBody(request)
    if (body.length === 0 || body.toString('utf8').trim().length === 0) {
      return jsonResponse({ error: 'Digest cannot be empty' }, 400)
    }

    await writeDigest(params.category, body)
    return jsonResponse({
      category: params.category,
      bytes: body.length,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    if (error instanceof ApiResponseError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    return internalServerError(error)
  }
}

export const fallback: RequestHandler = ({ params }) =>
  isCategory(params.category)
    ? methodNotAllowed('GET, HEAD, PUT')
    : apiRouteNotFound()
