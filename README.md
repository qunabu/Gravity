# Gravity · Solar System Simulator

An interactive, physically grounded model of the solar system that demonstrates
how gravity shapes orbits — built with **TypeScript + Three.js + Vite**.

It opens with a guided, 35-step walkthrough and then hands you a free-explore
mode. Everything is driven by real astronomical data; the only thing the
renderer ever fakes is the *scale* (and that is a toggle you control).

## Visuals

- **SpaceX-style UI** — pure black, hairline borders with HUD corner ticks,
  thin wide-tracked uppercase labels, white-fill active toggles, and monospace
  telemetry numerals (Inter + Roboto Mono).
- **Procedural textures** — every Sun/planet/moon surface is generated on a
  canvas from 3D value-noise (`src/scene/textures.ts`): solar granulation,
  banded gas giants with a Great Red Spot, a cloudy blue Earth, cratered rocky
  moons, and a radial Saturn ring with the Cassini gap. No image files, so it
  works fully offline.
- **Smooth transitions** — stepping through the tour eases the camera to each
  target (cancelled the instant you grab the controls) and fades bodies and
  orbits in and out, rather than snapping.

## Run it

```bash
npm install
npm run dev      # opens http://localhost:5173
npm run build    # type-check + production bundle into dist/
```

## The guided tour

A narrated, 35-step walkthrough that builds up *why* orbits exist before showing
the whole system. Jump around with the **dropdown** or the dots, and every step
has a **deep link** — paste `…/#why-no-fall` to land straight on that step. An
**EN / PL** switch in the panel header toggles the narration between English and
Polish (the choice is remembered).

1. **What is gravity?** (`#what-is-gravity`) — just two bodies and the equal-and-
   opposite force vectors between them (Newton's 3rd law); same force, unequal effect.
2. **Gravity builds the Sun** (`#birth-of-sun`) — a cloud of dust collapses and
   swirls into the Sun (accretion animation).
3. **Gravity builds the Earth** (`#birth-of-earth`) — the same in miniature in the
   leftover disk; the young Earth glows molten as it forms.
4. **A moving body keeps moving** (`#inertia`) — the Sun is removed; Earth drifts
   in a straight line at constant velocity (Newton's 1st law). Inertia alone.
5. **Why the Earth doesn't fall into the Sun** (`#why-no-fall`) — velocity vector +
   gravity vector + a dashed "straight path without gravity." Gravity bends the
   straight line into a closed loop — an orbit is just falling and always missing.
6. **The Earth and the Moon** (`#earth-moon`) — the same law one level down.
7. **Why the Moon doesn't fall to Earth** (`#moon-no-fall`) — the orbit-balance
   argument again, now Moon↔Earth: gravity + sideways velocity vectors and the
   dashed straight-line path. The camera follows Earth as it orbits.
8. **Into the third dimension** (`#into-3d`) — tilt into 3D for real inclinations;
   projection drop-lines map a 3D position onto the flat 2D plane.
9. **Spinning on their axes** (`#self-rotation`) — besides orbiting, every body
   spins on its own (tilted) axis; this is where axial rotation switches on.
10. **The Sun moves too — orbits are really helices** (`#sun-moving`) — the Sun
    drifts at 45° through a parallax starfield; planets' real-space trails coil
    into 3-D helices around its path.
11. **The same forces, still at work** (`#sun-moving-vectors`) — velocity (along
    the helix) + gravity (toward the Sun) arrows on every body during that motion.
12. **Moons ride along too** (`#sun-moving-moons`) — the Moon coils around the
    Earth's coil around the Sun's path: helices within helices.
13. **The whole solar system** (`#solar-system`) — all eight planets, Pluto, and
    the major moons on their real J2000 orbits.

`#explore` (or "Skip · Explore") leaves the tour for the free-explore panel;
"Replay guided tour" restarts it from step 1.

## What's real

- **Sizes** — every body uses its real mean radius (Sun 696 340 km → Pluto
  1 188 km) and mass.
- **Orbits** — real J2000.0 heliocentric Keplerian elements (semi-major axis,
  eccentricity, inclination, node, perihelion, mean longitude) from the
  JPL/IAU approximate-element tables. Kepler's equation is solved per frame.
- **Dates** — the clock is real: T=0 is the J2000 epoch (2000-01-01 12:00).

## The two hard problems, and how they're handled

**Scale.** At true scale the Sun is 0.00465 AU across while Neptune orbits at
30 AU — you cannot show real sizes *and* real distances and see anything. So
there are two interchangeable scale models behind one interface
(`src/scene/scale.ts`):

- **True scale** — sizes and distances share one linear factor. Accurate, but
  planets become the specks they really are; zoom in to find them.
- **Visual scale** — a monotonic radial remap pulls the outer planets inward and
  a logarithmic size map keeps both the Sun and tiny Mercury visible at once.
  Physics still runs in true AU; only rendering is remapped.

**Physics.** Two toggleable models, seeded from identical real initial
conditions:

- **Keplerian** (`src/physics/kepler.ts`) — analytic two-body positions from the
  orbital elements. Exact and perfectly stable.
- **N-body** (`src/physics/nbody.ts`) — direct all-pairs Newtonian gravity
  integrated with a symplectic kick–drift–kick **leapfrog** scheme. This is
  gravity *simulated* rather than prescribed. The info panel shows live energy
  drift (typically ~10⁻⁶ %), which is how you know the integrator is honest.

## Moons

Every planet carries its major moon(s) with real radii, masses, and orbital
parameters. They always render on accurate Keplerian paths around their planet
(visually exaggerated in Visual mode so they're not sub-pixel). The **Moons**
toggle controls them — it's flagged "heavier" because turning it on in N-body
mode also feeds the dynamically significant moons into the integrator, which
needs a finer timestep (the short-period moons drive it).

Only moons massive enough to actually perturb their planet are simulated
gravitationally (the Moon ≈ 1.2 % of Earth; **Charon ≈ 12 % of Pluto**, a true
binary; the Galileans; Titan; Triton). Negligible moons like Phobos (~10⁻⁸ of
Mars) are render-only — including them would burn compute for no visible effect.

## Project layout

```
src/
  data/
    constants.ts   physical constants (G, AU, masses, …)
    bodies.ts      real planet + moon data (radii, masses, J2000 elements)
    system.ts      builds the N-body body set; moon-relative Kepler helpers
  physics/
    kepler.ts      Kepler's-equation solver + analytic positions
    state.ts       position+velocity state vectors from elements
    nbody.ts       leapfrog N-body integrator (SI internally)
  scene/
    scale.ts       real vs visual scale models
    textures.ts    procedural canvas surface textures (offline, no images)
    world.ts       Three.js scene, bodies, orbits, vectors, accretion, 2D↔3D
  ui/
    panel.ts       control + info panels
    tour.ts        the guided walkthrough (steps + deep links)
  main.ts          wiring + animation loop
```

## Caveats

- Moon J2000 node/argument/phase are approximate (real values are messy and
  precess); semi-major axis, eccentricity, inclination, and period are real.
- Visual scale is a non-linear radial remap, so in that mode orbit ellipses are
  *near*-ellipses by construction. Switch to True scale for exact geometry.
- At very high time-multipliers in N-body the substep count is capped, so the
  fastest moons lose accuracy gracefully rather than freezing the tab.
