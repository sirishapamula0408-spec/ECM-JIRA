import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Box, Typography, Tabs, Tab, TextField, MenuItem, Grid, Card, CardContent, CardActions,
  Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel, Stack, Avatar,
} from '@mui/material'
import {
  fetchApps, fetchInstalled, installApp, uninstallApp, updateInstalled, registerApp,
} from '../../api/marketplaceApi'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import './MarketplacePage.css'

const CATEGORIES = ['', 'Communication', 'Developer Tools', 'Reporting', 'Automation', 'Other']

export function MarketplacePage() {
  const { isAdmin } = usePermissions()
  const [tab, setTab] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [apps, setApps] = useState([])
  const [installed, setInstalled] = useState([])
  const [detail, setDetail] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [regForm, setRegForm] = useState({ key: '', name: '', vendor: '', description: '', category: '', version: '1.0.0' })
  const [regError, setRegError] = useState('')

  const loadApps = useCallback(() => {
    fetchApps({ search, category })
      .then((d) => setApps(Array.isArray(d) ? d : []))
      .catch(() => setApps([]))
  }, [search, category])

  const loadInstalled = useCallback(() => {
    fetchInstalled()
      .then((d) => setInstalled(Array.isArray(d) ? d : []))
      .catch(() => setInstalled([]))
  }, [])

  useEffect(loadApps, [loadApps])
  useEffect(loadInstalled, [loadInstalled])

  const installedByAppId = useMemo(() => {
    const map = {}
    installed.forEach((i) => { map[i.app_id] = i })
    return map
  }, [installed])

  async function handleInstall(app) {
    try {
      await installApp(app.id)
      loadInstalled()
      setDetail(null)
    } catch { /* handled by client snackbar */ }
  }

  async function handleUninstall(app) {
    try {
      await uninstallApp(app.id)
      loadInstalled()
      setDetail(null)
    } catch { /* ignore */ }
  }

  async function handleToggle(inst) {
    try {
      await updateInstalled(inst.id, { enabled: !inst.enabled })
      loadInstalled()
    } catch { /* ignore */ }
  }

  async function handleRegister() {
    setRegError('')
    if (!regForm.key.trim() || !regForm.name.trim()) {
      setRegError('Key and name are required.')
      return
    }
    if (!/^[a-z0-9-]+$/.test(regForm.key.trim())) {
      setRegError('Key must be slug-like (lowercase letters, numbers, hyphens).')
      return
    }
    try {
      await registerApp(regForm)
      setShowRegister(false)
      setRegForm({ key: '', name: '', vendor: '', description: '', category: '', version: '1.0.0' })
      loadApps()
    } catch (err) {
      setRegError(err?.message || 'Failed to register app.')
    }
  }

  return (
    <Box className="page marketplace-page" sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h4" component="h1">Marketplace</Typography>
        {isAdmin && (
          <Button variant="contained" onClick={() => setShowRegister(true)}>Register app</Button>
        )}
      </Stack>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Browse" />
        <Tab label={`Installed (${installed.length})`} />
      </Tabs>

      {tab === 0 && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
            <TextField
              size="small" label="Search apps" value={search}
              onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 240 }}
            />
            <TextField
              size="small" select label="Category" value={category}
              onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 200 }}
            >
              {CATEGORIES.map((c) => <MenuItem key={c || 'all'} value={c}>{c || 'All categories'}</MenuItem>)}
            </TextField>
          </Stack>

          {apps.length === 0 ? (
            <EmptyState
              icon="🧩"
              title="No apps available"
              description="No marketplace listings match your filters. Admins can register a new app listing."
            />
          ) : (
            <Grid container spacing={2}>
              {apps.map((app) => (
                <Grid item xs={12} sm={6} md={4} key={app.id}>
                  <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                        <Avatar variant="rounded">{app.icon || (app.name || '?')[0]}</Avatar>
                        <Box>
                          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{app.name}</Typography>
                          {app.vendor && <Typography variant="caption" color="text.secondary">{app.vendor}</Typography>}
                        </Box>
                      </Stack>
                      {app.category && <Chip size="small" label={app.category} sx={{ mb: 1 }} />}
                      <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {app.description || 'No description provided.'}
                      </Typography>
                    </CardContent>
                    <CardActions sx={{ justifyContent: 'space-between' }}>
                      <Button size="small" onClick={() => setDetail(app)}>Details</Button>
                      {installedByAppId[app.id]
                        ? <Chip size="small" color="success" label="Installed" />
                        : isAdmin && <Button size="small" variant="contained" onClick={() => handleInstall(app)}>Install</Button>}
                    </CardActions>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}
        </>
      )}

      {tab === 1 && (
        installed.length === 0 ? (
          <EmptyState icon="📦" title="No installed apps" description="Browse the marketplace to install apps into this workspace." />
        ) : (
          <Stack spacing={1.5}>
            {installed.map((inst) => (
              <Card key={inst.id} variant="outlined">
                <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Avatar variant="rounded">{inst.icon || (inst.name || '?')[0]}</Avatar>
                    <Box>
                      <Typography variant="subtitle1">{inst.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{inst.vendor} · v{inst.version}</Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <FormControlLabel
                      control={<Switch checked={!!inst.enabled} onChange={() => handleToggle(inst)} disabled={!isAdmin} />}
                      label={inst.enabled ? 'Enabled' : 'Disabled'}
                    />
                    {isAdmin && <Button size="small" color="error" onClick={() => handleUninstall({ id: inst.app_id })}>Uninstall</Button>}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )
      )}

      {/* App detail dialog */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        {detail && (
          <>
            <DialogTitle>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar variant="rounded">{detail.icon || (detail.name || '?')[0]}</Avatar>
                <Box>
                  {detail.name}
                  {detail.vendor && <Typography variant="caption" display="block" color="text.secondary">{detail.vendor} · v{detail.version}</Typography>}
                </Box>
              </Stack>
            </DialogTitle>
            <DialogContent dividers>
              {detail.category && <Chip size="small" label={detail.category} sx={{ mb: 2 }} />}
              <Typography variant="body2">{detail.description || 'No description provided.'}</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDetail(null)}>Close</Button>
              {isAdmin && (installedByAppId[detail.id]
                ? <Button color="error" onClick={() => handleUninstall(detail)}>Uninstall</Button>
                : <Button variant="contained" onClick={() => handleInstall(detail)}>Install</Button>)}
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Register listing dialog (Admin) */}
      <Dialog open={showRegister} onClose={() => setShowRegister(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register app listing</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {regError && <Typography color="error" variant="body2">{regError}</Typography>}
            <TextField label="Key (slug)" value={regForm.key} onChange={(e) => setRegForm((f) => ({ ...f, key: e.target.value }))} helperText="Lowercase letters, numbers, hyphens" required />
            <TextField label="Name" value={regForm.name} onChange={(e) => setRegForm((f) => ({ ...f, name: e.target.value }))} required />
            <TextField label="Vendor" value={regForm.vendor} onChange={(e) => setRegForm((f) => ({ ...f, vendor: e.target.value }))} />
            <TextField select label="Category" value={regForm.category} onChange={(e) => setRegForm((f) => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map((c) => <MenuItem key={c || 'none'} value={c}>{c || 'None'}</MenuItem>)}
            </TextField>
            <TextField label="Description" multiline rows={3} value={regForm.description} onChange={(e) => setRegForm((f) => ({ ...f, description: e.target.value }))} />
            <TextField label="Version" value={regForm.version} onChange={(e) => setRegForm((f) => ({ ...f, version: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRegister(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRegister}>Register</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
