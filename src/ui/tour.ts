import { World } from '../scene/world';
import type { ScaleMode } from '../scene/scale';
import type { PhysicsMode, DemoMode } from '../scene/world';

// A narrated walkthrough that builds up *why* orbits exist, one idea at a time:
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
}

function fmtSpeed(dps: number): string {
  if (dps < 1) return `${(dps * 24).toFixed(1)} h/s`;
  if (dps < 400) return `${dps.toFixed(1)} days/s`;
  return `${(dps / 365.25).toFixed(2)} yr/s`;
}

const V = (o: TourStep['vectors']) => o;

export const STEPS: TourStep[] = [
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
      'Switch Physics to “N-body” in the panel later to watch the Moon tug back and both bodies swing around their shared barycenter.',
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'normal',
    showMoons: true, showOrbits: true, showProjection: false, spin: false, daysPerSecond: 4,
    visible: ['sun', 'earth', 'moon'], focus: 'earth', focusMul: 16, follow: true, followRaise: 0,
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
    showMoons: false, showOrbits: false, showProjection: false, spin: true, axes: true, daysPerSecond: 0.5,
    visible: ['sun', 'earth'], focus: 'earth', focusMul: 6,
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
    scale: 'visual', physics: 'kepler', twoD: true, demo: 'rocket',
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
      'Everything so far is Newton’s picture — masses reaching across space to pull on one another. It predicts orbits beautifully, but Einstein’s general relativity (1915) goes deeper. Mass and energy curve the very fabric of space and time around them, the way a heavy ball dents a stretched sheet. A nearby object isn’t “pulled” by a force — it simply follows the straightest path it can through that curved space, rolling into the well. Same falling orbits you’ve watched all along — a profoundly different reason why.',
    scale: 'visual', physics: 'kepler', twoD: false, demo: 'spacetime',
    showMoons: false, showOrbits: false, showProjection: false, spin: false, daysPerSecond: 0,
    visible: [],
  },
];

export type Lang = 'en' | 'pl';

// Polish translations, keyed by step id. UI chrome strings below.
const PL: Record<string, { title: string; body: string }> = {
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
    body: 'Ta sama reguła zagnieżdża się na każdej skali. Księżyc (1,2% masy Ziemi) jest utrzymywany grawitacją Ziemi, okrążając ją co 27,3 dnia w odległości 384 400 km — orbita wewnątrz orbity. Przełącz później fizykę na „N-body” w panelu, by zobaczyć, jak Księżyc odciąga Ziemię i oba ciała krążą wokół wspólnego środka masy.',
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
    body: 'Wszystko dotąd to obraz Newtona — masy przyciągające się nawzajem przez przestrzeń. Pięknie przewiduje orbity, ale ogólna teoria względności Einsteina (1915) sięga głębiej. Masa i energia zakrzywiają samą tkankę przestrzeni i czasu wokół siebie, tak jak ciężka kula wgniata napiętą tkaninę. Pobliski obiekt nie jest „przyciągany” siłą — po prostu podąża najprostszą możliwą drogą w tej zakrzywionej przestrzeni, wtaczając się w studnię. Te same spadające orbity, które widziałeś — lecz z całkiem innego powodu.',
  },
};

const UI = {
  en: { tour: 'Guided Tour', explore: 'Explore ✕', back: '‹ Back', next: 'Next ›', finish: 'Finish ✓', speed: 'Time speed', step: 'Step' },
  pl: { tour: 'Przewodnik', explore: 'Eksploruj ✕', back: '‹ Wstecz', next: 'Dalej ›', finish: 'Zakończ ✓', speed: 'Prędkość czasu', step: 'Krok' },
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
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private dd: HTMLElement;            // step dropdown container
  private ddCurrent: HTMLElement;     // closed-state label
  private speedWrap: HTMLElement;     // time-speed control (step-gated)
  private speedRange: HTMLInputElement;
  private speedVal: HTMLElement;
  private active = false;
  private lang: Lang = (localStorage.getItem('gravity-lang') as Lang) === 'pl' ? 'pl' : 'en';

  constructor(private world: World, private onExit: () => void) {
    // Single right-side tour panel: header, step dropdown, narration, speed, nav.
    this.root = document.createElement('div');
    this.root.className = 'panel tour-panel';
    this.root.innerHTML = `
      <div class="tour-head">
        <span class="tour-eyebrow">${UI[this.lang].tour}</span>
        <div class="lang-switch">
          <button class="lang-btn" data-lang="en">EN</button>
          <button class="lang-btn" data-lang="pl">PL</button>
        </div>
        <button class="tour-skip">${UI[this.lang].explore}</button>
      </div>
      <div class="tour-dd">
        <button class="tour-dd-toggle"><span class="dd-current"></span><span class="dd-chev">▾</span></button>
        <ol class="steps-list"></ol>
      </div>
      <div class="tour-title"></div>
      <div class="tour-body"></div>
      <div class="tour-speed">
        <div class="glabel">Time speed · <span class="speed-val"></span></div>
        <input type="range" class="speed-range" min="0" max="100" />
      </div>
      <div class="tour-foot">
        <button class="tour-prev">‹ Back</button>
        <button class="tour-next">Next ›</button>
      </div>`;
    document.getElementById('app')!.appendChild(this.root);

    this.titleEl = this.root.querySelector('.tour-title')!;
    this.bodyEl = this.root.querySelector('.tour-body')!;
    this.prevBtn = this.root.querySelector('.tour-prev')!;
    this.nextBtn = this.root.querySelector('.tour-next')!;
    this.dd = this.root.querySelector('.tour-dd')!;
    this.ddCurrent = this.root.querySelector('.dd-current')!;
    this.speedWrap = this.root.querySelector('.tour-speed')!;
    this.speedRange = this.root.querySelector('.speed-range')!;
    this.speedVal = this.root.querySelector('.speed-val')!;

    const list = this.root.querySelector('.steps-list')!;
    STEPS.forEach((step, i) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.innerHTML = `<span class="step-num">${i + 1}</span><span class="step-title">${step.title}</span>`;
      li.addEventListener('click', () => this.go(i));
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

    this.prevBtn.addEventListener('click', () => this.go(this.index - 1));
    this.nextBtn.addEventListener('click', () => {
      if (this.index >= STEPS.length - 1) this.exit();
      else this.go(this.index + 1);
    });
    this.root.querySelector('.tour-skip')!.addEventListener('click', () => this.exit());

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
    document.body.classList.remove('tour-active');
    this.world.setVisibleBodies(null);
    this.clearTeaching();
    location.hash = 'explore';
    this.onExit();
  }

  private showExplore(): void {
    this.active = false;
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
    this.bodyEl.textContent = loc.body;
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
    } else {
      w.setDemo(step.demo);
      if (step.frameAU != null) w.frameRadius(step.frameAU);
      else if (step.focus && step.follow) w.followBody(step.focus, step.focusMul ?? 10, step.followRaise);
      else if (step.focus) w.focusOn(step.focus, step.focusMul ?? 8);
    }
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
    (this.root.querySelector('.glabel') as HTMLElement).childNodes[0].textContent = `${ui.speed} · `;
    this.root.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('on', (btn as HTMLElement).dataset.lang === this.lang);
    });
    this.root.querySelectorAll('.step-item .step-title').forEach((el, k) => {
      el.textContent = this.localized(STEPS[k]).title;
    });
  }

  get isActive(): boolean { return this.active; }
}
