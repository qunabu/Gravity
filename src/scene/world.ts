import {
  Scene, PerspectiveCamera, WebGLRenderer, Vector3, Color,
  Mesh, SphereGeometry, MeshStandardMaterial, MeshBasicMaterial,
  Group, ConeGeometry, CylinderGeometry, BoxGeometry,
  PointLight, AmbientLight, BufferGeometry, LineBasicMaterial, Line,
  Float32BufferAttribute, AdditiveBlending, BackSide, Points,
  PointsMaterial, RingGeometry, DoubleSide, MathUtils, ArrowHelper,
  LineDashedMaterial, EdgesGeometry, LineSegments, Raycaster, Vector2,
  CatmullRomCurve3, WireframeGeometry,
  type ColorRepresentation,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

import { ALL_BODIES, PLANETS, SUN, type Body, type Moon } from '../data/bodies';
import { DAY, AU_KM, AU, G, M_SUN } from '../data/constants';
import { keplerState } from '../physics/state';
import { keplerPosition, sampleOrbit, orbitalPeriodDays } from '../physics/kepler';
import { NBody } from '../physics/nbody';
import {
  buildSimBodies, descriptorState, moonElements, moonRelativePosition,
  shortestMoonPeriod, pairMu, type SimDescriptor,
} from '../data/system';
import { getScale, TRUE_UNITS_PER_AU, type ScaleMode, type ScaleModel } from './scale';
import { surfaceTexture, ringTexture } from './textures';

// Ecliptic frame (x toward equinox, z north) -> Three.js Y-up scene frame.
function eclToScene(v: Vector3, out: Vector3): Vector3 {
  return out.set(v.x, v.z, -v.y);
}

export type PhysicsMode = 'kepler' | 'nbody';
export type DemoMode =
  | 'normal' | 'inertia' | 'accretion' | 'helix' | 'orbit-intro' | 'rocket'
  | 'soi' | 'flyby' | 'spacetime' | 'precession';

interface BodyView {
  body: Body;
  mesh: Mesh;
  orbitAU: Vector3[];
  orbitLine: Line | null;
  projLine: Line;
  projDot: Mesh;
  label: CSS2DObject;
  axisLine: Line; // rotation axis, shown on the self-rotation slide
  trail: Line;        // real-space path, shown on the "Sun moves" (helix) slide
  trailPts: Vector3[];
  vArrow: ArrowHelper; // per-body velocity arrow (helix-vectors slide)
  gArrow: ArrowHelper; // per-body gravity arrow
  spin: number;
  opacity: number; // eased 0..1 for fade in/out between steps
  // transient per-frame state shared with moon rendering
  curAU: Vector3;
  curScene: Vector3;
}

interface MoonView {
  moon: Moon;
  parent: Body;
  mesh: Mesh;
  orbitRelAU: Vector3[];
  orbitLine: Line;
  label: CSS2DObject;
  trail: Line;
  trailPts: Vector3[];
  spin: number;
  opacity: number;
}

export interface WorldState {
  scaleMode: ScaleMode;
  physics: PhysicsMode;
  twoD: number;
  showOrbits: boolean;
  showProjection: boolean;
  showLabels: boolean;
  showMoonLabels: boolean; // moon name labels (separate from planet labels)
  showMoons: boolean;
  showSpin: boolean;   // axial self-rotation of bodies
  showAxes: boolean;   // draw the rotation-axis line on visible bodies
  paused: boolean;
  daysPerSecond: number;
  // Teaching aids, driven by the guided tour.
  demoMode: DemoMode;
  vecVelocity: boolean;   // velocity (tangent) arrow
  vecGravity: boolean;    // gravity pull toward the attractor
  vecMutual: boolean;     // equal-and-opposite pull on the attractor too
  vecTangent: boolean;    // dashed "straight path without gravity"
  vecTarget: 'earth' | 'moon'; // which orbit the single-subject vectors describe
  vecAll: boolean;             // velocity+gravity arrows on every body (helix)
  vecSun: boolean;             // the Sun's own motion arrow (helix)
}

export class World {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: OrbitControls;

  private views: BodyView[] = [];
  private moonViews: MoonView[] = [];
  private scale: ScaleModel;

  private nbody!: NBody;
  private simBodies: SimDescriptor[] = [];
  private simIndexByPlanet = new Map<string, number>();
  /** Smallest moon semi-major axis (AU) per planet, for visual exaggeration. */
  private minMoonA = new Map<string, number>();

  private flatten = 0;
  private polarLimit = Math.PI;

  // Smooth camera fly-to between steps. When camPosGoal is set the camera and
  // its target ease toward the goal each frame; user interaction cancels it.
  private camPosGoal: Vector3 | null = null;
  private camTargetGoal = new Vector3();
  // Drag-to-rotate that springs back: while dragging, auto-framing is suspended
  // so the user can orbit freely; on release the camera eases back to the
  // slide's framing (only when returnOnRelease is on — i.e. during the tour).
  private userDragging = false;
  private returnOnRelease = false;
  private wantAutoRotate = false;

  // Free-explore hover: when on, hovering a body reveals its label + orbit.
  private hoverEnabled = false;
  private hoveredId: string | null = null;
  private raycaster = new Raycaster();
  private pointerNDC = new Vector2(2, 2); // off-screen until the mouse moves
  private homeCamPos: Vector3 | null = null;
  private homeCamTarget = new Vector3();

  // Camera follow: keeps a moving body framed (e.g. the Earth–Moon system,
  // since Earth itself orbits the Sun). Offsets are relative to the body.
  private followId: string | null = null;
  private followCamOffset = new Vector3();
  private followTgtOffset = new Vector3();
  private followCamPos = new Vector3();
  private followLast = new Vector3();   // followed body's previous scene pos
  private followHasLast = false;
  private followDelta = new Vector3();

  /** When non-null, only bodies whose id is present are shown (tour mode). */
  visible: Set<string> | null = null;

  simDays = 0;
  energy0 = 0;

  state: WorldState = {
    scaleMode: 'visual',
    physics: 'kepler',
    twoD: 0,
    showOrbits: true,
    showProjection: false,
    showLabels: true,
    showMoonLabels: true,
    showMoons: false,
    showSpin: true,
    showAxes: false,
    paused: false,
    daysPerSecond: 20,
    demoMode: 'normal',
    vecVelocity: false,
    vecGravity: false,
    vecMutual: false,
    vecTangent: false,
    vecTarget: 'earth',
    vecAll: false,
    vecSun: false,
  };

  // Teaching-vector objects (created once, toggled per step).
  private gravArrow!: ArrowHelper;     // pull on Earth, toward Sun
  private gravArrowSun!: ArrowHelper;  // equal/opposite pull on the Sun
  private velArrow!: ArrowHelper;      // Earth's velocity, tangent to orbit
  private tangentLine!: Line;          // dashed straight-line path
  private velLabel!: CSS2DObject;
  private gravLabel!: CSS2DObject;
  private orbitIntroLine!: Line;      // the orbit ellipse that fades in on Step 5
  private inertiaX = -30;              // Earth's x while drifting in inertia demo

  // "Orbit intro" demo (Step 5): a 2-body sim that continues the inertia drift,
  // then ramps gravity on so the straight path bends into an orbit as the Sun
  // and the vectors fade in.
  private orbitPos = new Vector3();
  private orbitVel = new Vector3();
  private orbitInitPos = new Vector3(); // for replay (escape demo)
  private orbitInitVel = new Vector3();
  private orbitSunPos = new Vector3();
  private orbitK = 784;
  private orbitVBase = 7;  // circular speed at orbitR (scene units) — vector scaling reference
  private orbitR = 16;     // reference Sun↔Earth distance (scene units)
  private orbitGrav = 0;   // gravity ramp 0..1
  private vecFade = 0;     // teaching-vector opacity 0..1

  // Cosmic-velocity "rocket" demo: a probe launched from a central body (Earth
  // or the Sun) that orbits or escapes, reusing the orbit fields for the sim.
  private rocketMesh!: Group;
  private satelliteMesh!: Group; // alternate craft shown on the orbit step
  private craftSatellite = false; // which craft the current step uses
  private rocketTrail!: Line;
  private rocketTrailPts: Vector3[] = [];
  private rocketLabel!: CSS2DObject;
  private rocketAttractor = 'earth';
  private rocketAttractorR = 0; // exaggerated display radius for the launch body
  private rocketEarthScale = 1; // animated scale, so the launch body grows in smoothly
  private rocketCenter = new Vector3(); // render offset: the launch body glides in from
  private rocketEmissive = 0;           // its previous on-screen spot, brightening as it centers
  private rocketLabelText = '';

  // Astrodynamics overlays (spheres of influence, gravity-assist trajectories).
  // Built once, shown per demo mode.
  // SOI: nested spheres — the Sun's, Earth's (on its orbit), and the Moon's.
  private soiSunSphere!: Mesh;
  private soiEarthSphere!: Mesh;
  private soiMoonSphere!: Mesh;
  private soiMoon!: Mesh;
  private soiSunLabel!: CSS2DObject;
  private soiEarthLabel!: CSS2DObject;
  private soiMoonLabel!: CSS2DObject;
  private soiMoonAngle = 0;
  private readonly soiEarthPos = new Vector3(15, 0, 0); // Earth's place on its orbit
  // Gravity assist (Voyager 1 & 2): paths rebuilt in scene units at slide start.
  private voyagerLines: Line[] = [];
  private voyagerCraft: Group[] = [];
  private voyagerLabels: CSS2DObject[] = [];
  private flybyIdx = 0;            // which probe this slide shows (0 = V1, 1 = V2)
  private flybyDays = 0;           // current mission clock (days since J2000)
  private flybyStart = 0;
  private flybyEnd = 1;
  private flybyRate = 100;         // days advanced per real second
  private flybyKeyDays: number[] = []; // flyby dates along the path
  // Spacetime-curvature slide: a warped grid (the "fabric"), a central mass that
  // dents it, and a body rolling around the well.
  private spacetimeGrid!: Group;
  private spacetimeStar!: Mesh;
  private spacetimeOrbiter!: Mesh;
  private spacetimeAngle = 0;
  private sunTime = { value: 0 }; // drives the animated churn on the Sun's surface
  // Mercury perihelion-precession slide: an eccentric orbit whose major axis
  // slowly rotates, tracing a rosette (the GR "Newton can't, Einstein can").
  private precessMercury!: Mesh;
  private precessTrail!: Line;
  private precessTrailPts: Vector3[] = [];
  private precessApsis!: Line;
  private precessPeri!: Mesh;
  private precessLabel!: CSS2DObject;
  private precessM = 0; // mean anomaly
  private precessW = 0; // perihelion (apsidal) angle
  private readonly precessA = 8.5;
  private readonly precessE = 0.45;

  // Explosion burst when a rocket crashes into the planet.
  private boom!: Points;
  private boomPos!: Float32Array;
  private boomVel!: Float32Array;
  private readonly boomN = 90;
  private boomLife = 0; // 1 → 0 over the blast

  // "Sun moves" / helix demo: the whole system drifts along the ecliptic normal
  // while planets keep orbiting, so their real-space trails coil into helices.
  private helixOffset = 0;
  private helixSpeed = 3.8;            // scene units/s
  private readonly maxTrail = 1400;
  // Near-field stars that wrap around the moving system for a parallax sense
  // of travelling through space (only shown on the helix slides).
  private parallax!: Points;
  private parallaxPos!: Float32Array;
  private parallaxUx = 0.7071;       // motion axis (for wrapping the field)
  private parallaxUy = -0.7071;
  private readonly parallaxN = 800;
  private readonly parallaxH = 260; // half-extent along the motion axis

  // Accretion demo: a dust cloud that swirls inward and builds a body. The
  // motion is scripted (deterministic spiral-in) rather than free N-body —
  // stable, loopable, and always reads as "gravity pulling the cloud together".
  private dust!: Points;
  private dustPos!: Float32Array;
  private dustCol!: Float32Array;    // per-particle brightness (fade, 0..1)
  private dustR0!: Float32Array;     // each particle's initial radius
  private dustTheta!: Float32Array;  // current angle (advanced each frame)
  private dustH0!: Float32Array;     // initial height above the disk
  private dustOmega!: Float32Array;  // angular speed
  private readonly dustN = 1800;
  private accreteBody = 'sun';
  private accreteR = 30;             // initial cloud radius (scene units)
  private accreteFinalR = 3;         // display radius of the forming body
  private accT = 0;                  // 0..1 collapse phase
  private accDuration = 8;           // seconds for a full collapse
  private accreteHold = 0;
  private accreteProgress = 0;

  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private tmp3 = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.scale = getScale(this.state.scaleMode);

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05060a, 1);

    this.camera = new PerspectiveCamera(50, 1, 0.001, 100000);
    this.camera.position.set(0, 70, 130);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    document.body.appendChild(this.labelRenderer.domElement);

    // Attach to the WebGL canvas, NOT the label layer (which is pointer-events:
    // none, so it would never receive drags).
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableZoom = false; // no mouse-wheel zoom — framing is per-slide
    // Track the pointer for free-explore hover highlighting.
    const cv = this.renderer.domElement;
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      this.pointerNDC.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    cv.addEventListener('pointerleave', () => { this.pointerNDC.set(2, 2); });

    // Drag to rotate: suspend auto-framing while dragging; on release, ease
    // back to the slide's framing (during the tour) or stay put (free explore).
    this.controls.addEventListener('start', () => { this.userDragging = true; });
    this.controls.addEventListener('end', () => {
      this.userDragging = false;
      if (this.returnOnRelease && !this.followId && this.homeCamPos) {
        this.camPosGoal = this.homeCamPos.clone();
        this.camTargetGoal.copy(this.homeCamTarget);
      } else if (!this.returnOnRelease) {
        this.camPosGoal = null; // free explore: keep the user's new view
      }
    });

    this.buildLights();
    this.buildStarfield();
    this.buildBodies();
    this.buildMoons();
    this.buildVectors();
    this.buildDust();
    this.buildParallax();
    this.buildRocket();
    this.buildAstro();
    this.buildSpacetime();
    this.buildPrecession();
    this.buildNBody();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---- construction -------------------------------------------------------

  private buildLights(): void {
    const sunLight = new PointLight(0xfff2d0, 4, 0, 0.2);
    sunLight.position.set(0, 0, 0);
    this.scene.add(sunLight);
    this.scene.add(new AmbientLight(0x222a3a, 1.1));
  }

  /** Make the Sun's surface churn: warp the texture lookup with a time-varying
   *  ripple, and pulse the brightness a touch — so it boils rather than sits flat. */
  private animateSunSurface(mat: MeshBasicMaterial): void {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sunTime;
      shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 warpUv = vMapUv + 0.010 * vec2(
            sin(vMapUv.y * 26.0 + uTime * 1.2) + sin(vMapUv.x * 17.0 - uTime * 0.7),
            cos(vMapUv.x * 22.0 - uTime * 1.0) + sin(vMapUv.y * 13.0 + uTime * 0.5)
          );
          vec4 sampledDiffuseColor = texture2D( map, warpUv );
          float flicker = 1.0 + 0.06 * sin(uTime * 2.3 + vMapUv.x * 40.0);
          diffuseColor *= sampledDiffuseColor * flicker;
        #endif`,
      );
    };
    mat.needsUpdate = true;
  }

  private buildStarfield(): void {
    const N = 4000;
    const pos = new Float32Array(N * 3);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < N; i++) {
      const r = 4000 + rand() * 4000;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const mat = new PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0.8 });
    this.scene.add(new Points(geo, mat));
  }

  private makeLabel(text: string, cls: string): CSS2DObject {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    return new CSS2DObject(el);
  }

  private buildBodies(): void {
    for (const body of ALL_BODIES) {
      const isStar = body.id === 'sun';
      const r = this.scale.bodyRadius(body.radius, isStar);
      const geo = new SphereGeometry(1, isStar ? 64 : 48, isStar ? 64 : 48);
      const tex = surfaceTexture(body.id, body.color);
      const mat = isStar
        ? new MeshBasicMaterial({ map: tex })
        : new MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.015, roughness: 0.92, metalness: 0.0 });
      if (isStar) this.animateSunSurface(mat as MeshBasicMaterial);
      const mesh = new Mesh(geo, mat);
      mesh.scale.setScalar(r);
      // Apply the axial tilt *outside* the daily spin (rotation.y) so the pole
      // stays fixed in space — spinning rotates the surface around a stationary
      // tilted axis, not precessing it (which only happens over ~26,000 yr).
      mesh.rotation.order = 'ZYX';
      mesh.rotation.z = MathUtils.degToRad(body.axialTilt);
      mesh.userData.id = body.id; // for hover raycasting
      this.scene.add(mesh);

      if (isStar) {
        // Two faint additive shells -> a soft halo that fades outward, rather
        // than one flat disk.
        for (const [s, o] of [[1.35, 0.22], [1.7, 0.1]] as const) {
          const glow = new Mesh(
            new SphereGeometry(1, 32, 32),
            new MeshBasicMaterial({ color: 0xffcf66, transparent: true, opacity: o, blending: AdditiveBlending, side: BackSide, depthWrite: false }),
          );
          glow.scale.setScalar(s);
          mesh.add(glow);
        }
      }
      if (body.id === 'saturn') {
        const ringGeo = new RingGeometry(1.35, 2.35, 96, 1);
        // Remap UVs so u runs radially (inner→outer), letting the ring profile
        // texture paint concentric bands and the Cassini gap.
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        for (let k = 0; k < pos.count; k++) {
          const rr = Math.hypot(pos.getX(k), pos.getY(k));
          uv.setXY(k, (rr - 1.35) / (2.35 - 1.35), 0.5);
        }
        const ring = new Mesh(
          ringGeo,
          new MeshBasicMaterial({ map: ringTexture(), side: DoubleSide, transparent: true, opacity: 0.9 }),
        );
        ring.rotation.x = Math.PI / 2;
        mesh.add(ring);
      }

      let orbitAU: Vector3[] = [];
      let orbitLine: Line | null = null;
      if (body.orbit) {
        orbitAU = sampleOrbit(body.orbit, 600);
        const lgeo = new BufferGeometry();
        lgeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(orbitAU.length * 3), 3));
        orbitLine = new Line(lgeo, new LineBasicMaterial({ color: dim(body.color, 0.55), transparent: true, opacity: 0.6 }));
        this.scene.add(orbitLine);
      }

      const projGeo = new BufferGeometry();
      projGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
      const projLine = new Line(projGeo, new LineBasicMaterial({ color: 0x4a6a9a, transparent: true, opacity: 0.5 }));
      projLine.visible = false;
      this.scene.add(projLine);

      const projDot = new Mesh(new SphereGeometry(1, 12, 12), new MeshBasicMaterial({ color: dim(body.color, 0.7) }));
      projDot.visible = false;
      this.scene.add(projDot);

      const label = this.makeLabel(body.name, 'body-label');
      mesh.add(label);

      // Rotation axis (local Y) — invariant under spin, tilted by the body's
      // obliquity. Child of the mesh so it inherits tilt but not the spin.
      const axisGeo = new BufferGeometry();
      axisGeo.setAttribute('position', new Float32BufferAttribute([0, -1.85, 0, 0, 1.85, 0], 3));
      const axisLine = new Line(axisGeo, new LineBasicMaterial({ color: 0x8fb6ff, transparent: true, opacity: 0.85 }));
      axisLine.visible = false;
      mesh.add(axisLine);

      // Real-space trail (helix slide). World-space line, grown each frame.
      const trailGeo = new BufferGeometry();
      trailGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
      trailGeo.setDrawRange(0, 0);
      const trail = new Line(trailGeo, new LineBasicMaterial({
        color: isStar ? 0xffe08a : body.color, transparent: true, opacity: 0.8,
      }));
      trail.visible = false;
      trail.frustumCulled = false;
      this.scene.add(trail);

      // Per-body velocity (green) + gravity (red) arrows for the helix-vectors slide.
      const vArrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 6, 0x57e08a, 2.4, 1.4);
      const gArrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 6, 0xff5a5a, 2.4, 1.4);
      this.styleArrow(vArrow, 0x57e08a);
      this.styleArrow(gArrow, 0xff5a5a);
      vArrow.visible = false; gArrow.visible = false;
      this.scene.add(vArrow); this.scene.add(gArrow);

      this.views.push({ body, mesh, orbitAU, orbitLine, projLine, projDot, label, axisLine, trail, trailPts: [], vArrow, gArrow, spin: 0, opacity: 1, curAU: new Vector3(), curScene: new Vector3() });
    }
  }

  private buildMoons(): void {
    for (const planet of PLANETS) {
      if (!planet.moons?.length) continue;
      let minA = Infinity;
      for (const moon of planet.moons) minA = Math.min(minA, moon.aKm / AU_KM);
      this.minMoonA.set(planet.id, minA);

      for (const moon of planet.moons) {
        const mtex = surfaceTexture(moon.id, moon.color);
        const mesh = new Mesh(
          new SphereGeometry(1, 28, 28),
          new MeshStandardMaterial({ map: mtex, bumpMap: mtex, bumpScale: 0.01, roughness: 0.95 }),
        );
        this.scene.add(mesh);

        // Sample one full relative orbit (ecliptic AU about the planet).
        const mu = pairMu(planet, moon);
        const el = moonElements(moon);
        const period = (2 * Math.PI) / Math.sqrt(mu / Math.pow(el.a * 1.495978707e11, 3)) / DAY;
        const orbitRelAU: Vector3[] = [];
        const segs = 256;
        for (let k = 0; k <= segs; k++) {
          orbitRelAU.push(keplerPosition(el, (k / segs) * period, mu));
        }
        const lgeo = new BufferGeometry();
        lgeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(orbitRelAU.length * 3), 3));
        const orbitLine = new Line(lgeo, new LineBasicMaterial({ color: dim(moon.color, 0.6), transparent: true, opacity: 0.45 }));
        this.scene.add(orbitLine);

        const label = this.makeLabel(moon.name, 'moon-label');
        mesh.add(label);

        const trailGeo = new BufferGeometry();
        trailGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
        trailGeo.setDrawRange(0, 0);
        const trail = new Line(trailGeo, new LineBasicMaterial({ color: moon.color, transparent: true, opacity: 0.7 }));
        trail.visible = false;
        trail.frustumCulled = false;
        this.scene.add(trail);

        this.moonViews.push({ moon, parent: planet, mesh, orbitRelAU, orbitLine, label, trail, trailPts: [], spin: 0, opacity: 0 });
      }
    }
  }

  /**
   * Render an arrow as a semi-transparent fill with a solid stroked outline:
   * the cone head becomes translucent and gains a solid edge wireframe, while
   * the shaft stays a solid line. Reads as a clean outlined arrow.
   */
  private styleArrow(a: ArrowHelper, color: number): void {
    const coneMat = a.cone.material as MeshBasicMaterial;
    coneMat.transparent = true;
    coneMat.opacity = 0.28;
    coneMat.depthWrite = false;
    const edges = new LineSegments(new EdgesGeometry(a.cone.geometry), new LineBasicMaterial({ color }));
    a.cone.add(edges);
  }

  private buildVectors(): void {
    const mk = (color: number) => {
      const a = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 8, color, 2.6, 1.5);
      this.styleArrow(a, color);
      a.visible = false;
      this.scene.add(a);
      return a;
    };
    this.gravArrow = mk(0xff5a5a);     // red: gravity on Earth
    this.gravArrowSun = mk(0xff9a4a);  // orange: equal pull on the Sun
    this.velArrow = mk(0x57e08a);      // green: velocity

    const tg = new BufferGeometry();
    tg.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.tangentLine = new Line(tg, new LineDashedMaterial({
      color: 0x9ab4ff, dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 0.7,
    }));
    this.tangentLine.visible = false;
    this.scene.add(this.tangentLine);

    this.velLabel = this.makeLabel('', 'vec-label vel');
    this.gravLabel = this.makeLabel('', 'vec-label grav');
    this.velLabel.visible = false;
    this.gravLabel.visible = false;
    this.scene.add(this.velLabel);
    this.scene.add(this.gravLabel);

    // Orbit-intro: the closed orbit, drawn from the live 2-body state, fading in.
    const og = new BufferGeometry();
    og.setAttribute('position', new Float32BufferAttribute(new Float32Array(129 * 3), 3));
    this.orbitIntroLine = new Line(og, new LineBasicMaterial({ color: 0x6f86c9, transparent: true, opacity: 0 }));
    this.orbitIntroLine.visible = false;
    this.orbitIntroLine.frustumCulled = false;
    this.scene.add(this.orbitIntroLine);
  }

  /** Position the cosmic-velocity craft (rocket or satellite) + trail + label. */
  private updateRocket(): void {
    const on = this.state.demoMode === 'rocket';
    const craft = this.craftSatellite ? this.satelliteMesh : this.rocketMesh;
    this.rocketMesh.visible = on && !this.craftSatellite;
    this.satelliteMesh.visible = on && this.craftSatellite;
    this.rocketTrail.visible = on;
    this.rocketLabel.visible = on && this.state.showLabels;
    if (!on) return;
    const rc = this.rocketCenter; // shared render offset so the craft tracks the gliding body
    craft.position.copy(this.orbitPos).add(rc);
    // Point the craft along its direction of travel.
    if (this.orbitVel.lengthSq() > 1e-6) {
      this.tmp.copy(this.orbitVel).normalize();
      craft.quaternion.setFromUnitVectors(UP_Y, this.tmp);
    }
    this.rocketLabel.position.copy(craft.position);
    (this.rocketLabel.element as HTMLElement).textContent = this.rocketLabelText;
    this.rocketTrailPts.push(this.orbitPos.clone()); // stored origin-frame; offset on write
    if (this.rocketTrailPts.length > this.maxTrail) this.rocketTrailPts.shift();
    const arr = (this.rocketTrail.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    for (let k = 0; k < this.rocketTrailPts.length; k++) {
      const p = this.rocketTrailPts[k];
      arr[k * 3] = p.x + rc.x; arr[k * 3 + 1] = p.y + rc.y; arr[k * 3 + 2] = p.z + rc.z;
    }
    this.rocketTrail.geometry.setDrawRange(0, this.rocketTrailPts.length);
    (this.rocketTrail.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
  }

  /** Draw the osculating orbit ellipse (Earth around the Sun) for orbit-intro. */
  private updateOrbitIntroLine(fade: number): void {
    if (this.state.demoMode !== 'orbit-intro' || fade <= 0.01) {
      this.orbitIntroLine.visible = false;
      return;
    }
    const rx = this.orbitPos.x - this.orbitSunPos.x, rz = this.orbitPos.z - this.orbitSunPos.z;
    const vx = this.orbitVel.x, vz = this.orbitVel.z;
    const rmag = Math.hypot(rx, rz) + 1e-6;
    const v2 = vx * vx + vz * vz;
    const mu = this.orbitK;
    const invA = 2 / rmag - v2 / mu;
    if (invA <= 1e-4) { this.orbitIntroLine.visible = false; return; } // not bound
    const a = 1 / invA;
    const rdotv = rx * vx + rz * vz;
    const ex = ((v2 - mu / rmag) * rx - rdotv * vx) / mu;
    const ez = ((v2 - mu / rmag) * rz - rdotv * vz) / mu;
    const e = Math.hypot(ex, ez);
    const b = a * Math.sqrt(Math.max(0, 1 - e * e));
    const ang = e > 1e-5 ? Math.atan2(ez, ex) : 0; // periapsis direction
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const wx = -Math.sin(ang), wz = Math.cos(ang);
    const cx = this.orbitSunPos.x - a * ex, cz = this.orbitSunPos.z - a * ez; // center
    const arr = (this.orbitIntroLine.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    for (let k = 0; k <= 128; k++) {
      const th = (k / 128) * Math.PI * 2;
      const ca = Math.cos(th) * a, sb = Math.sin(th) * b;
      arr[k * 3] = cx + ca * ux + sb * wx;
      arr[k * 3 + 1] = 0;
      arr[k * 3 + 2] = cz + ca * uz + sb * wz;
    }
    (this.orbitIntroLine.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (this.orbitIntroLine.material as LineBasicMaterial).opacity = 0.55 * fade;
    this.orbitIntroLine.visible = true;
  }

  private buildDust(): void {
    this.dustPos = new Float32Array(this.dustN * 3);
    this.dustCol = new Float32Array(this.dustN * 3).fill(1);
    this.dustR0 = new Float32Array(this.dustN);
    this.dustTheta = new Float32Array(this.dustN);
    this.dustH0 = new Float32Array(this.dustN);
    this.dustOmega = new Float32Array(this.dustN);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.dustPos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(this.dustCol, 3));
    // Float32BufferAttribute copies its source array, so point our arrays at
    // the geometry's own buffers — otherwise we'd animate detached copies.
    this.dustPos = (geo.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    this.dustCol = (geo.getAttribute('color') as Float32BufferAttribute).array as Float32Array;
    this.dust = new Points(geo, new PointsMaterial({
      // hue from material.color; per-particle brightness (fade) from vertex
      // colors — with additive blending, a particle that fades to 0 is gone.
      color: 0xcdb89a, vertexColors: true, size: 0.5, sizeAttenuation: true,
      transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false,
    }));
    this.dust.visible = false;
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  private buildParallax(): void {
    this.parallaxPos = new Float32Array(this.parallaxN * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.parallaxPos, 3));
    this.parallaxPos = (geo.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    this.parallax = new Points(geo, new PointsMaterial({
      color: 0xaec4e8, size: 0.7, sizeAttenuation: true, transparent: true,
      opacity: 0.85, blending: AdditiveBlending, depthWrite: false,
    }));
    this.parallax.visible = false;
    this.parallax.frustumCulled = false;
    this.scene.add(this.parallax);
    this.seedParallax(this.parallaxUx, this.parallaxUy);
  }

  /** Distribute the parallax stars in a tube around motion axis (ux,uy,0). */
  private seedParallax(ux: number, uy: number): void {
    this.parallaxUx = ux;
    this.parallaxUy = uy;
    const e1x = -uy, e1y = ux; // in-plane perpendicular; e2 = +Z
    let seed = 4242;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < this.parallaxN; i++) {
      const a = (rnd() * 2 - 1) * this.parallaxH;
      const ang = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 300;
      this.parallaxPos[i * 3] = ux * a + e1x * Math.cos(ang) * r;
      this.parallaxPos[i * 3 + 1] = uy * a + e1y * Math.cos(ang) * r;
      this.parallaxPos[i * 3 + 2] = Math.sin(ang) * r;
    }
    (this.parallax.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
  }

  /** Wrap the parallax stars around the moving body along the motion axis. */
  private updateParallax(centerX: number, centerY: number): void {
    const ux = this.parallaxUx, uy = this.parallaxUy, H = this.parallaxH, span = 2 * H;
    const p = this.parallaxPos;
    for (let i = 0; i < this.parallaxN; i++) {
      const dx = p[i * 3] - centerX, dy = p[i * 3 + 1] - centerY;
      const d = dx * ux + dy * uy;
      if (d > H) { p[i * 3] -= ux * span; p[i * 3 + 1] -= uy * span; }
      else if (d < -H) { p[i * 3] += ux * span; p[i * 3 + 1] += uy * span; }
    }
    (this.parallax.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
  }

  /** Begin the dust→body accretion animation for the given body id. */
  startAccretion(bodyId: string): void {
    this.state.demoMode = 'accretion';
    this.accreteBody = bodyId;
    const sun = bodyId === 'sun';
    this.accreteR = sun ? 34 : 24;
    this.accreteFinalR = sun ? 3.6 : 2.4; // exaggerated for visibility (the
    // birth animation is conceptual, not to scale)
    // Warm orange for the Sun; cool steel-blue for Earth so the two birth
    // slides read as clearly different scenes.
    (this.dust.material as PointsMaterial).color.setHex(sun ? 0xffc070 : 0x8fb4dc);
    this.seedDust();
    this.dust.visible = true;
    // Snap visibility (no cross-fade) so a previously-formed body — e.g. the
    // Sun when moving on to build the Earth — doesn't linger and fade out.
    for (const v of this.views) v.opacity = v.body.id === bodyId ? 1 : 0;
    for (const mv of this.moonViews) mv.opacity = 0;
    // View the collapsing disk from a tilted 3/4 angle.
    const R = this.accreteR;
    this.flyTo(new Vector3(0, R * 1.0, R * 1.5), new Vector3(0, R * 0.04, 0));
  }

  private seedDust(): void {
    const R = this.accreteR;
    let seed = 9173;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < this.dustN; i++) {
      const r0 = R * (0.22 + 0.78 * Math.sqrt(rnd()));
      this.dustR0[i] = r0;
      this.dustTheta[i] = rnd() * Math.PI * 2;
      this.dustH0[i] = (rnd() - 0.5) * R * 0.18 * (r0 / R); // thicker outside, flat inside
      this.dustOmega[i] = 0.5 + 0.6 * rnd();
    }
    this.accT = 0;
    this.accreteHold = 0;
    this.accreteProgress = 0;
    this.writeDust();
  }

  /**
   * Position the dust for the current phase, advance the swirl, fade absorbed
   * particles, and recompute how much has reached the center. `accreteProgress`
   * is the fraction of particles that have arrived — so the central body only
   * begins to grow once the first particles reach the middle, not before.
   */
  private writeDust(dtReal = 0): void {
    const R = this.accreteR;
    const p = this.dustPos;
    const c = this.dustCol;
    const tt = this.accT < 0 ? 0 : this.accT > 1 ? 1 : this.accT;
    const bodyR = this.accreteFinalR * (0.02 + 0.98 * smoothstep(this.accreteProgress));
    const fadeInner = bodyR * 0.8;
    const fadeOuter = bodyR * 2.2 + 0.6;
    const coreZone = R * 0.07; // a particle counts as "arrived" inside this
    let arrived = 0;
    for (let i = 0; i < this.dustN; i++) {
      const r0 = this.dustR0[i];
      // Each particle reaches the center at a staggered time (inner first,
      // outer last) over a falling window, so arrivals spread out smoothly.
      const arrival = 0.22 + 0.7 * (r0 / R);
      const delay = Math.max(0, arrival - 0.55); // fall window, never before t=0
      const local = clamp01((tt - delay) / (arrival - delay));
      const shrink = local * local; // accelerating infall
      const r = r0 * (1 - shrink);
      const h = this.dustH0[i] * (1 - shrink);
      this.dustTheta[i] += this.dustOmega[i] * dtReal * (7 / (r + 2)); // swirl
      const th = this.dustTheta[i];
      p[i * 3] = Math.cos(th) * r;
      p[i * 3 + 1] = h;
      p[i * 3 + 2] = Math.sin(th) * r;
      const fade = clamp01((r - fadeInner) / (fadeOuter - fadeInner));
      c[i * 3] = fade; c[i * 3 + 1] = fade; c[i * 3 + 2] = fade;
      if (r < coreZone) arrived++;
    }
    this.accreteProgress = arrived / this.dustN;
    (this.dust.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (this.dust.geometry.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
  }

  /** Advance the scripted collapse one frame; returns the body-growth factor. */
  private stepAccretion(dtReal: number): number {
    this.accT += dtReal / this.accDuration;
    this.writeDust(dtReal);
    if (this.accT >= 1) {
      this.accreteHold += dtReal;
      if (this.accreteHold > 1.6) this.seedDust(); // loop
    }
    return smoothstep(this.accreteProgress);
  }

  /** (Re)build the N-body integrator and seed it from the current sim time. */
  private buildNBody(): void {
    this.simBodies = buildSimBodies(this.state.showMoons);
    this.simIndexByPlanet.clear();
    this.simBodies.forEach((d, i) => {
      if (d.kind !== 'moon') this.simIndexByPlanet.set(d.id, i);
    });
    this.nbody = new NBody(this.simBodies.map((d) => d.mass));
    this.seedNBody();
  }

  private seedNBody(): void {
    const pos: Vector3[] = [];
    const vel: Vector3[] = [];
    for (const d of this.simBodies) {
      const s = descriptorState(d, this.simDays);
      pos.push(s.pos);
      vel.push(s.vel);
    }
    this.nbody.seed(pos, vel);
    this.energy0 = this.nbody.totalEnergy();
  }

  // ---- public controls ----------------------------------------------------

  setScaleMode(mode: ScaleMode): void {
    this.state.scaleMode = mode;
    this.scale = getScale(mode);
    for (const v of this.views) {
      v.mesh.scale.setScalar(this.scale.bodyRadius(v.body.radius, v.body.id === 'sun'));
      // Clear any leftover molten glow / self-illumination from an accretion step.
      const m = v.mesh.material as MeshStandardMaterial;
      if (m.emissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 1;
        if (m.emissiveMap) { m.emissiveMap = null; m.needsUpdate = true; }
      }
    }
    for (const mv of this.moonViews) {
      mv.mesh.scale.setScalar(this.scale.bodyRadius(mv.moon.radius, false));
    }
    this.rebuildOrbits();
  }

  setPhysics(mode: PhysicsMode): void {
    this.state.physics = mode;
    if (mode === 'nbody') this.seedNBody();
  }

  setShowMoons(on: boolean): void {
    this.state.showMoons = on;
    // Moon gravity changes the N-body body set, so rebuild it.
    this.buildNBody();
  }

  setTwoD(on: boolean): void {
    this.state.twoD = on ? 1 : 0;
  }

  setDemo(mode: DemoMode): void {
    if (mode !== 'accretion' && this.dust) this.dust.visible = false;
    if (mode !== 'helix') {
      for (const v of this.views) { v.trail.visible = false; v.trailPts.length = 0; }
    }
    if (mode !== 'helix' && mode !== 'inertia' && this.parallax) this.parallax.visible = false;
    if (mode !== 'helix') this.helixOffset = 0;
    this.state.demoMode = mode;
  }

  /** Inertia demo: Earth drifts straight ahead through a parallax starfield,
   *  the camera riding along so the motion reads as streaming background. */
  startInertia(): void {
    this.state.demoMode = 'inertia';
    this.inertiaX = 0;
    if (this.dust) this.dust.visible = false; // clear any accretion debris
    this.seedParallax(1, 0); // motion along +X
    this.parallax.visible = true;
    this.followBody('earth', 18, 0); // raise 0 → Earth dead-center, even while rotating
  }

  /** Step 5: continue the drifting Earth, then bend it into an orbit as gravity
   *  (the Sun) and the vectors fade in. A small fixed-Sun 2-body sim. */
  /**
   * Step 5 + escape-velocity slides. `speedFactor` scales the Earth's sideways
   * speed relative to the circular value: 1 = stable orbit (with the
   * straight→curve intro), <1 = too slow (plunges toward the Sun), >√2 = too
   * fast (escapes). Off-nominal speeds turn gravity on instantly for a clean conic.
   */
  startOrbitIntro(speedFactor = 1): void {
    const earth = this.views.find((v) => v.body.id === 'earth');
    this.state.demoMode = 'orbit-intro';
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    const vBase = 7, R = 16;
    this.orbitVBase = vBase; this.orbitR = R;
    // Continue from the Earth's current position, moving +X.
    this.orbitPos.set(earth ? earth.curScene.x : 0, 0, earth ? earth.curScene.z : 0);
    this.orbitVel.set(vBase * speedFactor, 0, 0);
    this.orbitSunPos.copy(this.orbitPos).add(new Vector3(0, 0, R)); // Sun ⟂ to velocity
    this.orbitK = vBase * vBase * R; // circular speed = vBase at R
    this.orbitGrav = speedFactor === 1 ? 0 : 1; // ramp for the stable orbit; instant otherwise
    this.vecFade = 0;
    this.orbitInitPos.copy(this.orbitPos);
    this.orbitInitVel.copy(this.orbitVel);
    if (earth) earth.trailPts.length = 0; // fresh path
    // Frame the forthcoming orbit (overhead, Sun centered).
    this.flyTo(new Vector3(this.orbitSunPos.x, 46, this.orbitSunPos.z + 0.001), this.orbitSunPos.clone());
  }

  private buildRocket(): void {
    // A simple rocket: white body + red nose cone + fins, pointing along +Y.
    const rocket = new Group();
    const body = new Mesh(new CylinderGeometry(0.16, 0.16, 0.6, 14), new MeshBasicMaterial({ color: 0xeef2f8 }));
    const nose = new Mesh(new ConeGeometry(0.16, 0.32, 14), new MeshBasicMaterial({ color: 0xff5a5a }));
    nose.position.y = 0.46;
    const finMat = new MeshBasicMaterial({ color: 0xc0c8d4 });
    for (let i = 0; i < 3; i++) {
      const fin = new Mesh(new ConeGeometry(0.1, 0.22, 4), finMat);
      const a = (i / 3) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.18, -0.32, Math.sin(a) * 0.18);
      fin.rotation.x = Math.PI; // point down
      rocket.add(fin);
    }
    rocket.add(body, nose);
    rocket.scale.setScalar(1.1);
    this.rocketMesh = rocket;
    this.rocketMesh.visible = false;
    this.scene.add(this.rocketMesh);

    // A simple satellite: a boxy bus + two solar-panel wings + a dish, shown on
    // the orbit step (a craft that circles, rather than one that launches).
    const sat = new Group();
    const bus = new Mesh(new BoxGeometry(0.34, 0.3, 0.34), new MeshBasicMaterial({ color: 0xd9dee6 }));
    const panelMat = new MeshBasicMaterial({ color: 0x2b6cff, side: DoubleSide });
    for (const sx of [-1, 1]) {
      const panel = new Mesh(new BoxGeometry(0.62, 0.01, 0.26), panelMat);
      panel.position.x = sx * 0.52;
      sat.add(panel);
      const arm = new Mesh(new CylinderGeometry(0.015, 0.015, 0.4, 8), new MeshBasicMaterial({ color: 0x9aa3b0 }));
      arm.rotation.z = Math.PI / 2;
      arm.position.x = sx * 0.27;
      sat.add(arm);
    }
    const dish = new Mesh(new CylinderGeometry(0.13, 0.13, 0.04, 16), new MeshBasicMaterial({ color: 0xeef2f8 }));
    dish.rotation.x = Math.PI / 2;
    dish.position.z = 0.2;
    sat.add(bus, dish);
    sat.scale.setScalar(1.1);
    this.satelliteMesh = sat;
    this.satelliteMesh.visible = false;
    this.scene.add(this.satelliteMesh);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
    tg.setDrawRange(0, 0);
    this.rocketTrail = new Line(tg, new LineBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.8 }));
    this.rocketTrail.visible = false;
    this.rocketTrail.frustumCulled = false;
    this.scene.add(this.rocketTrail);
    this.rocketLabel = this.makeLabel('', 'vec-label vel');
    this.rocketLabel.visible = false;
    this.scene.add(this.rocketLabel);

    // Explosion sparks (shown briefly when a rocket crashes).
    this.boomPos = new Float32Array(this.boomN * 3);
    this.boomVel = new Float32Array(this.boomN * 3);
    const bg = new BufferGeometry();
    bg.setAttribute('position', new Float32BufferAttribute(this.boomPos, 3));
    this.boomPos = (bg.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    this.boom = new Points(bg, new PointsMaterial({
      color: 0xffa53a, size: 0.45, sizeAttenuation: true, transparent: true,
      opacity: 1, blending: AdditiveBlending, depthWrite: false,
    }));
    this.boom.visible = false;
    this.boom.frustumCulled = false;
    this.scene.add(this.boom);
  }

  /** Replace a line's geometry with a smooth Catmull-Rom curve through pts. */
  private setCurveLine(line: Line, pts: Vector3[]): void {
    const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    line.geometry.dispose();
    line.geometry = new BufferGeometry().setFromPoints(curve.getPoints(240));
  }

  private smallMoon(r: number): Mesh {
    const m = new Mesh(
      new SphereGeometry(r, 28, 28),
      new MeshStandardMaterial({ color: 0xc2c6cc, emissive: 0x6b7078, emissiveIntensity: 0.5, roughness: 1 }),
    );
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  /** A simple Voyager-style probe: a dish antenna on a bus with an instrument
   *  boom. Built around +Y so spinning about Y sweeps the boom round. */
  private buildProbeShape(color: number): Group {
    const g = new Group();
    const dish = new Mesh(
      new ConeGeometry(0.5, 0.22, 22, 1, true),
      new MeshBasicMaterial({ color, side: DoubleSide }),
    );
    dish.position.y = 0.22; // bowl opening upward
    const bus = new Mesh(new BoxGeometry(0.26, 0.2, 0.26), new MeshBasicMaterial({ color: 0xc8ccd4 }));
    const boom = new Mesh(new CylinderGeometry(0.03, 0.03, 0.95, 8), new MeshBasicMaterial({ color: 0x9aa3b0 }));
    boom.rotation.z = Math.PI / 2; boom.position.x = 0.48; // RTG boom out one side
    const tip = new Mesh(new BoxGeometry(0.12, 0.12, 0.12), new MeshBasicMaterial({ color }));
    tip.position.x = 0.95;
    g.add(dish, bus, boom, tip);
    g.scale.setScalar(1.5);
    g.visible = false; g.frustumCulled = false;
    this.scene.add(g);
    return g;
  }

  /** A faint translucent sphere + wireframe shell (a sphere of influence). */
  private buildSoiSphere(r: number, color: number): Mesh {
    const s = new Mesh(
      new SphereGeometry(r, 32, 24),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.045, side: DoubleSide, depthWrite: false }),
    );
    s.add(new LineSegments(
      new WireframeGeometry(new SphereGeometry(r, 20, 14)),
      new LineBasicMaterial({ color, transparent: true, opacity: 0.13 }),
    ));
    s.visible = false; s.frustumCulled = false;
    this.scene.add(s);
    return s;
  }

  /** Build the astrodynamics overlays (nested spheres of influence; Voyager paths). */
  private buildAstro(): void {
    // Spheres of influence: nested domains — the Sun's (vast), Earth's (on its
    // orbit, inside the Sun's), and the Moon's (tiny, inside Earth's). Sizes are
    // exaggerated for visibility but keep the nesting order.
    this.soiSunSphere = this.buildSoiSphere(22, 0xffcf66);
    this.soiEarthSphere = this.buildSoiSphere(4.2, 0x4aa3ff);
    this.soiMoonSphere = this.buildSoiSphere(1.2, 0xbfeaff);
    this.soiMoon = this.smallMoon(0.32);
    this.soiSunLabel = this.makeLabel('Sun’s sphere of influence', 'vec-label');
    this.soiEarthLabel = this.makeLabel('Earth’s SOI', 'vec-label');
    this.soiMoonLabel = this.makeLabel('Moon’s SOI', 'vec-label');
    for (const l of [this.soiSunLabel, this.soiEarthLabel, this.soiMoonLabel]) { l.visible = false; this.scene.add(l); }

    // Gravity-assist: Voyager 1 & 2. The path lines are rebuilt in scene units at
    // slide start (so they sit on the real orbit rings); here we just make the
    // craft markers + labels and empty lines.
    for (const [i, name] of ['Voyager 1', 'Voyager 2'].entries()) {
      const color = i === 0 ? 0xffcf66 : 0x6fe0ff;
      const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      line.frustumCulled = false; line.visible = false; this.scene.add(line);
      this.voyagerLines.push(line);
      this.voyagerCraft.push(this.buildProbeShape(color));
      const lab = this.makeLabel(name, 'vec-label');
      lab.visible = false; this.scene.add(lab);
      this.voyagerLabels.push(lab);
    }
  }

  /** Depth of the spacetime "well" a distance r from the central mass. */
  private spacetimeWell(r: number): number {
    const depth = 13, r0 = 4.2;
    return -depth / (1 + (r / r0) * (r / r0));
  }

  /** Build the spacetime-curvature overlay: a warped grid + central mass + a
   *  body that rolls around the well (Einstein's view of gravity). */
  private buildSpacetime(): void {
    const grid = new Group();
    const ext = 24, stepG = 2.4, seg = 64;
    const mat = new LineBasicMaterial({ color: 0x49d6c4, transparent: true, opacity: 0.5 });
    const lineAlong = (fixed: number, axis: 'x' | 'z') => {
      const pts: Vector3[] = [];
      for (let j = 0; j <= seg; j++) {
        const v = -ext + (2 * ext) * (j / seg);
        const x = axis === 'x' ? v : fixed, z = axis === 'x' ? fixed : v;
        pts.push(new Vector3(x, this.spacetimeWell(Math.hypot(x, z)), z));
      }
      grid.add(new Line(new BufferGeometry().setFromPoints(pts), mat));
    };
    for (let g = -ext; g <= ext + 0.01; g += stepG) { lineAlong(g, 'x'); lineAlong(g, 'z'); }
    grid.visible = false; this.scene.add(grid);
    this.spacetimeGrid = grid;

    this.spacetimeStar = new Mesh(
      new SphereGeometry(2.6, 32, 32),
      new MeshStandardMaterial({ color: 0xffb056, emissive: 0xff7b22, emissiveIntensity: 0.85, roughness: 1 }),
    );
    this.spacetimeStar.position.set(0, this.spacetimeWell(0) + 1.7, 0);
    this.spacetimeStar.visible = false; this.scene.add(this.spacetimeStar);

    this.spacetimeOrbiter = new Mesh(
      new SphereGeometry(0.7, 24, 24),
      new MeshStandardMaterial({ color: 0x9fc6ff, emissive: 0x2b5d8c, emissiveIntensity: 0.7, roughness: 1 }),
    );
    this.spacetimeOrbiter.visible = false; this.scene.add(this.spacetimeOrbiter);
  }

  /** Build the Mercury perihelion-precession overlay: a planet, its rosette
   *  trail, and a rotating apsidal line marking the precessing perihelion. */
  private buildPrecession(): void {
    this.precessMercury = new Mesh(
      new SphereGeometry(0.5, 24, 24),
      new MeshStandardMaterial({ color: 0xc7b29a, emissive: 0x6b5a45, emissiveIntensity: 0.6, roughness: 1 }),
    );
    this.precessMercury.visible = false; this.precessMercury.frustumCulled = false;
    this.scene.add(this.precessMercury);

    const tg = new BufferGeometry();
    tg.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
    tg.setDrawRange(0, 0);
    this.precessTrail = new Line(tg, new LineBasicMaterial({ color: 0xc79a5a, transparent: true, opacity: 0.7 }));
    this.precessTrail.visible = false; this.precessTrail.frustumCulled = false;
    this.scene.add(this.precessTrail);

    const ag = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
    this.precessApsis = new Line(ag, new LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.7 }));
    this.precessApsis.visible = false; this.precessApsis.frustumCulled = false;
    this.scene.add(this.precessApsis);

    this.precessPeri = new Mesh(new SphereGeometry(0.28, 16, 16), new MeshBasicMaterial({ color: 0x9fb4ff }));
    this.precessPeri.visible = false; this.precessPeri.frustumCulled = false;
    this.scene.add(this.precessPeri);

    this.precessLabel = this.makeLabel('Mercury', 'vec-label');
    this.precessLabel.visible = false; this.scene.add(this.precessLabel);
  }

  /** Read a point along a built trajectory Line from its vertex buffer (t 0..1).
   *  Linearly interpolates between vertices so a marker moves smoothly each
   *  frame rather than snapping from one vertex to the next. */
  private sampleLine(line: Line, t: number, out: Vector3): void {
    const arr = (line.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
    const n = arr.length / 3;
    const f = Math.max(0, Math.min(n - 1, t * (n - 1)));
    const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), k = f - i0;
    out.set(
      arr[i0 * 3] + (arr[i1 * 3] - arr[i0 * 3]) * k,
      arr[i0 * 3 + 1] + (arr[i1 * 3 + 1] - arr[i0 * 3 + 1]) * k,
      arr[i0 * 3 + 2] + (arr[i1 * 3 + 2] - arr[i0 * 3 + 2]) * k,
    );
  }

  /** Position + show the astrodynamics overlays for the current demo mode. */
  private updateAstro(dtReal: number): void {
    const mode = this.state.demoMode;
    const showLabels = this.state.showLabels;

    // Nested spheres of influence: Sun ⊃ Earth ⊃ Moon. Each body rules inside
    // its own sphere; the Moon's nests within Earth's, which nests in the Sun's.
    const soiOn = mode === 'soi';
    this.soiSunSphere.visible = soiOn;
    this.soiEarthSphere.visible = soiOn;
    this.soiMoonSphere.visible = soiOn;
    this.soiMoon.visible = soiOn;
    this.soiSunLabel.visible = soiOn && showLabels;
    this.soiEarthLabel.visible = soiOn && showLabels;
    this.soiMoonLabel.visible = soiOn && showLabels;
    if (soiOn) {
      if (!this.state.paused) this.soiMoonAngle += dtReal * 0.6;
      const E = this.soiEarthPos;
      this.soiEarthSphere.position.copy(E);
      const mr = 2.4; // Moon orbits Earth inside Earth's sphere
      this.soiMoon.position.set(E.x + Math.cos(this.soiMoonAngle) * mr, 0, E.z + Math.sin(this.soiMoonAngle) * mr);
      this.soiMoonSphere.position.copy(this.soiMoon.position);
      this.soiSunLabel.position.set(0, 0, 22);
      this.soiEarthLabel.position.set(E.x, 0, E.z + 4.2);
      this.soiMoonLabel.position.copy(this.soiMoon.position);
    }

    // Gravity-assist (one Voyager per slide): the probe rides its path, timed to
    // the mission clock so it reaches each planet exactly on the flyby date. The
    // label carries a running date, like the Wikipedia animations.
    const flybyOn = mode === 'flyby';
    for (let i = 0; i < this.voyagerLines.length; i++) {
      const on = flybyOn && i === this.flybyIdx;
      this.voyagerLines[i].visible = on;
      this.voyagerCraft[i].visible = on;
      this.voyagerLabels[i].visible = on && showLabels;
    }
    if (flybyOn) {
      const i = this.flybyIdx;
      const t = this.flybyPathT();
      this.sampleLine(this.voyagerLines[i], t, this.tmp);
      this.voyagerCraft[i].position.copy(this.tmp);
      if (!this.state.paused) this.voyagerCraft[i].rotation.y += dtReal * 1.6; // spin in flight
      this.voyagerLabels[i].position.copy(this.tmp);
      const name = i === 0 ? 'Voyager 1' : 'Voyager 2';
      (this.voyagerLabels[i].element as HTMLElement).textContent = `${name} · ${fmtMissionDate(this.flybyDays)}`;
    }

    // Spacetime curvature (Einstein): a body rolls around the well in the grid.
    const stOn = mode === 'spacetime';
    this.spacetimeGrid.visible = stOn;
    this.spacetimeStar.visible = stOn;
    this.spacetimeOrbiter.visible = stOn;
    if (stOn) {
      if (!this.state.paused) this.spacetimeAngle += dtReal * 0.7;
      const r = 9;
      this.spacetimeOrbiter.position.set(
        Math.cos(this.spacetimeAngle) * r,
        this.spacetimeWell(r) + 0.6,
        Math.sin(this.spacetimeAngle) * r,
      );
    }

    // Mercury precession: an eccentric orbit (Kepler motion) whose apsidal line
    // slowly rotates, so the planet traces a rosette — the GR perihelion shift,
    // exaggerated to be visible.
    const prOn = mode === 'precession';
    this.precessMercury.visible = prOn;
    this.precessTrail.visible = prOn;
    this.precessApsis.visible = prOn;
    this.precessPeri.visible = prOn;
    this.precessLabel.visible = prOn && this.state.showLabels;
    if (prOn) {
      if (!this.state.paused) {
        this.precessM += dtReal * 2.0;   // orbital motion (~3s/orbit)
        this.precessW += dtReal * 0.22;  // exaggerated perihelion precession
      }
      const a = this.precessA, e = this.precessE, b = a * Math.sqrt(1 - e * e);
      let E = this.precessM;
      for (let i = 0; i < 5; i++) E -= (E - e * Math.sin(E) - this.precessM) / (1 - e * Math.cos(E));
      const ox = a * (Math.cos(E) - e), oy = b * Math.sin(E);
      const cw = Math.cos(this.precessW), sw = Math.sin(this.precessW);
      this.precessMercury.position.set(ox * cw - oy * sw, 0, ox * sw + oy * cw);
      this.precessLabel.position.copy(this.precessMercury.position);
      // Trail rosette.
      this.precessTrailPts.push(this.precessMercury.position.clone());
      if (this.precessTrailPts.length > this.maxTrail) this.precessTrailPts.shift();
      const tarr = (this.precessTrail.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      for (let k = 0; k < this.precessTrailPts.length; k++) {
        const p = this.precessTrailPts[k];
        tarr[k * 3] = p.x; tarr[k * 3 + 1] = p.y; tarr[k * 3 + 2] = p.z;
      }
      this.precessTrail.geometry.setDrawRange(0, this.precessTrailPts.length);
      (this.precessTrail.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      // Apsidal line (major axis) + perihelion marker, both rotated by W.
      const peri = a * (1 - e), apo = -a * (1 + e);
      const aarr = (this.precessApsis.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      aarr[0] = peri * cw; aarr[1] = 0; aarr[2] = peri * sw;
      aarr[3] = apo * cw; aarr[4] = 0; aarr[5] = apo * sw;
      (this.precessApsis.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      this.precessPeri.position.set(peri * cw, 0, peri * sw);
    }
  }

  /** Map the current mission day to a 0..1 parameter along the probe's path,
   *  so it arrives at each keyframe (planet) exactly on its flyby date. */
  private flybyPathT(): number {
    const d = this.flybyKeyDays;
    const K = d.length;
    if (this.flybyDays <= d[0]) return 0;
    for (let k = 0; k < K - 1; k++) {
      if (this.flybyDays < d[k + 1]) {
        const u = (this.flybyDays - d[k]) / (d[k + 1] - d[k]);
        return (k + u) / (K - 1);
      }
    }
    return 1;
  }

  /** Kick off an explosion burst at a point (rocket crash). */
  private triggerBoom(x: number, y: number, z: number): void {
    let seed = 7321;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < this.boomN; i++) {
      this.boomPos[i * 3] = x; this.boomPos[i * 3 + 1] = y; this.boomPos[i * 3 + 2] = z;
      const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), sp = 4 + rnd() * 9;
      this.boomVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.boomVel[i * 3 + 1] = Math.cos(ph) * sp;
      this.boomVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
    }
    this.boomLife = 1;
    this.boom.visible = true;
    (this.boom.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
  }

  private updateBoom(dtReal: number): void {
    if (this.boomLife <= 0) return;
    this.boomLife -= dtReal / 0.9; // ~0.9s blast
    if (this.boomLife <= 0) { this.boom.visible = false; return; }
    const p = this.boomPos, v = this.boomVel;
    for (let i = 0; i < this.boomN; i++) {
      v[i * 3] *= 0.94; v[i * 3 + 1] *= 0.94; v[i * 3 + 2] *= 0.94;
      p[i * 3] += v[i * 3] * dtReal;
      p[i * 3 + 1] += v[i * 3 + 1] * dtReal;
      p[i * 3 + 2] += v[i * 3 + 2] * dtReal;
    }
    (this.boom.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (this.boom.material as PointsMaterial).opacity = this.boomLife;
  }

  /** Reset the craft's trail, seeding its first point at the launch body's
   *  surface so the path visibly starts from the surface. (No seed for the
   *  Sun-attractor case, where the probe launches from a wide orbit.) */
  private seedRocketTrail(): void {
    this.rocketTrailPts.length = 0;
    if (this.rocketAttractorR > 0) this.rocketTrailPts.push(new Vector3(this.rocketAttractorR, 0, 0));
  }

  /**
   * Cosmic-velocity demo: launch a probe from a central body. speedFactor 1 =
   * circular orbit (1st cosmic), √2 = escape (2nd from Earth / 3rd from Sun).
   */
  startRocket(attractorId: string, R: number, vBase: number, speedFactor: number, label: string, lob = 0, satellite = false): void {
    const wasRocket = this.state.demoMode === 'rocket';
    this.state.demoMode = 'rocket';
    this.craftSatellite = satellite;
    this.rocketAttractor = attractorId;
    // Earth is exaggerated (and self-lit, in the loop) so it's clearly visible
    // with the rocket launching just off its surface; the Sun stays normal.
    this.rocketAttractorR = attractorId === 'earth' ? 3.5 : 0;
    // Arriving from another demo (e.g. the Sun-centered "Earth escapes" step),
    // carry the *same* Earth in: start it small, dark, and at its previous
    // on-screen position, then let the loop glide it to center while it grows
    // and lights up — so it reads as one continuous Earth, not a new model.
    if (!wasRocket) {
      const ev = this.views.find((v) => v.body.id === attractorId);
      this.rocketEarthScale = ev ? ev.mesh.scale.x : 1;
      this.rocketCenter.copy(ev ? ev.curScene : ZERO);
      if (this.rocketCenter.length() > 26) this.rocketCenter.setLength(26); // bound the glide
      this.rocketEmissive = 0;
    } else {
      this.rocketCenter.copy(ZERO); // already centered between rocket steps
      this.rocketEmissive = this.rocketAttractorR > 0 ? 0.5 : 0;
    }
    this.rocketLabelText = label;
    // Hide anything this step doesn't show (e.g. the Sun) *immediately* rather
    // than letting it linger through the Earth's glide-in — the slow cross-fade
    // looked wrong. Slides that need it (the escape step, or stepping back to
    // the Sun-centered slides) fade it back in normally via the opacity damp.
    for (const v of this.views) {
      if (!this.isVisible(v.body.id)) { v.opacity = 0; v.mesh.visible = false; }
    }
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    this.orbitSunPos.set(0, 0, 0); // attractor at the origin
    this.orbitPos.set(R, 0, 0);    // launch point on +X, just off the surface
    // Velocity split between tangential (+Z, prograde) and radial-out (+X): a
    // non-zero lob lifts the rocket up off the surface before gravity arcs it
    // back, so a too-slow launch reads as a full rise-and-fall, not half a fall.
    const v = vBase * speedFactor;
    this.orbitVel.set(Math.sin(lob) * v, 0, Math.cos(lob) * v);
    this.orbitK = vBase * vBase * R;
    this.orbitGrav = 1;
    this.orbitInitPos.copy(this.orbitPos);
    this.orbitInitVel.copy(this.orbitVel);
    this.seedRocketTrail();
    if (this.rocketAttractorR > 0) {
      // Earth launches: zoom in close, top-down, so the planet fills the view.
      const dist = this.rocketAttractorR * 2.9 + 2.8;
      this.flyTo(new Vector3(0, dist, 0.001), new Vector3(0, 0, 0));
    } else {
      // Sun escape (third cosmic): a pulled-back 3/4 view matching the
      // solar-system slide, so arriving from it is a gentle move rather than a
      // hard tilt-and-zoom through the Sun.
      const dist = R * 3.6 + 8;
      this.flyTo(new Vector3(0.45, 0.5, 1).normalize().multiplyScalar(dist), new Vector3(0, 0, 0));
    }
  }

  /** Sphere-of-influence slide: nested Sun ⊃ Earth ⊃ Moon spheres. */
  startSOI(): void {
    this.state.demoMode = 'soi';
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    for (const v of this.views) {
      if (!this.isVisible(v.body.id)) { v.opacity = 0; v.mesh.visible = false; }
    }
    this.soiMoonAngle = 0;
    // A 3/4 view pulled back to take in the whole (vast) solar sphere.
    this.flyTo(new Vector3(2, 42, 50), new Vector3(7, 0, 0));
  }

  /** Heliocentric position (scene units) of a body on a given day. */
  private bodyDayPos(id: string, day: number, out: Vector3): Vector3 {
    const v = this.views.find((x) => x.body.id === id);
    if (v?.body.orbit) this.tmp.copy(keplerPosition(v.body.orbit, day));
    else this.tmp.set(0, 0, 0);
    this.scale.position(this.tmp, this.tmp);
    return eclToScene(this.tmp, out);
  }

  /** Gravity-assist slide (2D heliocentric, one Voyager): the clock follows the
   *  real mission timeline so the planets orbit into place and the probe's path
   *  is keyed to their actual positions on each flyby date. */
  startFlyby(missionId: string): void {
    this.state.demoMode = 'flyby';
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    const m = VOYAGER_MISSIONS[missionId];
    this.flybyIdx = m.idx;
    // Each keyframe: the visited planet's real position on the real flyby date.
    const days = m.keys.map((k) => j2000Days(...k.date));
    const pts = m.keys.map((k, i) => this.bodyDayPos(k.body, days[i], new Vector3()));
    // One more keyframe carrying the probe on outward past the last planet.
    const n = pts.length;
    const dir = pts[n - 1].clone().sub(pts[n - 2]).normalize();
    pts.push(pts[n - 1].clone().add(dir.multiplyScalar(20)));
    days.push(days[n - 1] + (days[n - 1] - days[n - 2]) * 0.7);
    this.flybyKeyDays = days;
    this.flybyStart = days[0];
    this.flybyEnd = days[days.length - 1];
    this.flybyDays = this.flybyStart;
    this.flybyRate = (this.flybyEnd - this.flybyStart) / 34; // whole mission in ~34 s
    this.setCurveLine(this.voyagerLines[m.idx], pts);
    // Top-down heliocentric, framed to take in Neptune's orbit.
    this.frameRadius(33);
  }

  /** Spacetime-curvature slide: warped grid + central mass + a body in the well. */
  startSpacetime(): void {
    this.state.demoMode = 'spacetime';
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    for (const v of this.views) {
      if (!this.isVisible(v.body.id)) { v.opacity = 0; v.mesh.visible = false; }
    }
    this.spacetimeAngle = 0;
    // Look down at the sheet from a low 3/4 angle, like the embedding diagram.
    this.flyTo(new Vector3(0, 23, 37), new Vector3(0, -5, 0));
  }

  /** Mercury-precession slide: Sun centered, the eccentric orbit's perihelion
   *  slowly rotating (exaggerated) so it traces a rosette. */
  startPrecession(): void {
    this.state.demoMode = 'precession';
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    for (const v of this.views) {
      if (!this.isVisible(v.body.id)) { v.opacity = 0; v.mesh.visible = false; }
    }
    this.precessM = 0;
    this.precessW = 0;
    this.precessTrailPts.length = 0;
    // Top-down on the Sun so the rosette reads face-on.
    this.flyTo(new Vector3(0, 30, 0.001), new Vector3(0, 0, 0));
  }

  private setArrowOpacity(a: ArrowHelper, o: number): void {
    const line = a.line.material as LineBasicMaterial;
    line.transparent = true; line.opacity = o;
    (a.cone.material as MeshBasicMaterial).opacity = 0.28 * o;
    const edges = a.cone.children[0] as LineSegments | undefined;
    if (edges) { const m = edges.material as LineBasicMaterial; m.transparent = true; m.opacity = o; }
  }

  /** Begin the "Sun moves → helices" demo: drift the system, draw real trails. */
  startHelix(): void {
    if (this.dust) this.dust.visible = false;
    this.helixOffset = 0;
    this.helixSpeed = (28 * this.state.daysPerSecond) / 365.25; // pitch ≈ a diameter
    for (const v of this.views) { v.trailPts.length = 0; v.trail.visible = false; }
    for (const mv of this.moonViews) { mv.trailPts.length = 0; mv.trail.visible = false; }
    this.parallax.visible = true;
    this.state.demoMode = 'helix';
    // Follow the Sun from the side (and a touch below) so the coils trailing
    // upward fill the view in a clear 3/4 perspective.
    this.followCamOffset.set(9, -4, 52);
    this.followTgtOffset.set(0, 7, 0);
    this.followId = 'sun';
    this.followHasLast = false;
  }

  /** Restrict the visible bodies (tour). Pass null to show everything. */
  setVisibleBodies(ids: string[] | null): void {
    this.visible = ids ? new Set(ids) : null;
  }

  energyDrift(): number {
    if (this.state.physics !== 'nbody') return 0;
    return (this.nbody.totalEnergy() - this.energy0) / Math.abs(this.energy0);
  }

  /** Whether the camera springs back to the slide framing after a drag. */
  setCameraReturn(on: boolean): void { this.returnOnRelease = on; }

  /** Enable mouse-wheel zoom (free-explore only; off during the guided tour). */
  setZoomEnabled(on: boolean): void { this.controls.enableZoom = on; }

  /** Hover-to-reveal a body's label + orbit (free-explore only). */
  setHoverLabels(on: boolean): void { this.hoverEnabled = on; if (!on) this.hoveredId = null; }

  /** Slowly orbit the camera around the system (engaged once framing settles). */
  setAutoRotate(on: boolean): void {
    this.wantAutoRotate = on;
    this.controls.autoRotateSpeed = 0.4; // gentle
    if (!on) this.controls.autoRotate = false;
  }

  /** Queue a smooth camera fly-to (eased each frame in update()). */
  private flyTo(pos: Vector3, target: Vector3): void {
    this.followId = null;
    this.camPosGoal = pos.clone();
    this.camTargetGoal.copy(target);
    this.homeCamPos = pos.clone();      // remembered for spring-back after a drag
    this.homeCamTarget.copy(target);
  }

  /**
   * Keep the camera framed on a body as it moves (2D overhead). Used for the
   * Earth–Moon slides, where Earth orbits the Sun so a fixed camera would lose
   * it. The view eases toward the moving target each frame.
   */
  followBody(id: string, distanceMul = 10, raiseFactor = 0.34, sideView = false): void {
    const v = this.views.find((x) => x.body.id === id);
    const radius = v ? v.mesh.scale.x : 1;
    const dist = Math.max(radius * distanceMul, 8);
    if (sideView) {
      // 3/4 view from in front (+Z) and slightly above, so an axial tilt reads
      // as a lean — used for the self-rotation slide (which would otherwise show
      // the tilt foreshortened from straight overhead).
      this.followCamOffset.set(0, dist * 0.42, dist * 0.92);
      this.followTgtOffset.set(0, 0, 0);
    } else {
      const raise = dist * raiseFactor; // 0 = body dead-center on screen
      this.followCamOffset.set(0, dist, raise + 0.001); // tiny z avoids gimbal at raise=0
      this.followTgtOffset.set(0, 0, raise);
    }
    this.followId = id;
    this.followHasLast = false;
    this.homeCamPos = null; // home is the (dynamic) follow pose
  }

  stopFollow(): void { this.followId = null; }

  /**
   * The body's intended scene position for the CURRENT step's state (physics +
   * target flatten, no demo offsets) — computed fresh rather than read from the
   * mesh, whose position still reflects the previous step (e.g. a helix offset).
   */
  private bodyScenePos(id: string, out: Vector3): Vector3 {
    const v = this.views.find((x) => x.body.id === id);
    if (!v) return out.set(0, 0, 0);
    if (v.body.orbit) {
      if (this.state.physics === 'kepler') this.tmp.copy(keplerPosition(v.body.orbit, this.simDays));
      else this.nbody.positionAU(this.simIndexByPlanet.get(id)!, this.tmp);
    } else {
      this.tmp.set(0, 0, 0);
    }
    this.scale.position(this.tmp, this.tmp);
    eclToScene(this.tmp, out);
    out.y *= 1 - this.state.twoD; // target flatten for the new step
    return out;
  }

  focusOn(id: string, distanceMul = 6): void {
    const v = this.views.find((x) => x.body.id === id);
    const target = this.bodyScenePos(id, new Vector3());
    const radius = v ? v.mesh.scale.x : 3;
    const dist = Math.max(radius * distanceMul, 8);

    if (this.state.twoD) {
      // Overhead for the 2D ecliptic view; shift the aim so the body sits in
      // the upper area (clear of the bottom tour panel). Screen-up is −Z.
      const raise = dist * 0.4;
      const aim = new Vector3(target.x, 0, target.z + raise);
      this.flyTo(new Vector3(target.x, dist, target.z + raise + 0.001), aim);
      return;
    }

    // 3D: view from the sunlit side (camera between Sun and body) with a little
    // elevation; the body is centered on screen (target = body).
    const sunward = target.lengthSq() > 1e-6 ? target.clone().multiplyScalar(-1).normalize() : new Vector3(0, 0, 1);
    const dir = sunward.add(new Vector3(0, 0.5, 0)).normalize();
    const goalPos = target.clone().add(dir.clone().multiplyScalar(dist));
    this.flyTo(goalPos, target);
  }

  /** Frame the camera to fit a given heliocentric distance (AU) on screen. */
  frameRadius(au: number): void {
    this.scale.position(this.tmp.set(au, 0, 0), this.tmp);
    const r = this.tmp.length() * 1.6 + 10;
    const origin = new Vector3(0, 0, 0);
    if (this.state.twoD) {
      // Center the origin (the Sun) on screen; the tiny z avoids a gimbal at
      // dead-overhead. Rotating drags orbit around this fixed point, so the Sun
      // stays centered.
      this.flyTo(new Vector3(0, r, 0.001), new Vector3(0, 0, 0));
      return;
    }
    // Elevated 3/4 angle so orbits read as tilted rings (clearly 3-D).
    const dir = new Vector3(0.45, 0.5, 1).normalize();
    this.flyTo(dir.multiplyScalar(r), origin);
  }

  // ---- per-frame update ---------------------------------------------------

  private moonFactor(parentId: string, parentRenderRadius: number): number {
    if (this.scale.mode === 'real') return TRUE_UNITS_PER_AU;
    const minA = this.minMoonA.get(parentId) ?? 0.001;
    return (parentRenderRadius * 1.9) / minA; // innermost moon sits ~1.9 radii out
  }

  private rebuildOrbits(): void {
    const f = 1 - this.flatten;
    for (const v of this.views) {
      if (!v.orbitLine) continue;
      const attr = (v.orbitLine.geometry as BufferGeometry).getAttribute('position');
      const arr = attr.array as Float32Array;
      for (let k = 0; k < v.orbitAU.length; k++) {
        this.scale.position(v.orbitAU[k], this.tmp);
        eclToScene(this.tmp, this.tmp2);
        this.tmp2.y *= f;
        arr[k * 3] = this.tmp2.x; arr[k * 3 + 1] = this.tmp2.y; arr[k * 3 + 2] = this.tmp2.z;
      }
      attr.needsUpdate = true;
    }
    for (const mv of this.moonViews) {
      const factor = this.moonFactor(mv.parent.id, this.scale.bodyRadius(mv.parent.radius, false));
      const attr = (mv.orbitLine.geometry as BufferGeometry).getAttribute('position');
      const arr = attr.array as Float32Array;
      for (let k = 0; k < mv.orbitRelAU.length; k++) {
        this.tmp.copy(mv.orbitRelAU[k]).multiplyScalar(factor);
        eclToScene(this.tmp, this.tmp2);
        this.tmp2.y *= f;
        arr[k * 3] = this.tmp2.x; arr[k * 3 + 1] = this.tmp2.y; arr[k * 3 + 2] = this.tmp2.z;
      }
      attr.needsUpdate = true;
    }
  }

  private isVisible(id: string): boolean {
    return this.visible ? this.visible.has(id) : true;
  }

  update(dtReal: number): void {
    const s = this.state;
    this.sunTime.value += dtReal; // animate the Sun's surface

    if (s.demoMode === 'flyby') {
      // Voyager slides drive the clock along the mission timeline (real dates),
      // so the planets move into their grand-tour positions as the probe flies.
      if (!s.paused) {
        this.flybyDays += dtReal * this.flybyRate;
        if (this.flybyDays > this.flybyEnd) this.flybyDays = this.flybyStart;
      }
      this.simDays = this.flybyDays;
    } else if (!s.paused) {
      const dtDays = dtReal * s.daysPerSecond;
      this.simDays += dtDays;
      if (s.physics === 'nbody') this.stepNBody(dtDays);
    }

    const prevFlatten = this.flatten;
    this.flatten = MathUtils.damp(this.flatten, s.twoD, 4, dtReal);
    const flattenMoving = Math.abs(this.flatten - prevFlatten) > 1e-4;

    const targetPolar = s.twoD ? 0.0001 : Math.PI;
    if (s.twoD && this.userDragging) {
      // While tilting a 2D slide, hold polarLimit at the *live* tilt and free the
      // angle. That way, when the lock is re-applied on release, it eases back to
      // flat from where the user left it instead of snapping (it would otherwise
      // have kept damping to flat in the background during the drag).
      this.tmp.copy(this.camera.position).sub(this.controls.target);
      this.polarLimit = Math.acos(MathUtils.clamp(this.tmp.y / (this.tmp.length() || 1), -1, 1));
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = Math.PI;
    } else {
      // Lock to top-down for 2D (easing there); free for 3D.
      this.polarLimit = MathUtils.damp(this.polarLimit, targetPolar, 4, dtReal);
      if (s.twoD) {
        this.controls.minPolarAngle = this.polarLimit;
        this.controls.maxPolarAngle = this.polarLimit;
      } else {
        this.controls.minPolarAngle = 0;
        this.controls.maxPolarAngle = Math.PI;
      }
    }

    const f = 1 - this.flatten;

    // Free-explore hover: which body is under the pointer (reveals its label/orbit).
    if (this.hoverEnabled) {
      this.raycaster.setFromCamera(this.pointerNDC, this.camera);
      const meshes = this.views.filter((v) => v.mesh.visible).map((v) => v.mesh);
      const hits = this.raycaster.intersectObjects(meshes, false);
      this.hoveredId = hits.length ? (hits[0].object.userData.id as string) : null;
    } else {
      this.hoveredId = null;
    }

    // Inertia demo: Earth drifts straight ahead at constant speed (no Sun, no
    // gravity — Newton's 1st law). The camera follows, so the parallax stars
    // stream past to convey the motion; Earth never needs to wrap.
    if (s.demoMode === 'inertia' && !s.paused) {
      this.inertiaX += dtReal * 7;
    }

    // "Sun moves" demo: advance the whole system along the ecliptic normal.
    if (s.demoMode === 'helix' && !s.paused) {
      this.helixOffset += this.helixSpeed * dtReal;
    }

    // Rocket demo: glide the carried-in launch body toward center and ramp its
    // self-illumination, so it arrives as the same Earth rather than popping.
    if (s.demoMode === 'rocket') {
      this.rocketCenter.set(
        MathUtils.damp(this.rocketCenter.x, 0, 3.2, dtReal),
        MathUtils.damp(this.rocketCenter.y, 0, 3.2, dtReal),
        MathUtils.damp(this.rocketCenter.z, 0, 3.2, dtReal),
      );
      this.rocketEmissive = MathUtils.damp(this.rocketEmissive, this.rocketAttractorR > 0 ? 0.5 : 0, 3.2, dtReal);
    }

    // Orbit-intro (and the cosmic-velocity rocket): integrate the 2-body path
    // around the fixed attractor; orbit-intro also ramps gravity + vectors in.
    if ((s.demoMode === 'orbit-intro' || s.demoMode === 'rocket') && !s.paused) {
      this.orbitGrav = MathUtils.damp(this.orbitGrav, 1, 1.4, dtReal);
      this.vecFade = MathUtils.damp(this.vecFade, 1, 2.5, dtReal);
      const sub = 4, h = Math.min(dtReal, 0.05) / sub;
      for (let i = 0; i < sub; i++) {
        const dx = this.orbitSunPos.x - this.orbitPos.x;
        const dz = this.orbitSunPos.z - this.orbitPos.z;
        const d2 = dx * dx + dz * dz;
        const d = Math.sqrt(d2) + 1e-3;
        const a = (this.orbitK / d2) * this.orbitGrav;
        this.orbitVel.x += (dx / d) * a * h;
        this.orbitVel.z += (dz / d) * a * h;
        this.orbitPos.x += this.orbitVel.x * h;
        this.orbitPos.z += this.orbitVel.z * h;
      }
      // Rocket crash: if it reaches the planet's surface, explode and relaunch.
      if (s.demoMode === 'rocket') {
        const cr = this.rocketAttractorR > 0 ? this.rocketAttractorR : 3.2;
        const rx = this.orbitPos.x - this.orbitSunPos.x, rz = this.orbitPos.z - this.orbitSunPos.z;
        if (rx * rx + rz * rz < cr * cr) {
          this.triggerBoom(this.orbitPos.x + this.rocketCenter.x, this.orbitPos.y + this.rocketCenter.y, this.orbitPos.z + this.rocketCenter.z);
          this.orbitPos.copy(this.orbitInitPos);
          this.orbitVel.copy(this.orbitInitVel);
          this.seedRocketTrail();
        }
      } else if (s.demoMode === 'orbit-intro') {
        // The too-slow planet spirals into the Sun — explode at its surface and
        // restart (only this case ever gets close; the others orbit or escape).
        const sun = this.views.find((v) => v.body.id === 'sun');
        const cr = (sun ? sun.mesh.scale.x : 3.5) + 0.4;
        const ex = this.orbitPos.x - this.orbitSunPos.x, ez = this.orbitPos.z - this.orbitSunPos.z;
        if (ex * ex + ez * ez < cr * cr) {
          this.triggerBoom(this.orbitPos.x, this.orbitPos.y, this.orbitPos.z);
          this.orbitPos.copy(this.orbitInitPos);
          this.orbitVel.copy(this.orbitInitVel);
          const ev = this.views.find((v) => v.body.id === 'earth');
          if (ev) ev.trailPts.length = 0;
        }
      }
      // Replay once it has flown off-screen (the escape case never returns).
      const ox = this.orbitPos.x - this.orbitSunPos.x, oz = this.orbitPos.z - this.orbitSunPos.z;
      if (ox * ox + oz * oz > 130 * 130) {
        this.orbitPos.copy(this.orbitInitPos);
        this.orbitVel.copy(this.orbitInitVel);
        if (s.demoMode === 'rocket') {
          this.seedRocketTrail();
        } else {
          const ev = this.views.find((v) => v.body.id === 'earth');
          if (ev) ev.trailPts.length = 0; // restart the path on replay
        }
      }
    }

    // Accretion demo: integrate the dust cloud; accreteScale (0..1) drives the
    // growing central body.
    let accreteScale = 0;
    if (s.demoMode === 'accretion') {
      accreteScale = s.paused ? smoothstep(this.accreteProgress) : this.stepAccretion(dtReal);
    }

    // Planets + Sun.
    for (let idx = 0; idx < this.views.length; idx++) {
      const v = this.views[idx];
      const shown = this.isVisible(v.body.id);
      v.opacity = MathUtils.damp(v.opacity, shown ? 1 : 0, 6, dtReal);
      const vis = v.opacity > 0.02;
      v.mesh.visible = vis;
      const mat = v.mesh.material as MeshStandardMaterial;
      mat.transparent = v.opacity < 0.995;
      mat.opacity = v.opacity;

      const inertiaEarth = s.demoMode === 'inertia' && v.body.id === 'earth';
      const accreteTarget = s.demoMode === 'accretion' && v.body.id === this.accreteBody;
      const orbitIntro = s.demoMode === 'orbit-intro';
      if (accreteTarget) {
        this.tmp2.set(0, 0, 0); // the forming body sits at the cloud's center
      } else if (orbitIntro && v.body.id === 'earth') {
        this.tmp2.copy(this.orbitPos);
      } else if (orbitIntro && v.body.id === 'sun') {
        this.tmp2.copy(this.orbitSunPos);
      } else if (s.demoMode === 'rocket' && v.body.id === this.rocketAttractor) {
        this.tmp2.copy(this.rocketCenter); // glides to center as it grows in
      } else if (s.demoMode === 'soi' && v.body.id === 'earth') {
        this.tmp2.copy(this.soiEarthPos); // Earth on its orbit, inside the Sun's sphere
      } else if (inertiaEarth) {
        this.tmp2.set(this.inertiaX, 0, 0);
      } else {
        if (v.body.orbit) {
          if (s.physics === 'kepler') {
            this.tmp.copy(keplerPosition(v.body.orbit, this.simDays));
          } else {
            this.nbody.positionAU(this.simIndexByPlanet.get(v.body.id)!, this.tmp);
          }
        } else {
          if (s.physics === 'nbody') this.nbody.positionAU(this.simIndexByPlanet.get(v.body.id)!, this.tmp);
          else this.tmp.set(0, 0, 0);
        }
        v.curAU.copy(this.tmp);
        this.scale.position(this.tmp, this.tmp);
        eclToScene(this.tmp, this.tmp2);
        this.tmp2.y *= f;
      }
      // Helix demo: drift the whole system at 45° in the screen X/Y plane
      // (down-right), so the trail of past positions streams up-left into the
      // clear area and the diagonal motion reads clearly against the parallax.
      if (s.demoMode === 'helix' && !accreteTarget) {
        this.tmp2.x += this.helixOffset * 0.7071;
        this.tmp2.y -= this.helixOffset * 0.7071;
      }
      v.mesh.position.copy(this.tmp2);
      v.curScene.copy(this.tmp2);

      // Real-space trail: the helix coils, and the Earth's path in orbit-intro
      // (which traces the orbit / the escape trajectory).
      const trailHelix = s.demoMode === 'helix' && shown;
      const trailOrbit = s.demoMode === 'orbit-intro' && v.body.id === 'earth';
      if (trailHelix || trailOrbit) {
        v.trailPts.push(v.curScene.clone());
        if (v.trailPts.length > this.maxTrail) v.trailPts.shift();
        const tarr = (v.trail.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        for (let k = 0; k < v.trailPts.length; k++) {
          const pt = v.trailPts[k];
          tarr[k * 3] = pt.x; tarr[k * 3 + 1] = pt.y; tarr[k * 3 + 2] = pt.z;
        }
        v.trail.geometry.setDrawRange(0, v.trailPts.length);
        (v.trail.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
        v.trail.visible = true;
        (v.trail.material as LineBasicMaterial).opacity = (trailOrbit ? 0.6 * this.vecFade : 0.8) * v.opacity;
      } else if (v.trail.visible) {
        v.trail.visible = false;
      }

      // Rocket-launch body: enlarge + self-illuminate so it's clearly visible
      // (the only light is at the origin, where this body now sits).
      if (s.demoMode === 'rocket' && v.body.id === this.rocketAttractor && this.rocketAttractorR > 0) {
        this.rocketEarthScale = MathUtils.damp(this.rocketEarthScale, this.rocketAttractorR, 6, dtReal);
        v.mesh.scale.setScalar(this.rocketEarthScale);
        const m = v.mesh.material as MeshStandardMaterial;
        if (m.emissive) {
          if (m.emissiveMap !== m.map) { m.emissiveMap = m.map; m.needsUpdate = true; }
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = this.rocketEmissive; // brightens as it centers
        }
      }

      // SOI: enlarge Earth and add a little self-illumination so it reads
      // clearly at this pulled-back framing.
      if (s.demoMode === 'soi' && v.body.id === 'earth') {
        v.mesh.scale.setScalar(1.3);
        const m = v.mesh.material as MeshStandardMaterial;
        if (m.emissive) {
          if (m.emissiveMap !== m.map) { m.emissiveMap = m.map; m.needsUpdate = true; }
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 0.4;
        }
      }

      // Inertia / orbit-intro: the Sun is removed or sits off-origin, so the
      // point light barely reaches the Earth — self-illuminate it via its
      // texture so it stays clearly visible.
      if ((s.demoMode === 'inertia' || s.demoMode === 'orbit-intro') && v.body.id === 'earth') {
        const m = v.mesh.material as MeshStandardMaterial;
        if (m.emissive) {
          if (m.emissiveMap !== m.map) { m.emissiveMap = m.map; m.needsUpdate = true; }
          m.emissive.setHex(0xffffff);
          m.emissiveIntensity = 0.55;
        }
      }

      if (accreteTarget) {
        // Stays a near-invisible speck until particles begin reaching center.
        v.mesh.scale.setScalar(this.accreteFinalR * (0.02 + 0.98 * accreteScale));
        // A young accreting body starts molten and cools into its real surface:
        // self-illuminate via its own texture (the central light sits inside it)
        // and lerp the glow from hot orange to the planet's natural colors.
        const m = v.mesh.material as MeshStandardMaterial;
        if (m.emissive && v.body.id !== 'sun') {
          if (m.emissiveMap !== m.map) { m.emissiveMap = m.map; m.needsUpdate = true; }
          m.emissive.setHex(0xff5a1e).lerp(WHITE, accreteScale); // molten → true color
          m.emissiveIntensity = 1.15 - 0.55 * accreteScale;
        }
      }

      if (!s.paused && s.showSpin && v.body.rotationPeriod) {
        const rate = (2 * Math.PI) / Math.abs(v.body.rotationPeriod);
        v.spin += rate * dtReal * s.daysPerSecond * Math.sign(v.body.rotationPeriod);
        v.mesh.rotation.y = v.spin;
      }
      v.axisLine.visible = s.showAxes && vis;

      const showProj = s.showProjection && vis && !!v.body.orbit;
      v.projLine.visible = showProj;
      v.projDot.visible = showProj;
      if (showProj) {
        const arr = (v.projLine.geometry as BufferGeometry).getAttribute('position').array as Float32Array;
        arr[0] = this.tmp2.x; arr[1] = this.tmp2.y; arr[2] = this.tmp2.z;
        arr[3] = this.tmp2.x; arr[4] = 0; arr[5] = this.tmp2.z;
        (v.projLine.geometry as BufferGeometry).getAttribute('position').needsUpdate = true;
        v.projDot.position.set(this.tmp2.x, 0, this.tmp2.z);
        v.projDot.scale.setScalar(Math.max(0.15, v.mesh.scale.x * 0.4));
      }

      const hov = this.hoveredId === v.body.id;
      if (v.orbitLine) {
        v.orbitLine.visible = (s.showOrbits || hov) && vis;
        (v.orbitLine.material as LineBasicMaterial).opacity = 0.6 * v.opacity;
      }
      v.label.visible = (s.showLabels || hov) && v.opacity > 0.4;
      (v.label.element as HTMLElement).style.opacity = String(v.opacity);
    }

    // Moons (always Keplerian-rendered, relative to their planet).
    for (const mv of this.moonViews) {
      const parentView = this.views.find((x) => x.body.id === mv.parent.id)!;
      const moonShown = this.moonShown(mv);
      mv.opacity = MathUtils.damp(mv.opacity, moonShown ? 1 : 0, 6, dtReal);
      const mvis = mv.opacity > 0.02;
      mv.mesh.visible = mvis;
      (mv.mesh.material as MeshStandardMaterial).transparent = mv.opacity < 0.995;
      (mv.mesh.material as MeshStandardMaterial).opacity = mv.opacity;
      mv.orbitLine.visible = mvis && s.showOrbits;
      (mv.orbitLine.material as LineBasicMaterial).opacity = 0.45 * mv.opacity;
      mv.label.visible = mvis && s.showLabels && s.showMoonLabels && mv.opacity > 0.4;
      (mv.label.element as HTMLElement).style.opacity = String(mv.opacity);
      if (!mvis) continue;

      const factor = this.moonFactor(mv.parent.id, parentView.mesh.scale.x);
      this.tmp.copy(moonRelativePosition(mv.parent, mv.moon, this.simDays)).multiplyScalar(factor);
      eclToScene(this.tmp, this.tmp3);
      this.tmp3.y *= f;
      mv.mesh.position.copy(parentView.curScene).add(this.tmp3);
      mv.orbitLine.position.copy(parentView.curScene);

      // These moons are tidally locked: their rotation period equals their
      // orbital period, so the same hemisphere always faces the planet. Rather
      // than free-spin on an axis, orient a fixed meridian toward the parent —
      // a geometric truth that holds even when paused. (this.tmp3 is the
      // parent→moon offset, so the parent lies in the -tmp3 direction.)
      mv.mesh.rotation.y = Math.atan2(-this.tmp3.x, -this.tmp3.z);

      // Moon real-space trail (helix slide): a coil around the planet's coil.
      if (s.demoMode === 'helix' && mvis) {
        mv.trailPts.push(mv.mesh.position.clone());
        if (mv.trailPts.length > this.maxTrail) mv.trailPts.shift();
        const tarr = (mv.trail.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        for (let k = 0; k < mv.trailPts.length; k++) {
          const pt = mv.trailPts[k];
          tarr[k * 3] = pt.x; tarr[k * 3 + 1] = pt.y; tarr[k * 3 + 2] = pt.z;
        }
        mv.trail.geometry.setDrawRange(0, mv.trailPts.length);
        (mv.trail.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
        mv.trail.visible = true;
        (mv.trail.material as LineBasicMaterial).opacity = 0.7 * mv.opacity;
      } else if (mv.trail.visible) {
        mv.trail.visible = false;
      }
    }

    // Parallax stars wrap around the moving body (sense of travel through space).
    if (s.demoMode === 'helix') {
      const sun = this.views.find((v) => v.body.id === 'sun');
      if (sun) this.updateParallax(sun.curScene.x, sun.curScene.y);
    } else if (s.demoMode === 'inertia') {
      const earth = this.views.find((v) => v.body.id === 'earth');
      if (earth) this.updateParallax(earth.curScene.x, earth.curScene.y);
    }

    if (flattenMoving) this.rebuildOrbits();

    this.updateVectors(f);
    this.updateBodyVectors();
    this.updateOrbitIntroLine(this.vecFade);
    this.updateRocket();
    this.updateBoom(dtReal);
    this.updateAstro(dtReal);

    // Following a moving body (the body's curScene is set above this frame).
    if (this.followId) {
      const fv = this.views.find((v) => v.body.id === this.followId);
      if (fv) {
        if (!this.followHasLast) { this.followLast.copy(fv.curScene); this.followHasLast = true; }
        if (this.userDragging) {
          // While rotating, rigidly translate the camera AND its pivot by the
          // body's motion, so the body stays dead-center under the user's orbit.
          this.followDelta.copy(fv.curScene).sub(this.followLast);
          this.camera.position.add(this.followDelta);
          this.controls.target.add(this.followDelta);
        } else {
          this.camPosGoal = this.followCamPos.copy(fv.curScene).add(this.followCamOffset);
          this.camTargetGoal.copy(fv.curScene).add(this.followTgtOffset);
        }
        this.followLast.copy(fv.curScene);
      }
    }

    // Ease the camera toward its goal (set by focusOn / frameRadius / follow).
    if (this.camPosGoal && !this.userDragging) {
      const k = 1 - Math.exp(-3.2 * dtReal);
      this.camera.position.lerp(this.camPosGoal, k);
      this.controls.target.lerp(this.camTargetGoal, k);
      if (!this.followId &&
          this.camera.position.distanceTo(this.camPosGoal) < 0.04 &&
          this.controls.target.distanceTo(this.camTargetGoal) < 0.04) {
        this.camera.position.copy(this.camPosGoal);
        this.controls.target.copy(this.camTargetGoal);
        this.camPosGoal = null;
      }
    }

    // Auto-rotate only once the framing has settled and the user isn't dragging,
    // so it doesn't fight the fly-in ease.
    this.controls.autoRotate = this.wantAutoRotate && !this.camPosGoal && !this.userDragging;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  /**
   * Draw the teaching arrows for the active subject: Earth orbiting the Sun, or
   * the Moon orbiting the Earth. Both are the same physics, so one routine
   * resolves the subject body, its attractor, and the real velocity/force.
   */
  private updateVectors(f: number): void {
    const s = this.state;
    this.gravArrow.visible = false;
    this.gravArrowSun.visible = false;
    this.velArrow.visible = false;
    this.tangentLine.visible = false;
    this.velLabel.visible = false;
    this.gravLabel.visible = false;

    const anyVec = s.vecVelocity || s.vecGravity || s.vecMutual || s.vecTangent;
    if (!anyVec) return;

    const earth = this.views.find((x) => x.body.id === 'earth');
    if (!earth) return;
    const orbitIntro = s.demoMode === 'orbit-intro';

    // Resolve subject position, attractor position, velocity (ecliptic AU/day),
    // separation (m), and the two masses.
    let subjScene: Vector3, attrScene: Vector3, velEcl: Vector3, rMeters: number, m1: number, m2: number;
    if (orbitIntro) {
      // Live 2-body state; labels still use the real Earth figures.
      subjScene = this.orbitPos;
      attrScene = this.orbitSunPos;
      velEcl = keplerState(earth.body.orbit!, this.simDays).vel;
      rMeters = AU; m1 = M_SUN; m2 = earth.body.mass;
    } else if (s.vecTarget === 'moon') {
      const mv = this.moonViews.find((x) => x.moon.id === 'moon');
      if (!mv) return;
      subjScene = mv.mesh.position;
      attrScene = earth.curScene;
      velEcl = keplerState(moonElements(mv.moon), this.simDays, pairMu(earth.body, mv.moon)).vel;
      rMeters = moonRelativePosition(earth.body, mv.moon, this.simDays).length() * AU;
      m1 = earth.body.mass; m2 = mv.moon.mass;
    } else {
      const sun = this.views.find((x) => x.body.id === 'sun');
      if (!sun) return;
      subjScene = earth.curScene;
      attrScene = sun.curScene;
      velEcl = keplerState(earth.body.orbit!, this.simDays).vel;
      rMeters = Math.max(earth.curAU.length(), 1e-6) * AU;
      m1 = M_SUN; m2 = earth.body.mass;
    }

    // Velocity direction (tangent). Orbit-intro uses the live sim velocity;
    // inertia uses the drift direction; otherwise the orbital-velocity vector.
    const velDir = this.tmp.set(1, 0, 0);
    if (orbitIntro) {
      velDir.copy(this.orbitVel); velDir.y = 0;
    } else if (s.demoMode !== 'inertia') {
      eclToScene(velEcl, velDir);
      velDir.y *= f;
    }
    velDir.normalize();

    const inertia = s.demoMode === 'inertia';
    const sep = subjScene.distanceTo(attrScene);

    // Magnitudes + arrow lengths. Orbit-intro reflects the LIVE 2-body state, so
    // the numbers and arrow lengths change as the planet speeds up, slows, or
    // the pull weakens (plunge vs escape) — rather than reading constant.
    let speedKmS: number, force: number, velLen: number, gravLen: number;
    if (orbitIntro) {
      const sepR = Math.max(sep, 0.5);
      const speedScene = Math.hypot(this.orbitVel.x, this.orbitVel.z);
      const speedRatio = speedScene / this.orbitVBase;   // 1 == the circular case
      const forceRatio = (this.orbitR / sepR) ** 2;       // 1/r², 1 == reference distance
      speedKmS = speedRatio * 29.8;                       // anchored to Earth's real ~29.8 km/s
      force = forceRatio * 3.5e22;                        // anchored to the real ~3.5e22 N
      const L0 = this.orbitR * 0.45;
      velLen = L0 * Math.max(0.3, Math.min(1.7, speedRatio));
      gravLen = L0 * Math.max(0.25, Math.min(1.8, forceRatio));
    } else {
      speedKmS = (velEcl.length() * AU_KM) / DAY;
      force = (G * m1 * m2) / (rMeters * rMeters); // Newtons
      // Fixed length in the inertia demo (no attractor); else scaled to the orbit.
      velLen = gravLen = inertia ? 6 : Math.max(sep * 0.5, 0.6);
    }
    const labelGap = (len: number) => len + (inertia ? 1.5 : sep * 0.12 + 0.5);
    const vf = orbitIntro ? this.vecFade : 1; // arrows fade in during the orbit-intro

    if (s.vecVelocity) {
      this.velArrow.visible = true;
      this.velArrow.position.copy(subjScene);
      this.velArrow.setDirection(velDir);
      this.velArrow.setLength(velLen, velLen * 0.4, velLen * 0.22);
      this.setArrowOpacity(this.velArrow, vf);
      this.velLabel.visible = s.showLabels;
      this.velLabel.position.copy(subjScene).addScaledVector(velDir, labelGap(velLen));
      (this.velLabel.element as HTMLElement).textContent = `v ≈ ${speedKmS.toFixed(speedKmS < 10 ? 2 : 1)} km/s`;
      (this.velLabel.element as HTMLElement).style.opacity = String(vf);
    }

    if (s.vecTangent) {
      this.tangentLine.visible = true;
      (this.tangentLine.material as LineDashedMaterial).opacity = 0.7 * vf;
      const len = sep * 2.2;
      const arr = (this.tangentLine.geometry as BufferGeometry).getAttribute('position').array as Float32Array;
      arr[0] = subjScene.x; arr[1] = subjScene.y; arr[2] = subjScene.z;
      arr[3] = subjScene.x + velDir.x * len;
      arr[4] = subjScene.y + velDir.y * len;
      arr[5] = subjScene.z + velDir.z * len;
      (this.tangentLine.geometry as BufferGeometry).getAttribute('position').needsUpdate = true;
      this.tangentLine.computeLineDistances();
    }

    if (s.vecGravity || s.vecMutual) {
      // Gravity on the subject points toward the attractor.
      const gravDir = this.tmp2.copy(attrScene).sub(subjScene);
      if (gravDir.lengthSq() < 1e-9) gravDir.set(-1, 0, 0);
      gravDir.normalize();

      this.gravArrow.visible = true;
      this.gravArrow.position.copy(subjScene);
      this.gravArrow.setDirection(gravDir);
      this.gravArrow.setLength(gravLen, gravLen * 0.4, gravLen * 0.22);
      this.setArrowOpacity(this.gravArrow, vf);
      this.gravLabel.visible = s.showLabels;
      this.gravLabel.position.copy(subjScene).addScaledVector(gravDir, labelGap(gravLen));
      (this.gravLabel.element as HTMLElement).textContent = `F ≈ ${force.toExponential(1)} N`;
      (this.gravLabel.element as HTMLElement).style.opacity = String(vf);

      if (s.vecMutual) {
        this.gravArrowSun.visible = true;
        this.gravArrowSun.position.copy(attrScene);
        this.gravArrowSun.setDirection(gravDir.clone().negate());
        this.gravArrowSun.setLength(gravLen, gravLen * 0.4, gravLen * 0.22);
        this.setArrowOpacity(this.gravArrowSun, vf);
      }
    }
  }

  /**
   * Velocity (green, tangent to the helix) and gravity (red, toward the Sun)
   * arrows on every visible planet — the helix-vectors slide. Velocity is the
   * true scene-space tangent (finite difference of the trail), so it points
   * along the 3-D path, not just the in-plane orbit.
   */
  private updateBodyVectors(): void {
    const s = this.state;
    const show = s.vecAll && s.demoMode === 'helix';
    const sun = this.views.find((v) => v.body.id === 'sun');
    for (const v of this.views) {
      const ok = show && sun && v.body.id !== 'sun' && v.opacity > 0.5 && v.trailPts.length >= 2;
      if (!ok) { v.vArrow.visible = false; v.gArrow.visible = false; continue; }
      const prev = v.trailPts[v.trailPts.length - 2];
      this.tmp.copy(v.curScene).sub(prev);
      if (this.tmp.lengthSq() > 1e-9) {
        this.tmp.normalize();
        v.vArrow.visible = true;
        v.vArrow.position.copy(v.curScene);
        v.vArrow.setDirection(this.tmp);
        v.vArrow.setLength(6, 2.4, 1.4);
      } else {
        v.vArrow.visible = false;
      }
      this.tmp2.copy(sun!.curScene).sub(v.curScene);
      if (this.tmp2.lengthSq() > 1e-9) {
        this.tmp2.normalize();
        v.gArrow.visible = true;
        v.gArrow.position.copy(v.curScene);
        v.gArrow.setDirection(this.tmp2);
        v.gArrow.setLength(6, 2.4, 1.4);
      } else {
        v.gArrow.visible = false;
      }
    }

    // The Sun's own motion arrow (it's being carried along the helix axis).
    if (s.vecSun && s.demoMode === 'helix' && sun) {
      const dir = this.tmp.set(0.7071, -0.7071, 0); // the system's drift direction
      sun.vArrow.visible = true;
      sun.vArrow.position.copy(sun.curScene);
      sun.vArrow.setDirection(dir);
      sun.vArrow.setLength(12, 3.2, 1.9);
      sun.gArrow.visible = false;
      this.velLabel.visible = s.showLabels;
      this.velLabel.position.copy(sun.curScene).addScaledVector(dir, 14);
      (this.velLabel.element as HTMLElement).textContent = 'v ≈ 230 km/s';
    }
  }

  private moonShown(mv: MoonView): boolean {
    if (!this.isVisible(mv.parent.id)) return false;
    // In tour mode, a moon shows when its id is explicitly listed; otherwise
    // it follows the global "show moons" toggle.
    if (this.visible) return this.visible.has(mv.moon.id);
    return this.state.showMoons;
  }

  /** Integrate N-body across one frame; substep small enough for fast moons. */
  private stepNBody(dtDays: number): void {
    if (dtDays === 0) return;
    let maxStepDays = 0.5;
    if (this.state.showMoons) {
      const shortest = shortestMoonPeriod(this.simBodies);
      if (isFinite(shortest)) maxStepDays = Math.min(maxStepDays, shortest / 40);
    }
    let n = Math.ceil(Math.abs(dtDays) / maxStepDays);
    n = Math.min(n, 6000); // hard cap; accuracy degrades gracefully past here
    const stepSec = (dtDays / n) * DAY;
    for (let i = 0; i < n; i++) this.nbody.step(stepSec);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }
}

function dim(hex: ColorRepresentation, fac: number): number {
  const c = new Color(hex);
  c.multiplyScalar(fac);
  return c.getHex();
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }

const WHITE = new Color(0xffffff);
const UP_Y = new Vector3(0, 1, 0);
const ZERO = new Vector3(0, 0, 0);

// --- Gravity-assist slides (2D heliocentric, like the Wikipedia Voyager
// trajectory animations): the clock runs along each mission's real timeline so
// the planets orbit into their late-1970s "grand tour" alignment, and each
// probe's path is keyed to the planets' actual positions on the real flyby
// dates — so the slingshots line up exactly. Dates as [year, month, day].
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function j2000Days(y: number, m: number, d: number): number {
  return (Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1, 12)) / 86400000;
}
function fmtMissionDate(days: number): string {
  const dt = new Date(Date.UTC(2000, 0, 1, 12) + days * 86400000);
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
interface MissionKey { date: [number, number, number]; body: string; }
interface Mission { name: string; idx: number; keys: MissionKey[]; }
const VOYAGER_MISSIONS: Record<string, Mission> = {
  'voyager-1': {
    name: 'Voyager 1', idx: 0, keys: [
      { date: [1977, 9, 5], body: 'earth' },    // launch
      { date: [1979, 3, 5], body: 'jupiter' },  // Jupiter flyby
      { date: [1980, 11, 12], body: 'saturn' }, // Saturn flyby → on out of the plane
    ],
  },
  'voyager-2': {
    name: 'Voyager 2', idx: 1, keys: [
      { date: [1977, 8, 20], body: 'earth' },   // launch
      { date: [1979, 7, 9], body: 'jupiter' },  // Jupiter
      { date: [1981, 8, 25], body: 'saturn' },  // Saturn
      { date: [1986, 1, 24], body: 'uranus' },  // Uranus
      { date: [1989, 8, 25], body: 'neptune' }, // Neptune → interstellar
    ],
  },
};

export { orbitalPeriodDays };
