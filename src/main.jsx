import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// JL-414 (option B): self-hosted Inter, the closest open match to Atlassian
// Sans, which is proprietary and undistributed. SIL Open Font License.
// @fontsource ships the woff2 subsets in-package and already sets
// font-display: swap, so there is no CDN dependency and no blocking fetch.
// Imported before index.css so the @font-face rules are registered first.
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
