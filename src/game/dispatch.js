// Single entry point for player actions during a mission.
// Solo / squad host: applied directly to the authoritative engine (with role checks for squads).
// Squad client: forwarded to the host over the real-time channel; the host validates & applies.
import { runtime, bumpRuntime, useGame } from '../state/store.js';

export function dispatch(action) {
  const e = runtime.engine;
  if (!e) return { ok: false, msg: 'No active mission.' };
  const sc = runtime.squadClient;
  if (sc && !sc.isHost) { sc.sendAction(action); return { ok: true, pending: true, msg: 'Sent to mission host…' }; }
  const actor = sc ? sc.localActor() : {};
  const res = e.act(action, actor);
  if (sc) sc.afterLocalAction?.();
  bumpRuntime();
  return res;
}

export function act(action, { quiet = false } = {}) {
  const r = dispatch(action);
  if (!quiet && r && !r.pending) useGame.getState().toast(r.msg, r.ok ? 'good' : 'bad', r.ok ? 2500 : 5000);
  return r;
}
