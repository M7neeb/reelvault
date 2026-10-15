/**
 * screenshot the web build at an exact device viewport.
 *
 * WHY THIS EXISTS
 * Headless Edge clamps small windows: `--window-size=393,852` actually lays the
 * page out at ~482 CSS px. The screenshot is still 393*3 device px wide, so the
 * right ~90 CSS px of the app falls outside the image - which looks exactly like
 * "the Import button, the select toggle and the search button are missing".
 * They were never missing; the capture was lying.
 *
 * `--window-size` therefore cannot be trusted for phone-width checks. This drives
 * Chrome DevTools Protocol directly and sets exact device metrics, so the image
 * matches the layout. No dependencies: Node 22+ has a global WebSocket, and Edge
 * is already installed.
 *
 * Usage:
 *   node scripts/shot.mjs <url> <out.png> [width=393] [height=852] [dsf=3]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , url, out, w = '393', h = '852', dsf = '3'] = process.argv;
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [w] [h] [dsf]');
  process.exit(2);
}

const EDGE =
  process.env.EDGE_PATH ||
  ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
   'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].join(';').split(';')
    .find((p) => p) || 'msedge';

const PORT = 9333 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(path, init) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, init);
  return res.json();
}

/** Minimal CDP client over the page target's websocket. */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        events.push(msg.method);
      }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () =>
      resolve({
        events,
        send(method, params = {}) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id);
                rej(new Error(`timeout: ${method}`));
              }
            }, 30000);
          });
        },
        close: () => ws.close(),
      })
    );
  });
}

const browser = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shot-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let exitCode = 0;
try {
  // Wait for the DevTools endpoint.
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await json('/json/version');
      ready = true;
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!ready) throw new Error('DevTools endpoint never came up');

  // Create a page target and talk to it directly.
  let page = null;
  for (let i = 0; i < 20 && !page?.webSocketDebuggerUrl; i++) {
    try {
      page = await json(`/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    } catch {
      page = null;
    }
    if (!page?.webSocketDebuggerUrl) await sleep(250);
  }
  if (!page?.webSocketDebuggerUrl) throw new Error('could not create a page target');

  const cdp = await connect(page.webSocketDebuggerUrl);

  // The whole point: exact device metrics, so layout width == image width.
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: Number(dsf),
    mobile: true,
  });
  await cdp.send('Emulation.setVisibleSize', { width: Number(w), height: Number(h) });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });

  // Wait for load, then let React hydrate and the layout settle.
  for (let i = 0; i < 60; i++) {
    if (cdp.events.includes('Page.loadEventFired')) break;
    await sleep(250);
  }
  await sleep(2500);

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  // Report what the page actually laid out at - the number window-size lies about.
  const probe = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({innerWidth:window.innerWidth,dpr:window.devicePixelRatio,sw:document.documentElement.scrollWidth})',
    returnByValue: true,
  });
  console.log(`  ${out}  ${probe.result.value}`);

  cdp.close();
} catch (err) {
  console.error(`  FAILED: ${err.message}`);
  exitCode = 1;
} finally {
  browser.kill();
}

process.exit(exitCode);
