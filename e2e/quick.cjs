const { launch, signup, track } = require('./helpers.cjs');
(async () => { const b = await launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 760 } })).newPage(); const e = track(p);
  await signup(p, 'zed'); await p.getByTestId('mode-solo').click(); await p.waitForTimeout(6000); await p.screenshot({ path: 'shots/q-hq.png' });
  console.log('errors', e.length, e.slice(0, 3)); await b.close(); })();
