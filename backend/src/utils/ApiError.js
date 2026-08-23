export class ApiError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(m = 'Bad request', code, details) { return new ApiError(400, m, code, details); }
  static unauthorized(m = 'Not authenticated', code) { return new ApiError(401, m, code); }
  static forbidden(m = 'Not allowed', code) { return new ApiError(403, m, code); }
  static notFound(m = 'Not found', code) { return new ApiError(404, m, code); }
  static conflict(m = 'Already exists', code) { return new ApiError(409, m, code); }
  static tooMany(m = 'Too many requests', code) { return new ApiError(429, m, code); }
  static internal(m = 'Something went wrong', code) { return new ApiError(500, m, code); }
}
