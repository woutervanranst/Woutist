// Minimal request/response shapes so handlers can be tested without the Functions host.
// The real `HttpRequest` / `HttpResponseInit` from @azure/functions satisfy these structurally.
import type { ApiErrorBody } from '@woutist/contracts'
import type { Logger } from './logger'

export const MAX_BODY_BYTES = 512 * 1024

export interface ApiRequest {
  readonly method?: string
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}

export interface ApiResponse {
  status: number
  jsonBody?: unknown
  headers?: Record<string, string>
}

/** An error that maps directly onto an HTTP error response. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly headers: Record<string, string> | undefined

  constructor(status: number, code: string, message: string, headers?: Record<string, string>) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.headers = headers
  }
}

export function errorResponse(status: number, error: string, message: string, headers?: Record<string, string>): ApiResponse {
  const body: ApiErrorBody = { error, message }
  return headers ? { status, jsonBody: body, headers } : { status, jsonBody: body }
}

export function noContent(): ApiResponse {
  return { status: 204 }
}

export function okJson(body: unknown): ApiResponse {
  return { status: 200, jsonBody: body }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, 'bad_request', message)
}

/** Reads and parses a JSON body, rejecting anything larger than {@link MAX_BODY_BYTES}. */
export async function readJsonBody(req: ApiRequest): Promise<unknown> {
  const declared = req.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw tooLarge()
  }
  const text = await req.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw tooLarge()
  }
  if (text.trim() === '') {
    throw badRequest('A JSON request body is required.')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw badRequest('The request body is not valid JSON.')
  }
}

function tooLarge(): HttpError {
  return new HttpError(413, 'payload_too_large', `The request body must not exceed ${MAX_BODY_BYTES} bytes.`)
}

/** Runs handler logic, turning {@link HttpError}s into responses and anything else into a 500. */
export async function handleErrors(log: Logger, fn: () => Promise<ApiResponse>): Promise<ApiResponse> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpError) {
      return errorResponse(err.status, err.code, err.message, err.headers)
    }
    log.error('Unhandled error while processing request', err)
    return errorResponse(500, 'internal_error', 'An unexpected error occurred.')
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
