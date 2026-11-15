// N-player squad session (N = 2..4): join by code, roles, shared mission Q01 to completion.
const { launch, signup, track } = require('./helpers.cjs');
const N = +(process.env.N || 2);
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1000, height: 660 } });
  const names = ['alice', 'bob', 'carol', 'dave'].slice(0, N).map((n) => `${n}${N}`);
  const P = []; const errs = [];
  for (const n of names) { const p = await ctx.newPage(); errs.push(...track(p, n)); P.push(p); }
  const [L, ...M] = P;
  const t0 = Date.now(); const log = (m) => console.log(`[N=${N} +${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
  try {
    for (let i = 0; i < N; i++) await signup(P[i], names[i], { suit: ['#4fd1ff', '#ffb547', '#ff6fa8', '#7cff9b'][i] });
    for (const p of P) { await p.getByTestId('mode-squad').click(); await p.getByTestId('skip-arrival').click({ timeout: 60000 }); await p.getByTestId('quick-squad').waitFor({ timeout: 60000 }); }
    log('all players in Squad HQ');
    await L.getByTestId('quick-squad').click(); await L.getByTestId('create-squad').click();
    const code = (await L.getByTestId('squad-code').innerText({ timeout: 10000 })).trim();
    for (const p of M) { await p.getByTestId('quick-squad').click(); await p.fill('[aria-label="squad code"]', code); await p.getByTestId('join-code').click(); }
    await L.getByText(`${N}/4 members`).waitFor({ timeout: 20000 });
    log(`squad ${code} has ${N} members`);
    const roles = ['flight', 'systems', 'autonomy'];
    for (let i = 0; i < M.length; i++) { await L.locator('select[aria-label="assign role"]').nth(i + 1).selectOption(roles[i]); await L.waitForTimeout(1200); }
    for (const p of P) await p.getByTestId('close-facility').click();
    await L.waitForTimeout(2500);
    // presence: leader's page should render remote characters (count via store peers)
    const peers = await L.evaluate(() => window.__alunaStore.getState().squadRoom?.peers().filter((x) => x.presence?.p).length || 0);
    log(`leader sees ${peers} peers with live positions (expected ≥ ${N})`);
    if (peers < N) throw new Error('presence not synced');
    await L.screenshot({ path: `shots/sqN${N}-hq.png` });
    await L.getByTestId('quick-mission').click(); await L.getByTestId('mission-Q01').click(); await L.getByTestId('squad-start').click();
    for (const p of M) { await p.getByTestId('ready-brief').click({ timeout: 20000 }); }
    await L.getByTestId('squad-design').click({ timeout: 20000 });
    await L.waitForTimeout(2000); await L.getByTestId('launch-btn').click({ timeout: 20000 });
    for (const p of P) await p.getByTestId('skip-launch').click({ timeout: 30000 });
    for (const p of P) await p.getByTestId('mission-timer').waitFor({ timeout: 60000 });
    log('all players in shared space mission');
    const deployer = M[0];
    await deployer.getByTestId('deploy').first().click(); await deployer.waitForTimeout(1500); await deployer.getByTestId('deploy').first().click();
    for (const p of P) await p.locator('.obj.done', { hasText: 'Flight: deploy 2 satellites' }).waitFor({ timeout: 20000 });
    log('deployment synced to every player');
    await L.getByTestId('authorize').click();
    const reviewer = N >= 4 ? P[3] : L;
    await reviewer.getByRole('button', { name: 'History' }).click();
    await reviewer.getByRole('button', { name: 'Mark reviewed' }).first().click({ timeout: 30000 });
    if (N < 3) await L.getByRole('button', { name: '×600' }).click().catch(() => {});
    for (const p of P) await p.getByTestId('results').waitFor({ timeout: 180000 });
    const res = await Promise.all(P.map((p) => p.getByTestId('results').innerText()));
    log(`results: ${res.map((r) => (r.includes('MISSION COMPLETE') ? 'COMPLETE' : 'FAILED')).join(', ')}`);
    await M[M.length - 1].screenshot({ path: `shots/sqN${N}-results.png` });
  } catch (e) { console.log('✗', e.message.split('\n')[0]); await L.screenshot({ path: `shots/sqN${N}-fail.png` }); process.exitCode = 1; }
  console.log('console errors', errs.length, [...new Set(errs)].slice(0, 6));
  await b.close();
})();
