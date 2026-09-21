import { World } from './scene/world';
import { buildUI } from './ui/panel';
import { Tour } from './ui/tour';
import { initMusic } from './ui/music';
import { initAbout } from './ui/about';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = new World(canvas);
// A handle for poking at the scene from the console, and for the promo
// recorder (scripts/render-promo.mjs) to drive frames by hand — it records the
// production build, so it asks for the handle explicitly with ?promo=1.
if (import.meta.env.DEV || location.search.includes('promo')) {
  (window as unknown as { world: World }).world = world;
}

// Build the panel first (it sets #app innerHTML); then the Tour appends its
// overlay into that DOM. The tour mutates world state directly, so `sync`
// refreshes the panel controls to match when the tour exits.
let tour: Tour;
const sync = buildUI(world, () => tour.restart());
tour = new Tour(world, () => sync());
initAbout();

// Begin in the guided walkthrough (honoring any #step deep link in the URL).
tour.start();

// Once the scene has rendered its first frame, drop the preloader and — only
// then, when nothing else is competing for the network — start loading the
// background-music track.
let booted = false;
function boot(): void {
  if (booted) return;
  booted = true;
  const pre = document.getElementById('preloader');
  if (pre) {
    pre.classList.add('hidden');
    setTimeout(() => pre.remove(), 600);
  }
  const idle: (cb: () => void) => void =
    (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
    ((cb) => window.setTimeout(cb, 300));
  idle(() => initMusic());
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1); // clamp big gaps (tab switch)
  last = now;
  world.update(dt);
  if (!booted) boot();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
