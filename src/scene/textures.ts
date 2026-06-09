import { CanvasTexture, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';

// Real Earth daymap from Solar System Scope (CC BY 4.0), bundled in /public.
let earthRealCache: Texture | null = null;
function earthRealTexture(): Texture {
  if (earthRealCache) return earthRealCache;
  const t = new TextureLoader().load('/earth_daymap.jpg');
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  earthRealCache = t;
  return t;
}

// Self-contained procedural surface textures. Everything is generated on an
// offscreen canvas from 3D value-noise — no external image files, so the demo
// works fully offline. Each body gets an equirectangular map (seamless in
// longitude because the noise is sampled on a cylinder around the sphere).

type RGB = [number, number, number];

// ---- 3D value noise + fbm ------------------------------------------------

function hash3(xi: number, yi: number, zi: number, seed: number): number {
  let n = xi * 374761393 + yi * 668265263 + zi * 2147483647 + seed * 982451653;
  n = (n ^ (n >> 13)) >>> 0;
  n = (n * 1274126177) >>> 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number { return t * t * (3 - 2 * t); }

function vnoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = c(0, 0, 0) + u * (c(1, 0, 0) - c(0, 0, 0));
  const x10 = c(0, 1, 0) + u * (c(1, 1, 0) - c(0, 1, 0));
  const x01 = c(0, 0, 1) + u * (c(1, 0, 1) - c(0, 0, 1));
  const x11 = c(0, 1, 1) + u * (c(1, 1, 1) - c(0, 1, 1));
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

function fbm3(x: number, y: number, z: number, seed: number, oct = 5, gain = 0.5, lac = 2): number {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise3(x * freq, y * freq, z * freq, seed + i * 17);
    freq *= lac; amp *= gain;
  }
  return sum;
}

// ---- helpers -------------------------------------------------------------

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }

function makeCanvas(w: number, h: number): { cv: HTMLCanvasElement; img: ImageData; data: Uint8ClampedArray } {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  return { cv, img, data: img.data };
}

// For each pixel call `shade(u, v, p)` -> RGB, where (u,v) ∈ [0,1) and p is the
// 3D point on a unit cylinder (seamless longitude).
function paint(w: number, h: number, freq: number, shade: (u: number, v: number, nx: number, ny: number, nz: number) => RGB): CanvasTexture {
  const { cv, img, data } = makeCanvas(w, h);
  for (let j = 0; j < h; j++) {
    const v = j / h;
    const lat = (v - 0.5) * Math.PI; // -π/2 .. π/2
    const cy = Math.sin(lat) * freq;
    const ringR = Math.cos(lat) * freq;
    for (let i = 0; i < w; i++) {
      const u = i / w;
      const ang = u * Math.PI * 2;
      const nx = Math.cos(ang) * ringR;
      const ny = cy;
      const nz = Math.sin(ang) * ringR;
      const rgb = shade(u, v, nx, ny, nz);
      const o = (j * w + i) * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  cv.getContext('2d')!.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ---- per-surface generators ----------------------------------------------

function starTex(seed: number): CanvasTexture {
  const dark: RGB = [200, 90, 12], mid: RGB = [255, 170, 40], hot: RGB = [255, 244, 200];
  return paint(640, 320, 5, (_u, _v, x, y, z) => {
    const n = fbm3(x, y, z, seed, 6);
    const g = clamp01((n - 0.25) * 2.0);
    const base = g < 0.5 ? mix(dark, mid, g * 2) : mix(mid, hot, (g - 0.5) * 2);
    // bright granulation flecks
    const fleck = fbm3(x * 3, y * 3, z * 3, seed + 99, 3);
    return mix(base, hot, clamp01((fleck - 0.62) * 3) * 0.6);
  });
}

function rockyTex(seed: number, lo: RGB, hi: RGB, opts: { craters?: number; poles?: RGB } = {}): CanvasTexture {
  const craters = opts.craters ?? 0;
  return paint(512, 256, 4, (_u, v, x, y, z) => {
    let n = fbm3(x, y, z, seed, 6);
    n = clamp01((n - 0.2) * 1.6);
    let col = mix(lo, hi, n);
    if (craters > 0) {
      const c = fbm3(x * craters, y * craters, z * craters, seed + 7, 4);
      const pit = clamp01((0.42 - c) * 6); // dark crater floors
      const rim = clamp01((c - 0.62) * 6); // bright rims
      col = mix(col, mix(col, [0, 0, 0], 0.5), pit * 0.5);
      col = mix(col, mix(col, [255, 255, 255], 0.4), rim * 0.3);
    }
    if (opts.poles && Math.abs(v - 0.5) > 0.44) {
      col = mix(col, opts.poles, clamp01((Math.abs(v - 0.5) - 0.44) * 14));
    }
    return col;
  });
}

function earthTex(seed: number): CanvasTexture {
  const deep: RGB = [12, 50, 110], ocean: RGB = [24, 86, 158], shallow: RGB = [40, 130, 178];
  const grass: RGB = [58, 116, 56], forest: RGB = [40, 86, 44];
  const sand: RGB = [168, 150, 96], rock: RGB = [120, 100, 74], ice: RGB = [244, 248, 255];
  return paint(768, 384, 3.0, (_u, v, x, y, z) => {
    const e = fbm3(x, y, z, seed, 7);
    const LAND = 0.48;
    let col: RGB;
    if (e <= LAND) {
      // ocean depth from sea level downward
      const d = clamp01((LAND - e) * 5);
      col = mix(shallow, mix(ocean, deep, d), d);
    } else {
      // beaches → vegetation → arid highlands → snow, by elevation
      const t = clamp01((e - LAND) * 3.2);
      const veg = fbm3(x * 5, y * 5, z * 5, seed + 3, 3);
      const base = veg > 0.5 ? mix(grass, forest, clamp01((veg - 0.5) * 2)) : mix(sand, rock, clamp01(veg * 1.6));
      col = mix(mix(sand, base, smooth(clamp01(t * 1.5))), [200, 205, 210], clamp01((t - 0.7) * 3) * 0.6);
    }
    // polar ice caps
    const polar = Math.abs(v - 0.5);
    if (polar > 0.38) col = mix(col, ice, clamp01((polar - 0.38) * 8));
    // cloud layer — broad swirls
    const cloud = fbm3(x * 1.5 + 11, y * 1.5, z * 1.5, seed + 50, 5);
    col = mix(col, [255, 255, 255], clamp01((cloud - 0.52) * 3.5) * 0.7);
    return col;
  });
}

function gasTex(seed: number, bands: RGB[], opts: { contrast?: number; spot?: RGB; turb?: number } = {}): CanvasTexture {
  const contrast = opts.contrast ?? 1;
  const turb = opts.turb ?? 0.12;
  return paint(768, 384, 4, (u, v, x, y, z) => {
    // warp latitude by turbulence so bands wobble
    const warp = (fbm3(x, y, z, seed + 5, 4) - 0.5) * turb;
    const lat = clamp01(v + warp);
    const f = lat * (bands.length - 1);
    const i0 = Math.min(bands.length - 1, Math.floor(f));
    const i1 = Math.min(bands.length - 1, i0 + 1);
    let col = mix(bands[i0], bands[i1], smooth(f - i0));
    // fine streaks within bands
    const streak = fbm3(x * 6, y * 1.0, z * 6, seed + 11, 3) - 0.5;
    col = mix(col, mix(col, [255, 255, 255], 0.5), clamp01(streak * contrast) * 0.25);
    col = mix(col, mix(col, [0, 0, 0], 0.5), clamp01(-streak * contrast) * 0.18);
    // great red spot (Jupiter): a vortex in the southern bands
    if (opts.spot) {
      const su = (u - 0.72); const sv = (v - 0.62);
      const d = Math.sqrt(su * su * 1.0 + sv * sv * 4.0);
      if (d < 0.07) col = mix(col, opts.spot, clamp01((0.07 - d) * 16));
    }
    return col;
  });
}

// ---- public API ----------------------------------------------------------

const cache = new Map<string, Texture>();

function strSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h % 100000;
}

/** Surface texture for a Sun / planet / moon, keyed and cached by id. */
export function surfaceTexture(id: string, colorHex: number): Texture {
  const hit = cache.get(id);
  if (hit) return hit;
  const seed = strSeed(id);
  const base: RGB = [(colorHex >> 16) & 255, (colorHex >> 8) & 255, colorHex & 255];
  let tex: Texture;
  switch (id) {
    case 'sun': tex = starTex(seed); break;
    case 'mercury': tex = rockyTex(seed, [86, 78, 70], [165, 150, 135], { craters: 5 }); break;
    case 'venus': tex = gasTex(seed, [[222, 198, 150], [205, 175, 120], [232, 212, 170], [198, 168, 118]], { contrast: 0.6, turb: 0.18 }); break;
    case 'earth': tex = earthRealTexture(); break;
    case 'mars': tex = rockyTex(seed, [120, 52, 28], [196, 108, 64], { craters: 4, poles: [240, 240, 245] }); break;
    case 'jupiter': tex = gasTex(seed, [[206, 180, 142], [170, 128, 90], [224, 200, 168], [150, 110, 78], [210, 188, 150]], { contrast: 1.3, spot: [188, 92, 60], turb: 0.16 }); break;
    case 'saturn': tex = gasTex(seed, [[230, 210, 158], [208, 184, 130], [224, 202, 150], [196, 172, 120]], { contrast: 0.8, turb: 0.1 }); break;
    case 'uranus': tex = gasTex(seed, [[176, 224, 228], [150, 208, 214], [186, 230, 232]], { contrast: 0.4, turb: 0.06 }); break;
    case 'neptune': tex = gasTex(seed, [[48, 86, 196], [60, 104, 214], [40, 74, 176], [70, 120, 224]], { contrast: 0.7, spot: [30, 50, 120], turb: 0.1 }); break;
    case 'pluto': tex = rockyTex(seed, [120, 104, 84], [206, 188, 160], { craters: 3 }); break;
    // moons
    case 'moon': tex = rockyTex(seed, [78, 78, 82], [176, 176, 180], { craters: 6 }); break;
    case 'io': tex = rockyTex(seed, [188, 170, 70], [236, 224, 150], { craters: 2 }); break;
    case 'europa': tex = rockyTex(seed, [180, 168, 150], [232, 224, 210], { craters: 1 }); break;
    case 'titan': tex = gasTex(seed, [[206, 150, 60], [224, 170, 80], [196, 138, 52]], { contrast: 0.3, turb: 0.1 }); break;
    case 'triton': tex = rockyTex(seed, [170, 150, 162], [222, 206, 214], { craters: 2, poles: [240, 235, 245] }); break;
    default: tex = rockyTex(seed, mix(base, [0, 0, 0], 0.45) as RGB, base, { craters: 5 }); break;
  }
  cache.set(id, tex);
  return tex;
}

/** Radial ring profile texture for Saturn (alpha encodes the gaps). */
export function ringTexture(): CanvasTexture {
  const hit = cache.get('__rings');
  if (hit) return hit as CanvasTexture;
  const w = 512, h = 8;
  const { cv, img, data } = makeCanvas(w, h);
  for (let i = 0; i < w; i++) {
    const r = i / w; // 0 inner .. 1 outer
    const n = fbm3(r * 60, 0.5, 0.5, 7, 4);
    let alpha = 0.55 + 0.4 * (n - 0.5);
    // Cassini division and a couple of fainter gaps
    if (r > 0.62 && r < 0.68) alpha *= 0.15;
    if (r > 0.84 && r < 0.86) alpha *= 0.3;
    if (r < 0.04 || r > 0.99) alpha *= 0.2;
    alpha = clamp01(alpha);
    const shade = 180 + 50 * (n - 0.5);
    const c: RGB = [clamp01(shade / 255) * 230, clamp01(shade / 255) * 210, clamp01(shade / 255) * 160];
    for (let j = 0; j < h; j++) {
      const o = (j * w + i) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = alpha * 255;
    }
  }
  cv.getContext('2d')!.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  cache.set('__rings', tex);
  return tex;
}
