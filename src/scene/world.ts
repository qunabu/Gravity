import {
  Scene, PerspectiveCamera, WebGLRenderer, Vector3, Color,
  Mesh, SphereGeometry, MeshStandardMaterial, MeshBasicMaterial,
  Group, ConeGeometry, CylinderGeometry, BoxGeometry,
  PointLight, AmbientLight, DirectionalLight, BufferGeometry, LineBasicMaterial, Line,
  Float32BufferAttribute, AdditiveBlending, BackSide, Points,
  PointsMaterial, RingGeometry, TorusGeometry, DoubleSide, MathUtils, ArrowHelper,
  LineDashedMaterial, EdgesGeometry, LineSegments, Raycaster, Vector2,
  CatmullRomCurve3, WireframeGeometry, PlaneGeometry, CanvasTexture, SRGBColorSpace,
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
  | 'soi' | 'flyby' | 'spacetime' | 'precession'
  // Extended "extreme gravity / cosmic scale" arc:
  | 'blackhole' | 'gwaves' | 'lensing' | 'timedilation'
  | 'milkyway' | 'sgra' | 'darkmatter'
  | 'lagrange' | 'tides' | 'exoplanet' | 'resonance'
  // Ideas lifted from the reference animations:
  | 'lightlag' | 'geoid' | 'magnetosphere' | 'heliosphere' | 'venusrose'
  | 'polaris' | 'cosmicmotion' | 'earlyuniverse';

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
  /** Marker planted on the near side (our Moon only) — see buildMoons. */
  nearLabel?: CSS2DObject;
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
  /** The polar angle the 2-D lock holds. It tracks the live camera whenever the
   *  lock is off, so engaging it always eases from the real view; `polarSynced`
   *  covers the cold start, where a 2-D slide may be the first thing drawn. */
  private polarLimit = Math.PI;
  private polarSynced = false;

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

  // ---- extended "extreme gravity / cosmic scale" demos --------------------
  // Each demo's objects live in a Group, built once (hidden) and toggled +
  // animated by updateExtras() based on the current demoMode.
  private bhGroup!: Group;       private bhDisk!: Mesh;          // black hole + accretion disk
  private bhBody!: Mesh; private bhInfallT = 0; private bhHorizonY = 0; private readonly bhHorizonR = 2.2;
  private gwGroup!: Group;       private gwA!: Mesh; private gwB!: Mesh; private gwRings: Line[] = [];
  private gwPhase = 0;           private gwInspiral = 0;
  private lensGroup!: Group;     private lensPulse!: Mesh; private lensPulsePath: Vector3[] = [];
  private lensPulseT = 0;
  private tdGroup!: Group;       private tdNearHand!: Line; private tdFarHand!: Line;
  private tdNearLabel!: CSS2DObject; private tdFarLabel!: CSS2DObject;
  private tdNear = 0;            private tdFar = 0;
  private mwGroup!: Group;       private mwDisk!: Points; private mwSun!: Mesh; private mwSunLabel!: CSS2DObject;
  private mwAngle = 0;
  private sgrGroup!: Group;      private sgrStar!: Mesh; private sgrTrail!: Line; private sgrTrailPts: Vector3[] = [];
  private sgrLabel!: CSS2DObject; private sgrM = 0; private sgrDisk!: Mesh;
  private readonly sgrA = 11;    private readonly sgrE = 0.88;
  private dmGroup!: Group;       private dmStars: { mesh: Mesh; r: number; angle: number; obs: ArrowHelper; ghost: ArrowHelper }[] = [];
  // Lagrange demo. The true Sun/Earth mass ratio (3e-6) puts L1 and L2 within
  // 0.01 AU of Earth — invisible at any framing that also shows L3/L4/L5 — so
  // lagMu is exaggerated to 1:50. It stays well under 0.0385, above which L4
  // and L5 would stop being stable and the whole point would be lost.
  private readonly lagR = 15;    private readonly lagMu = 0.02;
  private lagGroup!: Group;      private lagSpin!: Group;
  private lagProbes: { mesh: Mesh; x: number; ax: number; az: number; w: number; ph: number; dir: number }[] = [];
  private lagTrojans: { mesh: Mesh; lead0: number; s: number; r: number; a: number; b: number; w: number; ph: number }[] = [];
  private lagHorse!: Mesh;       private lagHorsePath: Vector3[] = [];
  private lagLegend!: HTMLElement;
  private lagAngle = 0;          private lagT = 0;
  private tideGroup!: Group;     private tideEarth!: Mesh; private tideBulge!: Mesh; private tideMoonAngle = 0; private tideSpin = 0;
  private tideCity!: Mesh; private tideColumn!: Line; private tideCityLabel!: CSS2DObject;
  private tideMoon!: Mesh; private tideMoonLabel!: CSS2DObject; private tideAxis!: Line;
  private tideRegionLabels: CSS2DObject[] = []; // [high, high, low, low]
  // Side-view coastline diorama, rendered as a 3-D inset (its own scene/camera).
  private tidePanel!: HTMLElement; private tideLabel2D!: Element;
  private dioramaScene!: Scene; private dioramaCam!: PerspectiveCamera; private dioramaWater!: Mesh; private dioramaDot!: Mesh;
  // Tide-height-vs-time graph (spring/neap beat) with a tracing marker.
  private tideGraph!: HTMLElement; private tideGraphDot!: SVGCircleElement; private tideClock = 0;
  private exoGroup!: Group;      private exoStar!: Mesh; private exoPlanet!: Mesh; private exoAngle = 0;
  private exoStarTrail!: Line;   private exoStarTrailPts: Vector3[] = [];
  private exoObserver!: Mesh; private exoBeam!: Line; private exoHalo!: Mesh; private exoLink!: Line;
  private exoSpecMarker!: Mesh; private exoStateLabel!: CSS2DObject;
  private resGroup!: Group;      private resMoons: Mesh[] = []; private resAngle = 0;

  // ---- demos distilled from the reference animations ----------------------
  // Light-travel time: a wavefront leaving the Sun, timed at each planet.
  private llGroup!: Group;       private llRing!: Line; private llT = 0;
  private llPlanets: { au: number; name: string; dot: Mesh; label: CSS2DObject; timeEl: HTMLElement }[] = [];
  private llClock!: CSS2DObject;
  // Earth's geoid: the real field's biggest highs and lows, wildly exaggerated.
  private geoidGroup!: Group;    private geoidMesh!: Mesh; private geoidSpin = 0;
  private geoidTags: CSS2DObject[] = [];
  // Magnetosphere: solar wind streaming past Earth's deflecting field.
  private magGroup!: Group;      private magWind!: Points; private magWindB!: Float32Array;
  private magWindX!: Float32Array; private magWindJ!: Float32Array;
  private magAurora: Mesh[] = []; private magT = 0;
  // Heliosphere: the solar-wind bubble, its shock, and the Voyagers outside it.
  private helGroup!: Group;      private helWind!: Points; private helWindR!: Float32Array;
  private helWindA!: Float32Array; private helWindV!: Float32Array;
  // Rose of Venus: the 8-year Earth–Venus pattern, drawn one chord at a time.
  private roseGroup!: Group;     private roseEarth!: Mesh; private roseVenus!: Mesh;
  private roseLines!: LineSegments; private roseSegs = 0; private roseT = 0;
  private roseLabel!: CSS2DObject;
  private readonly roseMaxSegs = 1000;
  // Polaris: the axis stays parallel all year, so one star never moves.
  private polGroup!: Group;      private polEarth!: Mesh; private polAxis!: Line;
  private polSight!: Line;       private polAngle = 0; private polPrecDot!: Mesh;
  private polPrecT = 0;
  // "You are never standing still": nested motions, spin → orbit → galaxy.
  private cmGroup!: Group;       private cmSunPivot!: Group; private cmYouPivot!: Group;
  private cmStarField!: Points;  private cmStars!: Float32Array;
  private cmOdo!: CSS2DObject;   private cmT = 0;
  // The early universe: a smooth gas pulled by gravity into the cosmic web.
  private euGroup!: Group;       private euPoints!: Points;
  private euP0!: Float32Array;   private euP1!: Float32Array; private euT = 0;
  private euLabel!: CSS2DObject;

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
  private accreteSpin = 0;           // forming body's rotation (spins up as it collapses)
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
    this.buildExtras();
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

        // Tidal locking is invisible on a 30-pixel disc: the surface detail is
        // too small to track and the lit fraction changes with the phase, which
        // reads as tumbling. So plant a flag on the near side. It is a child of
        // the mesh, so it turns with the Moon — and because the Moon is locked,
        // it ends up aimed at Earth every single frame. The dim cross-needle
        // sweeps a full circle each orbit, which is the rotation itself.
        let nearLabel: CSS2DObject | undefined;
        if (moon.id === 'moon') {
          const needle = (from: Vector3, to: Vector3, color: number, opacity: number) =>
            mesh.add(new Line(new BufferGeometry().setFromPoints([from, to]),
              new LineBasicMaterial({ color, transparent: true, opacity })));
          needle(new Vector3(0.9, 0, 0), new Vector3(2.5, 0, 0), 0xffd08a, 0.95); // near side → Earth
          needle(new Vector3(0, 0, 0.9), new Vector3(0, 0, 1.7), 0x6f9fd8, 0.5);  // shows the turn
          needle(new Vector3(0, 0, -0.9), new Vector3(0, 0, -1.7), 0x6f9fd8, 0.5);
          nearLabel = this.makeLabel('near side', 'moon-label near-side');
          nearLabel.position.set(2.7, 0, 0);
          mesh.add(nearLabel);
        }

        const label = this.makeLabel(moon.name, 'moon-label');
        mesh.add(label);

        const trailGeo = new BufferGeometry();
        trailGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
        trailGeo.setDrawRange(0, 0);
        const trail = new Line(trailGeo, new LineBasicMaterial({ color: moon.color, transparent: true, opacity: 0.7 }));
        trail.visible = false;
        trail.frustumCulled = false;
        this.scene.add(trail);

        this.moonViews.push({ moon, parent: planet, mesh, nearLabel, orbitRelAU, orbitLine, label, trail, trailPts: [], spin: 0, opacity: 0 });
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
    this.accreteSpin = 0;
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

  // ---- extended demos: builders ------------------------------------------

  /** Points of a circle of radius r in the X–Z plane (for orbits / ripples). */
  private circlePoints(r: number, segs = 96, y = 0): Vector3[] {
    const pts: Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    return pts;
  }
  private circleLine(r: number, color: number, opacity = 0.5): Line {
    return new Line(new BufferGeometry().setFromPoints(this.circlePoints(r)),
      new LineBasicMaterial({ color, transparent: true, opacity }));
  }

  /** Build every extended-demo overlay once (hidden); toggled by updateExtras. */
  private buildExtras(): void {
    this.buildBlackHole();
    this.buildGravWaves();
    this.buildLensing();
    this.buildTimeDilation();
    this.buildMilkyWay();
    this.buildSgrA();
    this.buildDarkMatter();
    this.buildLagrange();
    this.buildTides();
    this.buildExoplanet();
    this.buildResonance();
    this.buildLightLag();
    this.buildGeoid();
    this.buildMagnetosphere();
    this.buildHeliosphere();
    this.buildVenusRose();
    this.buildPolaris();
    this.buildCosmicMotion();
    this.buildEarlyUniverse();
  }

  /** A warped grid funnel of the given depth/width, like the spacetime sheet. */
  private warpGrid(depth: number, r0: number, color: number, opacity: number): Group {
    const g = new Group();
    const ext = 26, stepG = 2.6, seg = 64;
    const mat = new LineBasicMaterial({ color, transparent: true, opacity });
    const well = (r: number) => -depth / (1 + (r / r0) * (r / r0));
    const lineAlong = (fixed: number, axis: 'x' | 'z') => {
      const pts: Vector3[] = [];
      for (let j = 0; j <= seg; j++) {
        const v = -ext + 2 * ext * (j / seg);
        const x = axis === 'x' ? v : fixed, z = axis === 'x' ? fixed : v;
        pts.push(new Vector3(x, well(Math.hypot(x, z)), z));
      }
      g.add(new Line(new BufferGeometry().setFromPoints(pts), mat));
    };
    for (let q = -ext; q <= ext + 0.01; q += stepG) { lineAlong(q, 'x'); lineAlong(q, 'z'); }
    return g;
  }

  private buildBlackHole(): void {
    const depth = 13;
    const g = this.warpGrid(depth, 3.2, 0x7a5cff, 0.28);
    const yc = -depth; // well(0)
    const hpos = new Vector3(0, yc + 2.4, 0);
    this.bhHorizonY = hpos.y;
    const tilt = -Math.PI / 2 + 0.34;
    // Event horizon: a pure-black sphere (the point of no return).
    const horizon = new Mesh(new SphereGeometry(this.bhHorizonR, 40, 40), new MeshBasicMaterial({ color: 0x000000 }));
    horizon.position.copy(hpos); g.add(horizon);
    // Accretion disk — layered glowing gas: a hot white-orange inner band and a
    // cooler orange outer band, lying around the horizon and tilted.
    this.bhDisk = new Mesh(new RingGeometry(2.7, 4.6, 90, 1),
      new MeshBasicMaterial({ color: 0xffd79a, side: DoubleSide, transparent: true, opacity: 0.85, blending: AdditiveBlending }));
    this.bhDisk.rotation.x = tilt; this.bhDisk.position.copy(hpos); g.add(this.bhDisk);
    const outer = new Mesh(new RingGeometry(4.6, 8.2, 90, 1),
      new MeshBasicMaterial({ color: 0xff7a2c, side: DoubleSide, transparent: true, opacity: 0.6, blending: AdditiveBlending }));
    this.bhDisk.add(outer); // child → inherits the disk's tilt/position and spin
    // Lensed "photon rings": one in the disk plane and one standing vertical, so
    // light bent around the hole arcs over the top — the Interstellar/EHT look.
    const ringMat = () => new MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.9, blending: AdditiveBlending });
    const ph1 = new Mesh(new TorusGeometry(2.5, 0.07, 12, 80), ringMat()); ph1.rotation.x = tilt; ph1.position.copy(hpos); g.add(ph1);
    const ph2 = new Mesh(new TorusGeometry(2.55, 0.06, 12, 80), ringMat()); ph2.position.copy(hpos); g.add(ph2); // vertical (faces camera)
    // An infalling body that spirals in, gets stretched into "spaghetti", and is
    // swallowed — nothing escapes the horizon.
    this.bhBody = new Mesh(new SphereGeometry(0.42, 18, 18),
      new MeshBasicMaterial({ color: 0x9fc6ff }));
    this.bhBody.position.copy(hpos); g.add(this.bhBody);
    // Labels.
    const lab = (t: string, x: number, y: number, z: number) => { const l = this.makeLabel(t, 'vec-label'); l.position.set(x, y, z); g.add(l); return l; };
    lab('Event horizon', 0, hpos.y - 3.2, 0);
    lab('Inside: unknown — our physics breaks down', 0, hpos.y + 4.4, 0);
    lab('Nothing escapes — not even light', 0, hpos.y + 6.0, 0);
    g.visible = false; this.scene.add(g);
    this.bhGroup = g;
  }

  private buildGravWaves(): void {
    const g = new Group();
    const bhMat = () => new MeshBasicMaterial({ color: 0x0a0a12 });
    const halo = (m: Mesh) => { const h = new Mesh(new SphereGeometry(1.05, 20, 20), new MeshBasicMaterial({ color: 0x8a7bff, transparent: true, opacity: 0.5, blending: AdditiveBlending, side: BackSide })); m.add(h); };
    this.gwA = new Mesh(new SphereGeometry(0.9, 24, 24), bhMat()); halo(this.gwA); g.add(this.gwA);
    this.gwB = new Mesh(new SphereGeometry(0.9, 24, 24), bhMat()); halo(this.gwB); g.add(this.gwB);
    // Outgoing ripples: a pool of unit circles scaled out each frame.
    this.gwRings = [];
    for (let i = 0; i < 7; i++) {
      const ring = this.circleLine(1, 0x6ad6ff, 0.5);
      g.add(ring); this.gwRings.push(ring);
    }
    g.visible = false; this.scene.add(g);
    this.gwGroup = g;
  }

  private buildLensing(): void {
    const g = new Group();
    // Schematic in the X–Z plane (viewed top-down): Sun at origin, observer at
    // +X, the true star far at -X (directly behind the Sun); light grazing the
    // Sun bends, so the star *appears* offset (+Z).
    const sunTex = surfaceTexture('sun', 0xffb056);
    const sun = new Mesh(new SphereGeometry(2.4, 40, 40),
      new MeshStandardMaterial({ map: sunTex, emissiveMap: sunTex, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 1 }));
    g.add(sun);
    // Soft glow halo so it reads like the Sun in the other slides.
    const glow = new Mesh(new SphereGeometry(3.4, 32, 32),
      new MeshBasicMaterial({ color: 0xffb056, transparent: true, opacity: 0.18, blending: AdditiveBlending, side: BackSide }));
    g.add(glow);
    g.add(this.makeStar(-22, 0, 0xffffff));            // true star (on axis)
    g.add(this.makeStar(-22, 7.5, 0x9fc6ff));          // apparent star (offset)
    const observer = new Mesh(new SphereGeometry(0.7, 20, 20), new MeshStandardMaterial({ color: 0x6fa8ff, emissive: 0x1f3f6b, emissiveIntensity: 0.6 }));
    observer.position.set(20, 0, 0); g.add(observer);
    // Bent light path (star → grazes Sun's top → observer).
    const bent = new CatmullRomCurve3([
      new Vector3(-22, 0, 0), new Vector3(-8, 0, 2.4), new Vector3(0, 0, 3.1),
      new Vector3(8, 0, 2.4), new Vector3(20, 0, 0),
    ]).getPoints(80);
    g.add(new Line(new BufferGeometry().setFromPoints(bent), new LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 })));
    // Apparent line of sight (observer → apparent star), dashed.
    const dash = (a: Vector3, b: Vector3, color: number) => {
      const l = new Line(new BufferGeometry().setFromPoints([a, b]), new LineDashedMaterial({ color, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.5 }));
      l.computeLineDistances(); return l;
    };
    g.add(dash(new Vector3(20, 0, 0), new Vector3(-22, 0, 7.5), 0x9fc6ff));
    g.add(dash(new Vector3(20, 0, 0), new Vector3(-22, 0, 0), 0x556074)); // true (blocked) sightline
    // A light pulse that travels the bent path.
    this.lensPulsePath = bent;
    this.lensPulse = new Mesh(new SphereGeometry(0.35, 16, 16), new MeshBasicMaterial({ color: 0xfff1d0, blending: AdditiveBlending }));
    g.add(this.lensPulse);
    // Labels.
    const lab = (text: string, x: number, z: number) => { const l = this.makeLabel(text, 'vec-label'); l.position.set(x, 0, z); g.add(l); return l; };
    lab('Sun', 0, -3.2); lab('True position', -22, -2.4); lab('Apparent position', -22, 10);
    lab('Observer', 20, -2.2);
    g.visible = false; this.scene.add(g);
    this.lensGroup = g;
  }

  private makeStar(x: number, z: number, color: number): Mesh {
    const m = new Mesh(new SphereGeometry(0.55, 16, 16), new MeshBasicMaterial({ color, blending: AdditiveBlending }));
    m.position.set(x, 0, z); return m;
  }

  private buildTimeDilation(): void {
    const g = new Group();
    g.add(this.warpGrid(16, 3.4, 0x49a6ff, 0.32));
    const yc = -16;
    const mass = new Mesh(new SphereGeometry(2.4, 32, 32),
      new MeshStandardMaterial({ color: 0xbfc6d4, emissive: 0x33405a, emissiveIntensity: 0.5, roughness: 1 }));
    mass.position.set(0, yc + 2.0, 0); g.add(mass);
    // Two clocks: one deep in the well (near), one far out.
    const clock = (x: number, y: number): Line => {
      const ring = this.circleLine(1.1, 0xffffff, 0.6); ring.position.set(x, y, 0); ring.rotation.x = -Math.PI / 2; g.add(ring);
      const hand = new Line(new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), new Vector3(0, 0, -1.0)]),
        new LineBasicMaterial({ color: 0x9fc6ff }));
      hand.position.set(x, y + 0.02, 0); hand.rotation.x = -Math.PI / 2; g.add(hand);
      return hand;
    };
    this.tdNearHand = clock(0, yc + 5.2);     // near the mass (deep in the well)
    this.tdFarHand = clock(18, -1);           // far away (shallow)
    this.tdNearLabel = this.makeLabel('', 'vec-label'); this.tdNearLabel.position.set(0, yc + 7.4, 0); g.add(this.tdNearLabel);
    this.tdFarLabel = this.makeLabel('', 'vec-label'); this.tdFarLabel.position.set(18, 1.6, 0); g.add(this.tdFarLabel);
    g.visible = false; this.scene.add(g);
    this.tdGroup = g;
  }

  private buildMilkyWay(): void {
    const g = new Group();
    const N = 6000, maxR = 30, arms = 2, wind = 2.6;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const t = Math.pow(Math.random(), 0.6); // denser toward center
      const r = t * maxR;
      const arm = i % arms;
      const spread = (Math.random() - 0.5) * (0.6 + 0.8 * t);
      const ang = arm * (Math.PI * 2 / arms) + r * (wind / maxR) + spread;
      const bulge = Math.max(0, 1 - r / 6);
      const y = (Math.random() - 0.5) * (0.6 + bulge * 4);
      pos[i * 3] = Math.cos(ang) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(ang) * r;
      const warm = bulge; // center warmer, arms bluer
      col[i * 3] = 0.6 + 0.4 * warm; col[i * 3 + 1] = 0.6 + 0.2 * warm; col[i * 3 + 2] = 0.9 - 0.3 * warm;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.mwDisk = new Points(geo, new PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
    g.add(this.mwDisk);
    // The Sun, ~2/3 of the way out.
    this.mwSun = new Mesh(new SphereGeometry(0.5, 16, 16), new MeshBasicMaterial({ color: 0xfff2c0, blending: AdditiveBlending }));
    this.mwSun.position.set(19, 0, 0); this.mwDisk.add(this.mwSun); // rides with the disk's rotation
    this.mwSunLabel = this.makeLabel('Sun', 'vec-label'); this.mwSunLabel.position.set(19, 1.4, 0); this.mwDisk.add(this.mwSunLabel);
    g.visible = false; this.scene.add(g);
    this.mwGroup = g;
  }

  /** A Gargantua-style black hole: the shadow, a thin accretion disk seen
   *  nearly edge-on, and — the signature of a strongly lensed disk — the light
   *  from the far side bent up over the top and under the bottom, so the disk
   *  appears to wrap the shadow in a standing halo. Interstellar's look.
   *
   *  The disk is tilted rather than the camera: that keeps S2's ellipse legible
   *  from above while presenting the disk edge-on, which is what the halo needs.
   *  (Sgr A*'s real disk is not aligned with S2's orbit either.) DISK_TILT and
   *  HALO_TILT below are derived from the camera angle set in startSgrA. */
  private buildSgrA(): void {
    const g = new Group();
    const RS = 1.6;                    // shadow radius
    const CAM_EL = Math.atan2(20, 30); // camera elevation above the orbit plane
    // Not quite edge-on: a few degrees off, so the near half of the disk sweeps
    // visibly across the face of the hole instead of collapsing to a line, and
    // the far half drops behind the shadow. That off-angle is what makes the
    // Interstellar frame read.
    const DISK_TILT = Math.PI / 2 - CAM_EL - 0.065;
    const HALO_TILT = -CAM_EL;              // halo normal along it → faces us

    // The hole itself: not dark, but *nothing* — no light leaves it.
    g.add(new Mesh(new SphereGeometry(RS, 36, 36), new MeshBasicMaterial({ color: 0x000000 })));

    // Gas spiralling in, shredded and heated to millions of degrees: white-hot
    // at the inner edge, cooling outward, and brighter on the limb sweeping
    // toward us (relativistic beaming).
    const diskColors = (geo: BufferGeometry, beam: number): BufferGeometry => {
      const pos = geo.getAttribute('position') as Float32BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      const hot = new Color(0xfff6e0), cool = new Color(0xff8a2e), c = new Color();
      let rMin = Infinity, rMax = 0;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      }
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const r = Math.max(1e-6, Math.hypot(x, y));
        const t = (r - rMin) / Math.max(1e-6, rMax - rMin);
        c.copy(hot).lerp(cool, Math.pow(t, 0.75)).multiplyScalar(
          MathUtils.clamp((1 + beam * (x / r)) * (1 - 0.5 * t), 0.06, 1.0));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new Float32BufferAttribute(col, 3));
      return geo;
    };
    const diskMat = (opacity: number) => new MeshBasicMaterial({
      vertexColors: true, side: DoubleSide, transparent: true, opacity,
      blending: AdditiveBlending, depthWrite: false,
    });

    // Edge-on, the disk would be a zero-height line, so stack a few sheets at
    // slightly different tilts to give it some body.
    const disk = new Group();
    disk.rotation.x = DISK_TILT;
    for (const [lean, op] of [[0, 0.4], [0.016, 0.16], [-0.016, 0.16], [0.032, 0.07], [-0.032, 0.07]] as const) {
      // Reaching inside the shadow's silhouette on purpose: the near half then
      // crosses in front of the hole (bright) while the far half is swallowed
      // behind the sphere — which is the whole Interstellar composition.
      const sheet = new Mesh(diskColors(new RingGeometry(RS * 1.0, RS * 5.6, 180, 5), 0.5), diskMat(op));
      sheet.rotation.x = lean;
      disk.add(sheet);
    }
    // Seen edge-on, the stacked sheets pile up at the left and right limbs but
    // separate where they cross the shadow, leaving that crossing too dim. One
    // extra unleant inner sheet puts the brightness back where the near side
    // passes in front of the hole.
    const front = new Mesh(diskColors(new RingGeometry(RS * 1.0, RS * 2.4, 180, 3), 0.5), diskMat(0.28));
    disk.add(front);
    g.add(disk);
    this.sgrDisk = disk as unknown as Mesh;

    // The far side of that same disk, lifted over the top and pulled under the
    // bottom by the hole's gravity: a narrow standing ring around the shadow.
    const halo = new Group();
    halo.rotation.x = HALO_TILT;
    const bright = new Mesh(diskColors(new RingGeometry(RS * 1.04, RS * 1.38, 180, 3), 0.28), diskMat(0.6));
    const faint = new Mesh(diskColors(new RingGeometry(RS * 1.38, RS * 2.1, 180, 3), 0.28), diskMat(0.05));
    halo.add(bright, faint);
    // Photon ring: light that circled the hole before escaping, hugging the
    // shadow's edge — bright, and razor thin.
    halo.add(new Mesh(new TorusGeometry(RS * 1.02, 0.035, 12, 120),
      new MeshBasicMaterial({ color: 0xfff3d6, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false })));
    g.add(halo);

    // S2: the star whose 16-year ellipse weighed this thing.
    this.sgrStar = new Mesh(new SphereGeometry(0.4, 20, 20), new MeshBasicMaterial({ color: 0xcfe0ff }));
    const glow = new Mesh(new SphereGeometry(0.85, 20, 20),
      new MeshBasicMaterial({ color: 0x9fc6ff, transparent: true, opacity: 0.4, blending: AdditiveBlending, side: BackSide }));
    this.sgrStar.add(glow);
    g.add(this.sgrStar);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
    tg.setDrawRange(0, 0);
    this.sgrTrail = new Line(tg, new LineBasicMaterial({ color: 0x6fa0e0, transparent: true, opacity: 0.7 }));
    this.sgrTrail.frustumCulled = false; g.add(this.sgrTrail);
    this.sgrLabel = this.makeLabel('S2', 'vec-label'); g.add(this.sgrLabel);
    const c = this.makeLabel('Sgr A* · 4 million Suns', 'vec-label');
    c.position.set(0, -RS * 3.4, 0); g.add(c);
    g.visible = false; this.scene.add(g);
    this.sgrGroup = g;
  }

  private buildDarkMatter(): void {
    const g = new Group();
    g.add(this.circleLine(0.001, 0x000000, 0)); // keep group non-empty if list changes
    const radii = [4, 6.5, 9, 11.5, 14, 16.5];
    this.dmStars = [];
    for (const r of radii) {
      g.add(this.circleLine(r, 0x394056, 0.35));
      const mesh = new Mesh(new SphereGeometry(0.45, 16, 16), new MeshBasicMaterial({ color: 0xeaf0ff, blending: AdditiveBlending }));
      g.add(mesh);
      const obs = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(), 3, 0x6ad6ff, 0.9, 0.5);
      const ghost = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(), 3, 0xff8a3c, 0.9, 0.5);
      this.setArrowOpacity(obs, 0.95); this.setArrowOpacity(ghost, 0.35);
      g.add(obs); g.add(ghost);
      this.dmStars.push({ mesh, r, angle: Math.random() * Math.PI * 2, obs, ghost });
    }
    const l1 = this.makeLabel('● observed — flat', 'vec-label'); l1.position.set(-15, 0, -16); g.add(l1);
    const l2 = this.makeLabel('● expected — Keplerian', 'vec-label'); l2.position.set(-15, 0, -13.5); g.add(l2);
    g.visible = false; this.scene.add(g);
    this.dmGroup = g;
  }

  /** Effective potential of the circular restricted three-body problem: the two
   *  gravity wells plus the centrifugal term, as felt in the frame that turns
   *  with the pair. Units where the separation, the total mass and the orbital
   *  rate are all 1, so the primaries sit at x = -mu and x = 1-mu and the two
   *  maxima (L4, L5) come out at exactly -3/2. */
  private lagPot(x: number, z: number): number {
    const mu = this.lagMu;
    const r1 = Math.hypot(x + mu, z), r2 = Math.hypot(x - (1 - mu), z);
    return -(1 - mu) / Math.max(r1, 2e-3) - mu / Math.max(r2, 2e-3) - 0.5 * (x * x + z * z);
  }

  /** The collinear point in [lo, hi], where the on-axis gradient vanishes.
   *  Bisection rather than the usual series expansion: same length, exact for
   *  any mass ratio, and it can't quietly drift as lagMu is tuned. */
  private lagCollinear(lo: number, hi: number): number {
    const mu = this.lagMu, x1 = -mu, x2 = 1 - mu;
    const f = (x: number): number => {
      const d1 = x - x1, d2 = x - x2;
      return (1 - mu) * d1 / Math.abs(d1) ** 3 + mu * d2 / Math.abs(d2) ** 3 - x;
    };
    let a = lo, b = hi, fa = f(a);
    for (let i = 0; i < 70; i++) {
      const m = (a + b) / 2, fm = f(m);
      if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
    }
    return (a + b) / 2;
  }

  /** The potential drawn as a contour map — the picture every textbook uses:
   *  two wells, a warm ring at the corotation radius, hilltops at L4/L5 and
   *  the three saddles between them. Filled bands plus hairline contours,
   *  baked once into a canvas and laid flat under the markers. */
  private buildLagrangeField(ext: number): Mesh {
    const N = 640;
    // The whole story lives in the few hundredths just below the L4/L5 maximum,
    // so depth is compressed logarithmically; K sets how much of the top of
    // that range gets spread across the ramp.
    const K = 0.004, LMAX = Math.log1p(1.1 / K);
    const dep = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      const z = ((j / (N - 1)) * 2 - 1) * ext;
      for (let i = 0; i < N; i++) {
        const x = ((i / (N - 1)) * 2 - 1) * ext;
        dep[j * N + i] = Math.min(1, Math.log1p(Math.max(0, -1.5 - this.lagPot(x, z)) / K) / LMAX);
      }
    }
    // High ground is warm, deep ground fades into the near-black of the rest of
    // the scene, so the map ends in space rather than on an edge.
    // Capped at a clear amber rather than white: the crest is broad, and a
    // blown-out one would swallow every marker and annotation drawn over it.
    const ramp = [
      [0.00, 246, 196, 128], [0.12, 236, 150, 86], [0.30, 186, 88, 100],
      [0.50, 112, 58, 122], [0.70, 52, 46, 106], [0.86, 18, 24, 54],
      [1.00, 4, 6, 14],
    ];
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(N, N), px = img.data;
    const bands = 18;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i, t = dep[k];
        let g = 1;
        while (g < ramp.length - 1 && ramp[g][0] < t) g++;
        const a = ramp[g - 1], b = ramp[g], f = (t - a[0]) / (b[0] - a[0]);
        // Contours without marching squares: measure the local slope in bands
        // per texel, then shade by how close this texel sits to a boundary —
        // an antialiased hairline instead of a staircase. Where the slope is
        // steeper than a band per texel the lines would only alias into moiré,
        // so those (the well floors) are left plain.
        const tr = dep[k + (i < N - 1 ? 1 : 0)], tb = dep[k + (j < N - 1 ? N : 0)];
        const slope = Math.max(Math.abs(t - tr), Math.abs(t - tb)) * bands;
        const fr = t * bands - Math.floor(t * bands);
        // Faded out, not cut off: a hard cutoff leaves one stray dotted ring
        // at the radius where the crowding starts, which reads as an object.
        const room = MathUtils.clamp((0.55 - slope) / 0.22, 0, 1)
          * MathUtils.clamp((0.95 - t) / 0.07, 0, 1);
        const cov = slope > 1e-7
          ? room * MathUtils.clamp(1 - Math.min(fr, 1 - fr) / slope, 0, 1) : 0;
        const lift = cov * (t < 0.30 ? -62 : 52); // dark lines on light ground, light on dark
        const o = k * 4;
        for (let c = 0; c < 3; c++) {
          px[o + c] = MathUtils.clamp(a[c + 1] + (b[c + 1] - a[c + 1]) * f + lift, 0, 255);
        }
        const rx = (i / (N - 1)) * 2 - 1, rz = (j / (N - 1)) * 2 - 1;
        px[o + 3] = 255 * MathUtils.clamp((1 - Math.hypot(rx, rz)) / 0.16, 0, 1); // feathered rim
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    const size = 2 * ext * this.lagR;
    const m = new Mesh(new PlaneGeometry(size, size),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.4;   // under everything else, so nothing z-fights with it
    m.renderOrder = -1;
    return m;
  }

  private buildLagrange(): void {
    const g = new Group();
    const R = this.lagR, mu = this.lagMu, EXT = 1.45;

    // Everything here keeps station with Earth, so it all lives in one group
    // that turns once a year. That rotation *is* the idea: the pattern is
    // frozen in the frame that goes round with Earth, so a probe parked on it
    // stays put.
    const spin = new Group(); g.add(spin);
    this.lagSpin = spin;
    spin.add(this.buildLagrangeField(EXT));

    // Polar helper in the natural coordinates of this diagram: lead angle
    // (positive = ahead of Earth along the orbit) and distance from the
    // barycenter. Earth moves toward -Z, so a lead is a rotation toward -Z.
    const at = (lead: number, r: number): Vector3 =>
      new Vector3(Math.cos(lead) * r, 0, -Math.sin(lead) * r);

    const sunX = -mu * R, earthX = (1 - mu) * R;
    const earthPos = new Vector3(earthX, 0, 0);
    const L1 = this.lagCollinear(-mu + 0.05, 1 - mu - 0.02) * R;
    const L2 = this.lagCollinear(1 - mu + 0.02, 2) * R;
    const L3 = this.lagCollinear(-2, -mu - 0.05) * R;
    const L4 = at(Math.PI / 3, earthX), L5 = at(-Math.PI / 3, earthX);

    g.add(this.circleLine(earthX, 0x5a6480, 0.5)); // Earth's orbit

    const dash = (a: Vector3, b: Vector3, color: number, op: number): Line => {
      const l = new Line(new BufferGeometry().setFromPoints([a, b]),
        new LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: op }));
      l.computeLineDistances(); return l;
    };
    // The Sun–Earth line, carried on past L2 one way and out to L3 the other:
    // the axis all three saddles sit on.
    spin.add(dash(new Vector3(L3 - 2.5, 0, 0), new Vector3(L2 + 2.5, 0, 0), 0xc3cbdb, 0.5));
    // L4 and L5 close two equilateral triangles with the Sun and Earth. Drawing
    // them is the quickest way to say where sixty degrees comes from.
    for (const p of [L4, L5]) {
      spin.add(dash(new Vector3(sunX, 0, 0), p, 0x8affc0, 0.7));
      spin.add(dash(earthPos, p, 0x8affc0, 0.7));
    }
    const arc: Vector3[] = [];
    for (let k = 0; k <= 28; k++) {
      const a = (k / 28) * Math.PI / 3;
      arc.push(new Vector3(sunX + Math.cos(a) * 4.6, 0, -Math.sin(a) * 4.6));
    }
    spin.add(new Line(new BufferGeometry().setFromPoints(arc),
      new LineBasicMaterial({ color: 0x8affc0, transparent: true, opacity: 0.6 })));

    const sunTex = surfaceTexture('sun', 0xffb056);
    const sun = new Mesh(new SphereGeometry(1.9, 40, 40),
      new MeshStandardMaterial({ map: sunTex, emissiveMap: sunTex, emissive: 0xffffff, emissiveIntensity: 1.0, roughness: 1 }));
    sun.position.x = sunX; spin.add(sun);
    const eTex = surfaceTexture('earth', 0x3a6ea5);
    const earth = new Mesh(new SphereGeometry(0.75, 32, 32),
      new MeshStandardMaterial({ map: eTex, emissiveMap: eTex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.95 }));
    earth.position.copy(earthPos); spin.add(earth);

    // A marker that stays readable on top of the contour map: a bright core
    // inside a thin ring, colour-coded by what the point actually does.
    const mark = (p: Vector3, color: number): void => {
      // A punched-out dark disc first: over the crest of the map a bare marker
      // would be one bright thing on another. The hole makes it a marker again.
      const hole = new Mesh(new RingGeometry(0, 0.72, 28),
        new MeshBasicMaterial({ color: 0x05070d, transparent: true, opacity: 0.66, side: DoubleSide, depthWrite: false }));
      hole.rotation.x = -Math.PI / 2; hole.position.copy(p); spin.add(hole);
      const core = new Mesh(new RingGeometry(0, 0.26, 24),
        new MeshBasicMaterial({ color, side: DoubleSide, depthWrite: false }));
      core.rotation.x = -Math.PI / 2; core.position.copy(p); spin.add(core);
      const ring = new Mesh(new RingGeometry(0.62, 0.74, 36),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(p); spin.add(ring);
    };
    // A saddle: the one way out is along the Sun–Earth line (amber), and every
    // other direction falls back in (mint). That asymmetry is the whole
    // difference between L1/L2/L3 and L4/L5.
    const saddle = (x: number): void => {
      for (const sg of [-1, 1]) {
        const out = new ArrowHelper(new Vector3(sg, 0, 0), new Vector3(x + sg * 0.85, 0, 0), 1.0, 0xff8a2c, 0.44, 0.3);
        this.setArrowOpacity(out, 1); spin.add(out);
        const back = new ArrowHelper(new Vector3(0, 0, -sg), new Vector3(x, 0, sg * 2.3), 1.0, 0x8affc0, 0.44, 0.3);
        this.setArrowOpacity(back, 0.75); spin.add(back);
      }
    };
    // A bowl: nudge a rock off it in any direction and it swings back, so
    // debris collects instead of leaking away.
    const bowl = (p: Vector3): void => {
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
        const d = new Vector3(Math.cos(a), 0, Math.sin(a));
        const arr = new ArrowHelper(d.clone().negate(), p.clone().addScaledVector(d, 3.0), 1.1, 0x8affc0, 0.44, 0.3);
        this.setArrowOpacity(arr, 0.7); spin.add(arr);
      }
    };
    const UNSTABLE = 0xffb04a, STABLE = 0x8affc0;
    for (const x of [L1, L2, L3]) { mark(new Vector3(x, 0, 0), UNSTABLE); saddle(x); }
    for (const p of [L4, L5]) { mark(p, STABLE); bowl(p); }

    const tag = (text: string, x: number, z: number): void => {
      const l = this.makeLabel(text, 'vec-label');
      l.position.set(x, 0, z); spin.add(l);
    };
    tag('Sun', sunX, 3.0);
    tag('Earth', earthX, -2.3);
    tag('60°', sunX + 4.4, -2.9);
    tag('L1 · SOHO', L1 - 0.7, 3.6);
    tag('L2 · Webb', L2 + 0.7, 3.6);
    tag('L3 · forever behind the Sun', L3 + 2.2, 2.7);
    tag('L4 · Trojans', L4.x, L4.z - 3.9);
    tag('L5 · Trojans', L5.x, L5.z + 3.9);

    // Neither SOHO nor Webb sits *on* its point: both trace a wide halo around
    // it, and both slide off along the unstable axis and burn their way back
    // every few weeks. Parked, but never once at rest.
    for (const [x, dir, ph] of [[L1, -1, 0], [L2, 1, 2]] as [number, number, number][]) {
      const halo: Vector3[] = [];
      for (let k = 0; k <= 80; k++) {
        const a = (k / 80) * Math.PI * 2;
        halo.push(new Vector3(x + Math.sin(a) * 0.6, 0, Math.cos(a) * 1.85));
      }
      spin.add(new Line(new BufferGeometry().setFromPoints(halo),
        new LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.45 })));
      const m = new Mesh(new SphereGeometry(0.2, 12, 12), new MeshBasicMaterial({ color: 0xfff1d0 }));
      spin.add(m);
      this.lagProbes.push({ mesh: m, x, ax: 0.6, az: 1.85, w: 1.1, ph, dir });
    }

    // Trojan swarms. A real Trojan doesn't sit on its point either — it crawls
    // round a long tadpole, fat on the far side and pinched toward Earth,
    // taking centuries to go once around. Jupiter's number in the thousands;
    // Earth has one confirmed, 2010 TK7, at L4.
    for (const sg of [1, -1]) {
      const lead0 = sg * Math.PI / 3;
      const tad: Vector3[] = [];
      for (let k = 0; k <= 96; k++) {
        const th = (k / 96) * Math.PI * 2;
        tad.push(at(lead0 + sg * 0.40 * Math.cos(th), earthX + sg * 1.5 * Math.sin(th) * (1 + 0.55 * Math.cos(th))));
      }
      spin.add(new Line(new BufferGeometry().setFromPoints(tad),
        new LineBasicMaterial({ color: 0x2a8a63, transparent: true, opacity: 0.8 })));
      for (let k = 0; k < 10; k++) {
        const m = new Mesh(new SphereGeometry(0.15, 10, 10),
          new MeshBasicMaterial({ color: 0x0a3527 }));
        spin.add(m);
        this.lagTrojans.push({
          mesh: m, lead0, s: sg, r: earthX,
          a: 0.12 + Math.random() * 0.34, b: 0.5 + Math.random() * 1.2,
          w: 0.3 + Math.random() * 0.25, ph: Math.random() * Math.PI * 2,
        });
      }
    }

    // The horseshoe: the same libration taken to its limit. A body on one runs
    // nearly all the way round the orbit, gets turned back by Earth before it
    // arrives, and retraces the loop on the other side of Earth's radius.
    const SPAN = MathUtils.degToRad(336), OPEN = MathUtils.degToRad(12), AMP = 1.3;
    for (let k = 0; k <= 200; k++) {
      const f = k / 200;
      this.lagHorsePath.push(at(-OPEN - SPAN * f, earthX + AMP * Math.sin(Math.PI * f)));
    }
    for (let k = 0; k <= 200; k++) {
      const f = k / 200;
      this.lagHorsePath.push(at(-OPEN - SPAN * (1 - f), earthX - AMP * Math.sin(Math.PI * f)));
    }
    // Drawn as dark ink: it lies almost entirely on the bright crest, where a
    // light line would disappear.
    const hl = new Line(new BufferGeometry().setFromPoints(this.lagHorsePath),
      new LineDashedMaterial({ color: 0x141a3c, dashSize: 0.7, gapSize: 0.5, transparent: true, opacity: 0.85 }));
    hl.computeLineDistances(); spin.add(hl);
    this.lagHorse = new Mesh(new SphereGeometry(0.22, 12, 12), new MeshBasicMaterial({ color: 0x3e9bff }));
    spin.add(this.lagHorse);
    const hlab = this.makeLabel('horseshoe orbit — turns back before it reaches Earth', 'vec-label');
    hlab.position.copy(at(MathUtils.degToRad(152), earthX + 4.4)); spin.add(hlab);

    // The colour key for the map. It has to be read, not glanced at, so it sits
    // in the page chrome rather than floating in the scene like the tags.
    const el = document.createElement('div');
    el.className = 'lag-legend';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="lag-legend-title">Effective potential · frame rotating with Earth</div>
      <div class="lag-bar"></div>
      <div class="lag-bar-ends"><span>deep — falls away</span><span>high ground</span></div>
      <ul class="lag-key">
        <li><i class="lag-sw lag-sw-stable"></i>L4 · L5 — hilltops that trap: rock nudged off swings back, so asteroids collect</li>
        <li><i class="lag-sw lag-sw-saddle"></i>L1 · L2 · L3 — saddles: a probe slides off along the Sun–Earth line and must thrust back</li>
      </ul>`;
    document.body.appendChild(el);
    this.lagLegend = el;

    g.visible = false; this.scene.add(g);
    this.lagGroup = g;
  }

  private buildTides(): void {
    const g = new Group();
    const eR = 2.4;
    const eTex = surfaceTexture('earth', 0x3a6ea5);
    this.tideEarth = new Mesh(new SphereGeometry(eR, 40, 40),
      new MeshStandardMaterial({ map: eTex, emissiveMap: eTex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.95 }));
    g.add(this.tideEarth);
    // Water envelope, stretched along the Earth–Moon axis (X) into two bulges
    // (high tide) while sitting low across the sides (low tide). It clears the
    // rock by a few percent everywhere — an ocean does, and coincident surfaces
    // z-fight, which shows up as the whole planet flickering.
    // The camera's near plane is 0.001 (true-scale mode needs it), which leaves
    // little depth precision out here, so clear the rock by a good margin and
    // bias the water toward the camera on top of that.
    this.tideBulge = new Mesh(new SphereGeometry(eR, 40, 40),
      new MeshBasicMaterial({
        color: 0x4ea6ff, transparent: true, opacity: 0.28, blending: AdditiveBlending,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
    this.tideBulge.scale.set(1.44, 1.06, 1.06);
    g.add(this.tideBulge);
    this.tideMoon = new Mesh(new SphereGeometry(0.9, 24, 24), new MeshStandardMaterial({ map: surfaceTexture('moon', 0x888888), emissive: 0x222222, emissiveIntensity: 0.4, roughness: 1 }));
    g.add(this.tideMoon);
    this.tideMoonLabel = this.makeLabel('Moon', 'vec-label'); g.add(this.tideMoonLabel);
    // Line from Earth to the Moon — the tidal axis the bulges line up with.
    this.tideAxis = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineDashedMaterial({ color: 0x6ad6ff, dashSize: 0.7, gapSize: 0.5, transparent: true, opacity: 0.45 }));
    g.add(this.tideAxis);
    // Region labels (repositioned each frame): two high-tide bulges along the
    // Moon axis, two low-tide points perpendicular to it.
    this.tideRegionLabels = [
      this.makeLabel('High tide', 'vec-label'), this.makeLabel('High tide', 'vec-label'),
      this.makeLabel('Low tide', 'vec-label'), this.makeLabel('Low tide', 'vec-label'),
    ];
    for (const l of this.tideRegionLabels) g.add(l);
    // A "city" fixed to Earth's surface — a child of the Earth mesh so it turns
    // with the planet's spin. Sitting just above the surface avoids z-fighting
    // (the blinking). One spin carries it through two highs and two lows.
    this.tideCity = new Mesh(new SphereGeometry(0.26, 16, 16), new MeshBasicMaterial({ color: 0xffd24a }));
    this.tideCity.position.set(0, 0, eR + 0.14);
    this.tideEarth.add(this.tideCity);
    this.tideColumn = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: 0x6ad6ff, transparent: true, opacity: 0.95 }));
    g.add(this.tideColumn);
    this.tideCityLabel = this.makeLabel('', 'vec-label'); g.add(this.tideCityLabel);

    // Framing + caption for the 3-D coastline inset (the diorama itself is
    // drawn straight onto the canvas in render(), behind this transparent div).
    const el = document.createElement('div');
    el.className = 'tide-panel';
    el.style.display = 'none';
    el.innerHTML = `<span class="tide-panel-title">Tide level</span><span class="tide2d-label">Low tide</span>`;
    document.body.appendChild(el);
    this.tidePanel = el;
    this.tideLabel2D = el.querySelector('.tide2d-label')!;
    this.buildTideDiorama();
    this.buildTideGraph();

    g.visible = false; this.scene.add(g);
    this.tideGroup = g;
  }

  /** A little 3-D side-view coastline (own scene + camera) for the inset: a
   *  sloped beach, a tree, the Moon, and a sea whose level rises/falls. Flat
   *  MeshBasic colours so it needs no scene lighting. */
  private buildTideDiorama(): void {
    const s = new Scene();
    s.background = new Color(0x070b12);
    this.dioramaCam = new PerspectiveCamera(42, 1.46, 0.1, 100);
    this.dioramaCam.position.set(-1, 4.5, 16);
    this.dioramaCam.lookAt(2, 1.5, 0);
    // Beach: a box tilted so its top is a slope rising left (sea) → right (land).
    const beach = new Mesh(new BoxGeometry(24, 9, 9), new MeshBasicMaterial({ color: 0x6b5836 }));
    beach.rotation.z = -0.22; beach.position.set(5, -2.6, 0); s.add(beach);
    // Tree on the upper beach.
    const trunk = new Mesh(new CylinderGeometry(0.28, 0.36, 3, 10), new MeshBasicMaterial({ color: 0x6b4a2b }));
    trunk.position.set(8.5, 3.4, 0.5); s.add(trunk);
    const canopy = new Mesh(new ConeGeometry(1.7, 3.4, 14), new MeshBasicMaterial({ color: 0x3f7d4a }));
    canopy.position.set(8.5, 5.7, 0.5); s.add(canopy);
    // Moon in the sky.
    const moon = new Mesh(new SphereGeometry(1.1, 20, 20), new MeshBasicMaterial({ color: 0xe9eccb }));
    moon.position.set(-7, 8, -3); s.add(moon);
    // Sea: a big box so it always fills the left/bottom; its top is the water
    // surface, raised/lowered each frame so the waterline climbs the beach.
    this.dioramaWater = new Mesh(new BoxGeometry(40, 20, 16), new MeshBasicMaterial({ color: 0x2f6fa6 }));
    this.dioramaWater.position.set(-9, -10, 0.5); s.add(this.dioramaWater); // y set in updateExtras
    // Red marker riding the water surface (matches the graph's marker).
    this.dioramaDot = new Mesh(new SphereGeometry(0.55, 14, 14), new MeshBasicMaterial({ color: 0xff3b30 }));
    s.add(this.dioramaDot);
    this.dioramaScene = s;
  }

  /** Tide height at day d: lunar semidiurnal (period 12.42 h) + solar (12 h).
   *  Their drift in and out of phase is the spring/neap beat (~14.8-day cycle).
   *  Returned roughly in [-1, 1]. */
  private tideHeight(d: number): number {
    return (Math.cos(2 * Math.PI * d / 0.5175) + 0.46 * Math.cos(2 * Math.PI * d / 0.5)) / 1.46;
  }

  /** A tide-height-vs-time graph (0–30 days) with the spring/neap envelope and
   *  a tracing red marker — the readout an observer would record. */
  private buildTideGraph(): void {
    const W = 470, H = 158, x0 = 34, x1 = W - 12, yMid = 86, amp = 52;
    const px = (d: number) => x0 + (d / 30) * (x1 - x0);
    const py = (h: number) => yMid - h * amp;
    let path = '';
    for (let i = 0; i <= 600; i++) { const d = (i / 600) * 30; path += (i ? 'L' : 'M') + px(d).toFixed(1) + ',' + py(this.tideHeight(d)).toFixed(1) + ' '; }
    let grid = '';
    for (let day = 0; day <= 30; day += 5) grid += `<line x1="${px(day).toFixed(1)}" y1="20" x2="${px(day).toFixed(1)}" y2="${H - 30}" stroke="rgba(120,150,200,0.18)" stroke-width="0.6"/>`;
    grid += `<line x1="${x0}" y1="${yMid}" x2="${x1}" y2="${yMid}" stroke="rgba(120,150,200,0.3)" stroke-width="0.6"/>`;
    let ticks = '';
    for (const day of [0, 10, 20, 30]) ticks += `<text x="${px(day).toFixed(1)}" y="${H - 8}" fill="#6fa0e0" font-size="10" font-family="sans-serif" text-anchor="middle">${day} day</text>`;
    const el = document.createElement('div');
    el.className = 'tide-graph'; el.style.display = 'none';
    el.innerHTML = `
      <div class="tide-graph-title">Tide height over a month</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${grid}
        <path d="${path}" fill="none" stroke="#eaf0ff" stroke-width="1.4"/>
        ${ticks}
        <circle class="tide-graph-dot" cx="${x0}" cy="${yMid}" r="5" fill="#ff3b30"/>
      </svg>`;
    document.body.appendChild(el);
    this.tideGraph = el;
    this.tideGraphDot = el.querySelector('.tide-graph-dot') as unknown as SVGCircleElement;
  }

  private buildExoplanet(): void {
    const g = new Group();
    // Faint line linking star and planet through the barycenter — they always
    // sit on opposite sides of it.
    this.exoLink = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: 0x556074, transparent: true, opacity: 0.5 }));
    g.add(this.exoLink);
    const bary = new Mesh(new SphereGeometry(0.22, 14, 14), new MeshBasicMaterial({ color: 0xff5a5a }));
    g.add(bary);
    const bl = this.makeLabel('Center of mass', 'vec-label'); bl.position.set(0, 0, -1.6); g.add(bl);
    this.exoStar = new Mesh(new SphereGeometry(1.8, 32, 32), new MeshStandardMaterial({ color: 0xffd479, emissive: 0xd98a1e, emissiveIntensity: 0.9, roughness: 1 }));
    g.add(this.exoStar);
    // Doppler halo around the star — tinted blue when it approaches us, red when
    // it recedes (this colour shift is what telescopes actually measure).
    this.exoHalo = new Mesh(new SphereGeometry(2.25, 24, 24),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, blending: AdditiveBlending, side: BackSide }));
    this.exoStar.add(this.exoHalo);
    this.exoPlanet = new Mesh(new SphereGeometry(0.7, 24, 24), new MeshStandardMaterial({ color: 0xc99a6a, emissive: 0x5a4327, emissiveIntensity: 0.4, roughness: 1 }));
    g.add(this.exoPlanet);
    const tg = new BufferGeometry();
    tg.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.maxTrail * 3), 3));
    tg.setDrawRange(0, 0);
    this.exoStarTrail = new Line(tg, new LineBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.8 }));
    this.exoStarTrail.frustumCulled = false; g.add(this.exoStarTrail);
    const sl = this.makeLabel('Star wobbles', 'vec-label'); sl.position.set(0, 2.6, 0); g.add(sl);

    // The observer (us, on Earth) with a line of sight up to the star.
    this.exoObserver = new Mesh(new SphereGeometry(0.5, 20, 20),
      new MeshStandardMaterial({ map: surfaceTexture('earth', 0x3a6ea5), emissiveMap: surfaceTexture('earth', 0x3a6ea5), emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 1 }));
    this.exoObserver.position.set(0, 0, 13); g.add(this.exoObserver);
    const ol = this.makeLabel('Us (Earth)', 'vec-label'); ol.position.set(0, 0, 14.4); g.add(ol);
    this.exoBeam = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    g.add(this.exoBeam);
    this.exoStateLabel = this.makeLabel('', 'vec-label'); g.add(this.exoStateLabel);

    // A spectrum strip near the observer: a rest wavelength (centre tick) and an
    // observed line (marker) that slides blue (←) when approaching, red (→) when
    // receding — the periodic wiggle that reveals the planet.
    const specY = 0, specZ = 16, half = 5;
    g.add(new Line(new BufferGeometry().setFromPoints([new Vector3(-half, specY, specZ), new Vector3(half, specY, specZ)]),
      new LineBasicMaterial({ color: 0x8893a6 })));
    g.add(new Line(new BufferGeometry().setFromPoints([new Vector3(0, specY, specZ - 0.5), new Vector3(0, specY, specZ + 0.5)]),
      new LineBasicMaterial({ color: 0x8893a6, transparent: true, opacity: 0.6 })));
    this.exoSpecMarker = new Mesh(new SphereGeometry(0.28, 14, 14), new MeshBasicMaterial({ color: 0xffffff }));
    this.exoSpecMarker.position.set(0, specY, specZ); g.add(this.exoSpecMarker);
    const sb = this.makeLabel('blue', 'vec-label'); sb.position.set(-half - 1, 0, specZ); g.add(sb);
    const sr = this.makeLabel('red', 'vec-label'); sr.position.set(half + 1, 0, specZ); g.add(sr);
    const st = this.makeLabel('starlight spectrum', 'vec-label'); st.position.set(0, 0, specZ + 1.4); g.add(st);

    g.visible = false; this.scene.add(g);
    this.exoGroup = g;
  }

  private buildResonance(): void {
    const g = new Group();
    const jupTex = surfaceTexture('jupiter', 0xd0a878);
    const jup = new Mesh(new SphereGeometry(2.2, 32, 32),
      new MeshStandardMaterial({ map: jupTex, emissiveMap: jupTex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 1 }));
    g.add(jup);
    const radii = [5, 7.5, 10];
    const names = ['Io', 'Europa', 'Ganymede'];
    const colors = [0xe8e08a, 0xe6ddd0, 0xc9b89a];
    this.resMoons = [];
    for (let i = 0; i < 3; i++) {
      g.add(this.circleLine(radii[i], 0x394056, 0.4));
      const m = new Mesh(new SphereGeometry(0.5, 20, 20), new MeshStandardMaterial({ color: colors[i], emissive: 0x222018, emissiveIntensity: 0.3, roughness: 1 }));
      m.userData.r = radii[i]; g.add(m); this.resMoons.push(m);
      const l = this.makeLabel(names[i], 'moon-label'); m.userData.label = l; g.add(l);
    }
    g.visible = false; this.scene.add(g);
    this.resGroup = g;
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


  // ---- builders for the demos distilled from the reference animations -----

  /** A small glowing star-like ball (the Sun in the schematic demos). */
  private sunBall(r: number): Mesh {
    const tex = surfaceTexture('sun', 0xffb056);
    const m = new Mesh(new SphereGeometry(r, 32, 32),
      new MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1, roughness: 1 }));
    const glow = new Mesh(new SphereGeometry(r * 1.5, 24, 24),
      new MeshBasicMaterial({ color: 0xffb056, transparent: true, opacity: 0.18, blending: AdditiveBlending, side: BackSide }));
    m.add(glow);
    return m;
  }

  /** A label parked at a point in the X–Z plane (the top-down demo layout). */
  private planeLabel(g: Group, text: string, x: number, z: number, y = 0): CSS2DObject {
    const l = this.makeLabel(text, 'vec-label');
    l.position.set(x, y, z);
    g.add(l);
    return l;
  }

  /** Light-travel-time slide: distances compressed as √AU so Neptune still fits. */
  private llRadius(au: number): number { return 27 * Math.sqrt(au / 30.07); }

  /** "8m 19s" / "4h 10m" — light time, for a readout that stays put. */
  private llFormat(min: number): string {
    return min < 60
      ? `${Math.floor(min)}m ${Math.floor((min % 1) * 60)}s`
      : `${Math.floor(min / 60)}h ${Math.floor(min % 60)}m`;
  }

  private buildLightLag(): void {
    const g = new Group();
    g.add(this.sunBall(1.3));
    const planets: [string, number, number][] = [
      ['Mercury', 0.387, 0x9e8d7a], ['Venus', 0.723, 0xd9b27a], ['Earth', 1.0, 0x5b8dd6],
      ['Mars', 1.524, 0xc1603c], ['Jupiter', 5.203, 0xd0a878], ['Saturn', 9.537, 0xd8c08a],
      ['Uranus', 19.19, 0x8fd0d8], ['Neptune', 30.07, 0x5a7fd8],
    ];
    planets.forEach(([name, au, color], i) => {
      const r = this.llRadius(au);
      g.add(this.circleLine(r, 0x3d4657, 0.3));
      // Fan the planets out around the Sun so their labels never collide.
      const ang = MathUtils.degToRad(104 - i * 27);
      const x = Math.cos(ang) * r, z = -Math.sin(ang) * r;
      const dot = new Mesh(new SphereGeometry(name === 'Earth' ? 0.5 : 0.42, 16, 16),
        new MeshBasicMaterial({ color }));
      dot.position.set(x, 0, z);
      g.add(dot);
      // Push each label out along its own spoke — and hold the inner four out
      // at a common radius, where their spokes have fanned far enough apart.
      const lr = Math.max(r + 3.2, 11.5);
      const label = this.planeLabel(g, name, Math.cos(ang) * lr, -Math.sin(ang) * lr);
      const el = label.element as HTMLElement;
      el.classList.add('stack'); // name over time
      // Both lines exist from the start, with the time merely invisible until
      // the light gets here. Growing the label from one line to two instead
      // would resize and shift it — and the four inner planets are all reached
      // within a second and a half of the slide appearing, so those jumps land
      // together and read as a blink.
      el.innerHTML = `${name}<br><b></b>`;
      const timeEl = el.querySelector('b') as HTMLElement;
      timeEl.textContent = this.llFormat(au * 8.3167);
      timeEl.style.visibility = 'hidden';
      this.llPlanets.push({ au, name, dot, label, timeEl });
    });
    // The wavefront: a unit circle scaled out at the speed of light.
    this.llRing = this.circleLine(1, 0xffe6a8, 0.9);
    g.add(this.llRing);
    this.llClock = this.planeLabel(g, '', 0, -31);
    (this.llClock.element as HTMLElement).classList.add('big', 'clock');
    g.visible = false; this.scene.add(g);
    this.llGroup = g;
  }

  /** Geoid slide: a globe bumped by the real field's largest anomalies. */
  private buildGeoid(): void {
    const g = new Group();
    // The biggest features of the real geoid (lat°, lon°, height in metres).
    // (lat°, lon°, height in metres, angular width in radians)
    const bumps: [number, number, number, number][] = [
      [4.7, 78.8, -106, 0.55],  // Indian Ocean low — the deepest dimple on Earth
      [-5, 141, 85, 0.5],       // New Guinea / west Pacific high
      [52, -32, 65, 0.45],      // North Atlantic high
      [-50, 60, -58, 0.42],     // south Indian Ocean low
      [15, -78, -52, 0.4],      // Caribbean low
      [-20, -30, 44, 0.4],      // South Atlantic high
      [58, 130, 40, 0.38],      // north-east Asia high
      [-62, -150, 52, 0.36],    // south Pacific / Ross high
      [35, -110, -40, 0.3],     // North American low
      [-28, 122, -34, 0.3],     // Australian low
      [12, 18, 32, 0.28],       // central African high
      [70, 60, -30, 0.3],       // west Siberian low
      [-8, -170, -28, 0.26],    // central Pacific low
      [40, 90, 30, 0.26],       // Tibetan high
    ];
    const dirOf = (lat: number, lon: number): Vector3 => {
      const a = MathUtils.degToRad(lat), b = MathUtils.degToRad(lon);
      return new Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), Math.cos(a) * Math.sin(b));
    };
    const dirs = bumps.map(([lat, lon]) => dirOf(lat, lon));
    const R = 6;
    const height = (n: Vector3): number => {
      let h = 0;
      for (let i = 0; i < bumps.length; i++) {
        const ang = Math.acos(MathUtils.clamp(n.dot(dirs[i]), -1, 1));
        const sg = bumps[i][3];
        h += bumps[i][2] * Math.exp(-(ang * ang) / (2 * sg * sg));
      }
      return h;
    };
    const geo = new SphereGeometry(R, 128, 80);
    const pos = geo.getAttribute('position') as Float32BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const n = new Vector3();
    // The standard geoid ramp: deep blue lows → green mean → red highs.
    const ramp = [0x0d2a8c, 0x2a7fe0, 0x1f9e7a, 0xe8c341, 0xe0431c].map((h) => new Color(h));
    const rampAt = (t: number, out: Color): Color => {
      const f = MathUtils.clamp((t + 1) / 2, 0, 1) * (ramp.length - 1);
      const i = Math.min(ramp.length - 2, Math.floor(f));
      return out.copy(ramp[i]).lerp(ramp[i + 1], f - i);
    };
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const h = height(n);
      const disp = R + h * 0.016; // ±100 m → ±1.6 units: exaggerated ~30,000×
      pos.setXYZ(i, n.x * disp, n.y * disp, n.z * disp);
      rampAt(MathUtils.clamp(h / 70, -1, 1), c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.geoidMesh = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
    g.add(this.geoidMesh);
    // A sphere at mean radius, for "what a uniform Earth would look like".
    const ref = new LineSegments(new WireframeGeometry(new SphereGeometry(R, 24, 16)),
      new LineBasicMaterial({ color: 0x8fa3c4, transparent: true, opacity: 0.12 }));
    // A hair above mean radius: where an anomaly is near zero the globe's own
    // surface sits exactly at R, and two coincident surfaces flicker.
    ref.scale.setScalar(1.006);
    this.geoidMesh.add(ref);
    // Labels ride with the globe, so each stays over its own anomaly.
    const tag = (text: string, lat: number, lon: number, h: number) => {
      const l = this.makeLabel(text, 'vec-label');
      l.position.copy(dirOf(lat, lon)).multiplyScalar(R + h * 0.016 + 1.2);
      this.geoidMesh.add(l);
      this.geoidTags.push(l); // hidden while its anomaly is on the far side
    };
    tag('Indian Ocean · −106 m', 4.7, 78.8, -106);
    tag('New Guinea · +85 m', -5, 141, 85);
    tag('North Atlantic · +65 m', 52, -32, 65);
    // The group carries its own light: the scene's only lamp sits at the Sun
    // (the origin), which is *inside* this globe.
    const key = new DirectionalLight(0xffffff, 2.2); key.position.set(6, 5, 9); g.add(key);
    g.add(new AmbientLight(0x3a4560, 0.9));
    g.visible = false; this.scene.add(g);
    this.geoidGroup = g;
  }

  /** Magnetosphere slide: solar wind streaming past a deflecting dipole field. */
  private buildMagnetosphere(): void {
    const g = new Group();
    const R = 2.2;             // Earth's radius here
    const NOSE = 7.4;          // magnetopause stand-off distance
    const SHOCK = 9.6;         // bow shock stand-off
    // Everything is drawn in the X–Y plane, seen from +Z: Sun off to the right.
    const earth = new Mesh(new SphereGeometry(R, 40, 32),
      new MeshStandardMaterial({ color: 0x3a6fb0, emissive: 0x0d1c33, emissiveIntensity: 0.8, roughness: 1 }));
    g.add(earth);
    // Squash the sunward side, drag the nightside out into a tail.
    const warp = (x: number, y: number): Vector3 =>
      x >= 0 ? new Vector3(x * 0.68, y, 0)
        : new Vector3(x * 2.4, y * (1 - 0.3 * Math.min(1, -x / 9)), 0);
    const fieldMat = new LineBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.45 });
    for (const L of [1.5, 2.1, 3.0, 4.2, 6.0]) {
      for (const side of [1, -1]) {
        // Dipole line: r = L·R·cos²λ, drawn from footpoint to footpoint.
        const lamMax = Math.acos(Math.sqrt(1 / L)) * 0.995;
        const pts: Vector3[] = [];
        for (let i = 0; i <= 90; i++) {
          const lam = -lamMax + (2 * lamMax * i) / 90;
          const r = L * R * Math.cos(lam) * Math.cos(lam);
          pts.push(warp(side * r * Math.cos(lam), r * Math.sin(lam)));
        }
        g.add(new Line(new BufferGeometry().setFromPoints(pts), fieldMat));
      }
    }
    // Two open tail lobes: field lines swept back by the wind.
    for (const sign of [1, -1]) {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const x = -R * 1.1 - t * 34;
        pts.push(new Vector3(x, sign * (R * 1.2 + 3.4 * Math.sqrt(t)), 0));
      }
      g.add(new Line(new BufferGeometry().setFromPoints(pts), fieldMat));
    }
    // Magnetopause and bow shock: paraboloids opening away from the Sun.
    const para = (a: number, color: number, opacity: number): Line => {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 120; i++) {
        const y = -26 + (52 * i) / 120;
        pts.push(new Vector3(a - (y * y) / (4 * a), y, 0));
      }
      return new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color, transparent: true, opacity }));
    };
    g.add(para(NOSE, 0x9fb4ff, 0.55));
    g.add(para(SHOCK, 0xff9f6b, 0.4));
    // Solar wind: particles blown in from +X, shouldered aside by the shock.
    const N = 1400;
    this.magWindB = new Float32Array(N);
    this.magWindX = new Float32Array(N);
    this.magWindJ = new Float32Array(N); // spread, so they don't pile on one curve
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.magWindB[i] = (Math.random() * 2 - 1) * 24;
      this.magWindX[i] = 34 - Math.random() * 74;
      this.magWindJ[i] = 0.92 + Math.random() * 0.5;
    }
    const wgeo = new BufferGeometry();
    wgeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.magWind = new Points(wgeo, new PointsMaterial({
      color: 0xffd08a, size: 0.34, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false,
    }));
    g.add(this.magWind);
    // Aurora: glowing ovals where the field lines come down at the poles.
    this.magAurora = [];
    for (const sign of [1, -1]) {
      const a = new Mesh(new TorusGeometry(R * 0.42, 0.13, 10, 40),
        new MeshBasicMaterial({ color: 0x6bff9f, transparent: true, opacity: 0.9, blending: AdditiveBlending }));
      a.position.set(0, sign * R * 0.92, 0);
      a.rotation.x = Math.PI / 2;
      g.add(a); this.magAurora.push(a);
    }
    const lab = (text: string, x: number, y: number) => {
      const l = this.makeLabel(text, 'vec-label'); l.position.set(x, y, 0); g.add(l);
    };
    lab('Solar wind · 400 km/s', 16, 20);
    lab('Bow shock', SHOCK + 1.6, 3.4);
    lab('Magnetopause', 1.5, 13.6);
    lab('Magnetotail', -26, 5.4);
    lab('Aurora', 2.8, R * 1.5);
    lab('Earth', 0, -R - 1.6);
    g.visible = false; this.scene.add(g);
    this.magGroup = g;
  }

  /** Heliosphere slide: the wind's bubble, its shock, and the Voyagers. */
  private buildHeliosphere(): void {
    const g = new Group();
    g.add(this.sunBall(0.9));
    // Teardrop: round on the nose (+X, into the interstellar wind), long behind.
    const teardrop = (nose: number, color: number, opacity: number, dashed = false): Line => {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const th = (i / 160) * Math.PI * 2;
        const r = (nose * 1.18) / (1 + 0.18 * Math.cos(th));
        pts.push(new Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
      }
      const mat = dashed
        ? new LineDashedMaterial({ color, dashSize: 1.1, gapSize: 0.8, transparent: true, opacity })
        : new LineBasicMaterial({ color, transparent: true, opacity });
      const l = new Line(new BufferGeometry().setFromPoints(pts), mat);
      if (dashed) l.computeLineDistances();
      return l;
    };
    const AU = 0.17;              // scene units per AU
    const TS = 94 * AU * 1.0;     // termination shock, ~94 AU
    const HP = 121 * AU * 1.0;    // heliopause, ~121 AU
    g.add(teardrop(TS, 0xffb066, 0.5, true));
    g.add(teardrop(HP, 0x9fd8ff, 0.7));
    g.add(this.circleLine(30 * AU, 0x4a5568, 0.45));
    // Solar wind: particles streaming out, piling up in the heliosheath.
    const N = 2200;
    this.helWindR = new Float32Array(N);
    this.helWindA = new Float32Array(N);
    this.helWindV = new Float32Array(N); // spread of speeds, so no bands form
    for (let i = 0; i < N; i++) {
      this.helWindA[i] = Math.random() * Math.PI * 2;
      this.helWindR[i] = Math.random() * TS;
      this.helWindV[i] = 0.8 + Math.random() * 0.45;
    }
    const wgeo = new BufferGeometry();
    wgeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(N * 3), 3));
    this.helWind = new Points(wgeo, new PointsMaterial({
      color: 0xffc98a, size: 0.26, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false,
    }));
    g.add(this.helWind);
    // Interstellar wind blowing onto the nose.
    for (const z of [-11, 0, 11]) {
      const a = new ArrowHelper(new Vector3(-1, 0, 0), new Vector3(32, 0, z), 6, 0x8fa3ff, 1.6, 1.0);
      g.add(a);
    }
    // The two Voyagers, out past the shock (V1 crossed in 2012, V2 in 2018).
    const probe = (name: string, au: number, ang: number, color: number) => {
      const r = au * AU, x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const m = new Mesh(new SphereGeometry(0.4, 14, 14), new MeshBasicMaterial({ color }));
      m.position.set(x, 0, z); g.add(m);
      this.planeLabel(g, name, x, z - 1.6);
      const trail = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3(x, 0, z)]),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      g.add(trail);
    };
    probe('Voyager 1 · crossed 2012', 165, MathUtils.degToRad(35), 0xffe6a8);
    probe('Voyager 2 · crossed 2018', 140, MathUtils.degToRad(-58), 0xa8d8ff);
    this.planeLabel(g, 'Termination shock · 94 AU', TS * 0.72, -TS * 0.72);
    this.planeLabel(g, 'Heliopause · 121 AU', -HP * 0.5, HP * 0.86);
    this.planeLabel(g, 'Heliosheath', -TS * 1.25, -TS * 0.2);
    this.planeLabel(g, 'Neptune’s orbit · 30 AU', 0, 30 * AU + 1.8);
    this.planeLabel(g, 'Interstellar wind', 31, -17);
    g.visible = false; this.scene.add(g);
    this.helGroup = g;
  }

  /** Rose-of-Venus slide: chords between Earth and Venus over eight years. */
  private buildVenusRose(): void {
    const g = new Group();
    g.add(this.sunBall(1.0));
    const rE = 11, rV = 11 * 0.723;
    g.add(this.circleLine(rE, 0x4a6fa8, 0.35));
    g.add(this.circleLine(rV, 0xa88a4a, 0.35));
    this.roseEarth = new Mesh(new SphereGeometry(0.42, 16, 16), new MeshBasicMaterial({ color: 0x5b8dd6 }));
    this.roseVenus = new Mesh(new SphereGeometry(0.38, 16, 16), new MeshBasicMaterial({ color: 0xd9b27a }));
    g.add(this.roseEarth, this.roseVenus);
    // One chord every few days, accumulated into a single LineSegments buffer.
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.roseMaxSegs * 6), 3));
    lg.setDrawRange(0, 0);
    this.roseLines = new LineSegments(lg, new LineBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.32 }));
    this.roseLines.frustumCulled = false;
    g.add(this.roseLines);
    this.roseLabel = this.planeLabel(g, '', 0, -15.4);
    this.planeLabel(g, 'Earth', 0, rE + 1.4);
    this.planeLabel(g, 'Venus', 0, -rV - 1.4);
    g.visible = false; this.scene.add(g);
    this.roseGroup = g;
  }

  /** Polaris slide: the axis stays parallel all year, so one star holds still. */
  private buildPolaris(): void {
    const g = new Group();
    g.add(this.sunBall(1.6));
    const R = 12;
    g.add(this.circleLine(R, 0x4a6fa8, 0.4));
    // Earth's axis: 23.4° off the orbit normal, and fixed in space all year.
    const tilt = MathUtils.degToRad(23.4);
    const AX = new Vector3(0, Math.cos(tilt), -Math.sin(tilt));
    const earthAt = (ang: number): Vector3 => new Vector3(Math.cos(ang) * R, 0, Math.sin(ang) * R);
    // Four ghosts around the orbit make the parallelism impossible to miss.
    for (let k = 0; k < 4; k++) {
      const p = earthAt((k / 4) * Math.PI * 2);
      const ghost = new Mesh(new SphereGeometry(0.9, 20, 20),
        new MeshStandardMaterial({ color: 0x3a6fb0, transparent: true, opacity: 0.28, roughness: 1 }));
      ghost.position.copy(p); g.add(ghost);
      const a = p.clone().add(AX.clone().multiplyScalar(-4.4));
      const b = p.clone().add(AX.clone().multiplyScalar(4.4));
      g.add(new Line(new BufferGeometry().setFromPoints([a, b]),
        new LineBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.5 })));
    }
    this.polEarth = new Mesh(new SphereGeometry(1.15, 32, 24),
      new MeshStandardMaterial({ color: 0x4a86d0, emissive: 0x0d1c33, emissiveIntensity: 0.7, roughness: 1 }));
    g.add(this.polEarth);
    this.polAxis = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: 0xffffff }));
    this.polAxis.frustumCulled = false; g.add(this.polAxis);
    // Polaris: far enough that the whole orbit is a rounding error in its aim.
    const polarisPos = AX.clone().multiplyScalar(34);
    const star = new Mesh(new SphereGeometry(0.85, 18, 18), new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending }));
    star.position.copy(polarisPos); g.add(star);
    const sl = this.makeLabel('Polaris · 433 light-years', 'vec-label');
    sl.position.copy(polarisPos).add(new Vector3(0, 2.4, 0)); g.add(sl);
    this.polSight = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineDashedMaterial({ color: 0xffe6a8, dashSize: 1.2, gapSize: 0.9, transparent: true, opacity: 0.6 }));
    this.polSight.frustumCulled = false; g.add(this.polSight);
    // The 26,000-year wobble: the axis traces a circle on the sky.
    const cone = 34 * Math.sin(tilt), coneY = 34 * Math.cos(tilt);
    const prec = this.circleLine(cone, 0x9fb4ff, 0.35);
    prec.position.set(0, coneY, 0); g.add(prec);
    this.polPrecDot = new Mesh(new SphereGeometry(0.4, 14, 14), new MeshBasicMaterial({ color: 0x9fb4ff }));
    g.add(this.polPrecDot);
    const vegaAng = Math.PI / 2; // half a wobble from now (Polaris sits at −π/2)
    const vl = this.makeLabel('Vega — the pole star in 12,000 years', 'vec-label');
    vl.position.set(Math.cos(vegaAng) * cone, coneY, Math.sin(vegaAng) * cone + 2.4); g.add(vl);
    this.planeLabel(g, '26,000-year wobble', -cone - 2.5, 0, coneY);
    this.planeLabel(g, 'Sun', 0, -2.6);
    g.visible = false; this.scene.add(g);
    this.polGroup = g;
  }

  /** "Never standing still": spin inside orbit inside the galactic orbit.
   *  The galaxy is too big to draw whole here, so the Sun holds the centre and
   *  the galaxy streams past it — an arc underfoot and a drifting star field. */
  private buildCosmicMotion(): void {
    const g = new Group();
    const rOrb = 9, rSpin = 2.6, rGal = 70;
    // The Sun's galactic orbit: an arc so wide it reads as a gentle curve.
    const galArc: Vector3[] = [];
    for (let i = 0; i <= 200; i++) {
      const a = -Math.PI / 2 + (i / 200 - 0.5) * 1.5;
      galArc.push(new Vector3(Math.cos(a) * rGal, 0, rGal + Math.sin(a) * rGal));
    }
    g.add(new Line(new BufferGeometry().setFromPoints(galArc),
      new LineBasicMaterial({ color: 0x8a7bff, transparent: true, opacity: 0.45 })));
    // Stars streaming backwards past us: the parallax of 230 km/s.
    const N = 700;
    this.cmStars = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.cmStars[i * 3] = (Math.random() - 0.5) * 110;
      this.cmStars[i * 3 + 1] = (Math.random() - 0.5) * 8;
      this.cmStars[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const sgeo = new BufferGeometry();
    sgeo.setAttribute('position', new Float32BufferAttribute(this.cmStars, 3));
    this.cmStarField = new Points(sgeo, new PointsMaterial({
      color: 0xc9d4ff, size: 0.3, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false,
    }));
    g.add(this.cmStarField);
    // Level 1 — the Sun, holding the centre while the galaxy slides past.
    const sun = this.sunBall(1.5); g.add(sun);
    g.add(new ArrowHelper(new Vector3(1, 0, 0), new Vector3(3.4, 0, 9.5), 12, 0xc9b8ff, 2.2, 1.3));
    this.planeLabel(g, 'The Sun · 230 km/s around the galaxy', 9, 12.4);
    this.planeLabel(g, 'Galactic centre · 26,000 light-years this way ↓', -8, 22);
    // Level 2 — Earth's 29.8 km/s lap of the Sun.
    this.cmSunPivot = new Group(); g.add(this.cmSunPivot);
    g.add(this.circleLine(rOrb, 0x4a6fa8, 0.45));
    const earth = new Mesh(new SphereGeometry(1.0, 24, 20),
      new MeshStandardMaterial({ color: 0x4a86d0, emissive: 0x0d1c33, emissiveIntensity: 0.7, roughness: 1 }));
    earth.position.set(rOrb, 0, 0); this.cmSunPivot.add(earth);
    const el = this.makeLabel('Earth · 29.8 km/s around the Sun', 'vec-label');
    el.position.set(rOrb + 6.2, 0, -3.4); this.cmSunPivot.add(el);
    // Level 3 — you, carried around by the spin: 0.46 km/s at the equator.
    this.cmYouPivot = new Group(); earth.add(this.cmYouPivot);
    earth.add(this.circleLine(rSpin, 0x6bff9f, 0.35));
    const you = new Mesh(new SphereGeometry(0.34, 14, 14), new MeshBasicMaterial({ color: 0x6bff9f }));
    you.position.set(rSpin, 0, 0); this.cmYouPivot.add(you);
    const yl = this.makeLabel('You · 0.46 km/s with the spin', 'vec-label');
    yl.position.set(rSpin + 4.4, 0, 2.2); this.cmYouPivot.add(yl);
    // And the whole lot drifting against the cosmic microwave background.
    g.add(new ArrowHelper(new Vector3(-0.7, 0, -0.72).normalize(), new Vector3(-16, 0, -6), 10, 0x9fd8ff, 1.8, 1.0));
    this.planeLabel(g, 'The Milky Way · ~600 km/s through the cosmic background', -19, -17);
    this.cmOdo = this.planeLabel(g, '', -2, -25);
    (this.cmOdo.element as HTMLElement).classList.add('big');
    g.visible = false; this.scene.add(g);
    this.cmGroup = g;
  }

  /** Early-universe slide: near-uniform gas pulled into the cosmic web. */
  private buildEarlyUniverse(): void {
    const g = new Group();
    const N = 9000, RBOX = 21;
    // A deterministic layout, so the web looks the same on every visit.
    let seed = 20240517;
    const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const inBall = (r: number): Vector3 => {
      const u = Math.pow(rand(), 1 / 3) * r, th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
      return new Vector3(u * Math.sin(ph) * Math.cos(th), u * Math.cos(ph), u * Math.sin(ph) * Math.sin(th));
    };
    // Nodes of the web, joined to their two nearest neighbours by filaments.
    const nodes: Vector3[] = [];
    for (let i = 0; i < 15; i++) nodes.push(inBall(RBOX * 0.82));
    const edges: [Vector3, Vector3][] = [];
    for (const a of nodes) {
      const others = nodes.filter((n) => n !== a).sort((p, q) => p.distanceTo(a) - q.distanceTo(a));
      for (const b of others.slice(0, 2)) edges.push([a, b]);
    }
    this.euP0 = new Float32Array(N * 3);
    this.euP1 = new Float32Array(N * 3);
    const ab = new Vector3(), ap = new Vector3(), proj = new Vector3(), best = new Vector3();
    for (let i = 0; i < N; i++) {
      const p = inBall(RBOX); // t = 0: gas spread almost perfectly evenly
      this.euP0.set([p.x, p.y, p.z], i * 3);
      // t = 1: collapsed onto the nearest filament (nodes are where they cross).
      let bestD = Infinity;
      for (const [a, b] of edges) {
        ab.subVectors(b, a); ap.subVectors(p, a);
        const t = MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
        proj.copy(a).addScaledVector(ab, t);
        const d = proj.distanceTo(p);
        if (d < bestD) { bestD = d; best.copy(proj); }
      }
      const jitter = 0.55 + Math.min(2.2, bestD * 0.12);
      this.euP1.set([
        best.x + (rand() - 0.5) * jitter * 2,
        best.y + (rand() - 0.5) * jitter * 2,
        best.z + (rand() - 0.5) * jitter * 2,
      ], i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.euP0.slice(), 3));
    this.euPoints = new Points(geo, new PointsMaterial({
      color: 0x9fb8ff, size: 0.26, transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false,
    }));
    g.add(this.euPoints);
    this.euLabel = this.makeLabel('', 'vec-label big');
    this.euLabel.position.set(0, RBOX + 4, 0); g.add(this.euLabel);
    g.visible = false; this.scene.add(g);
    this.euGroup = g;
  }

  // ---- extended demos: start (camera + reset), animated by updateExtras ----

  /** Shared setup for the extended demos: set mode, hide dust/parallax/bodies. */
  private beginExtra(mode: DemoMode): void {
    this.state.demoMode = mode;
    if (this.dust) this.dust.visible = false;
    if (this.parallax) this.parallax.visible = false;
    for (const v of this.views) {
      if (!this.isVisible(v.body.id)) { v.opacity = 0; v.mesh.visible = false; }
    }
  }

  startBlackHole(): void {
    this.beginExtra('blackhole');
    this.bhInfallT = 0;
    this.flyTo(new Vector3(0, 9, 27), new Vector3(0, -10, 0));
  }
  startGravWaves(): void {
    this.beginExtra('gwaves');
    this.gwPhase = 0; this.gwInspiral = 0;
    this.flyTo(new Vector3(0, 30, 30), new Vector3(0, 0, 0));
  }
  startLensing(): void {
    this.beginExtra('lensing');
    this.lensPulseT = 0;
    this.flyTo(new Vector3(-2, 34, 0.001), new Vector3(-2, 0, 0));
  }
  startTimeDilation(): void {
    this.beginExtra('timedilation');
    this.tdNear = 0; this.tdFar = 0;
    this.flyTo(new Vector3(4, 18, 34), new Vector3(4, -6, 0));
  }
  startMilkyWay(): void {
    this.beginExtra('milkyway');
    this.mwAngle = 0;
    this.flyTo(new Vector3(0, 40, 52), new Vector3(0, 0, 0));
  }
  startSgrA(): void {
    this.beginExtra('sgra');
    this.sgrM = 0; this.sgrTrailPts.length = 0;
    // Low and close: at this angle the disk is nearly edge-on, so the lensed
    // halo stands up around the shadow the way Gargantua's does.
    this.flyTo(new Vector3(-4, 20, 30), new Vector3(-4, 0, 0));
  }
  startDarkMatter(): void {
    this.beginExtra('darkmatter');
    this.flyTo(new Vector3(0, 36, 0.001), new Vector3(0, 0, 0));
  }
  startLagrange(): void {
    this.beginExtra('lagrange');
    this.lagAngle = 0; this.lagT = 0;
    // Framed so the whole contour disc clears the narration panel on the right.
    this.flyTo(new Vector3(7.5, 32, 0.001), new Vector3(7.5, 0, 0));
  }
  startTides(): void {
    this.beginExtra('tides');
    this.tideMoonAngle = 0; this.tideSpin = 0; this.tideClock = 0;
    this.flyTo(new Vector3(0, 26, 13), new Vector3(0, 0, 0));
  }
  startExoplanet(): void {
    this.beginExtra('exoplanet');
    this.exoAngle = 0; this.exoStarTrailPts.length = 0;
    this.flyTo(new Vector3(0, 27, 30), new Vector3(0, 0, 7));
  }
  startResonance(): void {
    this.beginExtra('resonance');
    this.resAngle = 0;
    this.flyTo(new Vector3(0, 30, 0.001), new Vector3(0, 0, 0));
  }


  startLightLag(): void {
    this.beginExtra('lightlag');
    this.llT = 0;
    this.flyTo(new Vector3(-5, 110, 0.001), new Vector3(-5, 0, 0));
  }
  startGeoid(): void {
    this.beginExtra('geoid');
    this.flyTo(new Vector3(-1, 7, 25), new Vector3(-2, 0, 0));
  }
  startMagnetosphere(): void {
    this.beginExtra('magnetosphere');
    this.magT = 0;
    this.flyTo(new Vector3(-6, 2, 80), new Vector3(-6, 0, 0));
  }
  startHeliosphere(): void {
    this.beginExtra('heliosphere');
    this.flyTo(new Vector3(-9, 88, 0.001), new Vector3(-9, 0, 0));
  }
  startVenusRose(): void {
    this.beginExtra('venusrose');
    this.roseT = 0; this.roseSegs = 0;
    this.roseLines.geometry.setDrawRange(0, 0);
    this.flyTo(new Vector3(-3, 38, 0.001), new Vector3(-3, 0, 0));
  }
  startPolaris(): void {
    this.beginExtra('polaris');
    this.polAngle = 0; this.polPrecT = 0;
    this.flyTo(new Vector3(24, 18, 48), new Vector3(-4, 14, -4));
  }
  startCosmicMotion(): void {
    this.beginExtra('cosmicmotion');
    this.cmT = 0;
    this.cmSunPivot.rotation.y = 0;
    this.cmYouPivot.rotation.y = 0;
    this.flyTo(new Vector3(-5, 44, 30), new Vector3(-5, 0, 2));
  }
  startEarlyUniverse(): void {
    this.beginExtra('earlyuniverse');
    this.euT = 0; this.euGroup.rotation.y = 0;
    this.flyTo(new Vector3(-5, 14, 68), new Vector3(-5, 0, 0));
  }

  /** Toggle + animate every extended-demo overlay based on the current mode. */
  private updateExtras(dtReal: number): void {
    const mode = this.state.demoMode;
    const paused = this.state.paused;
    this.bhGroup.visible = mode === 'blackhole';
    this.gwGroup.visible = mode === 'gwaves';
    this.lensGroup.visible = mode === 'lensing';
    this.tdGroup.visible = mode === 'timedilation';
    this.mwGroup.visible = mode === 'milkyway';
    this.sgrGroup.visible = mode === 'sgra';
    this.dmGroup.visible = mode === 'darkmatter';
    this.lagGroup.visible = mode === 'lagrange';
    this.tideGroup.visible = mode === 'tides';
    this.exoGroup.visible = mode === 'exoplanet';
    this.resGroup.visible = mode === 'resonance';
    this.llGroup.visible = mode === 'lightlag';
    this.geoidGroup.visible = mode === 'geoid';
    this.magGroup.visible = mode === 'magnetosphere';
    this.helGroup.visible = mode === 'heliosphere';
    this.roseGroup.visible = mode === 'venusrose';
    this.polGroup.visible = mode === 'polaris';
    this.cmGroup.visible = mode === 'cosmicmotion';
    this.euGroup.visible = mode === 'earlyuniverse';
    this.lagLegend.style.display = mode === 'lagrange' ? 'block' : 'none';
    this.tidePanel.style.display = mode === 'tides' ? 'block' : 'none';
    this.tideGraph.style.display = mode === 'tides' ? 'block' : 'none';

    // CSS2D labels are drawn by a separate renderer that doesn't inherit a
    // parent Group's visibility, so toggle each group's labels explicitly.
    const showLab = this.state.showLabels;
    for (const g of [this.bhGroup, this.gwGroup, this.lensGroup, this.tdGroup, this.mwGroup,
      this.sgrGroup, this.dmGroup, this.lagGroup, this.tideGroup, this.exoGroup, this.resGroup,
      this.llGroup, this.geoidGroup, this.magGroup, this.helGroup, this.roseGroup,
      this.polGroup, this.cmGroup, this.euGroup]) {
      const on = g.visible && showLab;
      g.traverse((o) => { if ((o as { isCSS2DObject?: boolean }).isCSS2DObject) o.visible = on; });
    }

    if (mode === 'blackhole') {
      if (!paused) { this.bhDisk.rotation.z += dtReal * 0.5; this.bhInfallT += dtReal * 0.16; if (this.bhInfallT > 1) this.bhInfallT = 0; }
      // Infalling body: spirals in (radius shrinks), heats up (blue→white), and
      // stretches radially into "spaghetti" as tidal forces grow near the horizon.
      const t = this.bhInfallT;
      const ease = t * t; // accelerates inward
      const r = MathUtils.lerp(9, this.bhHorizonR, ease);
      const ang = t * Math.PI * 7;
      const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
      this.bhBody.position.set(cx, this.bhHorizonY, cz);
      const center = new Vector3(0, this.bhHorizonY, 0);
      this.bhBody.lookAt(center); // local +Z points at the hole
      const stretch = 1 + Math.pow(t, 3) * 22; // dramatic near the end
      this.bhBody.scale.set(Math.max(0.25, 1 - t * 0.7), Math.max(0.25, 1 - t * 0.7), stretch);
      const m = this.bhBody.material as MeshBasicMaterial;
      m.color.copy(new Color(0x9fc6ff)).lerp(new Color(0xffffff), t); // heats up
      m.transparent = true; m.opacity = t > 0.92 ? (1 - t) / 0.08 : 1; // vanish at the horizon
    } else if (mode === 'gwaves') {
      if (!paused) {
        this.gwInspiral += dtReal * 0.12; if (this.gwInspiral > 1) this.gwInspiral = 0;
        const R = MathUtils.lerp(8, 1.6, this.gwInspiral);
        this.gwPhase += dtReal * (1.0 + 6 * (1 - R / 8));
      }
      const R = MathUtils.lerp(8, 1.6, this.gwInspiral);
      this.gwA.position.set(Math.cos(this.gwPhase) * R, 0, Math.sin(this.gwPhase) * R);
      this.gwB.position.set(-Math.cos(this.gwPhase) * R, 0, -Math.sin(this.gwPhase) * R);
      const maxR = 24;
      for (let i = 0; i < this.gwRings.length; i++) {
        const frac = ((this.gwPhase * 0.09 + i / this.gwRings.length) % 1 + 1) % 1;
        const rr = 2 + frac * maxR;
        this.gwRings[i].scale.setScalar(rr);
        (this.gwRings[i].material as LineBasicMaterial).opacity = 0.5 * (1 - frac);
      }
    } else if (mode === 'lensing') {
      if (!paused) { this.lensPulseT += dtReal * 0.22; if (this.lensPulseT > 1) this.lensPulseT = 0; }
      const p = this.lensPulsePath;
      if (p.length) {
        const f = this.lensPulseT * (p.length - 1);
        const i0 = Math.floor(f), i1 = Math.min(p.length - 1, i0 + 1), k = f - i0;
        this.lensPulse.position.lerpVectors(p[i0], p[i1], k);
      }
    } else if (mode === 'timedilation') {
      if (!paused) { this.tdFar += dtReal; this.tdNear += dtReal * 0.55; } // near the mass runs slow
      this.tdNearHand.rotation.z = -this.tdNear * 1.6;
      this.tdFarHand.rotation.z = -this.tdFar * 1.6;
      (this.tdNearLabel.element as HTMLElement).textContent = `Near: ${this.tdNear.toFixed(1)} s`;
      (this.tdFarLabel.element as HTMLElement).textContent = `Far: ${this.tdFar.toFixed(1)} s`;
    } else if (mode === 'milkyway') {
      if (!paused) this.mwAngle += dtReal * 0.05;
      this.mwDisk.rotation.y = this.mwAngle;
    } else if (mode === 'sgra') {
      if (!paused) this.sgrM += dtReal * 0.9;
      const a = this.sgrA, e = this.sgrE, b = a * Math.sqrt(1 - e * e);
      let E = this.sgrM;
      for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - this.sgrM) / (1 - e * Math.cos(E));
      // Focus at the origin (BH): shift the ellipse by +c so a focus sits at 0.
      const c = a * e;
      this.sgrStar.position.set(a * Math.cos(E) - c, 0, b * Math.sin(E));
      this.sgrLabel.position.copy(this.sgrStar.position).add(new Vector3(0, 0, 1.2));
      if (!paused) {
        this.sgrTrailPts.push(this.sgrStar.position.clone());
        if (this.sgrTrailPts.length > this.maxTrail) this.sgrTrailPts.shift();
        const arr = (this.sgrTrail.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        for (let k = 0; k < this.sgrTrailPts.length; k++) { const p = this.sgrTrailPts[k]; arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z; }
        this.sgrTrail.geometry.setDrawRange(0, this.sgrTrailPts.length);
        (this.sgrTrail.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      }
    } else if (mode === 'darkmatter') {
      const vObs = 4.2; // flat rotation speed (same at every radius)
      for (const s of this.dmStars) {
        if (!paused) s.angle += (vObs / s.r) * dtReal * 0.5;
        const x = Math.cos(s.angle) * s.r, z = Math.sin(s.angle) * s.r;
        s.mesh.position.set(x, 0, z);
        const tang = new Vector3(-Math.sin(s.angle), 0, Math.cos(s.angle));
        s.obs.position.set(x, 0, z); s.obs.setDirection(tang); s.obs.setLength(2.6, 0.8, 0.45);
        const vKep = 9 / Math.sqrt(s.r); // expected Keplerian falloff (∝ 1/√r)
        s.ghost.position.set(x, 0.05, z); s.ghost.setDirection(tang); s.ghost.setLength(vKep, 0.8, 0.45);
      }
    } else if (mode === 'tides') {
      if (!paused) { this.tideSpin += dtReal * 0.7; this.tideMoonAngle += dtReal * 0.12; } // Earth spins fast; Moon orbits slowly
      const eR = 2.4, aX = eR * 1.44, bZ = eR * 1.06, moonR = 12;
      // Moon orbits Earth; the two tidal bulges always line up with it.
      const m = this.tideMoonAngle;
      const moonDir = new Vector3(Math.cos(m), 0, Math.sin(m));
      const perpDir = new Vector3(-moonDir.z, 0, moonDir.x);
      this.tideMoon.position.copy(moonDir).multiplyScalar(moonR);
      this.tideMoonLabel.position.copy(this.tideMoon.position).add(new Vector3(0, 0, 1.6));
      this.tideEarth.rotation.y = this.tideSpin; // Earth spins independently of the bulge
      this.tideBulge.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), moonDir); // long axis → Moon
      // Tidal axis (Earth → Moon).
      const ax = (this.tideAxis.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      ax[0] = 0; ax[1] = 0; ax[2] = 0; ax[3] = this.tideMoon.position.x; ax[4] = 0; ax[5] = this.tideMoon.position.z;
      (this.tideAxis.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      this.tideAxis.computeLineDistances();
      // Region labels track the bulge: highs along the Moon axis, lows across it.
      this.tideRegionLabels[0].position.copy(moonDir).multiplyScalar(aX + 1.4);
      this.tideRegionLabels[1].position.copy(moonDir).multiplyScalar(-(aX + 1.4));
      this.tideRegionLabels[2].position.copy(perpDir).multiplyScalar(eR + 1.2);
      this.tideRegionLabels[3].position.copy(perpDir).multiplyScalar(-(eR + 1.2));
      // The city is a child of Earth, so its world direction follows the spin
      // (local +Z under rotation.y=tideSpin → (sin, 0, cos)). Water above it
      // rises as it turns toward the Moon axis (high tide), drops between (low).
      const cityDir = new Vector3(Math.sin(this.tideSpin), 0, Math.cos(this.tideSpin));
      const cosA = cityDir.dot(moonDir), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const waterR = 1 / Math.sqrt((cosA / aX) ** 2 + (sinA / bZ) ** 2);
      const base = cityDir.clone().multiplyScalar(eR);
      const top = cityDir.clone().multiplyScalar(waterR);
      const arr = (this.tideColumn.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      arr[0] = base.x; arr[1] = 0; arr[2] = base.z; arr[3] = top.x; arr[4] = 0; arr[5] = top.z;
      (this.tideColumn.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      this.tideCityLabel.position.copy(top).add(cityDir.clone().multiplyScalar(1.0));
      const isHigh = Math.abs(cosA) > 0.5;
      (this.tideCityLabel.element as HTMLElement).textContent = isHigh ? 'High tide' : 'Low tide';
      // Realistic 30-day tide signal (spring/neap beat) drives the graph marker,
      // the coastline water level, and the side-view red dot — all in sync.
      if (!paused) { this.tideClock += dtReal * 0.9; if (this.tideClock > 30) this.tideClock = 0; }
      const h = this.tideHeight(this.tideClock);       // ~[-1, 1]
      const lvl = (h + 1) / 2;                          // 0 low … 1 high
      this.dioramaWater.position.y = -10 + 0.3 + lvl * 2.7; // box top rises 0.3 → 3
      this.dioramaDot.position.set(-2.5, this.dioramaWater.position.y + 10, 4);
      this.tideLabel2D.textContent = h > 0.35 ? 'High tide' : h < -0.35 ? 'Low tide' : 'Mid tide';
      // Graph marker traces the curve.
      const gx = 34 + (this.tideClock / 30) * (458 - 34);
      this.tideGraphDot.setAttribute('cx', gx.toFixed(1));
      this.tideGraphDot.setAttribute('cy', (86 - h * 52).toFixed(1));
    } else if (mode === 'exoplanet') {
      if (!paused) this.exoAngle += dtReal * 0.8;
      const d = 9, mS = 1, mP = 0.12, rS = d * mP / (mS + mP), rP = d * mS / (mS + mP);
      const a = this.exoAngle;
      this.exoStar.position.set(Math.cos(a) * rS, 0, Math.sin(a) * rS);
      this.exoPlanet.position.set(-Math.cos(a) * rP, 0, -Math.sin(a) * rP);
      // Doppler: the star's velocity is tangential; its component toward the
      // observer (at +Z) is ∝ cos(a). Approaching → blue, receding → red.
      const ap = Math.cos(a);
      const c = new Color(0xffffff);
      if (ap >= 0) c.lerp(new Color(0x5a9cff), ap); else c.lerp(new Color(0xff5a5a), -ap);
      (this.exoHalo.material as MeshBasicMaterial).color.copy(c);
      (this.exoBeam.material as LineBasicMaterial).color.copy(c);
      (this.exoSpecMarker.material as MeshBasicMaterial).color.copy(c);
      this.exoSpecMarker.position.x = -5 * ap;
      // Star↔planet link through the centre of mass, and the line of sight.
      const setSeg = (line: Line, ax: Vector3, bx: Vector3) => {
        const arr = (line.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        arr[0] = ax.x; arr[1] = ax.y; arr[2] = ax.z; arr[3] = bx.x; arr[4] = bx.y; arr[5] = bx.z;
        (line.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      };
      setSeg(this.exoLink, this.exoStar.position, this.exoPlanet.position);
      setSeg(this.exoBeam, this.exoStar.position, this.exoObserver.position);
      this.exoStateLabel.position.set(5.5, 0, 8);
      (this.exoStateLabel.element as HTMLElement).textContent =
        ap > 0.15 ? 'Approaching → blueshift' : ap < -0.15 ? 'Receding → redshift' : 'Sideways → no shift';
      if (!paused) {
        this.exoStarTrailPts.push(this.exoStar.position.clone());
        if (this.exoStarTrailPts.length > this.maxTrail) this.exoStarTrailPts.shift();
        const arr = (this.exoStarTrail.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        for (let k = 0; k < this.exoStarTrailPts.length; k++) { const p = this.exoStarTrailPts[k]; arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z; }
        this.exoStarTrail.geometry.setDrawRange(0, this.exoStarTrailPts.length);
        (this.exoStarTrail.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      }
    } else if (mode === 'lagrange') {
      if (!paused) { this.lagT += dtReal; this.lagAngle += dtReal * 0.2; } // one year ≈ 31 s
      this.lagSpin.rotation.y = this.lagAngle;
      // Station-keeping, for real: each probe rides its halo loop and, on top
      // of that, slides off down the unstable axis until a burn puts it back.
      for (const pr of this.lagProbes) {
        const a = this.lagT * pr.w + pr.ph;
        const cyc = ((this.lagT + pr.ph) % 6) / 6;
        const slip = (cyc < 0.85 ? (cyc / 0.85) ** 2 : 1 - (cyc - 0.85) / 0.15) * 1.4;
        pr.mesh.position.set(pr.x + Math.sin(a) * pr.ax + pr.dir * slip, 0, Math.cos(a) * pr.az);
        pr.mesh.scale.setScalar(cyc > 0.85 ? 2.1 : 1); // thruster flare on the way back
      }
      // Trojans crawling round their tadpoles — nudged off, always pulled back.
      for (const t of this.lagTrojans) {
        const th = this.lagT * t.w + t.ph;
        const lead = t.lead0 + t.s * t.a * Math.cos(th);
        const rad = t.r + t.s * t.b * Math.sin(th) * (1 + 0.55 * Math.cos(th));
        t.mesh.position.set(Math.cos(lead) * rad, 0, -Math.sin(lead) * rad);
      }
      const hp = this.lagHorsePath;
      this.lagHorse.position.copy(hp[Math.floor(((this.lagT * 0.03) % 1) * hp.length) % hp.length]);
    } else if (mode === 'resonance') {
      if (!paused) this.resAngle += dtReal * 0.7;
      // Periods in 1:2:4 → angular speeds 4:2:1 (Io fastest).
      const w = [4, 2, 1];
      for (let i = 0; i < this.resMoons.length; i++) {
        const m = this.resMoons[i];
        const r = m.userData.r as number;
        const a = this.resAngle * w[i];
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        (m.userData.label as CSS2DObject).position.copy(m.position).add(new Vector3(0, 0, 1.1));
      }
    } else if (mode === 'lightlag') {
      // A wavefront leaving the Sun, clocked as it reaches each planet.
      if (!paused) { this.llT += dtReal * 9; if (this.llT > 290) this.llT = 0; } // minutes
      const au = this.llT / 8.3167; // light covers 1 AU in 499 s
      this.llRing.scale.setScalar(Math.max(0.05, this.llRadius(au)));
      (this.llRing.material as LineBasicMaterial).opacity = 0.9;
      // The running clock is zero-padded so its width never changes: with a
      // proportional jump every frame the readout reads as a flicker.
      const pad = (min: number): string => min < 60
        ? `${String(Math.floor(min)).padStart(2, '0')}m ${String(Math.floor((min % 1) * 60)).padStart(2, '0')}s`
        : `${String(Math.floor(min / 60)).padStart(2, '0')}h ${String(Math.floor(min % 60)).padStart(2, '0')}m`;
      (this.llClock.element as HTMLElement).textContent = `Light travel time · ${pad(this.llT)}`;
      for (const p of this.llPlanets) {
        const tp = p.au * 8.3167;
        const reached = this.llT >= tp;
        const want = reached ? 'visible' : 'hidden';
        if (p.timeEl.style.visibility !== want) p.timeEl.style.visibility = want;
        // Swell each planet gently as the light sweeps over it.
        const since = this.llT - tp;
        p.dot.scale.setScalar(reached && since < 12 ? 1 + 0.8 * (1 - since / 12) : 1);
      }
    } else if (mode === 'geoid') {
      if (!paused) { this.geoidSpin += dtReal * 0.18; }
      this.geoidMesh.rotation.y = this.geoidSpin;
      // CSS2D labels ignore depth, so hide the ones that have turned away.
      const view = this.tmp.copy(this.camera.position).normalize(); // globe is at the origin
      for (const l of this.geoidTags) {
        l.visible = this.state.showLabels && l.getWorldPosition(new Vector3()).normalize().dot(view) > 0.25;
      }
    } else if (mode === 'magnetosphere') {
      if (!paused) this.magT += dtReal;
      const N = this.magWindB.length;
      const arr = (this.magWind.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      const aBS = 9.6; // bow-shock stand-off: the wind parts around this
      for (let i = 0; i < N; i++) {
        if (!paused) { this.magWindX[i] -= dtReal * 14; if (this.magWindX[i] < -42) this.magWindX[i] = 34; }
        const x = this.magWindX[i], b = this.magWindB[i];
        const half = x < aBS
          ? Math.min(26, Math.sqrt(Math.max(0, 4 * aBS * (aBS - x))) * 0.62) * this.magWindJ[i]
          : 0;
        const y = (b < 0 ? -1 : 1) * Math.max(Math.abs(b), half);
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = 0;
      }
      (this.magWind.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      this.magAurora.forEach((a, i) => {
        (a.material as MeshBasicMaterial).opacity = 0.45 + 0.45 * Math.abs(Math.sin(this.magT * 1.6 + i * 1.7));
      });
    } else if (mode === 'heliosphere') {
      const AU = 0.17, TS = 94 * AU, HP = 121 * AU;
      const arr = (this.helWind.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      for (let i = 0; i < this.helWindR.length; i++) {
        const a = this.helWindA[i];
        const shape = 1.18 / (1 + 0.18 * Math.cos(a)); // teardrop: blunt nose, long tail
        const ts = TS * shape, hp = HP * shape;
        if (!paused) {
          // Supersonic inside the shock; it abruptly slows in the heliosheath.
          this.helWindR[i] += dtReal * this.helWindV[i] * (this.helWindR[i] < ts ? 9 : 2.2);
          if (this.helWindR[i] > hp * 0.97) this.helWindR[i] = 0.4 + Math.random() * 2.5;
        }
        const r = this.helWindR[i];
        arr[i * 3] = Math.cos(a) * r; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = Math.sin(a) * r;
      }
      (this.helWind.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    } else if (mode === 'venusrose') {
      const YEAR = 365.256, VYEAR = 224.701, SPAN = 8 * YEAR;
      if (!paused) this.roseT += dtReal * 162; // ~8 years in 18 s
      if (this.roseT > SPAN) { this.roseT = 0; this.roseSegs = 0; this.roseLines.geometry.setDrawRange(0, 0); }
      const rE = 11, rV = 11 * 0.723;
      const at = (day: number) => {
        const tE = (day / YEAR) * Math.PI * 2, tV = (day / VYEAR) * Math.PI * 2;
        return [
          new Vector3(Math.cos(tE) * rE, 0, -Math.sin(tE) * rE),
          new Vector3(Math.cos(tV) * rV, 0, -Math.sin(tV) * rV),
        ];
      };
      const [pe, pv] = at(this.roseT);
      this.roseEarth.position.copy(pe); this.roseVenus.position.copy(pv);
      // Lay down one chord every four days; together they weave the rose.
      const geom = this.roseLines.geometry;
      const arr = (geom.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      const want = Math.min(this.roseMaxSegs, Math.floor(this.roseT / 3));
      while (this.roseSegs < want) {
        const [a, b] = at(this.roseSegs * 3);
        const k = this.roseSegs * 6;
        arr[k] = a.x; arr[k + 1] = 0; arr[k + 2] = a.z;
        arr[k + 3] = b.x; arr[k + 4] = 0; arr[k + 5] = b.z;
        this.roseSegs++;
      }
      geom.setDrawRange(0, this.roseSegs * 2);
      (geom.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      (this.roseLabel.element as HTMLElement).textContent =
        `Year ${(this.roseT / YEAR).toFixed(1)} of 8 · Venus makes 13 laps while Earth makes 8`;
    } else if (mode === 'polaris') {
      if (!paused) { this.polAngle += dtReal * 0.36; this.polPrecT += dtReal * 0.07; }
      const R = 12, tilt = MathUtils.degToRad(23.4);
      const AX = new Vector3(0, Math.cos(tilt), -Math.sin(tilt));
      const p = new Vector3(Math.cos(this.polAngle) * R, 0, Math.sin(this.polAngle) * R);
      this.polEarth.position.copy(p);
      const setSeg = (line: Line, a: Vector3, b: Vector3) => {
        const arr = (line.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
        (line.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      };
      setSeg(this.polAxis, p.clone().addScaledVector(AX, -4.4), p.clone().addScaledVector(AX, 4.4));
      setSeg(this.polSight, p.clone().addScaledVector(AX, 4.4), AX.clone().multiplyScalar(34));
      this.polSight.computeLineDistances();
      // The aim of that axis drifts around a circle once every 26,000 years.
      const cone = 34 * Math.sin(tilt), coneY = 34 * Math.cos(tilt);
      const a = -Math.PI / 2 + this.polPrecT;
      this.polPrecDot.position.set(Math.cos(a) * cone, coneY, Math.sin(a) * cone);
    } else if (mode === 'cosmicmotion') {
      if (!paused) {
        this.cmT += dtReal;
        this.cmSunPivot.rotation.y -= dtReal * 0.42;
        this.cmYouPivot.rotation.y -= dtReal * 1.5;
        // The galaxy streams past us the other way, and wraps around.
        const arr = (this.cmStarField.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] -= dtReal * 7;
          if (arr[i] < -55) arr[i] += 110;
        }
        (this.cmStarField.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      }
      // Relative to the cosmic microwave background the Sun runs at 370 km/s.
      const km = Math.round(370 * this.cmT);
      (this.cmOdo.element as HTMLElement).textContent =
        `Since this slide opened you have travelled ${km.toLocaleString('en-US')} km`;
    } else if (mode === 'earlyuniverse') {
      if (!paused) { this.euT += dtReal * 0.055; this.euGroup.rotation.y += dtReal * 0.04; }
      if (this.euT > 1.32) this.euT = 0;
      const t = MathUtils.clamp(this.euT, 0, 1);
      const e = t * t * t; // collapse runs away with itself, as gravity does
      const arr = (this.euPoints.geometry.getAttribute('position') as Float32BufferAttribute).array as Float32Array;
      for (let i = 0; i < arr.length; i++) arr[i] = this.euP0[i] + (this.euP1[i] - this.euP0[i]) * e;
      (this.euPoints.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      const mat = this.euPoints.material as PointsMaterial;
      mat.color.copy(new Color(0x9fb8ff)).lerp(new Color(0xffd9a8), e);
      mat.size = 0.26 + 0.1 * e;
      (this.euLabel.element as HTMLElement).textContent = e < 0.02
        ? 't = 380,000 years · smooth to 1 part in 100,000'
        : `t ≈ ${(e * 13.8).toFixed(1)} billion years`;

    }
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

  /** The camera's polar angle about its target (0 = straight down on it). */
  private cameraPolar(): number {
    this.tmp.copy(this.camera.position).sub(this.controls.target);
    return Math.acos(MathUtils.clamp(this.tmp.y / (this.tmp.length() || 1), -1, 1));
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

    const targetPolar = 0.0001; // top-down, for the 2-D lock
    if (s.twoD && this.userDragging) {
      // While tilting a 2D slide, hold polarLimit at the *live* tilt and free the
      // angle. That way, when the lock is re-applied on release, it eases back to
      // flat from where the user left it instead of snapping (it would otherwise
      // have kept damping to flat in the background during the drag).
      this.polarLimit = this.cameraPolar();
      this.polarSynced = true;
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = Math.PI;
    } else if (s.twoD) {
      // Lock to top-down, easing there from wherever the camera actually is.
      if (!this.polarSynced) { this.polarLimit = this.cameraPolar(); this.polarSynced = true; }
      this.polarLimit = MathUtils.damp(this.polarLimit, targetPolar, 4, dtReal);
      this.controls.minPolarAngle = this.polarLimit;
      this.controls.maxPolarAngle = this.polarLimit;
    } else {
      // Free in 3-D — but keep the lock's angle tracking where the camera is,
      // so stepping onto a 2-D slide eases down from the live view. Left to
      // drift to π it would instead snap the camera under the scene on the
      // first frame and swing it back over, which reads as a hard blink.
      this.polarLimit = this.cameraPolar();
      this.polarSynced = true;
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = Math.PI;
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
        // Conservation of angular momentum: the collapsing cloud spins up, so
        // the forming body turns faster as it gathers (settling to a calm spin).
        if (!s.paused) this.accreteSpin += dtReal * (0.2 + 1.3 * accreteScale);
        v.mesh.rotation.y = this.accreteSpin;
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
      const moonLabels = mvis && s.showLabels && s.showMoonLabels && mv.opacity > 0.4;
      mv.label.visible = moonLabels;
      (mv.label.element as HTMLElement).style.opacity = String(mv.opacity);
      if (mv.nearLabel) {
        mv.nearLabel.visible = moonLabels;
        (mv.nearLabel.element as HTMLElement).style.opacity = String(mv.opacity);
      }
      if (!mvis) continue;

      const factor = this.moonFactor(mv.parent.id, parentView.mesh.scale.x);
      this.tmp.copy(moonRelativePosition(mv.parent, mv.moon, this.simDays)).multiplyScalar(factor);
      eclToScene(this.tmp, this.tmp3);
      this.tmp3.y *= f;
      mv.mesh.position.copy(parentView.curScene).add(this.tmp3);
      mv.orbitLine.position.copy(parentView.curScene);

      // These moons are tidally locked: one rotation takes exactly as long as
      // one orbit (27.3 days for our Moon), so the same hemisphere faces the
      // planet forever. Rather than free-spin on an axis, aim a fixed meridian
      // at the parent — a geometric truth that holds even when paused.
      // (this.tmp3 is the parent→moon offset, so the parent lies along -tmp3.)
      //
      // Which meridian: an equirectangular map wraps u=0 onto local -X and
      // runs eastward, so its centre (u=0.5) lands on local +X. Lunar maps are
      // centred on the sub-Earth point, so aiming local +X at the planet is
      // what puts the familiar dark-maria near side toward Earth — the whole
      // point of the lock. That is the -π/2 below.
      mv.mesh.rotation.y = Math.atan2(-this.tmp3.x, -this.tmp3.z) - Math.PI / 2;
      // The name label is a child of that spinning mesh, so counter-rotate it:
      // it should sit just clear of the body and stay there, not ride around.
      mv.label.position.set(0, 0, -1.7).applyAxisAngle(UP_Y, -mv.mesh.rotation.y);

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
    this.updateExtras(dtReal);

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

    // 3-D coastline inset (tides slide): render the diorama scene into a corner
    // viewport, on top of the main render.
    if (this.state.demoMode === 'tides') this.renderTideInset();
  }

  private renderTideInset(): void {
    const r = this.renderer;
    const mobile = window.innerWidth <= 760;
    const w = mobile ? 180 : 240, h = mobile ? 124 : 164;
    const x = mobile ? 10 : 14;
    const y = mobile ? window.innerHeight - 40 - h : 64; // viewport origin is bottom-left
    this.dioramaCam.aspect = w / h;
    this.dioramaCam.updateProjectionMatrix();
    r.setScissorTest(true);
    r.setViewport(x, y, w, h);
    r.setScissor(x, y, w, h);
    r.render(this.dioramaScene, this.dioramaCam); // autoClear fills the rect with the diorama bg
    r.setScissorTest(false);
    r.setViewport(0, 0, window.innerWidth, window.innerHeight);
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
