import { z } from 'zod'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  return result.data
}

export const sessionIdSchema = z.string().uuid()

// Central error handler: every route passes errors here with next(err).
export function errorHandler(err, req, res, _next) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500
  if (status === 500) process.stderr.write(`${err.stack || err}\n`)
  const message = status === 500 ? 'Something went wrong on the server.' : err.message
  res.status(status).json({ success: false, message })
}
