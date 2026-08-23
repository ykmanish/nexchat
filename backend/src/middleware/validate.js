import { ApiError } from '../utils/ApiError.js';

/** zod schema -> express middleware. Validates body/query/params in one pass. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    return next(ApiError.badRequest(details[0]?.message || 'Invalid input', 'VALIDATION', details));
  }
  req[source] = result.data;
  next();
};
