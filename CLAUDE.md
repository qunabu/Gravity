# CLAUDE.md

Guidance for AI assistants (and humans) working in this repo.

## What this is

**Gravity · Solar System Simulator** — an interactive, physically grounded model
of the solar system (TypeScript + Three.js + Vite). It opens with a guided,
narrated walkthrough (English / Polish) that builds up *why* orbits exist, then
hands the user a free-explore mode. Everything is driven by real astronomical
data; only the *scale* is faked (and that's a user toggle).

## Commands

```bash
npm install
npm run dev      # vite dev server (http://localhost:5173)
npm run build    # tsc --noEmit-style type-check + vite production build → dist/
npm run preview  # serve the production build locally
```

Always run `npm run build` (or `npx tsc --noEmit && npx vite build`) before
considering a change done — the build does a full type-check.

Deployment: pushing to `main` triggers `.github/workflows/deploy.yml`, which
builds and publishes `dist/` to GitHub Pages. The Vite `base` is `/Gravity/`
for production builds (see `vite.config.ts`); keep that in sync with the repo
name if it ever changes.

## Architecture

```
src/
  data/        physical constants, real planet/moon data (radii, masses, J2000 elements)
  physics/     kepler.ts (analytic two-body), state.ts (state vectors), nbody.ts (leapfrog)
  scene/
    scale.ts     real vs visual scale models
    textures.ts  procedural canvas surface textures (offline; Earth uses a real image)
    world.ts     the Three.js engine — scene, bodies, orbits, vectors, and every demo
  ui/
    panel.ts     free-explore control panel
    tour.ts      the guided walkthrough: STEPS data + the Tour controller + i18n (EN/PL)
  main.ts        wiring + animation loop
public/          static assets served at root (e.g. earth_daymap.jpg)
```

### How the guided tour works (`src/ui/tour.ts`)

- `STEPS` is an ordered array of `TourStep` objects. **Step numbers are computed
  from array order — never hardcode them.** Each step has an `id` used as a
  `#hash` deep link.
- Each step declares scene state declaratively (scale, physics, 2D/3D, which
  bodies are `visible`, vectors, `demo` mode, etc.). `Tour.apply(step)` pushes
  that state into the `World`.
- Narration is bilingual: English lives in the `STEPS` objects; Polish in the
  `PL` map keyed by step `id`. **When you add or edit a step, update the `PL`
  entry too**, and the README step count.

### How demos work (`src/scene/world.ts`)

`world.ts` is the large, central file. A `DemoMode` string selects special
behavior in the per-frame `update()` loop. Each mode typically has a `startX()`
method (sets camera + state) and a branch in the update loop / `updateAstro()`.
Existing modes: `normal`, `inertia`, `accretion`, `helix`, `orbit-intro`,
`rocket`, `soi` (spheres of influence), `flyby` (Voyager gravity assists), and
`spacetime` (Einstein's curved-spacetime grid). Camera moves via an eased
`flyTo`; on the tour, releasing a drag springs the camera back to the framing.

## Conventions

- Match the surrounding code's style: terse, purposeful comments that explain
  *why*, real units in the physics layer, scene units in the renderer.
- Coordinate frame: physics is heliocentric ecliptic AU; `eclToScene(v)` maps
  ecliptic → render space as `(v.x, v.z, -v.y)`.
- Keep things working offline — procedural textures, bundled assets.
- Verify visual changes in the browser when possible; the slides are tuned by
  eye.

## Credits

Earth texture: Solar System Scope (CC BY 4.0). Built by
[qunabu](https://github.com/qunabu/Gravity).
