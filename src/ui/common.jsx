import { Component, useEffect, useState } from 'react';
import { useGame } from '../state/store.js';

export const EMBLEMS = ['🛰', '🚀', '🌍', '🌙', '⭐', '☄', '🪐', '🔭', '🛸', '🧑‍🚀', '📡', '⚡'];

export function Avatar({ look, size = 40, emblem }) {
  const e = emblem ?? look?.emblem ?? 0;
  return <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.48, background: `radial-gradient(circle at 30% 30%, ${look?.suit || '#4fd1ff'}55, #0a1220)`, borderColor: look?.suit || 'var(--line)' }}>{EMBLEMS[e % EMBLEMS.length]}</div>;
}

export function Bar({ v, color, h = 6 }) {
  const pct = Math.max(0, Math.min(100, v * 100));
  const c = color || (pct > 50 ? 'var(--good)' : pct > 25 ? 'var(--warn)' : 'var(--bad)');
  return <div className="bar" style={{ height: h }}><i style={{ width: `${pct}%`, background: c }} /></div>;
}

export function Panel({ title, right, children, onClose, onMin, minimized, className = '', style }) {
  return (
    <div className={`glass ${className}`} style={style}>
      <div className="panel-head">
        <span>{title}</span>
        <span className="row" style={{ gap: 4 }}>
          {right}
          {onMin && <button className="btn xs ghost" aria-label={minimized ? 'Expand panel' : 'Minimize panel'} onClick={onMin}>{minimized ? '▸' : '▾'}</button>}
          {onClose && <button className="btn xs ghost" aria-label="Close panel" onClick={onClose}>✕</button>}
        </span>
      </div>
      {!minimized && children}
    </div>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return <div className="toast-wrap">{toasts.map((t) => <div key={t.id} className={`glass toast ${t.kind}`}>{t.msg}</div>)}</div>;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Countdown({ until }) {
  const [, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  return <span>{fmtTime((until - Date.now()) / 1000)}</span>;
}

export class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('ALUNA error boundary:', err, info?.componentStack); }
  render() {
    if (this.state.err) {
      return (
        <div className="center-screen" style={{ zIndex: 60 }}>
          <div className="glass card">
            <h2>Something went wrong</h2>
            <p className="muted small">{String(this.state.err?.message || this.state.err)}</p>
            <p className="small">Your progress is saved. You can return to headquarters and continue.</p>
            <div className="row">
              <button className="btn primary" onClick={() => { this.setState({ err: null }); this.props.onReset?.(); }}>Return to HQ</button>
              <button className="btn" onClick={() => location.reload()}>Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Confirm({ title, body, confirmText = 'Confirm', danger, onConfirm, onCancel, requireText }) {
  const [txt, setTxt] = useState('');
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="glass card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <div className="small muted" style={{ margin: '10px 0 14px' }}>{body}</div>
        {requireText && <div className="field"><label>Type <b>{requireText}</b> to confirm</label><input value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="confirmation text" /></div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={requireText && txt !== requireText} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
