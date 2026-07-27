import { MAX_DIGEST_BYTES } from './constants'

export class ApiResponseError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = status
  }
}

export function jsonResponse(
  payload: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const body = JSON.stringify(payload)
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
  responseHeaders.set('Content-Length', String(Buffer.byteLength(body)))

  return new Response(body, { status, headers: responseHeaders })
}

export function markdownResponse(body: Buffer, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('Content-Type', 'text/markdown; charset=utf-8')
  responseHeaders.set('Content-Length', String(body.length))

  return new Response(new Uint8Array(body), { status: 200, headers: responseHeaders })
}

export function responseWithoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function apiRouteNotFound(): Response {
  return jsonResponse({ error: 'API route not found' }, 404)
}

export function collectionJobNotFound(): Response {
  return jsonResponse({ error: 'Collection job not found' }, 404)
}

export function methodNotAllowed(allow: string): Response {
  return jsonResponse(
    { error: 'Method not allowed' },
    405,
    { Allow: allow },
  )
}

export function internalServerError(error: unknown): Response {
  console.error(error)
  return jsonResponse({ error: 'Internal server error' }, 500)
}

export async function readRequestBody(
  request: Request,
  maximumBytes = MAX_DIGEST_BYTES,
): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    size += value.byteLength
    if (size > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new ApiResponseError(413, 'Digest is too large')
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size)
}
