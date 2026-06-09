import { World } from './scene/world';
import { buildUI } from './ui/panel';
import { Tour } from './ui/tour';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const world = new World(canvas);

// Build the panel first (it sets #app innerHTML); then the Tour appends its
// overlay into that DOM. The tour mutates world state directly, so `sync`
// refreshes the panel controls to match when the tour exits.
let tour: Tour;
const sync = buildUI(world, () => tour.restart());
tour = new Tour(world, () => sync());

// Begin in the guided walkthrough (honoring any #step deep link in the URL).
tour.start();

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1); // clamp big gaps (tab switch)
  last = now;
  world.update(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
