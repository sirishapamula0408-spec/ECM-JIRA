import { api } from './client.js'

export const fetchDashboard = () => api('/api/dashboard')
export const fetchReports = () => api('/api/reports')
export const fetchRoadmap = () => api('/api/roadmap')
export const fetchWorkflows = () => api('/api/workflows')
export const fetchActivity = () => api('/api/activity')
