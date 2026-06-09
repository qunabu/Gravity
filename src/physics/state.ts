import { Vector3 } from 'three';
import { DEG, GM_SUN, AU, DAY } from '../data/constants';
import type { OrbitalElements } from '../data/bodies';
import { solveKepler } from './kepler';

export interface StateVector {
  /** Position, AU (ecliptic frame, z = north). */
  pos: Vector3;
  /** Velocity, AU/day (ecliptic frame). */
  vel: Vector3;
}

/**
 * Full heliocentric state (position + velocity) from Keplerian elements at
 * `tDays` since J2000. Used to seed the N-body integrator with physically
 * consistent initial conditions, so both models start from the same reality.
 */
export function keplerState(el: OrbitalElements, tDays: number, mu = GM_SUN): StateVector {
  const a = el.a;
  const e = el.e;
  const i = el.i * DEG;
  const node = el.node * DEG;
  const peri = el.peri * DEG;
  const L0 = el.meanLongitude * DEG;

  const aMeters = a * AU;
  const n = Math.sqrt(mu / (aMeters * aMeters * aMeters)); // rad/s
  const nPerDay = n * DAY;

  const M = L0 - peri + nPerDay * tDays;
  const E = solveKepler(M, e);

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const sqrt1me2 = Math.sqrt(1 - e * e);

  // Position in the orbital plane (measured from perihelion direction).
  const xv = a * (cosE - e);
  const yv = a * (sqrt1me2 * sinE);

  // Velocity in the orbital plane: differentiate w.r.t. time.
  // dE/dt = n / (1 - e cosE); express velocity in AU/day.
  const Edot = nPerDay / (1 - e * cosE); // rad/day
  const vxv = -a * sinE * Edot;
  const vyv = a * sqrt1me2 * cosE * Edot;

  const argPeri = peri - node;
  const cosO = Math.cos(node);
  const sinO = Math.sin(node);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosW = Math.cos(argPeri);
  const sinW = Math.sin(argPeri);

  // Rotation matrix (orbital plane -> ecliptic): R = Rz(Ω) Rx(i) Rz(ω).
  const r11 = cosO * cosW - sinO * sinW * cosI;
  const r12 = -cosO * sinW - sinO * cosW * cosI;
  const r21 = sinO * cosW + cosO * sinW * cosI;
  const r22 = -sinO * sinW + cosO * cosW * cosI;
  const r31 = sinW * sinI;
  const r32 = cosW * sinI;

  const pos = new Vector3(
    r11 * xv + r12 * yv,
    r21 * xv + r22 * yv,
    r31 * xv + r32 * yv,
  );
  const vel = new Vector3(
    r11 * vxv + r12 * vyv,
    r21 * vxv + r22 * vyv,
    r31 * vxv + r32 * vyv,
  );

  return { pos, vel };
}
