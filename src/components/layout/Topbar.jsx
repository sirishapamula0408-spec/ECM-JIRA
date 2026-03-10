import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useMembers } from '../../context/MemberContext'
import './Topbar.css'
import { displayNameFromEmail } from '../../utils/helpers'

import {
  TextField,
  InputAdornment,
  Button,
  IconButton,
  Badge,
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Typography,
  Stack,
} from '@mui/material'

import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import LogoutIcon from '@mui/icons-material/Logout'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

export function Topbar({ onCreate, hasProjects }) {
  const { authUser: currentUser, handleLogout } = useAuth()
  const { theme, onThemeChange } = useTheme()
  const { profile } = useMembers()
  const navigate = useNavigate()

  const [userMenuAnchor, setUserMenuAnchor] = useState(null)
  const [themeMenuAnchor, setThemeMenuAnchor] = useState(null)

  const isUserMenuOpen = Boolean(userMenuAnchor)
  const isThemeMenuOpen = Boolean(themeMenuAnchor)

  const email = String(currentUser?.email || '').trim()
  const fullName = String(displayNameFromEmail(email) || profile?.full_name || 'User')
  const avatarText = (fullName || 'U').trim().charAt(0).toUpperCase() || 'U'

  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const liveDate = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const liveTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const handleUserMenuOpen = (event) => {
    setUserMenuAnchor(event.currentTarget)
  }

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null)
    setThemeMenuAnchor(null)
  }

  const handleThemeMenuOpen = (event) => {
    setThemeMenuAnchor(event.currentTarget)
  }

  const handleThemeMenuClose = () => {
    setThemeMenuAnchor(null)
  }

  const handleThemeSelect = (selectedTheme) => {
    onThemeChange(selectedTheme)
    handleThemeMenuClose()
    handleUserMenuClose()
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <TextField
          className="search"
          placeholder="Search"
          size="small"
          variant="outlined"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </div>

      <div className="top-actions top-actions-jira">
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onCreate}
          disabled={!hasProjects}
          title={!hasProjects ? 'No project access' : undefined}
          size="small"
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Create
        </Button>

        <IconButton aria-label="Notifications" size="small">
          <Badge variant="dot" color="error">
            <NotificationsOutlinedIcon fontSize="small" />
          </Badge>
        </IconButton>

        <IconButton aria-label="Help" size="small">
          <HelpOutlineIcon fontSize="small" />
        </IconButton>

        <IconButton aria-label="Settings" size="small">
          <SettingsOutlinedIcon fontSize="small" />
        </IconButton>

        <Box className="topbar-live-clock">
          <Typography className="topbar-clock-time" component="span">
            {liveTime}
          </Typography>
          <Typography className="topbar-clock-date" component="span">
            {liveDate}
          </Typography>
        </Box>

        <IconButton
          aria-label="Open user menu"
          onClick={handleUserMenuOpen}
          size="small"
          sx={{ p: 0 }}
        >
          <Avatar
            sx={{
              width: 32,
              height: 32,
              fontSize: 14,
              bgcolor: 'primary.main',
              cursor: 'pointer',
            }}
          >
            {avatarText}
          </Avatar>
        </IconButton>

        <Menu
          anchorEl={userMenuAnchor}
          open={isUserMenuOpen}
          onClose={handleUserMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          slotProps={{
            paper: {
              sx: {
                width: 290,
                mt: 1,
                borderRadius: '10px',
                boxShadow: '0 12px 24px rgba(9, 30, 66, 0.2)',
              },
            },
          }}
        >
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', px: 2, py: 1.5, borderBottom: '1px solid #ebecf0' }}>
            <Avatar sx={{ width: 44, height: 44, bgcolor: 'primary.main' }}>
              {avatarText}
            </Avatar>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {fullName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {email || 'user@example.com'}
              </Typography>
            </Box>
          </Box>

          <MenuItem onClick={() => { handleUserMenuClose(); navigate('/profile') }}>
            <ListItemIcon>
              <PersonOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Profile</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => { handleUserMenuClose(); navigate('/profile') }}>
            <ListItemIcon>
              <ManageAccountsOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Account settings</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleThemeMenuOpen}>
            <ListItemIcon>
              <PaletteOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Theme</ListItemText>
            <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary', ml: 'auto' }} />
          </MenuItem>

          <MenuItem onClick={() => { handleUserMenuClose(); navigate('/dashboard') }}>
            <ListItemIcon>
              <DashboardOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Open Quickstart</ListItemText>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleLogout}>
            <ListItemIcon>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Switch account</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleLogout}>
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Log out</ListItemText>
          </MenuItem>
        </Menu>

        <Menu
          anchorEl={themeMenuAnchor}
          open={isThemeMenuOpen}
          onClose={handleThemeMenuClose}
          anchorOrigin={{ horizontal: 'left', vertical: 'top' }}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          slotProps={{
            paper: {
              sx: {
                width: 140,
                borderRadius: '8px',
                boxShadow: '0 8px 16px rgba(9, 30, 66, 0.2)',
              },
            },
          }}
        >
          <MenuItem onClick={() => handleThemeSelect('light')}>
            <ListItemIcon>
              <LightModeOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Light</ListItemText>
            {theme === 'light' && <Typography variant="body2" sx={{ ml: 1 }}>&#10003;</Typography>}
          </MenuItem>
          <MenuItem onClick={() => handleThemeSelect('dark')}>
            <ListItemIcon>
              <DarkModeOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Dark</ListItemText>
            {theme === 'dark' && <Typography variant="body2" sx={{ ml: 1 }}>&#10003;</Typography>}
          </MenuItem>
        </Menu>
      </div>
    </header>
  )
}
