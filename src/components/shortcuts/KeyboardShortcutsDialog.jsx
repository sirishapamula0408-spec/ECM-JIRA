import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Box from '@mui/material/Box'

import { KEYBOARD_SHORTCUTS } from '../../hooks/useKeyboardShortcuts'

function KeyCap({ label }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-block',
        minWidth: 22,
        px: 0.75,
        py: 0.25,
        textAlign: 'center',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        lineHeight: 1.4,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        boxShadow: '0 1px 0 rgba(0,0,0,0.15)',
      }}
    >
      {label}
    </Box>
  )
}

export function KeyboardShortcutsDialog({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="keyboard-shortcuts-title">
      <DialogTitle id="keyboard-shortcuts-title">Keyboard shortcuts</DialogTitle>
      <DialogContent dividers>
        <List dense disablePadding>
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <ListItem
              key={shortcut.keys.join('+')}
              disableGutters
              secondaryAction={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {shortcut.keys.map((k, idx) => (
                    <Box component="span" key={`${k}-${idx}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {idx > 0 && (
                        <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                          then
                        </Box>
                      )}
                      <KeyCap label={k} />
                    </Box>
                  ))}
                </Box>
              }
            >
              <ListItemText primary={shortcut.description} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
