// Multiplayer test (local multi-tab backend): 3 players, friends, squad, roles, shared mission, reconnection.
const { launch, signup, track } = require('./helpers.cjs');
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1100, height: 700 } });
  const [A, B, C] = [await ctx.newPage(), await ctx.newPage(), await ctx.newPage()];
  const errs = [...track(A, 'A'), ...track(B, 'B'), ...track(C, 'C')];
  const errsAll = () => errs;
  let ok = true;
  const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { ok = false; console.log('✗', n, e.message.split('\n')[0]); await A.screenshot({ path: `shots/sq-fail-A.png` }); await B.screenshot({ path: `shots/sq-fail-B.png` }); throw e; } };
  const enterSquadHQ = async (p) => { await p.getByTestId('mode-squad').click(); await p.getByTestId('skip-arrival').click({ timeout: 60000 }); await p.getByTestId('quick-squad').waitFor({ timeout: 60000 }); await p.waitForTimeout(500); };
  const openSquad = async (p) => { await p.getByTestId('quick-squad').click(); await p.getByTestId('facility').waitFor(); };
  try {
    await step('register 3 players', async () => { await signup(A, 'alice', { suit: '#4fd1ff' }); await signup(B, 'bob', { suit: '#ffb547' }); await signup(C, 'carol', { suit: '#ff6fa8' }); });
    await step('all enter Squad Ops HQ', async () => { for (const p of [A, B, C]) await enterSquadHQ(p); });
    let code;
    await step('alice creates squad', async () => { await openSquad(A); await A.getByTestId('create-squad').click(); code = (await A.getByTestId('squad-code').innerText({ timeout: 10000 })).trim(); if (code.length !== 6) throw new Error('bad code ' + code); });
    await step('friend requests: bob→alice accepted, carol→alice rejected', async () => {
      for (const p of [B, C]) { await openSquad(p); await p.fill('[aria-label="search players"]', 'ali'); await p.getByTestId('search').click(); await p.getByTestId('add-friend').first().click(); }
      await A.waitForTimeout(1500);
      await A.getByTestId('accept-friend').first().waitFor({ timeout: 10000 });
      const rows = A.locator('.row.small', { has: A.getByTestId('accept-friend') });
      if (await rows.count() !== 2) throw new Error('expected 2 incoming requests, got ' + await rows.count());
      await rows.filter({ hasText: 'Bob' }).getByTestId('accept-friend').click();
      await rows.filter({ hasText: 'Carol' }).getByTestId('reject-friend').click();
      await B.getByText('Friends (1)').waitFor({ timeout: 10000 });
      await C.getByText('Declined by Alice').waitFor({ timeout: 10000 });
      await A.getByText('Friends (1)').waitFor();
    });
    await step('alice invites bob; bob & carol join (invite + code)', async () => {
      await A.getByTestId('invite').click();
      await B.getByRole('button', { name: 'Accept' }).click({ timeout: 10000 });
      await C.fill('[aria-label="squad code"]', code); await C.getByTestId('join-code').click();
      await A.getByText('3/4 members').waitFor({ timeout: 15000 });
      await B.getByText('3/4 members').waitFor({ timeout: 15000 });
    });
    await step('leader assigns roles', async () => {
      const sel = A.locator('select[aria-label="assign role"]');
      await sel.nth(1).selectOption('flight'); await A.waitForTimeout(1200);
      await A.locator('select[aria-label="assign role"]').nth(2).selectOption('systems'); await A.waitForTimeout(1200);
      await B.getByText('Flight Operations Officer').first().waitFor({ timeout: 10000 });
      await C.getByText('Satellite Systems Specialist').first().waitFor({ timeout: 10000 });
    });
    await step('HQ shows teammates (presence sync)', async () => {
      for (const p of [A, B, C]) await p.getByTestId('close-facility').click();
      await A.keyboard.down('KeyW'); await A.waitForTimeout(1200); await A.keyboard.up('KeyW');
      await B.waitForTimeout(2500);
      await A.screenshot({ path: 'shots/sq-hq-A.png' }); await B.screenshot({ path: 'shots/sq-hq-B.png' });
    });
    await step('leader briefs squad → everyone sees briefing', async () => {
      await A.getByTestId('quick-mission').click(); await A.getByTestId('mission-Q01').click(); await A.getByTestId('squad-start').click();
      for (const p of [A, B, C]) await p.getByText('Squad Formation').first().waitFor({ timeout: 15000 });
      await B.getByTestId('ready-brief').click(); await C.getByTestId('ready-brief').click();
      await A.getByTestId('squad-design').click();
      for (const p of [A, B, C]) await p.getByText('SPACECRAFT MISSION DESIGNER').waitFor({ timeout: 15000 });
      await B.screenshot({ path: 'shots/sq-designer-B.png' });
    });
    await step('launch together', async () => {
      await A.getByTestId('launch-btn').waitFor(); await A.waitForTimeout(1500);
      if (await A.getByTestId('launch-btn').isDisabled()) throw new Error('launch disabled (ready status not synced)');
      await A.getByTestId('launch-btn').click();
      for (const p of [A, B, C]) { await p.getByTestId('skip-launch').click({ timeout: 20000 }); }
      for (const p of [A, B, C]) await p.getByTestId('mission-timer').waitFor({ timeout: 40000 });
    });
    await step('role-gated actions & sync', async () => {
      await C.waitForTimeout(2000);
      const cDeploy = C.getByTestId('deploy').first();
      if (!(await cDeploy.isDisabled())) throw new Error('systems role should not be able to deploy');
      await B.getByTestId('deploy').first().click(); await B.waitForTimeout(1500); await B.getByTestId('deploy').first().click();
      await A.getByText('Flight: deploy 2 satellites').waitFor();
      await A.locator('.obj.done', { hasText: 'Flight: deploy 2 satellites' }).waitFor({ timeout: 15000 });
      await C.locator('.obj.done', { hasText: 'Flight: deploy 2 satellites' }).waitFor({ timeout: 15000 });
      // commander-only mode switch: bob's button disabled
      if (!(await B.getByTestId('mode-manual').isDisabled())) throw new Error('flight should not switch mode');
      await A.screenshot({ path: 'shots/sq-space-A.png' }); await C.screenshot({ path: 'shots/sq-space-C.png' });
    });
    await step('bob disconnects and reconnects', async () => {
      await B.reload(); await B.getByText(/PRESS START|Skip intro/).first().waitFor({ timeout: 90000 }); await B.getByText('PRESS START').click({ timeout: 60000 }); await B.getByTestId('mode-squad').click();
      await B.getByTestId('mission-timer').waitFor({ timeout: 40000 });
      await B.locator('.obj.done', { hasText: 'Flight: deploy 2 satellites' }).waitFor({ timeout: 20000 });
    });
    await step('complete mission (authorize, review, warp)', async () => {
      await A.getByTestId('authorize').click();
      await A.locator('.obj.done', { hasText: 'Commander: authorise operations' }).waitFor({ timeout: 10000 });
      await A.getByRole('button', { name: 'History' }).click();
      await A.getByRole('button', { name: 'Mark reviewed' }).first().click({ timeout: 30000 });
      for (const p of [A, B, C]) await p.getByTestId('results').waitFor({ timeout: 120000 });
      const t = await C.getByTestId('results').innerText(); console.log('   C result:', t.includes('MISSION COMPLETE') ? 'COMPLETE' : t.slice(0, 160).replace(/\n/g, ' '));
      await A.screenshot({ path: 'shots/sq-results-A.png' });
    });
  } catch { /* logged */ }
  const e = errsAll(); console.log('console errors', e.length); for (const x of [...new Set(e)].slice(0, 12)) console.log('  ', x.slice(0, 250));
  await b.close(); process.exit(ok ? 0 : 1);
})();
