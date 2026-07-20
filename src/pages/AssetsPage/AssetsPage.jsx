import { useEffect, useState, useCallback } from 'react'
import {
  Box, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, TextField, Select, MenuItem, FormControl, InputLabel, Dialog, DialogTitle,
  DialogContent, DialogActions, IconButton, Chip, Typography, Stack, Alert,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CloseIcon from '@mui/icons-material/Close'
import {
  fetchAssets, fetchAssetTypes, createAsset, updateAsset, deleteAsset,
  createAssetType, ASSET_STATUSES,
} from '../../api/assetApi'
import { usePermissions } from '../../hooks/usePermissions'
import { EmptyState } from '../../components/common/EmptyState'
import { useConfirm } from '../../components/common/ConfirmDialog'
import './AssetsPage.css'

const STATUS_COLORS = {
  active: 'success', inactive: 'default', maintenance: 'warning', retired: 'error',
}

const EMPTY_ASSET = { name: '', asset_type_id: '', status: 'active', owner_email: '', attributes: [] }

export function AssetsPage() {
  const [assets, setAssets] = useState([])
  const [types, setTypes] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [error, setError] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null) // asset id or null
  const [form, setForm] = useState(EMPTY_ASSET)

  const [typeDialogOpen, setTypeDialogOpen] = useState(false)
  const [newType, setNewType] = useState({ name: '', icon: '' })

  const { isAdmin } = usePermissions()
  const { confirm, confirmDialog } = useConfirm()

  const loadTypes = useCallback(() => {
    fetchAssetTypes().then((d) => setTypes(Array.isArray(d) ? d : [])).catch(() => setTypes([]))
  }, [])

  const loadAssets = useCallback(() => {
    fetchAssets({ search, type: typeFilter })
      .then((d) => setAssets(Array.isArray(d) ? d : []))
      .catch((e) => setError(e?.message || 'Failed to load assets'))
  }, [search, typeFilter])

  useEffect(() => { loadTypes() }, [loadTypes])
  useEffect(() => {
    const t = setTimeout(loadAssets, 200)
    return () => clearTimeout(t)
  }, [loadAssets])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_ASSET, asset_type_id: types[0]?.id || '' })
    setDialogOpen(true)
  }

  function openEdit(asset) {
    setEditing(asset.id)
    setForm({
      name: asset.name,
      asset_type_id: asset.asset_type_id,
      status: asset.status,
      owner_email: asset.owner_email || '',
      attributes: Object.entries(asset.attributes || {}).map(([key, value]) => ({ key, value: String(value) })),
    })
    setDialogOpen(true)
  }

  function setAttr(idx, field, value) {
    setForm((f) => {
      const attributes = [...f.attributes]
      attributes[idx] = { ...attributes[idx], [field]: value }
      return { ...f, attributes }
    })
  }
  function addAttr() {
    setForm((f) => ({ ...f, attributes: [...f.attributes, { key: '', value: '' }] }))
  }
  function removeAttr(idx) {
    setForm((f) => ({ ...f, attributes: f.attributes.filter((_, i) => i !== idx) }))
  }

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    const attributes = {}
    for (const { key, value } of form.attributes) {
      if (key.trim()) attributes[key.trim()] = value
    }
    const payload = {
      name: form.name,
      asset_type_id: Number(form.asset_type_id),
      status: form.status,
      owner_email: form.owner_email,
      attributes,
    }
    try {
      if (editing) await updateAsset(editing, payload)
      else await createAsset(payload)
      setDialogOpen(false)
      loadAssets()
      loadTypes()
    } catch (err) {
      setError(err?.data?.error || err?.message || 'Failed to save asset')
    }
  }

  async function handleDelete(asset) {
    if (!(await confirm({ title: 'Delete asset?', message: `Delete asset "${asset.name}"?`, confirmLabel: 'Delete', danger: true }))) return
    try {
      await deleteAsset(asset.id)
      loadAssets()
      loadTypes()
    } catch (err) {
      setError(err?.message || 'Failed to delete asset')
    }
  }

  async function handleCreateType(e) {
    e.preventDefault()
    setError('')
    try {
      await createAssetType(newType)
      setNewType({ name: '', icon: '' })
      setTypeDialogOpen(false)
      loadTypes()
    } catch (err) {
      setError(err?.data?.error || err?.message || 'Failed to create asset type')
    }
  }

  return (
    <Box className="assets-page" sx={{ p: 3 }}>
      {confirmDialog}
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h5" fontWeight={600}>Assets (CMDB)</Typography>
        <Stack direction="row" spacing={1}>
          {isAdmin && (
            <Button variant="outlined" onClick={() => setTypeDialogOpen(true)}>New asset type</Button>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={types.length === 0}>
            New asset
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Stack direction="row" spacing={2} mb={2} flexWrap="wrap">
        <TextField
          size="small" label="Search" value={search}
          onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 220 }}
        />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Type</InputLabel>
          <Select label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <MenuItem value="">All types</MenuItem>
            {types.map((t) => (
              <MenuItem key={t.id} value={t.id}>{t.icon ? `${t.icon} ` : ''}{t.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {assets.length === 0 ? (
        <EmptyState
          icon="🗄️"
          title="No assets yet"
          description={types.length === 0
            ? 'Create an asset type first, then add assets to your CMDB.'
            : 'Add your first server, laptop, service or license to the CMDB.'}
        />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Attributes</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assets.map((a) => (
                <TableRow key={a.id} hover>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{a.typeIcon ? `${a.typeIcon} ` : ''}{a.typeName}</TableCell>
                  <TableCell>
                    <Chip size="small" label={a.status} color={STATUS_COLORS[a.status] || 'default'} />
                  </TableCell>
                  <TableCell>{a.owner_email || '—'}</TableCell>
                  <TableCell>
                    {Object.entries(a.attributes || {}).slice(0, 3).map(([k, v]) => (
                      <Chip key={k} size="small" variant="outlined" label={`${k}: ${v}`} sx={{ mr: 0.5, mb: 0.5 }} />
                    ))}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(a)} aria-label="edit"><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => handleDelete(a)} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / edit asset dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit asset' : 'New asset'}</DialogTitle>
        <form onSubmit={handleSave}>
          <DialogContent>
            <Stack spacing={2} mt={0.5}>
              <TextField
                label="Name" required value={form.name} autoFocus
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <FormControl required>
                <InputLabel>Type</InputLabel>
                <Select
                  label="Type" value={form.asset_type_id}
                  onChange={(e) => setForm((f) => ({ ...f, asset_type_id: e.target.value }))}
                >
                  {types.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.icon ? `${t.icon} ` : ''}{t.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status" value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  {ASSET_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField
                label="Owner email" value={form.owner_email}
                onChange={(e) => setForm((f) => ({ ...f, owner_email: e.target.value }))}
              />
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2">Attributes</Typography>
                  <Button size="small" startIcon={<AddIcon />} onClick={addAttr}>Add</Button>
                </Stack>
                {form.attributes.map((attr, idx) => (
                  <Stack direction="row" spacing={1} mb={1} key={idx} alignItems="center">
                    <TextField
                      size="small" placeholder="Key" value={attr.key}
                      onChange={(e) => setAttr(idx, 'key', e.target.value)}
                    />
                    <TextField
                      size="small" placeholder="Value" value={attr.value} fullWidth
                      onChange={(e) => setAttr(idx, 'value', e.target.value)}
                    />
                    <IconButton size="small" onClick={() => removeAttr(idx)} aria-label="remove attribute">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">{editing ? 'Save' : 'Create'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Create asset type dialog */}
      <Dialog open={typeDialogOpen} onClose={() => setTypeDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New asset type</DialogTitle>
        <form onSubmit={handleCreateType}>
          <DialogContent>
            <Stack spacing={2} mt={0.5}>
              <TextField
                label="Name" required autoFocus value={newType.name}
                onChange={(e) => setNewType((t) => ({ ...t, name: e.target.value }))}
                placeholder="e.g. Server, Laptop, Service"
              />
              <TextField
                label="Icon (emoji)" value={newType.icon}
                onChange={(e) => setNewType((t) => ({ ...t, icon: e.target.value }))}
                placeholder="🖥️"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTypeDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Create</Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  )
}

export default AssetsPage
