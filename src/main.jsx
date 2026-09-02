import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// JL-414 (option B): self-hosted Inter, the closest open match to Atlassian
// Sans, which is proprietary and undistributed. SIL Open Font License.
// @fontsource ships the woff2 subsets in-package and already sets
// font-display: swap, so there is no CDN dependency and no blocking fetch.
// Imported before index.css so the @font-face rules are registered first.
import '@fontsource-variable/inter'
// JL-447: preload the latin subset — the one this app actually renders from.
//
// Injected here rather than written statically into index.html because the URL
// differs between dev and build: Vite serves the package path in dev and a
// content-hashed asset after `vite build`. A hardcoded <link> would be correct
// in exactly one of those, and in the other it would preload a file the
// @font-face never requests — costing a download AND leaving the real font
// unpreloaded, which is the worst of both.
//
// `?url` makes Vite resolve the same file its own @font-face points at, so the
// preload cannot drift from the thing being loaded. `crossorigin` is required
// on font preloads even same-origin; without it the browser fetches it twice.
import interLatinWoff2 from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'
import './index.css'

const fontPreload = document.createElement('link')
fontPreload.rel = 'preload'
fontPreload.as = 'font'
fontPreload.type = 'font/woff2'
fontPreload.crossOrigin = 'anonymous'
fontPreload.href = interLatinWoff2
document.head.prepend(fontPreload)
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
