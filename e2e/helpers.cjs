const { chromium } = require('playwright');
exports.launch = () => chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
exports.BASE = process.env.BASE || 'http://localhost:4173/';
exports.track = (page, tag = '') => { const errs = []; page.on('pageerror', (e) => errs.push(`${tag} PAGEERROR ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error') errs.push(`${tag} ${m.text()}`); }); return errs; };
/** Register (or log in) a player in local mode under ?as=<name>, ending at mode select. */
exports.signup = async (page, name, { base = exports.BASE, suit } = {}) => {
  await page.goto(`${base}?as=${name}${process.env.LOWQ ? '&q=low' : ''}`);
  await page.getByText(/PRESS START|Skip intro/).first().waitFor({ timeout: 90000 });
  if (await page.getByText('Skip intro').isVisible().catch(() => false)) await page.getByText('Skip intro').click();
  await page.getByText('PRESS START').click();
  await page.getByRole('tab', { name: 'Register' }).or(page.getByTestId('mode-solo')).first().waitFor({ timeout: 30000 });
  if (await page.getByTestId('mode-solo').isVisible().catch(() => false)) return;
  await page.getByRole('tab', { name: 'Register' }).click();
  await page.fill('#username', `${name}_ops`); await page.fill('#email', `${name}@example.com`); await page.fill('#password', 'orbit1234'); await page.fill('#confirm', 'orbit1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('recovery-code').waitFor({ timeout: 30000 });
  await page.getByText('I saved it').click();
  await page.fill('#dn', name[0].toUpperCase() + name.slice(1));
  if (suit) await page.getByLabel(`suit ${suit}`).click();
  await page.getByText('Enter ALUNA').click();
  await page.getByTestId('mode-solo').waitFor();
};
