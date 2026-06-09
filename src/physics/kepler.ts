import { Vector3 } from 'three';
import { DEG, GM_SUN, AU, DAY } from '../data/constants';
import type { OrbitalElements } from '../data/bodies';

// Analytic two-body (Keplerian) positions from J2000 orbital elements.
// Positions are returned in AU, in a heliocentric ecliptic frame:
//   +X toward the vernal equinox, +Z toward the ecliptic north pole.
// (Three.js is Y-up, so the scene layer swaps Y/Z when building meshes.)

/** Solve Kepler's equation  M = E - e·sin E  for the eccentric anomaly E. */
export function solveKepler(M: number, e: number): number {
  // Normalise M to [-π, π] for fast, stable Newton–Raphson convergence.
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  if (m < -Math.PI) m += 2 * Math.PI;

  let E = e < 0.8 ? m : Math.PI; // good initial guess
  for (let iter = 0; iter < 60; iter++) {
    const dE = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Heliocentric ecliptic position (AU) for the given elements at a time
 * `tDays` measured in days since the J2000.0 epoch. `mu` is the central
 * standard gravitational parameter GM (defaults to the Sun); pass a planet's
 * GM to position a moon relative to its planet.
 */
export function keplerPosition(el: OrbitalElements, tDays: number, mu = GM_SUN): Vector3 {
  const a = el.a;
  const e = el.e;
  const i = el.i * DEG;
  const node = el.node * DEG;
  const peri = el.peri * DEG; // longitude of perihelion ϖ = Ω + ω
  const L0 = el.meanLongitude * DEG;

  // Mean motion n = sqrt(GM/a^3). Work in SI then convert the rate to rad/day.
  const aMeters = a * AU;
  const n = Math.sqrt(mu / (aMeters * aMeters * aMeters)); // rad/s
  const nPerDay = n * DAY;

  // Mean anomaly: M = L - ϖ, advanced by the mean motion since J2000.
  const M = L0 - peri + nPerDay * tDays;

  const E = solveKepler(M, e);

  // Position in the orbital plane (perifocal-ish, measured from the node).
  const xv = a * (Math.cos(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));

  // True anomaly and radius, then argument of perihelion ω = ϖ - Ω.
  const argPeri = peri - node;
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);

  const u = v + argPeri; // argument of latitude
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);

  // Rotate from the orbital plane into the ecliptic frame.
  const x = r * (cosNode * cosU - sinNode * sinU * cosI);
  const y = r * (sinNode * cosU + cosNode * sinU * cosI);
  const z = r * (sinU * sinI);

  // Return ecliptic coords as (X, Y=ecliptic-Z, Z=-ecliptic-Y) is handled in
  // the scene layer; here we keep the physical (x, y, z) with z = north.
  return new Vector3(x, y, z);
}

/** Sidereal orbital period in days for a given semi-major axis (AU). */
export function orbitalPeriodDays(a: number): number {
  const aMeters = a * AU;
  const n = Math.sqrt(GM_SUN / (aMeters * aMeters * aMeters)); // rad/s
  return (2 * Math.PI) / n / DAY;
}

/** Sample N points around the full orbit (AU, ecliptic frame) for drawing. */
export function sampleOrbit(el: OrbitalElements, segments = 512): Vector3[] {
  const period = orbitalPeriodDays(el.a);
  const pts: Vector3[] = [];
  for (let k = 0; k <= segments; k++) {
    const t = (k / segments) * period;
    pts.push(keplerPosition(el, t));
  }
  return pts;
}
