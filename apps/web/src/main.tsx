import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('FastShare could not find its application root.');
}

createRoot(rootElement).render(
  <StrictMode>
    <main>
      <h1>FastShare</h1>
      <p>The web application foundation is ready for incremental development.</p>
    </main>
  </StrictMode>,
);
