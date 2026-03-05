export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export function errorHandler(err, _req, res, _next) {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
