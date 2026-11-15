const { launch, signup, track } = require('./helpers.cjs');
(async () => {
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 780 } });
  const A = await ctx.newPage(); const errs = track(A);
  await signup(A, 'alice');
  await A.getByTestId('mode-squad').click();
  await A.waitForTimeout(3000);
  console.log(await A.evaluate(() => JSON.stringify({ s: window.__alunaStore.getState().screen, a: window.__alunaStore.getState().arrivalPhase, h: window.__alunaStore.getState().hqArrived })));
  const t0 = Date.now(); await A.getByTestId('skip-arrival').click(); console.log('click took', Date.now() - t0);
  await A.waitForTimeout(2000);
  console.log(await A.evaluate(() => JSON.stringify({ a: window.__alunaStore.getState().arrivalPhase, h: window.__alunaStore.getState().hqArrived })));
  console.log('quick visible', await A.getByTestId('quick-squad').isVisible());
  console.log(errs);
  await b.close();
})();
