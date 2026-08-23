import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';

export const notFound = (req, _res, next) =>
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    error = ApiError.badRequest('Please check the highlighted fields', 'VALIDATION', details);
  } else if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || { field: 1 })[0];
    const label = field === 'email' ? 'That email is already registered'
      : field === 'username' ? 'That username is taken'
      : 'That already exists';
    error = ApiError.conflict(label, 'DUPLICATE');
  } else if (err.name === 'CastError') {
    error = ApiError.badRequest('Malformed identifier', 'BAD_ID');
  } else if (err.type === 'entity.too.large') {
    error = ApiError.badRequest('That file is too large', 'PAYLOAD_TOO_LARGE');
  } else if (!(err instanceof ApiError)) {
    error = new ApiError(err.status || 500, err.message || 'Something went wrong');
    error.isOperational = false;
  }

  if (!error.isOperational || error.status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} — ${err.message}`);
    if (!env.isProd) console.error(err.stack);
  }

  res.status(error.status).json({
    success: false,
    message: error.message,
    code: error.code,
    ...(error.details ? { details: error.details } : {}),
    ...(env.isProd ? {} : { stack: error.stack?.split('\n').slice(0, 4) }),
  });
}
