// Browser smoke test (optional; needs Playwright with Chromium): `npm run build`, serve docs/ on
// port 8080 (for example `cd docs && python3 -m http.server 8080`), then `node tests/browser.cjs`.
// It opens the TV and two phones in "local" mode, plays a little through the phone controls,
// runs a round to the end, and saves screenshots in tests/screenshots/.
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Playwright is not installed: skipping the browser test'); process.exit(0); }
const fs = require('fs');
const path = require('path');

const base = process.env.URL || 'http://localhost:8080/';
const out = path.join(__dirname, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : 'FAIL '} ${msg}`); if (!cond) failures++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext();
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
  };
  const tv = await ctx.newPage();
  await tv.setViewportSize({ width: 1280, height: 720 });
  watch(tv, 'TV');
  await tv.goto(base + '?local&tv');
  await tv.waitForFunction(() => window.__claw && window.__claw.net.code);
  const code = await tv.evaluate(() => window.__claw.net.code);
  ok(/^[A-Z]{4}$/.test(code), `the TV opens a room (${code})`);

  const phones = [];
  for (const name of ['Ana', 'Bo']) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 390, height: 780 });
    await p.addInitScript(() => localStorage.removeItem('claw-name'));
    watch(p, name);
    await p.goto(`${base}?join=${code}&local`);
    await p.fill('#name', name);
    await p.click('#go');
    phones.push(p);
  }
  const [ana, bo] = phones;
  await tv.waitForFunction(() => window.__claw.game.players.size === 2, null, { timeout: 10000 });
  ok(true, 'two phones join');
  await ana.waitForSelector('.leader-bar .start');
  await tv.screenshot({ path: path.join(out, 'tv-lobby.png') });
  await ana.screenshot({ path: path.join(out, 'phone-lobby.png') });

  await ana.click('.leader-bar .start');
  await tv.waitForFunction(() => window.__claw.game.phase === 'play', null, { timeout: 20000 });
  ok(true, 'the leader starts the round from their phone');

  const drag = async (p, sel, dx, dy, ms) => {
    const b = await p.locator(sel).boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await p.mouse.move(x, y); await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 4 });
    await sleep(ms);
    await p.mouse.up();
  };
  const tap = async (p, sel) => { const b = await p.locator(sel).boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await sleep(60); await p.mouse.up(); };
  const claw = (slot) => tv.evaluate((s) => { const c = window.__claw.game.sim.claws.get(s); return { x: c.x, state: c.state }; }, slot);

  await ana.locator('.cards .card').nth(0).click();
  await tv.waitForFunction(() => window.__claw.game.sim.pieces.size === 1, null, { timeout: 5000 });
  ok(true, 'tapping a piece puts it on the shelf');
  await ana.waitForSelector('.inventory.busy');
  ok(true, 'and the phone says to pick it up before the next one');
  await tap(ana, '.buttons .drop');
  await tv.waitForFunction(() => { const c = window.__claw.game.sim.claws.get(0); return c.state === 'holding' && !c.auto; }, null, { timeout: 20000 });
  ok(true, 'DROP lowers the claw onto the shelf and grabs the piece');
  await drag(ana, '.stick.both', 0, -80, 900);
  const x0 = (await claw(0)).x;
  await drag(ana, '.stick.both', 80, 0, 1600);
  ok((await claw(0)).x > x0 + 1, 'the MOVE pad moves the claw');
  await sleep(1500);
  await tap(ana, '.buttons .drop');
  await tv.waitForFunction(() => window.__claw.game.sim.claws.get(0).state === 'open', null, { timeout: 15000 });
  ok(true, 'DROP lowers the claw and lets go');
  await sleep(1000);
  await tv.screenshot({ path: path.join(out, 'tv-play.png') });
  await bo.screenshot({ path: path.join(out, 'phone-play.png') });

  await tv.evaluate(() => { window.__claw.game.timeLeft = 1; });
  await tv.waitForFunction(() => window.__claw.game.phase === 'result', null, { timeout: 20000 });
  ok(true, 'the round ends with results');
  await sleep(2500);
  await tv.screenshot({ path: path.join(out, 'tv-result.png') });
  await ana.screenshot({ path: path.join(out, 'phone-result.png') });
  ok(await ana.isVisible('#overlay [data-act=again]'), 'the leader can play again from their phone');

  ok(errors.length === 0, `no errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nbrowser test passed');
  process.exit(failures ? 1 : 0);
})();
