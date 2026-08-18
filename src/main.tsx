import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PlaybackProvider } from './hooks/playback/PlaybackContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlaybackProvider>
      <App />
    </PlaybackProvider>
  </React.StrictMode>,
);
