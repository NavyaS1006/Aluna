const { launch, signup, track } = require('./helpers.cjs');
(async () => {
  const b = await launch();
  const page = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage();
  const errs = track(page);
  await signup(page, 'bob');
  await page.getByTestId('mode-solo').click(); await page.getByTestId('skip-arrival').click({ timeout: 20000 }).catch(() => {});
  await page.getByTestId('quick-mission').click(); await page.getByTestId('start-mission').click();
  await page.getByTestId('to-designer').click(); await page.getByTestId('launch-btn').click();
  for (const [t, n] of [[3000, 'L1'], [9000, 'L2'], [8000, 'L3'], [10000, 'L4'], [8000, 'L5']]) { await page.waitForTimeout(t); await page.screenshot({ path: `shots/${n}.png` }); }
  await page.getByTestId('mission-timer').waitFor({ timeout: 40000 }); await page.waitForTimeout(4000); await page.screenshot({ path: 'shots/L6-space.png' });
  console.log('errors', errs.length, errs.slice(0, 5));
  await b.close();
})();
