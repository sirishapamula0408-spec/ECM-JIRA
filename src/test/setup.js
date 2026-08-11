// Client (jsdom) test setup. The environment-only half lives in setup.env.js so
// the server project can share it without pulling in DOM-dependent imports.
import './setup.env.js'
import '@testing-library/jest-dom'
