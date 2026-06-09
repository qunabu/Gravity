// Real solar-system data. Orbital elements are J2000.0 heliocentric mean
// elements (epoch 2000-01-01 12:00 TT). Sources: NASA JPL planetary fact
// sheets and the IAU/JPL keplerian element tables (Standish 1992 / E.M.
// Standish "Keplerian Elements for Approximate Positions of the Major
// Planets"). Values are intentionally kept in their natural physical units;
// the renderer converts to scene units, never the data.

export interface OrbitalElements {
  /** Semi-major axis (AU). */
  a: number;
  /** Eccentricity (dimensionless). */
  e: number;
  /** Inclination to the ecliptic (degrees). */
  i: number;
  /** Longitude of the ascending node Ω (degrees). */
  node: number;
  /** Longitude of perihelion ϖ = Ω + ω (degrees). */
  peri: number;
  /** Mean longitude L at J2000 (degrees). */
  meanLongitude: number;
}

export interface Moon {
  id: string;
  name: string;
  /** Mass, kg. */
  mass: number;
  /** Mean radius, km. */
  radius: number;
  /** Semi-major axis of the orbit around the planet, km. */
  aKm: number;
  /** Eccentricity. */
  e: number;
  /** Inclination to the ecliptic (degrees). >90° = retrograde. */
  i: number;
  /** Starting phase / mean longitude (degrees) — only sets where it begins. */
  phase: number;
  /** Sidereal rotation period (days); most large moons are tidally locked. */
  rotationPeriod: number;
  color: number;
  /**
   * Whether this moon is fed into the N-body integrator. Only set for moons
   * massive enough to visibly perturb their planet (e.g. the Moon, Charon);
   * negligible moons (Phobos ~10⁻⁸ of Mars) are render-only to save compute.
   */
  simulateGravity: boolean;
  note?: string;
}

export interface Body {
  id: string;
  name: string;
  /** Mass, kg. */
  mass: number;
  /** Mean (volumetric) radius, km. */
  radius: number;
  /** Axial tilt / obliquity to its orbit (degrees). */
  axialTilt: number;
  /** Sidereal rotation period (days). Negative = retrograde. */
  rotationPeriod: number;
  /** sRGB display color. */
  color: number;
  /** Heliocentric J2000 orbital elements. The Sun has none. */
  orbit?: OrbitalElements;
  /** Natural satellites. */
  moons?: Moon[];
  /** Optional descriptive note shown in the info panel. */
  note?: string;
}

// The Sun sits at the origin / barycenter for the Keplerian model.
export const SUN: Body = {
  id: 'sun',
  name: 'Sun',
  mass: 1.98892e30,
  radius: 696340,
  axialTilt: 7.25,
  rotationPeriod: 25.38, // sidereal, at the equator
  color: 0xffd24a,
  note: 'G-type main-sequence star (G2V). Contains 99.86% of the system mass.',
};

export const PLANETS: Body[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    mass: 3.3011e23,
    radius: 2439.7,
    axialTilt: 0.034,
    rotationPeriod: 58.646,
    color: 0x9c8b7d,
    orbit: { a: 0.38709927, e: 0.20563593, i: 7.00497902, node: 48.33076593, peri: 77.45779628, meanLongitude: 252.25032350 },
    note: 'Smallest planet; no substantial atmosphere; 3:2 spin–orbit resonance.',
  },
  {
    id: 'venus',
    name: 'Venus',
    mass: 4.8675e24,
    radius: 6051.8,
    axialTilt: 177.36, // near-complete flip -> retrograde rotation
    rotationPeriod: -243.025,
    color: 0xe8cda2,
    orbit: { a: 0.72333566, e: 0.00677672, i: 3.39467605, node: 76.67984255, peri: 131.60246718, meanLongitude: 181.97909950 },
    note: 'Hottest planet (~464 °C) due to a runaway CO₂ greenhouse. Retrograde spin.',
  },
  {
    id: 'earth',
    name: 'Earth',
    mass: 5.97237e24,
    radius: 6371.0,
    axialTilt: 23.44,
    rotationPeriod: 0.99726968,
    color: 0x3b7dd8,
    orbit: { a: 1.00000261, e: 0.01671123, i: -0.00001531, node: 0.0, peri: 102.93768193, meanLongitude: 100.46457166 },
    note: 'The only body known to harbour life; reference for the 1 AU distance unit.',
    moons: [
      {
        id: 'moon', name: 'Moon', mass: 7.342e22, radius: 1737.4,
        aKm: 384400, e: 0.0549, i: 5.145, phase: 0, rotationPeriod: 27.3217,
        color: 0xbcbcbc, simulateGravity: true,
        note: 'Mass is 1.2% of Earth — enough that both bodies orbit a barycenter 4 671 km from Earth’s center.',
      },
    ],
  },
  {
    id: 'mars',
    name: 'Mars',
    mass: 6.4171e23,
    radius: 3389.5,
    axialTilt: 25.19,
    rotationPeriod: 1.025957,
    color: 0xc1440e,
    orbit: { a: 1.52371034, e: 0.09339410, i: 1.84969142, node: 49.55953891, peri: -23.94362959, meanLongitude: -4.55343205 },
    note: 'The "Red Planet"; hosts Olympus Mons, the tallest volcano in the system.',
    moons: [
      { id: 'phobos', name: 'Phobos', mass: 1.0659e16, radius: 11.27, aKm: 9376, e: 0.0151, i: 1.093, phase: 0, rotationPeriod: 0.31891, color: 0x8a7a6a, simulateGravity: false, note: 'Tiny (~10⁻⁸ of Mars’ mass): gravitationally irrelevant, so render-only.' },
      { id: 'deimos', name: 'Deimos', mass: 1.4762e15, radius: 6.2, aKm: 23463, e: 0.00033, i: 0.93, phase: 130, rotationPeriod: 1.2624, color: 0x8a7a6a, simulateGravity: false },
    ],
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    mass: 1.8982e27,
    radius: 69911,
    axialTilt: 3.13,
    rotationPeriod: 0.41354,
    color: 0xd8a878,
    orbit: { a: 5.20288700, e: 0.04838624, i: 1.30439695, node: 100.47390909, peri: 14.72847983, meanLongitude: 34.39644051 },
    note: 'Most massive planet (2.5× all others combined). Great Red Spot is a giant storm.',
    moons: [
      { id: 'io', name: 'Io', mass: 8.9319e22, radius: 1821.6, aKm: 421700, e: 0.0041, i: 0.05, phase: 0, rotationPeriod: 1.769, color: 0xd9cf6a, simulateGravity: true, note: 'Most volcanically active body in the system.' },
      { id: 'europa', name: 'Europa', mass: 4.7998e22, radius: 1560.8, aKm: 671034, e: 0.009, i: 0.47, phase: 60, rotationPeriod: 3.551, color: 0xcab98f, simulateGravity: true, note: 'Subsurface ocean beneath an ice shell.' },
      { id: 'ganymede', name: 'Ganymede', mass: 1.4819e23, radius: 2634.1, aKm: 1070412, e: 0.0013, i: 0.20, phase: 150, rotationPeriod: 7.155, color: 0x9c8e7a, simulateGravity: true, note: 'Largest moon in the solar system — bigger than Mercury.' },
      { id: 'callisto', name: 'Callisto', mass: 1.0759e23, radius: 2410.3, aKm: 1882709, e: 0.0074, i: 0.192, phase: 250, rotationPeriod: 16.689, color: 0x6e655a, simulateGravity: true },
    ],
  },
  {
    id: 'saturn',
    name: 'Saturn',
    mass: 5.6834e26,
    radius: 58232,
    axialTilt: 26.73,
    rotationPeriod: 0.44401,
    color: 0xe3c98f,
    orbit: { a: 9.53667594, e: 0.05386179, i: 2.48599187, node: 113.66242448, peri: 92.59887831, meanLongitude: 49.95424423 },
    note: 'Famous ring system of ice and rock; lowest mean density of any planet (<water).',
    moons: [
      { id: 'titan', name: 'Titan', mass: 1.3452e23, radius: 2574.7, aKm: 1221870, e: 0.0288, i: 0.34854, phase: 0, rotationPeriod: 15.945, color: 0xd8a14a, simulateGravity: true, note: 'Thick nitrogen atmosphere; lakes of liquid methane.' },
      { id: 'rhea', name: 'Rhea', mass: 2.307e21, radius: 763.8, aKm: 527108, e: 0.0012, i: 0.345, phase: 200, rotationPeriod: 4.518, color: 0xb9b3a8, simulateGravity: false },
    ],
  },
  {
    id: 'uranus',
    name: 'Uranus',
    mass: 8.6810e25,
    radius: 25362,
    axialTilt: 97.77, // rolls on its side
    rotationPeriod: -0.71833,
    color: 0x9fe0e6,
    orbit: { a: 19.18916464, e: 0.04725744, i: 0.77263783, node: 74.01692503, peri: 170.95427630, meanLongitude: 313.23810451 },
    note: 'Ice giant tilted 98°, effectively orbiting on its side. Retrograde rotation.',
    moons: [
      { id: 'titania', name: 'Titania', mass: 3.4e21, radius: 788.4, aKm: 435910, e: 0.0011, i: 0.34, phase: 0, rotationPeriod: 8.706, color: 0xa9b6b6, simulateGravity: false },
      { id: 'oberon', name: 'Oberon', mass: 3.076e21, radius: 761.4, aKm: 583520, e: 0.0014, i: 0.058, phase: 180, rotationPeriod: 13.46, color: 0x97a3a3, simulateGravity: false },
    ],
  },
  {
    id: 'neptune',
    name: 'Neptune',
    mass: 1.02413e26,
    radius: 24622,
    axialTilt: 28.32,
    rotationPeriod: 0.6713,
    color: 0x3b5bdb,
    orbit: { a: 30.06992276, e: 0.00859048, i: 1.77004347, node: 131.78422574, peri: 44.96476227, meanLongitude: -55.12002969 },
    note: 'Windiest planet (>2000 km/h). Discovered by mathematical prediction in 1846.',
    moons: [
      { id: 'triton', name: 'Triton', mass: 2.139e22, radius: 1353.4, aKm: 354759, e: 0.000016, i: 156.885, phase: 0, rotationPeriod: -5.877, color: 0xc9c2d0, simulateGravity: true, note: 'Orbits backwards (retrograde) — likely a captured Kuiper-belt object.' },
    ],
  },
  {
    id: 'pluto',
    name: 'Pluto',
    mass: 1.303e22,
    radius: 1188.3,
    axialTilt: 122.53,
    rotationPeriod: -6.387,
    color: 0xcdb89a,
    orbit: { a: 39.48211675, e: 0.24882730, i: 17.14001206, node: 110.30393684, peri: 224.06891629, meanLongitude: 238.92903833 },
    note: 'Dwarf planet on a highly eccentric, inclined orbit; reclassified by the IAU in 2006.',
    moons: [
      { id: 'charon', name: 'Charon', mass: 1.586e21, radius: 606, aKm: 19591, e: 0.0002, i: 0.08, phase: 0, rotationPeriod: 6.387, color: 0x9c948a, simulateGravity: true, note: 'Half Pluto’s diameter and 12% its mass — the barycenter lies in open space between them, making this a true binary.' },
    ],
  },
];

export const ALL_BODIES: Body[] = [SUN, ...PLANETS];
