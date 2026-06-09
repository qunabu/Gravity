import { World } from '../scene/world';
import { ALL_BODIES } from '../data/bodies';

// Builds the control HTML overlay and wires it to the World instance.
// Kept dependency-free (plain DOM) so the demo has no UI-framework weight.

export function buildUI(world: World, onStartTour: () => void): () => void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="panel" id="controls">
      <h1>Gravity</h1>
      <p class="sub">Solar System · Newtonian Model</p>

      <div class="group">
        <div class="glabel">Scale model</div>
        <div class="seg" id="scaleSeg">
          <button data-v="visual" class="on">Visual</button>
          <button data-v="real">True scale</button>
        </div>
        <div class="hint" id="scaleHint"></div>
      </div>

      <div class="group">
        <div class="glabel">Physics</div>
        <div class="seg" id="physSeg">
          <button data-v="kepler" class="on">Keplerian</button>
          <button data-v="nbody">N-body</button>
        </div>
        <div class="hint" id="physHint"></div>
      </div>

      <div class="group">
        <div class="glabel">Dimension</div>
        <div class="seg" id="dimSeg">
          <button data-v="3d" class="on">3D</button>
          <button data-v="2d">2D ecliptic</button>
        </div>
        <div class="hint">3D shows real orbital inclinations; 2D flattens onto the ecliptic plane.</div>
      </div>

      <div class="group">
        <label class="chk"><input type="checkbox" id="cOrbits" checked> Orbit paths</label>
        <label class="chk"><input type="checkbox" id="cMoons"> Moons <span class="tag">heavier</span></label>
        <label class="chk"><input type="checkbox" id="cProj"> Projection lines onto ecliptic</label>
        <label class="chk"><input type="checkbox" id="cLabels" checked> Labels</label>
      </div>

      <div class="group">
        <div class="glabel">Time · <span id="speedVal"></span></div>
        <input type="range" id="speed" min="0" max="100" value="42">
        <div class="row">
          <button id="pause">⏸ Pause</button>
          <button id="reset">⟲ J2000</button>
        </div>
      </div>

      <div class="group">
        <div class="glabel">Focus camera</div>
        <select id="focus"></select>
      </div>

      <button id="tourBtn" class="tour-restart">▶ Replay guided tour</button>
    </div>
  `;

  // ---- scale segment ----
  const scaleSeg = app.querySelector('#scaleSeg')!;
  const scaleHint = app.querySelector('#scaleHint') as HTMLElement;
  scaleHint.textContent = world['scale']?.label ?? '';
  scaleSeg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    seg(scaleSeg, b);
    const v = b.dataset.v as 'visual' | 'real';
    world.setScaleMode(v);
    scaleHint.textContent = v === 'real'
      ? 'True scale — accurate sizes & distances. Planets are specks; zoom in.'
      : 'Visual scale — sizes & distances compressed so everything is visible.';
  });
  scaleHint.textContent = 'Visual scale — sizes & distances compressed so everything is visible.';

  // ---- physics segment ----
  const physSeg = app.querySelector('#physSeg')!;
  const physHint = app.querySelector('#physHint') as HTMLElement;
  const setPhysHint = (v: string) => {
    physHint.textContent = v === 'kepler'
      ? 'Analytic two-body orbits from J2000 elements — exact, stable positions.'
      : 'Direct F = G·m₁·m₂/r² integration of every pair — gravity, simulated.';
  };
  setPhysHint('kepler');
  physSeg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    seg(physSeg, b);
    const v = b.dataset.v as 'kepler' | 'nbody';
    world.setPhysics(v);
    setPhysHint(v);
  });

  // ---- dimension segment ----
  const dimSeg = app.querySelector('#dimSeg')!;
  dimSeg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    seg(dimSeg, b);
    world.setTwoD(b.dataset.v === '2d');
  });

  // ---- checkboxes ----
  (app.querySelector('#cOrbits') as HTMLInputElement).addEventListener('change', (e) => {
    world.state.showOrbits = (e.target as HTMLInputElement).checked;
  });
  (app.querySelector('#cProj') as HTMLInputElement).addEventListener('change', (e) => {
    world.state.showProjection = (e.target as HTMLInputElement).checked;
  });
  (app.querySelector('#cLabels') as HTMLInputElement).addEventListener('change', (e) => {
    world.state.showLabels = (e.target as HTMLInputElement).checked;
  });
  (app.querySelector('#cMoons') as HTMLInputElement).addEventListener('change', (e) => {
    world.setShowMoons((e.target as HTMLInputElement).checked);
  });

  (app.querySelector('#tourBtn') as HTMLButtonElement).addEventListener('click', onStartTour);

  // ---- time ----
  const speed = app.querySelector('#speed') as HTMLInputElement;
  const speedVal = app.querySelector('#speedVal') as HTMLElement;
  const applySpeed = () => {
    // Map slider 0..100 to ~0.2 .. 4000 days/sec, logarithmically.
    const t = +speed.value / 100;
    const dps = 0.2 * Math.pow(20000, t);
    world.state.daysPerSecond = dps;
    speedVal.textContent = fmtSpeed(dps);
  };
  speed.addEventListener('input', applySpeed);
  applySpeed();

  const pauseBtn = app.querySelector('#pause') as HTMLButtonElement;
  pauseBtn.addEventListener('click', () => {
    world.state.paused = !world.state.paused;
    pauseBtn.textContent = world.state.paused ? '▶ Play' : '⏸ Pause';
  });
  (app.querySelector('#reset') as HTMLButtonElement).addEventListener('click', () => {
    world.simDays = 0;
    if (world.state.physics === 'nbody') world.setPhysics('nbody');
  });

  // ---- focus selector ----
  const focus = app.querySelector('#focus') as HTMLSelectElement;
  for (const b of ALL_BODIES) {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = b.name;
    focus.appendChild(o);
  }
  let selected = 'earth';
  focus.value = selected;
  focus.addEventListener('change', () => {
    selected = focus.value;
    world.focusOn(selected);
  });

  // Reflect world state into the controls (the tour mutates state directly).
  function setSeg(container: Element, value: string): void {
    container.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.v === value));
  }
  return function sync(): void {
    const st = world.state;
    setSeg(scaleSeg, st.scaleMode);
    setSeg(physSeg, st.physics);
    setSeg(dimSeg, st.twoD ? '2d' : '3d');
    setPhysHint(st.physics);
    scaleHint.textContent = st.scaleMode === 'real'
      ? 'True scale — accurate sizes & distances. Planets are specks; zoom in.'
      : 'Visual scale — sizes & distances compressed so everything is visible.';
    (app.querySelector('#cOrbits') as HTMLInputElement).checked = st.showOrbits;
    (app.querySelector('#cProj') as HTMLInputElement).checked = st.showProjection;
    (app.querySelector('#cLabels') as HTMLInputElement).checked = st.showLabels;
    (app.querySelector('#cMoons') as HTMLInputElement).checked = st.showMoons;
    // Invert the log speed mapping to position the slider.
    const t = Math.log(st.daysPerSecond / 0.2) / Math.log(20000);
    speed.value = String(Math.round(Math.max(0, Math.min(1, t)) * 100));
    speedVal.textContent = fmtSpeed(st.daysPerSecond);
    pauseBtn.textContent = st.paused ? '▶ Play' : '⏸ Pause';
  };
}

// ---- helpers ----
function seg(container: Element, active: Element): void {
  container.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
  active.classList.add('on');
}
function fmtSpeed(dps: number): string {
  if (dps < 1) return `${(dps * 24).toFixed(1)} h/s`;
  if (dps < 400) return `${dps.toFixed(1)} days/s`;
  return `${(dps / 365.25).toFixed(2)} yr/s`;
}
