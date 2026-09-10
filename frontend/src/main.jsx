import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import GlassDefs from './pieces/GlassDefs.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GlassDefs />
    <App />
  </StrictMode>,
)
