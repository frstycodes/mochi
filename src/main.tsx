import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { host } from './host';
import './index.css';

if (host.isDesktop) document.documentElement.dataset.desktop = '';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
