// Training & Simulation Room drills — practice scenarios that never affect attempts or progression.
const H = 3600;
const O = (type, label, params = {}) => ({ type, label, ...params });
export const TRAINING = [
  {
    id: 'T01', mode: 'training', number: 1, tier: 'Training', difficulty: 2, title: 'Collision Avoidance Drill', timeScale: 60, raanDeg: 30, ambientDebris: 10,
    story: 'A debris object is inbound. Open the conjunction panel, press "Compute avoidance", review the plan, then execute it. Try both Manual and AI-Assisted modes.',
    timeLimit: 2 * H, req: {}, lock: {}, preset: { satCount: 1 }, rewards: { xp: 0 }, tips: ['Conjunction alerts appear at the top of the screen.', 'Earlier burns need less Δv.'],
    events: [{ type: 'debris', at: 120, target: 0, lead: 2700, miss: 0.3 }],
    objectives: [O('deploy', 'Deploy', { count: 1 }), O('avoid', 'Clear the conjunction', { count: 1 })].map((o, j) => ({ ...o, id: `${o.type}-${j}` })),
  },
  {
    id: 'T02', mode: 'training', number: 2, tier: 'Training', difficulty: 2, title: 'Power & Eclipse Drill', timeScale: 60, raanDeg: 30, ambientDebris: 5,
    story: 'Practise load shedding, safe mode and payload duty-cycling across eclipses while a stuck heater drains power.',
    timeLimit: 3 * H, req: {}, lock: {}, preset: { satCount: 1, panelArea: 2 }, rewards: { xp: 0 }, tips: ['Shed loads when the battery bar turns amber.'],
    events: [{ type: 'power_shortage', at: 300, watts: 60, target: 0 }],
    objectives: [O('deploy', 'Deploy', { count: 1 }), O('eclipses', 'Survive 2 eclipses', { count: 2 }), O('resolve', 'Reset the heater', { count: 1 })].map((o, j) => ({ ...o, id: `${o.type}-${j}` })),
  },
  {
    id: 'T03', mode: 'training', number: 3, tier: 'Training', difficulty: 1, title: 'Operation Modes Drill', timeScale: 60, raanDeg: 30, ambientDebris: 5, startMode: 'ai',
    story: 'Watch the agents act in AI-Assisted mode, approve a medium-risk action, then switch to Manual and finish the job yourself. Mission state is preserved across switches.',
    timeLimit: 2 * H, req: {}, lock: {}, preset: { satCount: 2 }, rewards: { xp: 0 }, tips: ['Press M to toggle mode.'],
    events: [{ type: 'comms_loss', at: 400, target: 0 }, { type: 'sensor_fault', at: 700, target: 1 }],
    objectives: [O('deploy', 'Deploy 2', { count: 2 }), O('review', 'Review 2 decisions', { count: 2 }), O('resolve', 'Resolve 2 faults', { count: 2 })].map((o, j) => ({ ...o, id: `${o.type}-${j}` })),
  },
  {
    id: 'T04', mode: 'training', number: 4, tier: 'Training', difficulty: 3, title: 'Orbit Transfer Drill', timeScale: 60, raanDeg: 30, ambientDebris: 5,
    story: 'Use "Plan transfer" to raise to 700 km, then try a manual circularization burn.',
    timeLimit: 3 * H, req: { propulsion: true }, lock: {}, preset: { satCount: 1, altKm: 500 }, rewards: { xp: 0 }, tips: [],
    events: [],
    objectives: [O('deploy', 'Deploy', { count: 1 }), O('alt_target', 'Reach 700 ± 20 km', { alt: 700, tol: 20 })].map((o, j) => ({ ...o, id: `${o.type}-${j}` })),
  },
];
