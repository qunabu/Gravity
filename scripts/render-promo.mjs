// Renders the promo video by driving the real page — no mock-up, no after
// effects. It serves the production build, opens it in Chrome, and steps the
// simulation by hand so every frame is exactly 1/30 s of model time rather
// than wherever the animation loop happened to be. Then ffmpeg stitches them.
//
//   npm run promo            both aspects
//   npm run promo -- 16x9    just one

import { spawn } from 'node:child_process';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import ffmpeg from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'videos');
const FPS = 30;
const PORT = 4173;
const BASE = '/Gravity/';   // vite.config.ts sets this for production builds
const DT = 1 / FPS;

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));

const ASPECTS = {
  '16x9': { w: 1920, h: 1080 },
  '1x1': { w: 1080, h: 1080 },
};

/**
 * The storyboard. `pre` runs the slide forward without recording — some demos
 * are long loops and the interesting stretch is in the middle — and `frames`
 * is what lands in the video. Every slide gets a few frames of settle first so
 * the cut doesn't land mid-camera-jump.
 */
const BEATS = [
  { hash: 'what-is-gravity', pre: 20, frames: 80 },   // two masses, one law
  { hash: 'birth-of-sun', pre: 10, frames: 120 },     // the dust falls together
  { hash: 'why-no-fall', pre: 20, frames: 110 },      // falling and missing
  { hash: 'earth-moon', pre: 40, frames: 100 },       // the same law, one level down
  { hash: 'sun-moving', pre: 60, frames: 130 },       // orbits are really helices
  { hash: 'solar-system', pre: 30, frames: 100 },     // the whole thing
  { hash: 'tides', pre: 40, frames: 110 },            // two bulges, two tides
  // The rose takes 8 years to draw and then wipes itself: the beat has to end
  // before that. (pre + frames) / 30 * 162 days must stay under 2922.
  { hash: 'venus-rose', pre: 400, frames: 110, poster: true },
  { hash: 'spacetime', pre: 25, frames: 100 },        // Einstein's sheet
  { hash: 'sagittarius-a', pre: 30, frames: 110 },    // the monster at the centre
  { hash: 'early-universe', pre: 330, frames: 150 },  // gravity builds the web
  { hash: 'cosmic-motion', pre: 30, frames: 110 },    // you are never still
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function waitFor(url, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never came up`);
}

/**
 * Take the clock off the page. The app's own rAF loop calls world.update()
 * every frame; left alone it would advance the model between screenshots and
 * the video would stutter at whatever rate headless Chrome felt like painting.
 * Swap in a no-op and keep the real one for the recorder.
 */
async function seizeClock(page) {
  await page.evaluate(() => {
    const w = window.world;
    const real = w.update.bind(w);
    w.update = () => {};
    window.__step = (dt) => real(dt);
    document.getElementById('preloader')?.remove();
    // The first slide's "play with music" button is an invitation to click,
    // which a video cannot honour.
    const css = document.createElement('style');
    css.textContent = '.tour-cta { display: none !important; }';
    document.head.appendChild(css);
  });
}

async function setScene(page, hash) {
  await page.evaluate((h) => {
    location.hash = '';
    location.hash = h;
  }, hash);
  // Let the tour apply the step (it listens for hashchange) before stepping.
  await new Promise((r) => setTimeout(r, 120));
}

async function renderAspect(key, browser) {
  const { w, h } = ASPECTS[key];
  const frames = path.join(OUT, `.frames-${key}`);
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  // A fresh profile would default to English anyway; be explicit, since the
  // language is remembered and a stray PL would ship in the video.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('gravity-lang', 'en'); } catch { /* private mode */ }
  });
  await page.goto(`http://localhost:${PORT}${BASE}?promo=1#what-is-gravity`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.world);
  await seizeClock(page);

  let n = 0;
  const shot = () => page.screenshot({ path: path.join(frames, `f${String(n++).padStart(5, '0')}.png`) });
  const step = (count) => page.evaluate((c, dt) => {
    for (let i = 0; i < c; i++) window.__step(dt);
  }, count, DT);

  for (const beat of BEATS) {
    await setScene(page, beat.hash);
    await step(beat.pre);
    for (let i = 0; i < beat.frames; i++) {
      await step(1);
      await shot();
    }
    process.stdout.write(`  ${key} · ${beat.hash} → ${n} frames\n`);
  }
  await page.close();

  const mp4 = path.join(OUT, `gravity-${key}.mp4`);
  await run(ffmpeg, [
    '-y', '-framerate', String(FPS), '-i', path.join(frames, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    // LinkedIn re-encodes, so hand it clean even dimensions and a steady rate.
    '-r', String(FPS), mp4,
  ]);

  // A still for the post's thumbnail: the last frame of the flagged beat.
  const upTo = BEATS.slice(0, BEATS.findIndex((b) => b.poster) + 1);
  const posterFrame = upTo.reduce((a, b) => a + b.frames, 0) - 15;
  const poster = path.join(OUT, `gravity-${key}.png`);
  await run(ffmpeg, ['-y', '-i', path.join(frames, `f${String(posterFrame).padStart(5, '0')}.png`),
    '-frames:v', '1', '-update', '1', poster]);

  await rm(frames, { recursive: true, force: true });
  return { mp4, poster, frames: n, seconds: +(n / FPS).toFixed(1) };
}

const only = process.argv[2];
const keys = only ? [only] : Object.keys(ASPECTS);
if (!CHROME) throw new Error('No Chrome found — install Google Chrome.');

await mkdir(OUT, { recursive: true });
console.log('building…');
await run('npm', ['run', 'build'], { cwd: ROOT });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'ignore',
});
try {
  await waitFor(`http://localhost:${PORT}${BASE}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--force-color-profile=srgb',
      '--enable-unsafe-swiftshader'],
  });
  for (const key of keys) {
    console.log(`rendering ${key}…`);
    const r = await renderAspect(key, browser);
    console.log(`  → ${path.relative(ROOT, r.mp4)}  (${r.seconds}s)`);
    console.log(`  → ${path.relative(ROOT, r.poster)}`);
  }
  await browser.close();
} finally {
  server.kill();
}
console.log('\ndone:', (await readdir(OUT)).join(', '));
