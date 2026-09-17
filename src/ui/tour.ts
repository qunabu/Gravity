import type { World } from '../scene/world';
import { openIssue } from './issue';
import type { ScaleMode } from '../scene/scale';
import type { PhysicsMode, DemoMode } from '../scene/world';

// A guided walkthrough that builds up *why* orbits exist, one idea at a time:
// gravity between two masses → gravity builds the Sun and Earth from dust →
// inertia → orbit as falling-and-missing → the Moon → 3D → axial spin → the
// whole system. Each step declares the world state it wants; the controller
// applies it. Step numbers are derived from array order (never hardcoded), and
// each step has a stable `id` used for #hash deep-links and the dropdown.

export interface TourStep {
  id: string;
  title: string;
  body: string;
  scale: ScaleMode;
  physics: PhysicsMode;
  twoD: boolean;
  demo: DemoMode;
  showMoons: boolean;
  showOrbits: boolean;
  showProjection: boolean;
  spin: boolean;        // axial self-rotation of bodies
  axes?: boolean;       // draw rotation-axis lines
  moonLabels?: boolean; // show moon name labels (default true)
  daysPerSecond: number;
  visible: string[] | null;
  vectors?: { velocity?: boolean; gravity?: boolean; mutual?: boolean; tangent?: boolean };
  /** Which orbit the vectors describe (default Earth around the Sun). */
  vecTarget?: 'earth' | 'moon';
  /** Velocity + gravity arrows on every body (helix slide). */
  vecAll?: boolean;
  /** The Sun's own motion arrow (helix slide). */
  vecSun?: boolean;
  /** Slowly auto-rotate the camera around the system. */
  autoRotate?: boolean;
  /** Run the dust→body accretion animation for this body id. */
  accreteBody?: string;
  frameAU?: number;
  focus?: string;
  focusMul?: number;
  /** Keep the camera following the focused body as it moves. */
  follow?: boolean;
  /** Vertical screen offset of the followed body (0 = dead-center). */
  followRaise?: number;
  /** Show a time-speed slider in the panel for this step. */
  speedControl?: boolean;
  /** Orbit-intro sideways-speed factor (1 = stable, <1 falls in, >√2 escapes). */
  orbitSpeed?: number;
  /** Cosmic-velocity rocket: launch a probe from a central body.
   *  `lob` (radians from tangential toward straight-up) gives a ballistic
   *  launch that visibly rises off the surface before arcing back. */
  rocket?: { attractor: string; R: number; vBase: number; speed: number; label: string; lob?: number; satellite?: boolean };
  /** Which Voyager mission a gravity-assist slide plays. */
  mission?: 'voyager-1' | 'voyager-2';
  /** Follow with a 3/4 side view (so an axial tilt reads as a lean). */
  sideFollow?: boolean;
  /** A "go deeper" link shown under the narration (bilingual label). */
  link?: { href: string; en: string; pl: string };
}

/** Terms in the narration worth a click. The first mention in a slide's body
 *  becomes a link; matching is case-insensitive and whole-word. */
const GLOSSARY: Record<Lang, { term: string; href: string }[]> = {
  en: [{ term: 'barycenter', href: 'https://en.wikipedia.org/wiki/Barycenter' }],
  pl: [{ term: 'barycentrum', href: 'https://pl.wikipedia.org/wiki/Barycentrum' }],
};

/** Bartosz Ciechanowski's interactive Moon explainer — offered on every slide
 *  where the Moon is the subject. */
const MOON_LINK = {
  href: 'https://ciechanow.ski/moon/',
  en: 'Go deeper on the Moon — Bartosz Ciechanowski’s interactive explainer ↗',
  pl: 'Zgłęb temat Księżyca — interaktywne wyjaśnienie Bartosza Ciechanowskiego ↗',
};

function fmtSpeed(dps: number): string {
  if (dps < 1) return `${(dps * 24).toFixed(1)} h/s`;
  if (dps < 400) return `${dps.toFixed(1)} days/s`;
  return `${(dps / 365.25).toFixed(2)} yr/s`;
}

const V = (o: TourStep['vectors']) => o;

const STEPS_SOURCE: TourStep[] = [
  {
    id: 'what-is-gravity',
    title: 'What is gravity?',
    body:
      'Gravity is the attraction between any two masses: F = G · m₁·m₂ / r² — stronger with more mass, weaker with the square of the distance. ' +
      'Here are just two bodies. The arrows show the pull each exerts on the other: exactly equal and opposite (Newton’s 3rd law), about 3.5 × 10²² newtons. ' +
      'The Sun is ~333 000× heavier, so the same force barely moves it but flings the Earth around. This one rule is the whole story — next we’ll see it even built these bodies.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'normal',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 1.5,
    visible: ['sun', 'earth'], frameAU: 2.4,
    vectors: V({ gravity: true, mutual: true }),
  },
  {
    id: 'birth-of-sun',
    title: 'Gravity builds the Sun',
    body:
      '~4.6 billion years ago there were no planets — only a vast, cold cloud of gas and dust (the solar nebula). ' +
      'Every grain pulled on every other grain. Gravity dragged the cloud inward, and as it collapsed it spun into a flattening disk with a dense, growing core. ' +
      'When that core became hot and heavy enough for nuclear fusion to ignite, the Sun switched on. Watch the dust fall together.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'accretion',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: ['sun'], accreteBody: 'sun',
  },
  {
    id: 'birth-of-earth',
    title: 'Gravity builds the Earth',
    body:
      'The same thing happened in miniature all around the young Sun. In the leftover disk, dust grains stuck together and their growing gravity swept up more material — a runaway process called accretion. ' +
      'Pebbles became boulders, boulders became planetesimals, and those merged into planets. Earth is one such ball of accreted rock and metal. The exact same force that lit the Sun also assembled the ground beneath you.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'accretion',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: ['earth'], accreteBody: 'earth',
  },
  {
    id: 'inertia',
    title: 'A moving body keeps moving',
    body:
      'Now remove the Sun entirely. With no force acting on it, the Earth obeys Newton’s 1st law: it drifts in a perfectly straight line at a constant 29.8 km/s, forever (green arrow = its velocity). ' +
      'This is inertia. On its own, motion makes a straight line — never a curve, never a circle. Something has to bend the path. Keep this drifting Earth in mind for the next step.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'inertia',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 1,
    visible: ['earth'],
    vectors: V({ velocity: true }),
  },
  {
    id: 'why-no-fall',
    title: 'Why the Earth doesn’t fall into the Sun',
    body:
      'Put it together. The Sun’s gravity (red arrow) pulls the Earth straight toward it the whole time — so why no collision? Because the Earth is also moving sideways (green arrow) at 29.8 km/s. ' +
      'Each moment it does fall toward the Sun, but its sideways speed carries it past — it keeps missing. The dashed line shows where inertia alone would send it; gravity bends that straight path into a closed loop. ' +
      'An orbit is simply falling, continuously, and always missing.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'orbit-intro',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 1,
    visible: ['sun', 'earth'],
    vectors: V({ velocity: true, gravity: true, tangent: true }),
  },
  {
    id: 'too-slow',
    title: 'Too slow — it falls in',
    body:
      'Orbiting is a balance, and speed is what holds a body up. Give the Earth too little sideways speed and gravity wins: the path curves too hard, so instead of circling it plunges in toward the Sun. ' +
      'A planet that moves too slowly doesn’t orbit — it falls.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'orbit-intro', orbitSpeed: 0.42,
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 1,
    visible: ['sun', 'earth'],
    vectors: V({ velocity: true, gravity: true }),
  },
  {
    id: 'too-fast',
    title: 'Too fast — it escapes',
    body:
      'Now the opposite. Push the Earth past “escape velocity” and gravity can no longer hold it: the path still bends, but never closes. ' +
      'The Earth swings once past the Sun and flies off into space, never to return. Between too slow and too fast lies the narrow range of speeds that make a stable orbit.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'orbit-intro', orbitSpeed: 1.55,
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 1,
    visible: ['sun', 'earth'],
    vectors: V({ velocity: true, gravity: true }),
  },
  {
    id: 'rocket-too-slow',
    title: 'Below orbital speed — it falls back',
    body:
      'How fast must a rocket go to leave Earth? Launch it too slowly and it simply arcs back down: gravity pulls it into the ground before it can complete a loop. No matter the direction, too little speed always ends the same way — a crash.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'rocket',
    showMoons: false, showOrbits: false, showProjection: false, spin: true, daysPerSecond: 0.01,
    visible: ['earth'],
    rocket: { attractor: 'earth', R: 3.9, vBase: 2.6, speed: 0.82, lob: 0.7, label: 'v < 7.9 km/s' },
  },
  {
    id: 'first-cosmic',
    title: 'First cosmic velocity — orbit',
    body:
      'Give it just enough sideways speed — the first cosmic velocity, ≈ 7.9 km/s — and it stops falling back. Now the rocket falls around the Earth instead of into it, settling into a circular orbit. This is the speed of every satellite in low orbit.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'rocket',
    showMoons: false, showOrbits: false, showProjection: false, spin: true, daysPerSecond: 0.01,
    visible: ['earth'],
    rocket: { attractor: 'earth', R: 3.9, vBase: 2.6, speed: 1.0, label: 'v₁ ≈ 7.9 km/s', satellite: true },
  },
  {
    id: 'second-cosmic',
    title: 'Second cosmic velocity — escape',
    body:
      'Push to the second cosmic velocity, ≈ 11.2 km/s (exactly √2 × the first), and the rocket no longer orbits — it breaks free of Earth’s gravity entirely and coasts away. This is the escape velocity you need to reach the Moon or another planet.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'rocket',
    showMoons: false, showOrbits: false, showProjection: false, spin: true, daysPerSecond: 0.01,
    visible: ['earth'],
    rocket: { attractor: 'earth', R: 3.9, vBase: 2.6, speed: 1.42, label: 'v₂ ≈ 11.2 km/s' },
  },
  {
    id: 'earth-moon',
    title: 'The Earth and the Moon',
    body:
      'The same rule nests at every scale. The Moon (1.2% of Earth’s mass) is held by Earth’s gravity, orbiting every 27.3 days at 384 400 km — an orbit within an orbit. ' +
      'It’s also tidally locked. Earth’s pull raised a bulge on the Moon and slowly braked its spin until one rotation took exactly as long as one orbit — 27.3 days each. Because those two match, the same near side is turned toward us permanently: the familiar face of dark maria you can see below, following the Moon all the way round. The hemisphere behind it is the far side, not the dark one — over a month it gets just as much sunlight; it was simply unseen by anyone until Luna 3 photographed it in 1959. ' +
      'Switch Physics to “N-body” in the panel later to watch the Moon tug back and both bodies swing around their shared barycenter.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'normal',
    showMoons: true, showOrbits: true, showProjection: false, spin: false, daysPerSecond: 4,
    visible: ['sun', 'earth', 'moon'], focus: 'earth', focusMul: 16, follow: true, followRaise: 0,
    link: MOON_LINK,
  },
  {
    id: 'moon-no-fall',
    title: 'Why the Moon doesn’t fall to Earth',
    body:
      'It’s the very same balance as the Earth and Sun, one level down. Earth’s gravity (red arrow) pulls the Moon straight toward us — about 2 × 10²⁰ N — yet it never crashes down. ' +
      'The Moon is also moving sideways at 1.02 km/s (green arrow): every moment it falls toward Earth, but its speed carries it past, so it loops around instead of landing. The dashed line shows where it would fly off in a straight line without gravity. ' +
      'It has been falling around us — and missing — for 4.5 billion years.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'normal',
    showMoons: true, showOrbits: true, showProjection: false, spin: false, daysPerSecond: 5,
    visible: ['earth', 'moon'], focus: 'earth', focusMul: 11, follow: true, followRaise: 0,
    vectors: V({ velocity: true, gravity: true, tangent: true }), vecTarget: 'moon',
    link: MOON_LINK,
  },
  {
    id: 'into-3d',
    title: 'Into the third dimension',
    body:
      'Orbits aren’t perfectly flat. The Moon’s path tilts 5.1° to Earth’s orbit, and every planet’s orbit is inclined to the ecliptic plane. ' +
      'Rotate into 3D to see those tilts — drag to orbit the camera. Toggle “Projection” in the panel to drop each body onto the flat 2D plane and see how a 3D position projects down.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'normal',
    showMoons: true, showOrbits: true, showProjection: true, spin: false, daysPerSecond: 4,
    visible: ['sun', 'earth', 'moon'], frameAU: 2.0,
  },
  {
    id: 'self-rotation',
    title: 'Spinning on their axes',
    body:
      'Orbiting the Sun is only half the motion — every body also spins on its own axis, independently of its orbit. ' +
      'Earth turns once every 23 h 56 min (one sidereal day) about an axis tilted 23.4° (the blue line). That spin gives us day and night; the tilt gives us the seasons. ' +
      'Rates vary enormously: Jupiter spins in under 10 hours, while Venus takes 243 days — and turns backwards. Watch Earth rotate.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'normal',
    showMoons: false, showOrbits: false, showProjection: false, spin: true, axes: true, daysPerSecond: 0.14,
    visible: ['sun', 'earth'], focus: 'earth', focusMul: 7, follow: true, sideFollow: true,
  },
  {
    id: 'sun-moving',
    title: 'The Sun moves too — orbits are really helices',
    body:
      'We drew every orbit as a flat closed loop — but that’s only relative to the Sun. The Sun itself isn’t still: it sweeps around the galaxy at about 230 km/s, carrying the whole solar system with it. ' +
      'So a planet’s true path through space never closes. It keeps looping around the Sun while being dragged forward, tracing a long 3-D helix. Each coloured trail is a planet’s real route through space; the Sun’s is the straight line they all wind around.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'helix',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 50,
    visible: ['sun', 'venus', 'earth', 'mars'], vecSun: true,
  },
  {
    id: 'sun-moving-vectors',
    title: 'The same forces, still at work',
    body:
      'Even in this fully 3-D motion, nothing about the physics changed. Each planet still feels gravity (red) pulling it straight toward the Sun, and still carries a velocity (green) — but that velocity now points along its helix, not around a flat circle. ' +
      'Gravity bends the path at every instant; the forward drift stretches each loop into a coil. Same F = G·m₁·m₂/r², same falling-and-missing — just seen in the Sun’s moving frame.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'helix',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 50,
    visible: ['sun', 'venus', 'earth', 'mars'], vecAll: true, vecSun: true,
  },
  {
    id: 'sun-moving-moons',
    title: 'Moons ride along too',
    body:
      'The nesting goes all the way down. As the Sun drags the Earth along its helix, the Earth drags the Moon along too — so the Moon traces a coil wound around the Earth’s coil, which is itself wound around the Sun’s path. ' +
      'Every body is simultaneously orbiting, being carried, and carrying its own satellites. Real motion through space is helices within helices.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'helix',
    showMoons: true, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 30,
    visible: ['sun', 'earth', 'moon'],
    link: MOON_LINK,
  },
  {
    id: 'solar-system',
    title: 'The whole solar system',
    body:
      'Now the rest: eight planets (plus Pluto) and their major moons, all on their real J2000 orbits with accurate sizes and distances, each spinning on its own axis. ' +
      'Use the panel to switch between “Visual” and “True scale” (where planets become the specks they really are), turn on N-body gravity, change speed, and focus any body. Explore freely.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'normal',
    showMoons: true, showOrbits: true, showProjection: false, spin: true,
    moonLabels: false, daysPerSecond: 2, autoRotate: true, speedControl: true,
    visible: null, frameAU: 42,
  },
  {
    id: 'third-cosmic',
    title: 'Third cosmic velocity — leaving the Solar System',
    body:
      'One last step out. Even after escaping Earth, a probe is still bound to the Sun. The third cosmic velocity, ≈ 16.7 km/s from Earth, is what it takes to escape the Sun’s gravity too and leave the Solar System for interstellar space — the path Voyager is on. Watch the probe spiral out past the planets and never return.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'rocket',
    showMoons: false, showOrbits: true, showProjection: false, spin: false, daysPerSecond: 1,
    visible: null,
    rocket: { attractor: 'sun', R: 14, vBase: 3.0, speed: 1.45, label: 'v₃ ≈ 16.7 km/s' },
  },
  {
    id: 'sphere-of-influence',
    title: 'The sphere of influence',
    body:
      'Whose gravity wins? Around every body is a region — its sphere of influence — inside which its pull dominates. And they nest: the huge solar sphere holds the whole system; inside it Earth carves out its own (≈924,000 km); and inside that the Moon (at 384,400 km) carves out a smaller one still. That nesting is why the Moon orbits Earth rather than the Sun directly — cross a boundary and the next body out takes over. Mission planners exploit this, handing a spacecraft from one sphere to the next as a chain of simple two-body problems.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'soi',
    showMoons: false, showOrbits: false, showProjection: false, spin: true, daysPerSecond: 0.05,
    visible: ['sun', 'earth'],
  },
  {
    id: 'gravity-assist-1',
    title: 'Gravity assist — Voyager 1',
    body:
      'A spacecraft can steal a sliver of a planet’s orbital motion: swinging close behind it, the planet’s gravity slings the probe onward, faster, for free — a gravity assist. Voyager 1 launched in September 1977, used Jupiter (1979) to whip out to Saturn (1980), then a close pass of Saturn’s moon Titan bent it up out of the planets’ plane and on toward interstellar space. The clock runs the real dates — watch the planets move into place as the probe arrives.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'flyby', mission: 'voyager-1',
    showMoons: false, showOrbits: true, showProjection: false, spin: false, daysPerSecond: 0,
    visible: ['sun', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune'],
  },
  {
    id: 'gravity-assist-2',
    title: 'Gravity assist — Voyager 2 (the Grand Tour)',
    body:
      'Voyager 2 (launched August 1977) caught a rare alignment that comes around once every ~175 years: it chained all four giants — Jupiter (1979), Saturn (1981), Uranus (1986), Neptune (1989) — each flyby bending its path and flinging it further out, a tour impossible with rockets alone. Again the dates are real: the giants swing into their grand-tour line and the probe meets each one in turn.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'flyby', mission: 'voyager-2',
    showMoons: false, showOrbits: true, showProjection: false, spin: false, daysPerSecond: 0,
    visible: ['sun', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune'],
  },
  {
    id: 'spacetime',
    title: 'Einstein: gravity is curved spacetime',
    body:
      'Everything so far is Newton’s picture — masses reaching across space to pull on one another. It predicts orbits beautifully, but Einstein’s general relativity (1915) goes deeper. Mass and energy curve the very fabric of space and time around them, the way a heavy ball dents a stretched sheet. A nearby object isn’t “pulled” by a force — it simply follows the straightest path it can through that curved space, rolling into the well. Newton isn’t wrong, though: his law is exactly what Einstein’s becomes when gravity is weak and speeds are far below light — the same falling orbits you’ve watched all along, with a deeper reason why.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'spacetime',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'mercury-precession',
    title: 'The proof: Mercury’s orbit precesses',
    body:
      'Here’s where it stops being philosophy. Mercury’s elliptical orbit doesn’t close — its perihelion (closest point to the Sun) creeps around a little each lap. Newton, accounting for the tug of the other planets, predicts most of it but falls short by 43 arcseconds per century. That tiny gap went unexplained for decades — until general relativity predicted exactly 43″. The Sun’s curved spacetime makes the orbit rotate. Here it’s hugely exaggerated so you can watch the ellipse turn and trace a rosette; the blue line marks the precessing perihelion.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'precession',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: ['sun'],
  },
  {
    id: 'tides',
    title: 'Tides: why the sea breathes twice a day',
    body:
      'Gravity weakens with distance, so the Moon pulls the ocean on Earth’s near side harder than the planet’s center, and the center harder than the far side. That difference — the tidal force — stretches the oceans into two bulges, one facing the Moon and one directly opposite. Earth rotates through both each day, so most coasts get two high tides and two lows. The same stretching, over eons, is what locked the Moon’s spin to its orbit.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'tides',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [], link: MOON_LINK,
  },
  {
    id: 'lagrange',
    title: 'Lagrange points: parking spots in space',
    body:
      'Ordinarily the closer you orbit the Sun, the faster you must go — the orange dot is a body just inside Earth’s orbit doing exactly that on its own, running steadily ahead of us. But at five particular spots Earth’s pull (blue arrows) offsets the Sun’s (orange) by just enough to stretch the year back out to 365 days. A craft there keeps station with Earth, so this whole pattern turns as one piece, once a year. L1 and L2 hold great observatories — SOHO watches the Sun from L1, the James Webb telescope sits in our shadow at L2 — but both are saddles rather than bowls: a probe slides off and has to keep thrusting back, as these two are doing. L4 and L5, sixty degrees ahead and behind, are real bowls: rock nudged off them swings back in long loops, so asteroids collect. Jupiter’s hold Trojans in their thousands.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'lagrange',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'resonance',
    title: 'Orbital resonance: gravity keeping time',
    body:
      'When orbital periods line up in small whole-number ratios, repeated gentle tugs add up instead of cancelling. Jupiter’s three inner Galilean moons are locked in a 1:2:4 Laplace resonance — Io laps Europa exactly twice for every lap Europa makes of Ganymede. The same drumbeat carves the Kirkwood gaps in the asteroid belt and shepherds the rings of Saturn. Watch the moons return to alignment again and again.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'resonance',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'exoplanet',
    title: 'How we find other worlds',
    body:
      'A planet doesn’t simply orbit its star — both swing around their shared center of mass, the barycenter. The star traces a tiny circle in response to the planet’s pull. We can’t see most exoplanets directly, but we can detect that wobble: the star’s light shifts blue then red as it approaches and recedes. Jupiter makes our own Sun loop by about its own radius; that telltale dance is how thousands of distant worlds were discovered.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'exoplanet',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'lensing',
    title: 'Bending starlight',
    body:
      'If mass curves spacetime, then even light — which has no mass — must follow that curve. Einstein predicted the Sun would deflect the light of stars passing near its edge, shifting their apparent positions. During the total eclipse of 1919, Eddington measured exactly that bend, and Einstein became world-famous overnight. Today this “gravitational lensing” turns whole galaxies into cosmic magnifying glasses. Here a star sits directly behind the Sun, yet we see it offset — its light bent around the mass.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'lensing',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'black-hole',
    title: 'Black holes: a well with no bottom',
    body:
      'Pack enough mass into a small enough space and the spacetime well becomes bottomless. Inside the event horizon, escape would require travelling faster than light — so nothing, not even light, gets out. Just outside, gas spirals in and heats to millions of degrees, blazing as an accretion disk, while light itself can circle the hole in the razor-thin photon ring. This is the same falling-and-curving you’ve watched all tour, pushed to its absolute extreme.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'blackhole',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'gravitational-waves',
    title: 'Gravitational waves: ripples in spacetime',
    body:
      'When two black holes spiral together, their violent dance shakes spacetime itself, sending ripples outward at the speed of light. As they inspiral, the orbit tightens and quickens until they merge in a final chirp. In 2015 the LIGO detectors caught such a wave from two black holes that collided 1.3 billion years ago — stretching their 4-kilometre arms by less than a thousandth the width of a proton. A century after Einstein predicted them, we finally heard the universe ring.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'gwaves',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'time-dilation',
    title: 'Time runs slower in gravity',
    body:
      'Mass doesn’t just curve space — it slows time. A clock deep in a gravity well ticks slower than one far away. The effect is tiny on Earth, but real: this is why GPS satellites, higher up in a weaker field, must correct their clocks by about 38 microseconds a day — otherwise navigation would drift kilometres off within hours. Here the clock beside the mass falls steadily behind the distant one. Gravity and time are the same story.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'timedilation',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'milky-way',
    title: 'The Milky Way and the galactic year',
    body:
      'Pull back further than any orbit so far. Our Sun is one of a few hundred billion stars in the Milky Way, riding a spiral arm about two-thirds of the way out from the center. It orbits the galaxy at roughly 230 kilometres per second — yet the galaxy is so vast that one lap, a “galactic year”, takes about 230 million years. The last time the Sun was here, dinosaurs were just beginning. The same gravity that holds a moon holds a galaxy together.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'milkyway',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'sagittarius-a',
    title: 'Sagittarius A*: the monster at the center',
    body:
      'At the heart of the Milky Way lurks a supermassive black hole, Sagittarius A*, with the mass of about four million Suns. We know it’s there because we’ve watched stars whip around it for decades. The star S2 swings past on a wild ellipse every sixteen years, reaching 3% of the speed of light at closest approach — pure Kepler-and-Einstein motion around an invisible point. Those orbits won a Nobel Prize and weighed the unseen giant.',
    // 3-D: the 2-D lock would force the camera overhead, and the lensed halo
    // only reads with the disk edge-on.
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'sgra',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'dark-matter',
    title: 'The missing mass',
    body:
      'Here gravity hands us a mystery. By the very law from slide one, stars far from a galaxy’s center should orbit slower than those close in — just as Neptune crawls while Mercury races. But they don’t: the outer stars move just as fast as the inner ones, their speed curve staying stubbornly flat. The only fix is enormous amounts of unseen mass — “dark matter” — outweighing all the stars five to one. We’ve mapped the whole solar system, yet most of the universe is still something we cannot see.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'darkmatter',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'geoid',
    title: 'Earth’s gravity is lumpy',
    body:
      'We have been treating Earth as a smooth ball of mass, but it isn’t. Mountains, ocean trenches, thick continental roots and denser blobs in the mantle all pull a little harder or a little softer, so the strength of gravity changes from place to place. Geodesists map this as the geoid — the shape the oceans would settle into if gravity alone decided sea level. Its hills and hollows span about 200 metres: a big low south of India where gravity is weakest, highs over the west Pacific and the North Atlantic. Here that relief is exaggerated tens of thousands of times so you can see it; NASA’s GRACE satellites measure it by watching two spacecraft speed up and slow down as they fly over each anomaly.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'geoid',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'polaris',
    title: 'Why the North Star never moves',
    body:
      'Earth races around the Sun at 30 kilometres a second, crossing 300 million kilometres from one side of its orbit to the other — yet Polaris sits in the same spot above the northern horizon all year. Two reasons. First, the spin axis stays pointed the same way in space no matter where Earth is in its orbit; a spinning body holds its aim. Second, Polaris is 433 light-years away, so the entire width of our orbit shifts its apparent position by far less than the eye can catch. The aim isn’t quite frozen, though: gravity from the Sun and Moon tugs on Earth’s bulging equator and makes the axis wobble like a slow top, tracing a circle on the sky once every 26,000 years. In 12,000 years the pole star will be Vega.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'polaris',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'light-lag',
    title: 'Eight minutes and nineteen seconds',
    body:
      'The solar system is not just big — it is big compared to the fastest thing there is. Light covers 300,000 kilometres every second, and still takes 8 minutes 19 seconds to reach us from the Sun. You never see the Sun as it is; you see it as it was. Watch the wavefront sweep outward: Mars at 12 minutes, Jupiter at three quarters of an hour, Neptune more than four hours out. And this is not just about light. Gravity travels at exactly the same speed. If the Sun vanished this instant, Earth would keep curving along its orbit for another 8 minutes 19 seconds — the news of its absence arriving with the last of its light.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'lightlag',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'magnetosphere',
    title: 'The shield around the Earth',
    body:
      'The Sun doesn’t only shine — it blows. A million tonnes a second of charged particles stream outward at 400 kilometres a second, and during a solar storm far more. Earth deflects them. Molten iron churning in the core runs a dynamo, and the magnetic field it generates carves a cavity in that wind: squashed to ten Earth-radii on the sunward side, drawn out into a tail far past the Moon behind. Particles that do slip in spiral down the field lines to the poles and light the air as auroras. Mars had a field once, lost it, and the solar wind has been stripping its atmosphere ever since. Gravity holds the air down; magnetism keeps it from being blown away.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'magnetosphere',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'venus-rose',
    title: 'The rose that Venus draws',
    body:
      'Resonances leave signatures you can draw. Venus circles the Sun every 224.7 days, Earth every 365.3 — close enough to 13 laps against 8 that the pair almost exactly repeat their arrangement every eight years. Draw a line between the two planets every few days and those near-repeats weave a five-petalled rose. It is nearly perfect, not perfect: the pattern drifts by about two days per cycle, so the flower slowly rotates. This is the same near-resonance that puts Venus back in the same evening-star position every eight years, and it is the sort of pattern that convinced ancient astronomers the heavens ran on clockwork.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'venusrose',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'heliosphere',
    title: 'The bubble around the solar system',
    body:
      'The solar wind keeps blowing outward until it can no longer push back the thin gas between the stars. Where it finally slows below the speed of sound — about 94 times Earth’s distance from the Sun — it crosses the termination shock. Beyond that lies the turbulent heliosheath, and at roughly 120 AU the heliopause: the true edge of the Sun’s influence, where its wind gives way to the galaxy’s. Blunt on the side we plough into, drawn out into a long tail behind. Voyager 1 crossed it in 2012 and Voyager 2 in 2018 — the only human objects ever to leave the bubble. Gravity, though, reaches much further: the Sun still holds comets a thousand times beyond this boundary.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'heliosphere',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'cosmic-motion',
    title: 'You are never standing still',
    body:
      'Sitting perfectly still, you are being carried by four motions at once, each riding on the one above it. Earth’s spin sweeps you eastward at 0.46 km/s at the equator. Earth carries you around the Sun at 29.8 km/s. The Sun carries the whole system around the galaxy at 230 km/s. And the galaxy itself is falling toward the Great Attractor, so that against the oldest light in the universe — the cosmic microwave background — you are moving at about 370 km/s. Every one of those motions is a fall: a body going as straight as it can through curved space. The counter above shows how far you have come since this slide opened.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'cosmicmotion',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
  {
    id: 'early-universe',
    title: 'Before there were stars',
    body:
      'Wind everything back 13.8 billion years. No planets, no stars, no galaxies — just hydrogen and helium spread out almost perfectly evenly, smooth to about one part in 100,000. Almost. Those faint ripples were enough. Wherever the gas was a hair denser it pulled a little harder, so it gathered more gas, so it pulled harder still. Over hundreds of millions of years that runaway drained the voids and drew everything into a web of filaments and knots — and where the knots grew dense enough, the first stars ignited. Every galaxy, every star, every planet and every one of us sits on a thread of that web. Gravity, patiently amplifying almost nothing, built all of it — and in one knot of one thread, our own Sun is about to form.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'earlyuniverse',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
];

// Narrative order of the tour (step numbers derive from this). Gravity builds
// everything (cosmic web → Sun → Earth) → orbits → Moon & tides → 3-D & spin →
// the Sun's motion → the whole system → structures within it → leaving it &
// other worlds → the galaxy → and finally Einstein, all the way to black holes.
const TOUR_ORDER = [
  'what-is-gravity', 'early-universe', 'birth-of-sun', 'birth-of-earth',
  'inertia', 'why-no-fall', 'too-slow', 'too-fast', 'rocket-too-slow', 'first-cosmic', 'second-cosmic',
  'earth-moon', 'moon-no-fall', 'tides', 'geoid',
  'into-3d', 'self-rotation', 'polaris',
  'sun-moving', 'sun-moving-vectors', 'sun-moving-moons',
  'solar-system', 'light-lag', 'magnetosphere',
  'sphere-of-influence', 'lagrange', 'resonance', 'venus-rose',
  'third-cosmic', 'gravity-assist-1', 'gravity-assist-2', 'heliosphere',
  'exoplanet',
  'milky-way', 'cosmic-motion', 'sagittarius-a', 'dark-matter',
  'spacetime', 'mercury-precession', 'lensing', 'time-dilation', 'black-hole', 'gravitational-waves',
];

export const STEPS: TourStep[] = TOUR_ORDER.map((id) => {
  const step = STEPS_SOURCE.find((s) => s.id === id);
  if (!step) throw new Error(`TOUR_ORDER references unknown step id: ${id}`);
  return step;
});

export type Lang = 'en' | 'pl';

// Polish translations, keyed by step id. UI chrome strings below.
export const PL: Record<string, { title: string; body: string }> = {
  'what-is-gravity': {
    title: 'Czym jest grawitacja?',
    body: 'Grawitacja to przyciąganie między dowolnymi dwiema masami: F = G · m₁·m₂ / r² — tym silniejsze, im większe masy, i słabnące z kwadratem odległości. Oto tylko dwa ciała. Strzałki pokazują siłę, jaką każde działa na drugie: dokładnie równą i przeciwnie skierowaną (III zasada Newtona), około 3,5 × 10²² niutonów. Słońce jest ~333 000× cięższe, więc ta sama siła ledwie nim porusza, lecz rozpędza Ziemię wokół niego. Ta jedna reguła to cała opowieść — zaraz zobaczymy, że to ona zbudowała nawet te ciała.',
  },
  'birth-of-sun': {
    title: 'Grawitacja buduje Słońce',
    body: '~4,6 miliarda lat temu nie było planet — tylko ogromny, zimny obłok gazu i pyłu (mgławica słoneczna). Każde ziarno przyciągało każde inne. Grawitacja ściągała obłok do środka, a zapadając się, zawirował on w spłaszczający się dysk z gęstym, rosnącym jądrem. Gdy jądro stało się dość gorące i masywne, by rozpalić reakcję jądrową, Słońce się zapaliło. Patrz, jak pył opada razem.',
  },
  'birth-of-earth': {
    title: 'Grawitacja buduje Ziemię',
    body: 'To samo działo się w miniaturze wokół młodego Słońca. W pozostałym dysku ziarna pyłu sklejały się, a ich rosnąca grawitacja zgarniała coraz więcej materii — to lawinowy proces zwany akrecją. Kamyki stały się głazami, głazy planetozymalami, a te połączyły się w planety. Ziemia to taka właśnie kula nagromadzonej skały i metalu. Dokładnie ta sama siła, która rozpaliła Słońce, ułożyła też grunt pod twoimi stopami.',
  },
  'inertia': {
    title: 'Ciało w ruchu pozostaje w ruchu',
    body: 'Teraz usuńmy Słońce zupełnie. Bez działającej siły Ziemia podlega I zasadzie Newtona: dryfuje po idealnie prostej linii ze stałą prędkością 29,8 km/s, w nieskończoność (zielona strzałka = jej prędkość). To bezwładność. Sam ruch tworzy prostą linię — nigdy krzywą, nigdy okrąg. Coś musi zakrzywić tor. Zapamiętaj tę dryfującą Ziemię na następny krok.',
  },
  'why-no-fall': {
    title: 'Dlaczego Ziemia nie spada na Słońce',
    body: 'Połączmy to. Grawitacja Słońca (czerwona strzałka) cały czas ciągnie Ziemię prosto ku sobie — więc czemu nie ma zderzenia? Bo Ziemia porusza się też w bok (zielona strzałka) z prędkością 29,8 km/s. W każdej chwili spada ku Słońcu, ale ruch w bok przenosi ją obok — wciąż „chybia”. Przerywana linia pokazuje, dokąd poniosłaby ją sama bezwładność; grawitacja zagina ten prosty tor w zamkniętą pętlę. Orbita to po prostu nieustanne spadanie i wieczne chybianie.',
  },
  'too-slow': {
    title: 'Za wolno — spada do środka',
    body: 'Orbita to równowaga, a to prędkość utrzymuje ciało w górze. Daj Ziemi za mało prędkości w bok, a grawitacja wygra: tor zakręca zbyt mocno, więc zamiast krążyć, ciało nurkuje ku Słońcu. Planeta poruszająca się zbyt wolno nie krąży — spada.',
  },
  'too-fast': {
    title: 'Za szybko — ucieka',
    body: 'Teraz odwrotnie. Rozpędź Ziemię ponad „prędkość ucieczki”, a grawitacja już jej nie utrzyma: tor wciąż się zagina, lecz nigdy nie zamyka. Ziemia okrąża Słońce raz i odlatuje w przestrzeń, by nigdy nie wrócić. Między „za wolno” a „za szybko” leży wąski zakres prędkości dający stabilną orbitę.',
  },
  'rocket-too-slow': {
    title: 'Poniżej prędkości orbitalnej — spada z powrotem',
    body: 'Jak szybko musi lecieć rakieta, by opuścić Ziemię? Wystrzel ją w bok zbyt wolno, a po prostu zatoczy łuk i spadnie: grawitacja ściągnie ją na ziemię, zanim zdąży zamknąć pętlę. Niezależnie od kierunku, za mała prędkość kończy się tak samo — katastrofą.',
  },
  'first-cosmic': {
    title: 'Pierwsza prędkość kosmiczna — orbita',
    body: 'Daj jej akurat tyle prędkości w bok — pierwszą prędkość kosmiczną, ≈ 7,9 km/s — a przestanie spadać. Teraz rakieta spada wokół Ziemi, a nie na nią, wchodząc na orbitę kołową. To prędkość każdego satelity na niskiej orbicie.',
  },
  'second-cosmic': {
    title: 'Druga prędkość kosmiczna — ucieczka',
    body: 'Rozpędź ją do drugiej prędkości kosmicznej, ≈ 11,2 km/s (dokładnie √2 × pierwszej), a rakieta przestaje krążyć — całkowicie wyrywa się z grawitacji Ziemi i odlatuje. To prędkość ucieczki potrzebna, by dotrzeć do Księżyca lub innej planety.',
  },
  'earth-moon': {
    title: 'Ziemia i Księżyc',
    body: 'Ta sama reguła zagnieżdża się na każdej skali. Księżyc (1,2% masy Ziemi) jest utrzymywany grawitacją Ziemi, okrążając ją co 27,3 dnia w odległości 384 400 km — orbita wewnątrz orbity. Jest też zsynchronizowany pływowo. Grawitacja Ziemi wypiętrzyła na Księżycu zgrubienie i powoli hamowała jego obrót, aż jedna rotacja zaczęła trwać dokładnie tyle, co jeden obieg — po 27,3 dnia. Ponieważ oba ruchy się zgadzają, wciąż ta sama strona bliska jest zwrócona ku nam na stałe: znajoma twarz z ciemnych mórz, którą widzisz niżej, towarzyszy Księżycowi przez całą orbitę. Półkula za nią to strona odwrócona, a nie ciemna — w ciągu miesiąca dostaje tyle samo światła; była po prostu przez nikogo niewidziana, dopóki w 1959 roku nie sfotografowała jej Łuna 3. Przełącz później fizykę na „N-body” w panelu, by zobaczyć, jak Księżyc odciąga Ziemię i oba ciała krążą wokół wspólnego środka masy, czyli barycentrum.',
  },
  'moon-no-fall': {
    title: 'Dlaczego Księżyc nie spada na Ziemię',
    body: 'To dokładnie ta sama równowaga co Ziemia i Słońce, tylko piętro niżej. Grawitacja Ziemi (czerwona strzałka) ciągnie Księżyc prosto ku nam — około 2 × 10²⁰ N — a jednak nigdy nie spada. Księżyc porusza się też w bok z prędkością 1,02 km/s (zielona strzałka): w każdej chwili spada ku Ziemi, lecz prędkość przenosi go obok, więc zamiast lądować, krąży. Przerywana linia pokazuje, dokąd poleciałby po prostej bez grawitacji. Spada wokół nas — i chybia — od 4,5 miliarda lat.',
  },
  'into-3d': {
    title: 'W trzecim wymiarze',
    body: 'Orbity nie są idealnie płaskie. Tor Księżyca jest nachylony 5,1° do orbity Ziemi, a orbita każdej planety jest pochylona względem płaszczyzny ekliptyki. Obróć do 3D, by zobaczyć te nachylenia — przeciągnij, by obracać kamerą. Włącz „Projekcję” w panelu, by rzutować każde ciało na płaską płaszczyznę 2D i zobaczyć, jak pozycja 3D rzutuje się w dół.',
  },
  'self-rotation': {
    title: 'Obrót wokół własnej osi',
    body: 'Krążenie wokół Słońca to tylko połowa ruchu — każde ciało obraca się też wokół własnej osi, niezależnie od orbity. Ziemia obraca się raz na 23 h 56 min (jedna doba gwiazdowa) wokół osi nachylonej o 23,4° (niebieska linia). Ten obrót daje dzień i noc; nachylenie daje pory roku. Tempa są ogromnie różne: Jowisz obraca się w niecałe 10 godzin, a Wenus potrzebuje 243 dni — i kręci się wstecz. Patrz, jak Ziemia się obraca.',
  },
  'sun-moving': {
    title: 'Słońce też się porusza — orbity to naprawdę helisy',
    body: 'Rysowaliśmy każdą orbitę jako płaską, zamkniętą pętlę — ale to tylko względem Słońca. Samo Słońce nie stoi: pędzi wokół galaktyki z prędkością około 230 km/s, ciągnąc ze sobą cały Układ Słoneczny. Dlatego prawdziwy tor planety w przestrzeni nigdy się nie zamyka. Wciąż okrąża Słońce, będąc jednocześnie ciągniętą do przodu, kreśląc długą trójwymiarową helisę. Każdy kolorowy ślad to prawdziwa droga planety; ślad Słońca to prosta linia, wokół której wszystkie się nawijają.',
  },
  'sun-moving-vectors': {
    title: 'Te same siły, wciąż w działaniu',
    body: 'Nawet w tym w pełni trójwymiarowym ruchu fizyka się nie zmieniła. Każda planeta wciąż czuje grawitację (czerwona) ciągnącą ją prosto ku Słońcu i wciąż ma prędkość (zielona) — tyle że ta prędkość biegnie teraz wzdłuż helisy, a nie po płaskim okręgu. Grawitacja w każdej chwili zagina tor; ruch do przodu rozciąga każdą pętlę w sprężynę. To samo F = G·m₁·m₂/r², to samo spadanie-i-chybianie — tylko widziane w ruchomym układzie Słońca.',
  },
  'sun-moving-moons': {
    title: 'Księżyce lecą razem',
    body: 'Zagnieżdżenie sięga aż do dołu. Gdy Słońce ciągnie Ziemię wzdłuż jej helisy, Ziemia ciągnie też Księżyc — więc Księżyc kreśli sprężynę nawiniętą na sprężynę Ziemi, która z kolei jest nawinięta na tor Słońca. Każde ciało jednocześnie krąży, jest niesione i niesie własne satelity. Prawdziwy ruch w przestrzeni to helisy wewnątrz helis.',
  },
  'solar-system': {
    title: 'Cały Układ Słoneczny',
    body: 'A teraz reszta: osiem planet (plus Pluton) i ich główne księżyce, wszystkie na prawdziwych orbitach J2000 z dokładnymi rozmiarami i odległościami, każde obracające się wokół własnej osi. Użyj panelu, by przełączać między „Skalą wizualną” a „Skalą rzeczywistą” (gdzie planety stają się drobinami, którymi naprawdę są), włączyć grawitację N-body, zmienić prędkość i namierzyć dowolne ciało. Eksploruj swobodnie.',
  },
  'third-cosmic': {
    title: 'Trzecia prędkość kosmiczna — opuszczenie Układu Słonecznego',
    body: 'Jeszcze jeden krok na zewnątrz. Nawet po ucieczce z Ziemi sonda wciąż jest związana ze Słońcem. Trzecia prędkość kosmiczna, ≈ 16,7 km/s z Ziemi, to tyle, ile trzeba, by uciec również grawitacji Słońca i opuścić Układ Słoneczny ku przestrzeni międzygwiezdnej — drogą, którą leci Voyager. Patrz, jak sonda wykręca obok planet i nigdy nie wraca.',
  },
  'sphere-of-influence': {
    title: 'Sfera wpływu grawitacyjnego',
    body: 'Czyja grawitacja wygrywa? Wokół każdego ciała istnieje obszar — jego sfera wpływu — w którym to ono dominuje. I sfery te się zagnieżdżają: ogromna sfera Słońca obejmuje cały układ; w jej wnętrzu Ziemia ma własną (≈924 000 km); a w tamtej jeszcze mniejszą wycina Księżyc (w odległości 384 400 km). To zagnieżdżenie sprawia, że Księżyc krąży wokół Ziemi, a nie wprost wokół Słońca — przekrocz granicę, a przejmuje kolejne ciało. Planiści misji to wykorzystują, przekazując statek z jednej sfery do następnej jako ciąg prostych problemów dwóch ciał.',
  },
  'gravity-assist-1': {
    title: 'Asysta grawitacyjna — Voyager 1',
    body: 'Statek może ukraść odrobinę ruchu orbitalnego planety: przelatując tuż za nią, jej grawitacja wyrzuca sondę dalej i szybciej — za darmo. To asysta grawitacyjna. Voyager 1 wystartował we wrześniu 1977, użył Jowisza (1979), by wyrzucić się ku Saturnowi (1980), a bliski przelot obok księżyca Saturna, Tytana, wygiął jego tor w górę, poza płaszczyznę planet, ku przestrzeni międzygwiezdnej. Zegar pokazuje prawdziwe daty — patrz, jak planety ustawiają się, gdy sonda nadlatuje.',
  },
  'gravity-assist-2': {
    title: 'Asysta grawitacyjna — Voyager 2 (Wielka Podróż)',
    body: 'Voyager 2 (start w sierpniu 1977) trafił na rzadkie ustawienie, które zdarza się raz na ~175 lat: połączył wszystkie cztery olbrzymy — Jowisza (1979), Saturna (1981), Urana (1986) i Neptuna (1989) — a każdy przelot wyginał jego tor i wyrzucał go dalej, podróż niemożliwa dla samych rakiet. Także tutaj daty są prawdziwe: olbrzymy ustawiają się w linię wielkiej podróży, a sonda spotyka każdego po kolei.',
  },
  'spacetime': {
    title: 'Einstein: grawitacja to zakrzywiona czasoprzestrzeń',
    body: 'Wszystko dotąd to obraz Newtona — masy przyciągające się nawzajem przez przestrzeń. Pięknie przewiduje orbity, ale ogólna teoria względności Einsteina (1915) sięga głębiej. Masa i energia zakrzywiają samą tkankę przestrzeni i czasu wokół siebie, tak jak ciężka kula wgniata napiętą tkaninę. Pobliski obiekt nie jest „przyciągany” siłą — po prostu podąża najprostszą możliwą drogą w tej zakrzywionej przestrzeni, wtaczając się w studnię. Newton nie jest jednak w błędzie: jego prawo to dokładnie to, czym staje się teoria Einsteina, gdy grawitacja jest słaba, a prędkości dużo mniejsze od prędkości światła — te same spadające orbity, które widziałeś, lecz z głębszym wyjaśnieniem.',
  },
  'mercury-precession': {
    title: 'Dowód: orbita Merkurego się obraca',
    body: 'Tu kończy się filozofia. Eliptyczna orbita Merkurego się nie domyka — jej peryhelium (punkt najbliższy Słońcu) z każdym okrążeniem nieco się przesuwa. Newton, uwzględniając przyciąganie pozostałych planet, przewiduje większość tego ruchu, ale brakuje mu 43 sekund kątowych na stulecie. Ta drobna różnica przez dziesięciolecia pozostawała niewyjaśniona — aż ogólna teoria względności przewidziała dokładnie 43″. Zakrzywiona czasoprzestrzeń Słońca obraca orbitę. Tutaj efekt jest mocno wyolbrzymiony, byś mógł zobaczyć, jak elipsa się obraca i kreśli rozetę; niebieska linia wskazuje przesuwające się peryhelium.',
  },
  'tides': {
    title: 'Pływy: dlaczego morze oddycha dwa razy na dobę',
    body: 'Grawitacja słabnie z odległością, więc Księżyc przyciąga ocean po bliższej stronie Ziemi silniej niż jej środek, a środek silniej niż stronę daleką. Ta różnica — siła pływowa — rozciąga oceany w dwa wybrzuszenia: jedno zwrócone ku Księżycowi, drugie dokładnie przeciwnie. Ziemia obraca się przez oba w ciągu doby, więc większość wybrzeży ma dwa przypływy i dwa odpływy. To samo rozciąganie przez eony zsynchronizowało obrót Księżyca z jego orbitą.',
  },
  'lagrange': {
    title: 'Punkty Lagrange’a: parkingi w przestrzeni',
    body: 'Zwykle im bliżej Słońca krążysz, tym szybciej musisz lecieć — pomarańczowa kropka to ciało tuż wewnątrz orbity Ziemi, które robi właśnie to samo z siebie i stale nam ucieka do przodu. Ale w pięciu szczególnych miejscach przyciąganie Ziemi (niebieskie strzałki) odejmuje od przyciągania Słońca (pomarańczowe) dokładnie tyle, by rok znów wydłużył się do 365 dni. Statek w takim punkcie utrzymuje pozycję względem Ziemi, więc cały ten układ obraca się jak jedna całość, raz na rok. L1 i L2 goszczą wielkie obserwatoria — SOHO obserwuje stamtąd Słońce, a teleskop Jamesa Webba siedzi w naszym cieniu w L2 — ale oba są raczej siodłami niż misami: sonda z nich zsuwa się i musi wciąż zawracać silnikami, tak jak te dwie. L4 i L5, sześćdziesiąt stopni przed planetą i za nią, to prawdziwe misy: skała z nich zepchnięta wraca długimi pętlami, więc asteroidy się gromadzą. Te u Jowisza mieszczą trojańczyki w tysiącach.',
  },
  'resonance': {
    title: 'Rezonans orbitalny: grawitacja wybija rytm',
    body: 'Gdy okresy obiegu układają się w proste stosunki liczb całkowitych, powtarzające się delikatne szarpnięcia sumują się, zamiast znosić. Trzy wewnętrzne księżyce galileuszowe Jowisza tkwią w rezonansie Laplace’a 1:2:4 — Io okrąża planetę dokładnie dwa razy na każde okrążenie Europy i cztery na każde Ganimedesa. Ten sam rytm żłobi przerwy Kirkwooda w pasie planetoid i porządkuje pierścienie Saturna. Patrz, jak księżyce wracają do tej samej konfiguracji raz po raz.',
  },
  'exoplanet': {
    title: 'Jak znajdujemy inne światy',
    body: 'Planeta nie krąży po prostu wokół gwiazdy — oba ciała obiegają wspólny środek masy, barycentrum. Gwiazda kreśli maleńkie kółko w odpowiedzi na przyciąganie planety. Większości egzoplanet nie widzimy wprost, ale potrafimy wykryć to drżenie: światło gwiazdy przesuwa się ku błękitowi, gdy się zbliża, i ku czerwieni, gdy oddala. Jowisz sprawia, że nasze Słońce zatacza pętlę wielkości jego własnego promienia; właśnie ten taniec pozwolił odkryć tysiące odległych światów.',
  },
  'lensing': {
    title: 'Zaginanie światła gwiazd',
    body: 'Skoro masa zakrzywia czasoprzestrzeń, to nawet światło — które nie ma masy — musi podążać za tym zakrzywieniem. Einstein przewidział, że Słońce odchyli światło gwiazd przechodzące tuż obok jego brzegu, przesuwając ich pozorne położenia. Podczas całkowitego zaćmienia w 1919 roku Eddington zmierzył dokładnie takie ugięcie i Einstein z dnia na dzień stał się sławny na cały świat. Dziś to „soczewkowanie grawitacyjne” zamienia całe galaktyki w kosmiczne szkła powiększające. Tu gwiazda jest dokładnie za Słońcem, a jednak widzimy ją przesuniętą — jej światło zostało zagięte wokół masy.',
  },
  'black-hole': {
    title: 'Czarne dziury: studnia bez dna',
    body: 'Upakuj dość masy w dostatecznie małej przestrzeni, a studnia czasoprzestrzeni stanie się bezdenna. Wewnątrz horyzontu zdarzeń ucieczka wymagałaby prędkości większej od światła — więc nic, nawet światło, nie wydostaje się na zewnątrz. Tuż obok gaz spada po spirali i rozgrzewa się do milionów stopni, płonąc jako dysk akrecyjny, a samo światło potrafi okrążać dziurę w cienkim jak brzytwa pierścieniu fotonowym. To ten sam spadek i zakrzywienie, które oglądasz przez cały przewodnik, doprowadzone do absolutnej skrajności.',
  },
  'gravitational-waves': {
    title: 'Fale grawitacyjne: zmarszczki czasoprzestrzeni',
    body: 'Gdy dwie czarne dziury spadają ku sobie po spirali, ich gwałtowny taniec wstrząsa samą czasoprzestrzenią, wysyłając zmarszczki rozchodzące się z prędkością światła. W miarę zbliżania orbita zacieśnia się i przyspiesza, aż do końcowego „ćwierknięcia” przy zlaniu. W 2015 roku detektory LIGO złapały taką falę z dwóch czarnych dziur, które zderzyły się 1,3 miliarda lat temu — rozciągając swoje 4-kilometrowe ramiona o mniej niż tysięczną część szerokości protonu. Sto lat po przewidywaniu Einsteina wreszcie usłyszeliśmy, jak wszechświat dzwoni.',
  },
  'time-dilation': {
    title: 'W grawitacji czas płynie wolniej',
    body: 'Masa nie tylko zakrzywia przestrzeń — spowalnia czas. Zegar głęboko w studni grawitacyjnej tyka wolniej niż ten daleko od niej. Na Ziemi efekt jest maleńki, ale realny: dlatego zegary satelitów GPS, wyżej i w słabszym polu, muszą być korygowane o około 38 mikrosekund na dobę — inaczej nawigacja w kilka godzin pomyliłaby się o kilometry. Tutaj zegar przy masie systematycznie zostaje w tyle za odległym. Grawitacja i czas to ta sama opowieść.',
  },
  'milky-way': {
    title: 'Droga Mleczna i rok galaktyczny',
    body: 'Cofnij się dalej niż w jakiejkolwiek dotychczasowej orbicie. Nasze Słońce to jedna z kilkuset miliardów gwiazd Drogi Mlecznej, sunąca po ramieniu spiralnym mniej więcej w dwóch trzecich drogi od środka. Okrąża galaktykę z prędkością około 230 kilometrów na sekundę — a jednak galaktyka jest tak ogromna, że jedno okrążenie, „rok galaktyczny”, trwa około 230 milionów lat. Gdy Słońce było tu ostatnio, dinozaury dopiero się zaczynały. Ta sama grawitacja, która trzyma księżyc, spaja całą galaktykę.',
  },
  'sagittarius-a': {
    title: 'Sagittarius A*: potwór w centrum',
    body: 'W sercu Drogi Mlecznej czai się supermasywna czarna dziura, Sagittarius A*, o masie około czterech milionów Słońc. Wiemy, że tam jest, bo od dziesięcioleci obserwujemy gwiazdy okrążające ją z zawrotną prędkością. Gwiazda S2 przemyka po dzikiej elipsie co szesnaście lat, osiągając w peryhelium 3% prędkości światła — czysty ruch Keplera i Einsteina wokół niewidzialnego punktu. Te orbity przyniosły Nagrodę Nobla i pozwoliły zważyć niewidzialnego olbrzyma.',
  },
  'dark-matter': {
    title: 'Brakująca masa',
    body: 'Tu grawitacja stawia nas wobec zagadki. Według tego samego prawa z pierwszego slajdu gwiazdy daleko od środka galaktyki powinny krążyć wolniej niż te bliżej — tak jak Neptun się wlecze, a Merkury pędzi. A jednak tak nie jest: zewnętrzne gwiazdy poruszają się równie szybko jak wewnętrzne, a ich krzywa prędkości pozostaje uparcie płaska. Jedyne wyjaśnienie to ogromne ilości niewidzialnej masy — „ciemnej materii” — przeważającej nad wszystkimi gwiazdami pięć do jednego. Zmapowaliśmy cały Układ Słoneczny, a większość wszechświata wciąż jest czymś, czego nie potrafimy zobaczyć.',
  },
  'geoid': {
    title: 'Grawitacja Ziemi jest nierówna',
    body: 'Dotąd traktowaliśmy Ziemię jak gładką kulę masy, ale tak nie jest. Góry, rowy oceaniczne, grube korzenie kontynentów i gęstsze bryły w płaszczu przyciągają odrobinę mocniej albo słabiej, więc siła grawitacji zmienia się z miejsca na miejsce. Geodeci opisują to geoidą — kształtem, jaki przybrałyby oceany, gdyby o poziomie morza decydowała sama grawitacja. Jej wzgórza i zagłębienia obejmują około 200 metrów: wielkie minimum na południe od Indii, gdzie grawitacja jest najsłabsza, i maksima nad zachodnim Pacyfikiem oraz północnym Atlantykiem. Tutaj ta rzeźba jest wyolbrzymiona dziesiątki tysięcy razy, byś mógł ją zobaczyć; satelity NASA GRACE mierzą ją, śledząc, jak dwa statki przyspieszają i zwalniają, przelatując nad każdą anomalią.',
  },
  'polaris': {
    title: 'Dlaczego Gwiazda Polarna stoi w miejscu',
    body: 'Ziemia pędzi wokół Słońca z prędkością 30 km/s i pokonuje 300 milionów kilometrów z jednej strony orbity na drugą — a mimo to Polaris przez cały rok tkwi w tym samym punkcie nad północnym horyzontem. Z dwóch powodów. Po pierwsze, oś obrotu jest wciąż skierowana tak samo w przestrzeni, niezależnie od miejsca na orbicie; wirujące ciało utrzymuje swój kierunek. Po drugie, Polaris jest oddalona o 433 lata świetlne, więc cała szerokość naszej orbity przesuwa jej pozorne położenie o dużo mniej, niż zdoła wychwycić oko. Ten kierunek nie jest jednak zupełnie zamrożony: grawitacja Słońca i Księżyca szarpie wybrzuszony równik Ziemi i sprawia, że oś chwieje się jak powolny bąk, zataczając na niebie koło raz na 26 000 lat. Za 12 000 lat gwiazdą polarną będzie Wega.',
  },
  'light-lag': {
    title: 'Osiem minut i dziewiętnaście sekund',
    body: 'Układ Słoneczny nie jest po prostu wielki — jest wielki w porównaniu z najszybszą rzeczą, jaka istnieje. Światło pokonuje 300 000 kilometrów na sekundę, a i tak potrzebuje 8 minut i 19 sekund, by dotrzeć do nas ze Słońca. Nigdy nie widzisz Słońca takim, jakie jest; widzisz je takim, jakie było. Patrz, jak czoło fali mknie na zewnątrz: Mars po 12 minutach, Jowisz po trzech kwadransach, Neptun ponad cztery godziny dalej. I nie chodzi tylko o światło. Grawitacja biegnie dokładnie z tą samą prędkością. Gdyby Słońce znikło w tej chwili, Ziemia jeszcze przez 8 minut i 19 sekund zakrzywiałaby tor po swojej orbicie — wieść o jego zniknięciu dotarłaby wraz z ostatnim promieniem światła.',
  },
  'magnetosphere': {
    title: 'Tarcza wokół Ziemi',
    body: 'Słońce nie tylko świeci — ono wieje. Milion ton naładowanych cząstek na sekundę mknie na zewnątrz z prędkością 400 km/s, a podczas burzy słonecznej znacznie więcej. Ziemia je odchyla. Płynne żelazo wirujące w jądrze napędza dynamo, a wytworzone pole magnetyczne wykuwa w tym wietrze jamę: ściśniętą do dziesięciu promieni Ziemi od strony Słońca i rozciągniętą w ogon daleko poza orbitę Księżyca po stronie nocnej. Cząstki, którym uda się wślizgnąć, spływają wzdłuż linii pola ku biegunom i rozświetlają powietrze zorzami. Mars kiedyś miał pole, stracił je, i wiatr słoneczny od tamtej pory zdziera jego atmosferę. Grawitacja utrzymuje powietrze przy gruncie; magnetyzm nie pozwala go zdmuchnąć.',
  },
  'venus-rose': {
    title: 'Róża, którą kreśli Wenus',
    body: 'Rezonanse zostawiają ślady, które da się narysować. Wenus okrąża Słońce w 224,7 dnia, Ziemia w 365,3 — na tyle blisko stosunku 13 do 8 okrążeń, że po ośmiu latach oba ciała niemal dokładnie powtarzają swoje ustawienie. Poprowadź linię między planetami co kilka dni, a te powtórzenia utkają pięciopłatkową różę. Niemal doskonałą, lecz nie doskonałą: wzór przesuwa się o około dwa dni na cykl, więc kwiat powoli się obraca. To ten sam bliski rezonans sprawia, że Wenus co osiem lat wraca na to samo miejsce jako gwiazda wieczorna — i właśnie takie wzory przekonywały dawnych astronomów, że niebo chodzi jak zegar.',
  },
  'heliosphere': {
    title: 'Bańka wokół Układu Słonecznego',
    body: 'Wiatr słoneczny wieje na zewnątrz, dopóki potrafi odpychać rzadki gaz między gwiazdami. Tam, gdzie wreszcie zwalnia poniżej prędkości dźwięku — jakieś 94 razy dalej niż Ziemia od Słońca — przekracza szok końcowy. Dalej rozciąga się burzliwa helioosłona, a przy mniej więcej 120 jednostkach astronomicznych heliopauza: prawdziwa granica wpływu Słońca, gdzie jego wiatr ustępuje wiatrowi galaktyki. Tępa od strony, w którą wgryzamy się w przestrzeń, i wyciągnięta w długi ogon z tyłu. Voyager 1 przekroczył ją w 2012, Voyager 2 w 2018 — to jedyne ludzkie przedmioty, które opuściły tę bańkę. Grawitacja sięga jednak znacznie dalej: Słońce wciąż trzyma komety tysiąc razy poza tą granicą.',
  },
  'cosmic-motion': {
    title: 'Nigdy nie stoisz w miejscu',
    body: 'Siedząc zupełnie nieruchomo, jesteś niesiony przez cztery ruchy naraz, z których każdy jedzie na poprzednim. Obrót Ziemi unosi cię na wschód z prędkością 0,46 km/s na równiku. Ziemia niesie cię wokół Słońca z prędkością 29,8 km/s. Słońce niesie cały układ wokół galaktyki z prędkością 230 km/s. A sama galaktyka spada ku Wielkiemu Atraktorowi, więc względem najstarszego światła we wszechświecie — mikrofalowego promieniowania tła — poruszasz się z prędkością około 370 km/s. Każdy z tych ruchów jest spadaniem: ciałem lecącym tak prosto, jak tylko potrafi, przez zakrzywioną przestrzeń. Licznik u góry pokazuje, ile już przebyłeś od otwarcia tego slajdu.',
  },
  'early-universe': {
    title: 'Zanim powstały gwiazdy',
    body: 'Cofnij wszystko o 13,8 miliarda lat. Żadnych planet, gwiazd ani galaktyk — tylko wodór i hel rozłożone niemal idealnie równo, gładko z dokładnością do jednej stutysięcznej. Niemal. Te ledwie widoczne zmarszczki wystarczyły. Tam, gdzie gaz był odrobinę gęstszy, przyciągał nieco mocniej, więc zgarniał więcej gazu, więc przyciągał jeszcze mocniej. Przez setki milionów lat ta lawina opróżniła pustki i ściągnęła wszystko w sieć włókien i węzłów — a tam, gdzie węzły zgęstniały dostatecznie, zapłonęły pierwsze gwiazdy. Każda galaktyka, każda gwiazda, każda planeta i każdy z nas siedzi na nitce tej sieci. Grawitacja, cierpliwie wzmacniając prawie nic, zbudowała to wszystko — a w jednym z węzłów jednej z tych nitek zaraz uformuje się nasze Słońce.',
  },
};

const UI = {
  en: { tour: 'Guided Tour', explore: 'Explore ✕', back: '‹ Back', next: 'Next ›', finish: 'Finish ✓', speed: 'Time speed', step: 'Step', playCta: 'Play with music', issue: 'Something not right?' },
  pl: { tour: 'Przewodnik', explore: 'Eksploruj ✕', back: '‹ Wstecz', next: 'Dalej ›', finish: 'Zakończ ✓', speed: 'Prędkość czasu', step: 'Krok', playCta: 'Odtwórz z muzyką', issue: 'Coś nie tak?' },
};

export function stepIndexFromHash(): number {
  const id = location.hash.replace(/^#/, '');
  const i = STEPS.findIndex((s) => s.id === id);
  return i;
}

export class Tour {
  private index = 0;
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private linkEl: HTMLAnchorElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private dd: HTMLElement;            // step dropdown container
  private ddCurrent: HTMLElement;     // closed-state label
  private speedWrap: HTMLElement;     // time-speed control (step-gated)
  private speedRange: HTMLInputElement;
  private speedVal: HTMLElement;
  private active = false;
  private lang: Lang = (localStorage.getItem('gravity-lang') as Lang) === 'pl' ? 'pl' : 'en';
  // Auto-play: shows each slide for its estimated read time, then advances.
  private autoPlay = false;
  private autoTimer: number | undefined;
  private progressTrack!: HTMLElement;
  private progressFill!: HTMLElement;
  private autoSlideStart = 0;       // when the current slide came up (ms)
  private autoEnd = 0;              // estimated time it will advance (ms)
  private autoRaf = 0;
  private cta!: HTMLButtonElement;  // first-slide "play everything" call-to-action

  constructor(private world: World, private onExit: () => void) {
    // Single right-side tour panel: header, step dropdown, text, speed, nav.
    this.root = document.createElement('div');
    this.root.className = 'panel tour-panel';
    this.root.innerHTML = `
      <div class="tour-progress"><span class="tour-progress-fill"></span></div>
      <div class="tour-head">
        <span class="tour-eyebrow">${UI[this.lang].tour}</span>
        <div class="lang-switch">
          <button class="lang-btn" data-lang="en">EN</button>
          <button class="lang-btn" data-lang="pl">PL</button>
        </div>
        <button class="tour-skip">${UI[this.lang].explore}</button>
        <button class="tour-collapse" aria-label="Hide description">▾</button>
      </div>
      <div class="tour-dd">
        <button class="tour-dd-toggle"><span class="dd-current"></span><span class="dd-chev">▾</span></button>
        <ol class="steps-list"></ol>
      </div>
      <div class="tour-title"></div>
      <div class="tour-body"></div>
      <a class="tour-link" target="_blank" rel="noopener noreferrer"></a>
      <div class="tour-speed">
        <div class="glabel">Time speed · <span class="speed-val"></span></div>
        <input type="range" class="speed-range" min="0" max="100" />
      </div>
      <div class="tour-foot">
        <button class="tour-prev">‹ Back</button>
        <button class="tour-next">Next ›</button>
      </div>`;
    document.getElementById('app')!.appendChild(this.root);

    // First-slide call-to-action: one tap starts the music + auto-play.
    this.cta = document.createElement('button');
    this.cta.type = 'button';
    this.cta.className = 'tour-cta';
    this.cta.style.display = 'none';
    this.cta.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
      <span class="tour-cta-label">${UI[this.lang].playCta}</span>`;
    this.cta.addEventListener('click', () => this.startPlayback());
    document.getElementById('app')!.appendChild(this.cta);

    this.titleEl = this.root.querySelector('.tour-title')!;
    this.bodyEl = this.root.querySelector('.tour-body')!;
    this.linkEl = this.root.querySelector('.tour-link')!;
    this.prevBtn = this.root.querySelector('.tour-prev')!;
    this.nextBtn = this.root.querySelector('.tour-next')!;
    this.dd = this.root.querySelector('.tour-dd')!;
    this.ddCurrent = this.root.querySelector('.dd-current')!;
    this.speedWrap = this.root.querySelector('.tour-speed')!;
    this.speedRange = this.root.querySelector('.speed-range')!;
    this.speedVal = this.root.querySelector('.speed-val')!;
    this.progressTrack = this.root.querySelector('.tour-progress')!;
    this.progressFill = this.root.querySelector('.tour-progress-fill')!;

    const list = this.root.querySelector('.steps-list')!;
    STEPS.forEach((step, i) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.innerHTML = `<span class="step-num">${i + 1}</span><span class="step-title">${step.title}</span>`;
      li.addEventListener('click', () => { this.setAutoPlay(false); this.go(i); });
      list.appendChild(li);
    });

    // Dropdown open/close.
    this.root.querySelector('.tour-dd-toggle')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dd.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!this.dd.contains(e.target as Node)) this.dd.classList.remove('open');
    });

    // Time-speed slider (shown only on steps that allow it). Log mapping.
    this.speedRange.addEventListener('input', () => {
      const t = +this.speedRange.value / 100;
      const dps = 0.2 * Math.pow(2000, t);
      this.world.state.daysPerSecond = dps;
      this.speedVal.textContent = fmtSpeed(dps);
    });

    // Driving the tour by hand takes it off auto-play (which, with no toggle
    // in the header, is otherwise only started from the first-slide CTA).
    this.prevBtn.addEventListener('click', () => { this.setAutoPlay(false); this.go(this.index - 1); });
    this.nextBtn.addEventListener('click', () => {
      this.setAutoPlay(false);
      if (this.index >= STEPS.length - 1) this.exit();
      else this.go(this.index + 1);
    });
    this.root.querySelector('.tour-skip')!.addEventListener('click', () => this.exit());

    // "Something not right?" lives in the page footer, beside the credit, but
    // it is the tour that knows which slide the report is about.
    document.getElementById('issue-link')?.addEventListener('click', () => {
      const step = STEPS[this.index];
      openIssue(this.active ? `step ${this.index + 1} · ${step.title} (#${step.id})` : 'free explore');
    });


    // Mobile: collapse the description to a slim nav-only bar (and back).
    this.root.querySelector('.tour-collapse')!.addEventListener('click', () => {
      this.setCollapsed(!this.root.classList.contains('collapsed'));
    });

    // Language switch (EN / PL), persisted to localStorage.
    this.root.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const l = (btn as HTMLElement).dataset.lang as Lang;
        if (l && l !== this.lang) this.setLang(l);
      });
    });
    this.applyLang();

    // Browser back/forward and pasted #links navigate the tour.
    window.addEventListener('hashchange', () => this.onHashChange());
  }

  /** Start the tour, honoring a #step-id deep link if present. */
  start(): void {
    if (location.hash.replace(/^#/, '') === 'explore') { this.showExplore(); return; }
    const fromHash = stepIndexFromHash();
    this.active = true;
    document.body.classList.add('tour-active');
    this.go(fromHash >= 0 ? fromHash : 0);
  }

  /** Force the tour open from step 1 (the panel's "replay" button). */
  restart(): void {
    this.active = true;
    document.body.classList.add('tour-active');
    this.go(0);
  }

  private onHashChange(): void {
    const id = location.hash.replace(/^#/, '');
    if (id === 'explore') { if (this.active) this.exit(); return; }
    const i = STEPS.findIndex((s) => s.id === id);
    if (i >= 0 && (!this.active || i !== this.index)) {
      if (!this.active) { this.active = true; document.body.classList.add('tour-active'); }
      this.go(i, false);
    }
  }

  private clearTeaching(): void {
    const st = this.world.state;
    this.world.setDemo('normal');
    this.world.stopFollow();
    this.world.setCameraReturn(false); // free explore: camera stays where dragged
    this.world.setZoomEnabled(true);   // free explore: wheel-zoom on
    this.world.setHoverLabels(true);   // free explore: hover reveals label + orbit
    st.vecVelocity = st.vecGravity = st.vecMutual = st.vecTangent = false;
    st.vecTarget = 'earth';
    st.vecAll = false;
    st.vecSun = false;
    this.world.setAutoRotate(false);
    st.showSpin = true;   // free-explore: bodies rotate
    st.showAxes = false;
    st.showMoonLabels = true;
  }

  private exit(): void {
    this.active = false;
    if (this.autoPlay) this.setAutoPlay(false);
    this.updateCta();
    document.body.classList.remove('tour-active');
    this.world.setVisibleBodies(null);
    this.clearTeaching();
    location.hash = 'explore';
    this.onExit();
  }

  private showExplore(): void {
    this.active = false;
    if (this.autoPlay) this.setAutoPlay(false);
    this.updateCta();
    document.body.classList.remove('tour-active');
    this.world.setVisibleBodies(null);
    this.clearTeaching();
    this.onExit();
  }

  private go(i: number, updateHash = true): void {
    this.index = Math.max(0, Math.min(STEPS.length - 1, i));
    const step = STEPS[this.index];
    this.apply(step);

    const loc = this.localized(step);
    const ui = UI[this.lang];
    this.titleEl.textContent = `${ui.step} ${this.index + 1} · ${loc.title}`;
    this.renderBody(loc.body);
    if (step.link) {
      this.linkEl.href = step.link.href;
      this.linkEl.textContent = step.link[this.lang];
      this.linkEl.style.display = 'block';
    } else {
      this.linkEl.style.display = 'none';
    }
    this.prevBtn.disabled = this.index === 0;
    this.prevBtn.textContent = ui.back;
    this.nextBtn.textContent = this.index === STEPS.length - 1 ? ui.finish : ui.next;
    this.ddCurrent.textContent = `${this.index + 1} · ${loc.title}`;
    this.dd.classList.remove('open');
    this.root.querySelectorAll('.step-item').forEach((el, k) => {
      const on = k === this.index;
      el.classList.toggle('on', on);
      el.classList.toggle('done', k < this.index);
      if (on) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
    // Time-speed control: shown only where the step opts in.
    if (step.speedControl) {
      this.speedWrap.style.display = 'block';
      const t = Math.log(step.daysPerSecond / 0.2) / Math.log(2000);
      this.speedRange.value = String(Math.round(Math.max(0, Math.min(1, t)) * 100));
      this.speedVal.textContent = fmtSpeed(step.daysPerSecond);
    } else {
      this.speedWrap.style.display = 'none';
    }
    if (updateHash) location.hash = step.id;
    if (this.autoPlay) this.playCurrent(); // time this slide, then auto-advance
    this.updateCta();
  }

  // ---- auto-play ----------------------------------------------------------

  /** Collapse/expand the description (mobile shows a slim nav-only bar). */
  private setCollapsed(on: boolean): void {
    this.root.classList.toggle('collapsed', on);
    const btn = this.root.querySelector('.tour-collapse') as HTMLButtonElement;
    btn.textContent = on ? '▴' : '▾';
    btn.setAttribute('aria-label', on ? 'Show description' : 'Hide description');
  }

  /** First-slide CTA: turn the music on and start the auto-play. */
  private startPlayback(): void {
    // Music lives in its own controller (music.ts) behind the corner toggle —
    // flip it on by clicking that button, but only if it isn't already on.
    const music = document.getElementById('music-toggle');
    if (music && music.getAttribute('aria-pressed') !== 'true') music.click();
    if (!this.autoPlay) this.setAutoPlay(true);
    // On mobile, hide the description so the scene isn't covered while it plays.
    if (window.matchMedia('(max-width: 760px)').matches) this.setCollapsed(true);
  }

  /** The CTA shows only on the first slide before auto-play has started. */
  private updateCta(): void {
    this.cta.style.display = this.active && this.index === 0 && !this.autoPlay ? 'inline-flex' : 'none';
  }

  private setAutoPlay(on: boolean): void {
    this.autoPlay = on;
    this.progressTrack.classList.toggle('on', on);
    if (on) { this.playCurrent(); this.autoRaf = requestAnimationFrame(this.autoTick); }
    else { this.stopAuto(); cancelAnimationFrame(this.autoRaf); this.progressFill.style.width = '0%'; }
    this.updateCta();
  }

  private stopAuto(): void {
    window.clearTimeout(this.autoTimer);
  }

  /** Hold the current slide for its estimated read time, then advance. */
  private playCurrent(): void {
    window.clearTimeout(this.autoTimer);
    this.autoSlideStart = performance.now();
    const ms = this.readMs();
    this.autoEnd = this.autoSlideStart + ms;
    this.progressFill.style.width = '0%';
    this.scheduleAdvance(ms);
  }

  /** Animate the thin progress line toward the next slide's advance time. */
  private autoTick = (): void => {
    if (!this.autoPlay) return;
    const span = Math.max(1, this.autoEnd - this.autoSlideStart);
    const frac = Math.max(0, Math.min(1, (performance.now() - this.autoSlideStart) / span));
    this.progressFill.style.width = (frac * 100).toFixed(2) + '%';
    this.autoRaf = requestAnimationFrame(this.autoTick);
  };

  /** After the slide's read time has elapsed, go to the next slide. */
  private scheduleAdvance(afterMs: number): void {
    if (!this.autoPlay) return;
    window.clearTimeout(this.autoTimer);
    this.autoTimer = window.setTimeout(() => {
      if (!this.autoPlay) return;
      if (this.index >= STEPS.length - 1) this.setAutoPlay(false); // stop at the end
      else this.go(this.index + 1);
    }, afterMs);
  }

  /** How long to hold a slide: reading time (~160 wpm) plus a 5s beat. */
  private readMs(): number {
    const words = this.localized(STEPS[this.index]).body.split(/\s+/).length;
    return Math.min(32000, Math.max(9000, words * 380)) + 5000;
  }

  private apply(step: TourStep): void {
    const w = this.world;
    w.setScaleMode(step.scale);
    w.setVisibleBodies(step.visible);
    w.setShowMoons(step.showMoons);
    w.setPhysics(step.physics);
    w.setTwoD(step.twoD);
    w.state.showOrbits = step.showOrbits;
    w.state.showProjection = step.showProjection;
    w.state.showSpin = step.spin;
    w.state.showAxes = !!step.axes;
    w.state.showMoonLabels = step.moonLabels !== false;
    w.state.daysPerSecond = step.daysPerSecond;
    w.state.paused = false;
    w.state.vecVelocity = !!step.vectors?.velocity;
    w.state.vecGravity = !!step.vectors?.gravity;
    w.state.vecMutual = !!step.vectors?.mutual;
    w.state.vecTangent = !!step.vectors?.tangent;
    w.state.vecTarget = step.vecTarget ?? 'earth';
    w.state.vecAll = !!step.vecAll;
    w.state.vecSun = !!step.vecSun;
    w.setAutoRotate(!!step.autoRotate);
    w.setCameraReturn(true); // on every tour slide, releasing the mouse eases back to the framing
    w.setZoomEnabled(false);  // no wheel-zoom during the guided tour
    w.setHoverLabels(false);
    if (step.demo === 'accretion' && step.accreteBody) {
      w.startAccretion(step.accreteBody); // sets demo mode + camera + dust cloud
    } else if (step.demo === 'helix') {
      // If a helix is already running, continue it seamlessly (just toggle the
      // arrows / flags) instead of restarting — no position or camera jump.
      if (w.state.demoMode !== 'helix') w.startHelix();
    } else if (step.demo === 'inertia') {
      w.startInertia(); // drift + parallax + follow camera
    } else if (step.demo === 'orbit-intro') {
      w.startOrbitIntro(step.orbitSpeed ?? 1); // bend into an orbit (or fall in / escape)
    } else if (step.demo === 'rocket' && step.rocket) {
      const r = step.rocket;
      w.startRocket(r.attractor, r.R, r.vBase, r.speed, r.label, r.lob ?? 0, !!r.satellite);
    } else if (step.demo === 'soi') {
      w.startSOI();
    } else if (step.demo === 'flyby') {
      w.startFlyby(step.mission ?? 'voyager-2');
    } else if (step.demo === 'spacetime') {
      w.startSpacetime();
    } else if (step.demo === 'precession') {
      w.startPrecession();
    } else if (step.demo === 'blackhole') {
      w.startBlackHole();
    } else if (step.demo === 'gwaves') {
      w.startGravWaves();
    } else if (step.demo === 'lensing') {
      w.startLensing();
    } else if (step.demo === 'timedilation') {
      w.startTimeDilation();
    } else if (step.demo === 'milkyway') {
      w.startMilkyWay();
    } else if (step.demo === 'sgra') {
      w.startSgrA();
    } else if (step.demo === 'darkmatter') {
      w.startDarkMatter();
    } else if (step.demo === 'lagrange') {
      w.startLagrange();
    } else if (step.demo === 'tides') {
      w.startTides();
    } else if (step.demo === 'exoplanet') {
      w.startExoplanet();
    } else if (step.demo === 'resonance') {
      w.startResonance();
    } else if (step.demo === 'lightlag') {
      w.startLightLag();
    } else if (step.demo === 'geoid') {
      w.startGeoid();
    } else if (step.demo === 'magnetosphere') {
      w.startMagnetosphere();
    } else if (step.demo === 'heliosphere') {
      w.startHeliosphere();
    } else if (step.demo === 'venusrose') {
      w.startVenusRose();
    } else if (step.demo === 'polaris') {
      w.startPolaris();
    } else if (step.demo === 'cosmicmotion') {
      w.startCosmicMotion();
    } else if (step.demo === 'earlyuniverse') {
      w.startEarlyUniverse();
    } else {
      w.setDemo(step.demo);
      if (step.frameAU != null) w.frameRadius(step.frameAU);
      else if (step.focus && step.follow) w.followBody(step.focus, step.focusMul ?? 10, step.followRaise, step.sideFollow);
      else if (step.focus) w.focusOn(step.focus, step.focusMul ?? 8);
    }
  }

  /** Write the narration, turning the first mention of any glossary term into
   *  a link. Text is inserted as nodes (never as HTML), so it stays inert. */
  private renderBody(text: string): void {
    this.bodyEl.textContent = '';
    let rest = text;
    for (const { term, href } of GLOSSARY[this.lang]) {
      const at = new RegExp(`\\b${term}\\b`, 'i').exec(rest);
      if (!at) continue;
      this.bodyEl.appendChild(document.createTextNode(rest.slice(0, at.index)));
      const a = document.createElement('a');
      a.className = 'body-link';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = at[0];
      this.bodyEl.appendChild(a);
      rest = rest.slice(at.index + at[0].length);
    }
    this.bodyEl.appendChild(document.createTextNode(rest));
  }

  /** Title + body for a step in the current language (falls back to English). */
  private localized(step: TourStep): { title: string; body: string } {
    if (this.lang === 'pl' && PL[step.id]) return PL[step.id];
    return { title: step.title, body: step.body };
  }

  private setLang(l: Lang): void {
    this.lang = l;
    localStorage.setItem('gravity-lang', l);
    this.applyLang();
    if (this.active) this.go(this.index, false); // re-render title/body/nav without touching hash
  }

  /** Re-render all language-dependent chrome (eyebrow, buttons, step list). */
  private applyLang(): void {
    const ui = UI[this.lang];
    (this.root.querySelector('.tour-eyebrow') as HTMLElement).textContent = ui.tour;
    (this.root.querySelector('.tour-skip') as HTMLElement).textContent = ui.explore;
    const issueLabel = document.querySelector('#issue-link .issue-label');
    if (issueLabel) issueLabel.textContent = ui.issue;
    (this.root.querySelector('.glabel') as HTMLElement).childNodes[0].textContent = `${ui.speed} · `;
    this.root.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('on', (btn as HTMLElement).dataset.lang === this.lang);
    });
    this.root.querySelectorAll('.step-item .step-title').forEach((el, k) => {
      el.textContent = this.localized(STEPS[k]).title;
    });
    const ctaLabel = this.cta?.querySelector('.tour-cta-label');
    if (ctaLabel) ctaLabel.textContent = ui.playCta;
  }

  get isActive(): boolean { return this.active; }
}
