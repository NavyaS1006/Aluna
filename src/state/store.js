import { create } from 'zustand';

let toastId = 0;

export const useGame = create((set, get) => ({
  screen: 'boot',
  platform: null,
  user: null, // { uid, username }
  profile: null,
  progress: null,
  mode: 'solo', // 'solo' | 'squad'
  mission: null,
  design: null,
  attempt: null, // { seed }
  result: null,
  squad: null,
  memberships: [],
  online: new Set(),
  friends: { friends: [], incoming: [], outgoing: [], declined: [] },
  facility: null,
  toasts: [],
  modal: null,
  hqArrived: false,
  squadSession: null, // { role, host, leader }
  webglOk: true,
  set: (patch) => set(patch),
  go: (screen, extra = {}) => set({ screen, ...extra }),
  toast: (msg, kind = 'info', ms = 4200) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, msg, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), ms);
  },
}));

// Mission runtime (engine lives outside React state; HUD re-renders on a throttled tick)
export const runtime = { engine: null, squadClient: null, startedReal: 0, listeners: new Set(), version: 0 };
export function bumpRuntime() { runtime.version++; for (const l of runtime.listeners) l(runtime.version); }

export const useHud = create((set) => ({
  tick: 0,
  selected: null,
  focus: null,
  panels: { objectives: true, inspector: true, log: true, ai: true, fleet: true, squad: true, conj: true },
  setSel: (id) => set({ selected: id }),
  setFocus: (id) => set({ focus: id }),
  toggle: (k) => set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } })),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));
