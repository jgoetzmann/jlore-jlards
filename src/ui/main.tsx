/** Mounts the app into #root. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureRegistry } from '@net/bootstrap';
import { App } from './App';
import './styles.css';
import './motion.css';
// Last, so its phone and touch rules win ties with every sheet above.
import './mobile.css';

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
