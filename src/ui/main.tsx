/** Mounts the app into #root. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureRegistry } from '@net/bootstrap';
import { App } from './App';
import './styles.css';
import './motion.css';

ensureRegistry();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from index.html');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
