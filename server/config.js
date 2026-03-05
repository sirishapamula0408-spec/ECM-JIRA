import path from 'node:path'

export const PORT = Number(process.env.PORT) || 4000
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve('server', 'data', 'jira.db')
export const JWT_SECRET = process.env.JWT_SECRET || 'ecm-jira-dev-secret-change-in-production'
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'
