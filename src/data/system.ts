import { Vector3 } from 'three';
import { Body, Moon, OrbitalElements, SUN, PLANETS } from './bodies';
import { AU_KM, G } from './constants';
import { keplerState } from '../physics/state';
import { keplerPosition } from '../physics/kepler';

// Assembles the flat list of bodies handed to the N-body integrator and
// provides helpers for moon-relative Keplerian motion. The renderer keeps its
// own view list; this module is only about the simulation/physics side and the
// moon math shared with the renderer.

export interface SimDescriptor {
  id: string;
  mass: number;
  kind: 'sun' | 'planet' | 'moon';
  body?: Body;
  moon?: Moon;
  parent?: Body;
}

/** Convert a moon's parameters into orbital elements around its planet. */
export function moonElements(moon: Moon): OrbitalElements {
  return {
    a: moon.aKm / AU_KM,
    e: moon.e,
    i: moon.i,
    node: 0,
    peri: 0,
    meanLongitude: moon.phase,
  };
}

/** Standard gravitational parameter for a planet–moon pair (m³/s²). */
export function pairMu(planet: Body, moon: Moon): number {
  return G * (planet.mass + moon.mass);
}

/** Moon position relative to its planet, ecliptic AU, at `tDays` since J2000. */
export function moonRelativePosition(planet: Body, moon: Moon, tDays: number): Vector3 {
  return keplerPosition(moonElements(moon), tDays, pairMu(planet, moon));
}

/**
 * Build the body set for the integrator. `includeMoons` adds only moons whose
 * mass is dynamically significant (`simulateGravity`), keeping the all-pairs
 * cost and the required timestep bounded.
 */
export function buildSimBodies(includeMoons: boolean): SimDescriptor[] {
  const list: SimDescriptor[] = [{ id: SUN.id, mass: SUN.mass, kind: 'sun', body: SUN }];
  for (const planet of PLANETS) {
    list.push({ id: planet.id, mass: planet.mass, kind: 'planet', body: planet });
  }
  if (includeMoons) {
    for (const planet of PLANETS) {
      for (const moon of planet.moons ?? []) {
        if (!moon.simulateGravity) continue;
        list.push({ id: moon.id, mass: moon.mass, kind: 'moon', moon, parent: planet });
      }
    }
  }
  return list;
}

/** Heliocentric state (AU, AU/day) for a descriptor at `tDays` since J2000. */
export function descriptorState(d: SimDescriptor, tDays: number): { pos: Vector3; vel: Vector3 } {
  if (d.kind === 'sun') {
    return { pos: new Vector3(), vel: new Vector3() };
  }
  if (d.kind === 'planet') {
    return keplerState(d.body!.orbit!, tDays);
  }
  // Moon: planet heliocentric state + moon-relative state about the planet.
  const planetState = keplerState(d.parent!.orbit!, tDays);
  const rel = keplerState(moonElements(d.moon!), tDays, pairMu(d.parent!, d.moon!));
  return {
    pos: planetState.pos.add(rel.pos),
    vel: planetState.vel.add(rel.vel),
  };
}

/** Shortest orbital period (days) among included moons — drives the timestep. */
export function shortestMoonPeriod(descriptors: SimDescriptor[]): number {
  let min = Infinity;
  for (const d of descriptors) {
    if (d.kind !== 'moon') continue;
    const a = d.moon!.aKm / AU_KM;
    const mu = pairMu(d.parent!, d.moon!);
    const aM = a * 1.495978707e11;
    const n = Math.sqrt(mu / (aM * aM * aM));
    const periodDays = (2 * Math.PI) / n / 86400;
    if (periodDays < min) min = periodDays;
  }
  return min;
}
