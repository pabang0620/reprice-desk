export class PaypalError extends Error {
  constructor(code, message, status = 422) {
    super(message)
    this.code = code
    this.status = status
  }
}
