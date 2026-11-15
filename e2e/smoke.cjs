// End-to-end smoke test: register → profile → HQ → Mission Control → S01 → launch → space → results.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = process.env.OUT || 'shots';
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
  const step = async (name, fn) => { const t = Date.now(); try { await fn(); console.log(`✓ ${name} (${Date.now() - t} ms)`); } catch (e) { console.log(`✗ ${name}: ${e.message.split('\n')[0]}`); await shot(`fail-${name.replace(/\W+/g, '_')}`); throw e; } };
  try {
    await step('boot → intro', async () => { await page.goto(BASE); await page.getByText('Skip intro').waitFor({ timeout: 60000 }); await page.waitForTimeout(2500); await shot('01-intro'); });
    await step('intro skip → title', async () => { await page.getByText('Skip intro').click(); await page.getByText('PRESS START').waitFor(); await page.waitForTimeout(800); await shot('02-title'); });
    await step('title → auth', async () => { await page.getByText('PRESS START').click(); await page.getByRole('tab', { name: 'Register' }).waitFor(); });
    await step('register validation rejects bad input', async () => {
      await page.getByRole('tab', { name: 'Register' }).click();
      await page.fill('#username', 'a'); await page.fill('#email', 'bad'); await page.fill('#password', 'short'); await page.fill('#confirm', 'x');
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.getByText('Username: 3–20').waitFor(); await page.getByText('valid email').waitFor(); await page.getByText('at least 8').waitFor();
    });
    await step('register ok', async () => {
      await page.fill('#username', 'alice_ops'); await page.fill('#email', 'alice@example.com'); await page.fill('#password', 'orbit1234'); await page.fill('#confirm', 'orbit1234');
      await page.getByRole('button', { name: 'Create account' }).click();
      await page.getByTestId('recovery-code').waitFor({ timeout: 30000 });
      await shot('03-recovery');
      await page.getByText('I saved it').click();
      await page.getByText('CREW PROFILE').waitFor();
    });
    await step('profile setup', async () => {
      await page.fill('#dn', 'Alice'); await page.getByLabel('suit #ffb547').click(); await page.waitForTimeout(300); await shot('04-setup');
      await page.getByText('Enter ALUNA').click(); await page.getByTestId('mode-solo').waitFor();
      await shot('05-mode');
    });
    await step('solo → HQ arrival', async () => {
      await page.getByTestId('mode-solo').click();
      await page.waitForTimeout(4000); await shot('06-arrival-outside');
      await page.waitForTimeout(6000); await shot('07-arrival-doors');
      await page.getByTestId('skip-arrival').click({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500); await shot('08-hq-inside');
    });
    await step('walk with WASD', async () => {
      await page.mouse.click(683, 300);
      await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
      await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
      await page.waitForTimeout(500); await shot('09-hq-walk');
    });
    await step('mission control open', async () => {
      await page.getByTestId('quick-mission').click(); await page.getByTestId('facility').waitFor(); await page.waitForTimeout(500); await shot('10-mission-control');
      const n = await page.locator('[data-testid^=mission-S]').count(); if (n !== 25) throw new Error(`expected 25 solo missions, got ${n}`);
      await page.getByTestId('mission-S02').click(); const disabled = await page.getByTestId('start-mission').isDisabled(); if (!disabled) throw new Error('S02 should be locked');
      await page.getByTestId('mission-S01').click(); await page.getByTestId('start-mission').click();
      await page.getByTestId('to-designer').waitFor(); await page.waitForTimeout(600); await shot('11-briefing');
    });
    await step('designer', async () => {
      await page.getByTestId('to-designer').click(); await page.getByTestId('launch-btn').waitFor(); await page.waitForTimeout(1500); await shot('12-designer');
      await page.getByTestId('tab-autonomy').click(); await page.waitForTimeout(300); await shot('13-autonomy');
    });
    await step('launch sequence', async () => {
      await page.getByTestId('launch-btn').click(); await page.getByTestId('skip-launch').waitFor({ timeout: 20000 });
      await page.waitForTimeout(5000); await shot('14-countdown');
      await page.waitForTimeout(9000); await shot('15-liftoff');
      await page.waitForTimeout(14000); await shot('16-staging');
      await page.waitForTimeout(8000); await shot('17-fairing');
    });
    await step('space ops', async () => {
      await page.getByTestId('mission-timer').waitFor({ timeout: 40000 }); await page.waitForTimeout(3000); await shot('18-space');
      await page.keyboard.press('Digit1'); await page.waitForTimeout(500);
      await page.getByTestId('inspector').waitFor(); await shot('19-inspector');
      await page.getByRole('button', { name: '×600' }).click();
      await page.getByTestId('results').waitFor({ timeout: 240000 });
      await page.waitForTimeout(800); await shot('20-results');
      const txt = await page.getByTestId('results').innerText(); if (!txt.includes('MISSION COMPLETE')) throw new Error('mission not completed: ' + txt.slice(0, 200));
    });
    await step('return to HQ & S02 unlocked', async () => {
      await page.getByTestId('return-hq').click(); await page.getByTestId('quick-mission').click(); await page.getByTestId('mission-S02').click();
      if (await page.getByTestId('start-mission').isDisabled()) throw new Error('S02 still locked'); await shot('21-unlocked');
      await page.getByTestId('close-facility').click();
    });
    await step('reload keeps session & progress', async () => {
      await page.reload(); await page.getByText('PRESS START').waitFor({ timeout: 60000 }); await page.getByText('PRESS START').click();
      await page.getByTestId('mode-solo').waitFor({ timeout: 20000 }); const t = await page.getByTestId('mode-solo').innerText(); if (!t.includes('1/25')) throw new Error(`progress not persisted: ${t}`);
    });
  } catch (e) { process.exitCode = 1; }
  console.log(`console errors: ${errors.length}`); for (const e of errors.slice(0, 15)) console.log('  ', e.slice(0, 300));
  await browser.close();
})();
