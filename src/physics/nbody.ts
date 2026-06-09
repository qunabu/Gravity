import { Vector3 } from 'three';
import { G, AU } from '../data/constants';

// Direct (all-pairs) N-body gravitational integrator. This is the literal
// "how gravity works" model: every body pulls on every other body with
//     F = G·m₁·m₂ / r²
// and we integrate the resulting accelerations. Internals are SI (metres,
// seconds, kilograms); positions are exposed back in AU for the renderer.
//
// Integration uses kick–drift–kick leapfrog, which is symplectic and keeps
// orbital energy bounded over long runs far better than naive Euler.
//
// The body set is supplied at construction (Sun + planets, optionally plus
// dynamically significant moons), so the renderer can rebuild the simulation
// when the user toggles moon gravity on or off.

const SOFTENING = 1e6; // metres, avoids singular forces during close passes

export class NBody {
  readonly n: number;
  readonly mass: Float64Array;
  readonly pos: Float64Array;  // metres, xyz interleaved
  readonly vel: Float64Array;  // m/s, xyz interleaved
  private acc: Float64Array;

  constructor(masses: number[]) {
    this.n = masses.length;
    this.mass = Float64Array.from(masses);
    this.pos = new Float64Array(this.n * 3);
    this.vel = new Float64Array(this.n * 3);
    this.acc = new Float64Array(this.n * 3);
  }

  /**
   * Seed positions (AU) and velocities (AU/day) for every body, then remove
   * the net momentum so the barycenter stays fixed and compute accelerations.
   */
  seed(posAU: Vector3[], velAUday: Vector3[]): void {
    const DAY = 86400;
    for (let k = 0; k < this.n; k++) {
      this.pos[k * 3] = posAU[k].x * AU;
      this.pos[k * 3 + 1] = posAU[k].y * AU;
      this.pos[k * 3 + 2] = posAU[k].z * AU;
      this.vel[k * 3] = (velAUday[k].x * AU) / DAY;
      this.vel[k * 3 + 1] = (velAUday[k].y * AU) / DAY;
      this.vel[k * 3 + 2] = (velAUday[k].z * AU) / DAY;
    }
    this.removeNetMomentum();
    this.computeAccelerations();
  }

  private removeNetMomentum(): void {
    let px = 0, py = 0, pz = 0, mTot = 0;
    for (let k = 0; k < this.n; k++) {
      const m = this.mass[k];
      px += m * this.vel[k * 3];
      py += m * this.vel[k * 3 + 1];
      pz += m * this.vel[k * 3 + 2];
      mTot += m;
    }
    const vx = px / mTot, vy = py / mTot, vz = pz / mTot;
    for (let k = 0; k < this.n; k++) {
      this.vel[k * 3] -= vx;
      this.vel[k * 3 + 1] -= vy;
      this.vel[k * 3 + 2] -= vz;
    }
  }

  private computeAccelerations(): void {
    const a = this.acc;
    a.fill(0);
    const soft2 = SOFTENING * SOFTENING;
    for (let i = 0; i < this.n; i++) {
      const ix = i * 3;
      for (let j = i + 1; j < this.n; j++) {
        const jx = j * 3;
        const dx = this.pos[jx] - this.pos[ix];
        const dy = this.pos[jx + 1] - this.pos[ix + 1];
        const dz = this.pos[jx + 2] - this.pos[ix + 2];
        const r2 = dx * dx + dy * dy + dz * dz + soft2;
        const invR = 1 / Math.sqrt(r2);
        const invR3 = invR * invR * invR;
        const s = G * invR3;
        const mi = this.mass[i];
        const mj = this.mass[j];
        a[ix] += s * mj * dx;
        a[ix + 1] += s * mj * dy;
        a[ix + 2] += s * mj * dz;
        a[jx] -= s * mi * dx;
        a[jx + 1] -= s * mi * dy;
        a[jx + 2] -= s * mi * dz;
      }
    }
  }

  /** Advance the system by `dtSeconds` using one leapfrog (KDK) step. */
  step(dtSeconds: number): void {
    const half = 0.5 * dtSeconds;
    const a = this.acc;
    for (let k = 0; k < this.n * 3; k++) {
      this.vel[k] += a[k] * half;
      this.pos[k] += this.vel[k] * dtSeconds;
    }
    this.computeAccelerations();
    for (let k = 0; k < this.n * 3; k++) {
      this.vel[k] += a[k] * half;
    }
  }

  positionAU(k: number, out: Vector3): Vector3 {
    return out.set(
      this.pos[k * 3] / AU,
      this.pos[k * 3 + 1] / AU,
      this.pos[k * 3 + 2] / AU,
    );
  }

  totalEnergy(): number {
    let ke = 0;
    for (let k = 0; k < this.n; k++) {
      const vx = this.vel[k * 3], vy = this.vel[k * 3 + 1], vz = this.vel[k * 3 + 2];
      ke += 0.5 * this.mass[k] * (vx * vx + vy * vy + vz * vz);
    }
    let pe = 0;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const dx = this.pos[j * 3] - this.pos[i * 3];
        const dy = this.pos[j * 3 + 1] - this.pos[i * 3 + 1];
        const dz = this.pos[j * 3 + 2] - this.pos[i * 3 + 2];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        pe -= (G * this.mass[i] * this.mass[j]) / r;
      }
    }
    return ke + pe;
  }
}
