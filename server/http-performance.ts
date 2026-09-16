import type express from 'express'

export const HTTP_LARGE_RESPONSE_BYTES = 256 * 1024
export const HTTP_SLOW_REQUEST_MILLIS = 500

type HttpPerformanceSample = {
  bytes: number
  elapsedMillis: number
}

export function shouldReportHttpPerformance(sample: HttpPerformanceSample) {
  return sample.elapsedMillis >= HTTP_SLOW_REQUEST_MILLIS ||
    sample.bytes >= HTTP_LARGE_RESPONSE_BYTES
}

function responseBytes(response: express.Response) {
  const value = response.getHeader('content-length')
  const bytes = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : 0
}

function routeName(request: express.Request) {
  const path = request.route?.path
  if (typeof path !== 'string') return 'unmatched'
  return `${request.baseUrl}${path}` || '/'
}

export function reportHttpPerformance(
  report: (message: string) => void = (message) => console.warn(message),
) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const startedAt = performance.now()
    response.once('finish', () => {
      const sample = {
        bytes: responseBytes(response),
        elapsedMillis: performance.now() - startedAt,
      }
      if (!shouldReportHttpPerformance(sample)) return
      report(JSON.stringify({
        bytes: sample.bytes,
        elapsedMillis: Math.round(sample.elapsedMillis),
        method: request.method,
        route: routeName(request),
        status: response.statusCode,
        type: 'http.performance',
      }))
    })
    next()
  }
}
