import { useEffect, useState, useCallback } from 'react'
import {
  Box, Typography, Paper, TextField, MenuItem, Button, Stack, Chip,
  Table, TableHead, TableRow, TableCell, TableBody, Alert, Divider,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import { fetchBiSchema, downloadIssuesExport, downloadDimensionExport } from '../../api/biExportApi'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import './BiExportPage.css'

const FORMATS = ['json', 'csv', 'ndjson']
const DIMENSIONS = ['projects', 'users', 'statuses', 'priorities', 'types']

export function BiExportPage() {
  const { isAdmin } = usePermissions()
  const [schema, setSchema] = useState(null)
  const [error, setError] = useState('')
  const [since, setSince] = useState('')
  const [format, setFormat] = useState('json')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchBiSchema()
      .then(setSchema)
      .catch(() => setError('Failed to load BI schema'))
  }, [])

  useEffect(load, [load])

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch {
      setError('Export failed. Check your permissions and try again.')
    } finally {
      setBusy(false)
    }
  }

  // Convert a date-only input (yyyy-mm-dd) into an ISO timestamp for the cursor.
  const sinceIso = since ? new Date(since).toISOString() : ''

  if (!isAdmin) {
    return (
      <Box className="page bi-export-page">
        <EmptyState
          title="Admins only"
          description="The BI / data-warehouse export is restricted to workspace administrators."
        />
      </Box>
    )
  }

  return (
    <Box className="page bi-export-page">
      <Typography variant="h4" gutterBottom>BI / Data Warehouse Export</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        A normalized, star-schema-style dataset (issues fact table + dimension lookups) for
        your data warehouse or BI tool. Supports incremental pulls by <code>updated_at</code>.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Incremental issues fact export */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Issues fact export</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-end' }}>
          <TextField
            label="Since (updated_at cursor)"
            type="date"
            size="small"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Leave blank for a full export"
          />
          <TextField
            label="Format"
            select
            size="small"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            {FORMATS.map((f) => <MenuItem key={f} value={f}>{f.toUpperCase()}</MenuItem>)}
          </TextField>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            disabled={busy}
            onClick={() => run(() => downloadIssuesExport({ since: sinceIso, format }))}
          >
            Download issues
          </Button>
        </Stack>
      </Paper>

      {/* Dimension downloads */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Dimension tables</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {DIMENSIONS.map((name) => (
            <Button
              key={name}
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon />}
              disabled={busy}
              onClick={() => run(() => downloadDimensionExport(name, format))}
            >
              {name}
            </Button>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Downloads use the format selected above.
        </Typography>
      </Paper>

      {/* Schema description */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>Dataset schema</Typography>
        {!schema ? (
          <Typography variant="body2" color="text.secondary">Loading schema…</Typography>
        ) : (
          schema.datasets.map((ds) => (
            <Box key={ds.name} sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="subtitle1">{ds.name}</Typography>
                <Chip size="small" label={ds.type} color={ds.type === 'fact' ? 'primary' : 'default'} />
              </Stack>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Column</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Description</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ds.columns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell><code>{c.name}</code></TableCell>
                      <TableCell>{c.type}</TableCell>
                      <TableCell>{c.description || ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Divider sx={{ mt: 2 }} />
            </Box>
          ))
        )}
      </Paper>
    </Box>
  )
}
