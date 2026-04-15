/**
 * Zod validation middleware.
 * Schema should be a z.object({ body?, query?, params? }) shape.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body  : req.body,
      query : req.query,
      params: req.params,
    });

    if (!result.success) {
      return res.status(422).json({
        error : 'Validation failed',
        issues: result.error.issues.map((i) => ({
          field  : i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // Replace req fields with parsed (coerced/stripped) values
    if (result.data.body)   req.body        = result.data.body;
    if (result.data.params) req.params      = result.data.params;
    if (result.data.query)  req.parsedQuery = result.data.query;

    next();
  };
}
