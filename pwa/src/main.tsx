import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// SW registration now lives in <UpdateBanner /> via useRegisterSW (registerType:
// 'prompt') — the new SW precaches in the background and waits, surfacing a manual
// update instead of silently reloading and wiping in-progress input.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
