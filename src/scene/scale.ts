import { Vector3 } from 'three';
import { AU_KM } from '../data/constants';

// The scale problem: at true scale the Sun's radius is 0.00465 AU while
// Neptune orbits at 30 AU — a body-to-orbit ratio of ~6000:1, and Neptune is
// ~77× farther than Mercury. You cannot show real sizes AND real distances on
// one screen and see anything. So we expose two interchangeable scale models
// behind one interface. Physics always runs in true AU; only rendering differs.

export type ScaleMode = 'real' | 'visual';

/** Scene units per AU in TRUE-scale mode (Earth orbit = 10 units). */
export const TRUE_UNITS_PER_AU = 10;

export interface ScaleModel {
  mode: ScaleMode;
  /** Map a heliocentric position (AU) to scene-space units. */
  position(au: Vector3, out: Vector3): Vector3;
  /** Map a body's physical radius (km) to a scene-space radius. */
  bodyRadius(km: number, isStar: boolean): number;
  /** Human-readable description of the current distortion. */
  label: string;
}

/** Strictly accurate: sizes and distances share one linear factor. */
export const realScale: ScaleModel = {
  mode: 'real',
  label: 'True scale — accurate sizes & distances (zoom in to find planets)',
  position(au, out) {
    return out.copy(au).multiplyScalar(TRUE_UNITS_PER_AU);
  },
  bodyRadius(km) {
    const au = km / AU_KM;
    return au * TRUE_UNITS_PER_AU;
  },
};

// Visual model: a smooth radial remap pulls the outer planets inward, and a
// logarithmic size map keeps both the Sun and tiny Mercury visible at once.
// It is a monotonic radial transform, so closed orbits stay closed and smooth
// (ellipses become near-ellipses) and ordering/relative spacing is preserved.

const VISUAL_BASE = 14;       // scene units at 1 AU
const VISUAL_EXP = 0.62;      // <1 compresses large distances
const SIZE_MIN = 0.25;        // smallest rendered body radius (scene units)
const SIZE_MAX = 3.2;         // Sun's rendered radius (scene units)

function visualDistance(rAU: number): number {
  if (rAU <= 0) return 0;
  return VISUAL_BASE * Math.pow(rAU, VISUAL_EXP);
}

export const visualScale: ScaleModel = {
  mode: 'visual',
  label: 'Visual scale — sizes & distances compressed so everything is visible',
  position(au, out) {
    const r = au.length();
    if (r === 0) return out.set(0, 0, 0);
    const scaled = visualDistance(r) / r;
    return out.copy(au).multiplyScalar(scaled);
  },
  bodyRadius(km, isStar) {
    // Log map from [Mercury, Sun] radius range -> [SIZE_MIN, SIZE_MAX].
    const minKm = 1188; // ~Pluto, smallest body shown
    const maxKm = 696340; // Sun
    const t = (Math.log10(km) - Math.log10(minKm)) /
      (Math.log10(maxKm) - Math.log10(minKm));
    const r = SIZE_MIN + Math.max(0, Math.min(1, t)) * (SIZE_MAX - SIZE_MIN);
    return isStar ? r : r * 0.85;
  },
};

export function getScale(mode: ScaleMode): ScaleModel {
  return mode === 'real' ? realScale : visualScale;
}
