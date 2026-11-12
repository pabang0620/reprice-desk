import { PaypalError as SdkError } from 'paypal'
import { PaypalError } from './errors.js'

// One mapping from the SDK's error family to this app's PaypalError. The central errorHandler returns
// err.status and err.message, so every message here is written for the caller and never contains an SDK message
// (which names the method and URL).
export const MESSAGES = {
  credentials: "PayPal rejected this app's credentials.",
  rateLimited: 'PayPal is rate limiting this app. Try again shortly.',
  server: 'PayPal had an error.',
  unreadable: 'PayPal answered but the reply could not be read.',
  unreachable: 'PayPal could not be reached.',
  rejected: 'PayPal rejected the request.',
  unknown: 'PayPal may have applied this change but it could not be confirmed. Read the member back before doing anything else.',
}

export function isSdkError(err) {
  return err instanceof SdkError
}

// The declared error body is the same model on every arm, so the arm tag is not read (tags differ per operation).
export function reasonOf(err) {
  const payload = err?.payload
  const body = payload && 'body' in payload ? payload.body : null
  if (!body || typeof body.message !== 'string') return null
  const details = Array.isArray(body.details)
    ? body.details.map((d) => d?.description || d?.issue).filter((t) => typeof t === 'string')
    : []
  return [body.message, ...details].join(' ').slice(0, 500)
}

function fromStatus(err) {
  const { status } = err
  if (status === 401 || status === 403) return new PaypalError('PAYPAL_CREDENTIALS', MESSAGES.credentials, 502)
  if (status === 429) return new PaypalError('PAYPAL_RATE_LIMITED', MESSAGES.rateLimited, 503)
  if (status >= 400 && status < 500) return new PaypalError('PAYPAL_REJECTED', reasonOf(err) || MESSAGES.rejected, status)
  return new PaypalError('PAYPAL_ERROR', MESSAGES.server, 502)
}

// Returns an app PaypalError for every failure of the SDK family; anything else (an abort reason, a bug) is rethrown by the caller.
export function toPaypalError(err) {
  if (err instanceof PaypalError) return err
  if (!isSdkError(err)) return err
  switch (err.kind) {
    case 'api':
      return fromStatus(err)
    case 'decode':
      // A body that would not decode on a success status is unknown. On an error status only the detail was lost.
      return err.status >= 200 && err.status < 300
        ? new PaypalError('PAYPAL_UNREADABLE', MESSAGES.unreadable, 502)
        : err.status >= 400 && err.status < 500 && ![401, 403, 429].includes(err.status)
          ? new PaypalError('PAYPAL_REJECTED', MESSAGES.rejected, err.status)
          : fromStatus(err)
    case 'connection':
    case 'timeout':
      return new PaypalError('PAYPAL_UNREACHABLE', MESSAGES.unreachable, 502)
    case 'auth':
      return new PaypalError('AUTH_FAILED', MESSAGES.credentials, 502)
    case 'encode':
      return new PaypalError('INTEGRATION_DEFECT', 'The request could not be built.', 500)
    default:
      return new PaypalError('PAYPAL_ERROR', MESSAGES.server, 502)
  }
}

export function outcomeUnknown() {
  return new PaypalError('OUTCOME_UNKNOWN', MESSAGES.unknown, 502)
}

// What kind of failure was it for a WRITE?
//   'refused': PayPal said no, or the request never left. Nothing was applied, so the claim is released.
//   'maybe': PayPal may have acted without us learning the answer. Re-read before saying anything.
export function writeFailureKind(err) {
  // A 2xx reply that lacks the member we need (the new id) is the same as a reply we could not read: PayPal acted.
  if (err instanceof PaypalError && err.code === 'PAYPAL_UNREADABLE') return 'maybe'
  if (!isSdkError(err)) return 'refused'
  switch (err.kind) {
    case 'connection':
    case 'timeout':
      return 'maybe'
    case 'decode':
      return err.status >= 200 && err.status < 300 ? 'maybe' : 'refused'
    case 'api':
      return err.status >= 500 ? 'maybe' : 'refused'
    default:
      return 'refused'
  }
}
