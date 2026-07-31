import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { ToastProvider } from './components/ui/Toast'
import { DialogProvider } from './components/ui/DialogProvider'

const host = document.getElementById('root')
if (!host) throw new Error('missing #root')

createRoot(host).render(
  <StrictMode>
    <ToastProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ToastProvider>
  </StrictMode>,
)
