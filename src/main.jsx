import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

window.addEventListener('unhandledrejection', (e) => console.warn('ALUNA unhandled rejection:', e.reason));
import { useGame } from './state/store.js';
window.__alunaStore = useGame;
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
