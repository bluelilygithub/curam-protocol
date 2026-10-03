// The 3D viewport (R3F). R3F owns the canvas, the render-on-demand loop and the resize handling; the scene itself is the
// imperative `Scene3D`, mounted as one <primitive>. Pointer input goes through `Controller3D` into the shared `Interaction`.
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import * as THREE from 'three';
import { useApp, useProject, useUi } from '../ui/AppContext';
import { DEFAULT_FOV_DEG, polarFromVertical, presetCamera, type CameraState } from './cameraPresets';
import { Controller3D } from './controller3d';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PostFx } from './PostFx';
import { Scene3D } from './Scene3D';
import { buildTour, sampleTour, stopAt } from './tour';
import { NO_INPUT, stepWalk, walkPose, walkStart, type WalkInput } from './walk';
import { WalkPad } from './WalkPad';
import { Viewbar3D } from './Viewbar3D';

const BACKGROUND = '#F5F5F0';
const CLAY_BACKGROUND = '#ececec';

/** The part of OrbitControls this viewport uses (drei hands it over as `controls`). */
interface Orbit {
  target: THREE.Vector3;
  enabled: boolean;
  update(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const isOrtho = (c: THREE.Camera): boolean => !!(c as THREE.OrthographicCamera).isOrthographicCamera;

function Host() {
  const app = useApp();
  const { gl, scene, camera, controls, size, invalidate } = useThree();
  const projection = useStore(app.camera, (s) => s.camera?.projection ?? 'perspective');
  const active = useUi((s) => s.viewMode === '3d');
  const hasRoom = useProject((s) => !!s.project?.rooms.length);
  const cinematic = useUi((s) => s.cinematic);
  const quality = useUi((s) => s.quality);
  const tourPlaying = useUi((s) => s.tourPlaying);
  const walking = useUi((s) => s.walking);
  const tourLoop = useUi((s) => s.tourLoop);
  const tourTime = useRef(0);
  const live = useRef<{ camera: THREE.Camera; controls: Orbit | null }>({ camera, controls: controls as unknown as Orbit | null });
  live.current = { camera, controls: controls as unknown as Orbit | null };

  const scene3d = useMemo(
    () => new Scene3D({
      project: app.project, ui: app.ui, bus: app.bus, invalidate: () => invalidate(),
      onAnimationDone: () => app.interaction.animationDone(), animateMs: reducedMotion() ? 0 : 160,
    }),
    [app, invalidate],
  );
  useEffect(() => () => scene3d.dispose(), [scene3d]);
  useEffect(() => { scene.background = new THREE.Color(BACKGROUND); invalidate(); }, [scene, invalidate]);

  // Cinematic look: soft (variance) shadows, filmic tone mapping, a neutral studio environment for fill light, a pale background.
  // The scene itself switches to clay materials and its light levels (see Scene3D); this is the renderer's half.
  useEffect(() => {
    gl.shadowMap.type = cinematic ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
    gl.toneMapping = cinematic ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = 1;
    scene.background = new THREE.Color(cinematic ? CLAY_BACKGROUND : BACKGROUND);
    let pm: THREE.PMREMGenerator | null = null;
    let env: THREE.Texture | null = null;
    if (cinematic) {
      pm = new THREE.PMREMGenerator(gl);
      env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.8;
    } else {
      scene.environment = null;
    }
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
    });
    invalidate();
    return () => { env?.dispose(); pm?.dispose(); };
  }, [cinematic, gl, scene, invalidate]);

  // exposed for the browser walkthrough and tests; harmless in production
  useEffect(() => {
    (window as unknown as { roomPlanner3d?: unknown }).roomPlanner3d = {
      scene3d, scene, gl, get camera() { return live.current.camera; }, get controls() { return live.current.controls; },
    };
  }, [scene3d, scene, gl]);

  useEffect(() => {
    app.camera.getState().setViewport(Math.max(1, Math.round(size.width)), Math.max(1, Math.round(size.height)));
  }, [app, size.width, size.height]);

  const read = (): CameraState | null => {
    const { camera: cam, controls: ctl } = live.current;
    if (!ctl) return null;
    return {
      position: [cam.position.x, cam.position.y, cam.position.z], target: [ctl.target.x, ctl.target.y, ctl.target.z],
      projection: isOrtho(cam) ? 'orthographic' : 'perspective', zoom: (cam as THREE.OrthographicCamera).zoom,
    };
  };
  const apply = (c: CameraState): void => {
    const { camera: cam, controls: ctl } = live.current;
    cam.position.set(c.position[0], c.position[1], c.position[2]);
    if (isOrtho(cam)) { (cam as THREE.OrthographicCamera).zoom = c.zoom; (cam as THREE.OrthographicCamera).updateProjectionMatrix(); }
    if (ctl) { ctl.target.set(c.target[0], c.target[1], c.target[2]); ctl.update(); } else cam.lookAt(c.target[0], c.target[1], c.target[2]);
    invalidate();
  };

  // First use frames the room; afterwards the store holds the camera across view switches and projection swaps.
  useEffect(() => {
    if (!controls) return;
    const st = app.camera.getState();
    if (st.camera) {
      if (st.camera.projection === (isOrtho(camera) ? 'orthographic' : 'perspective')) apply(st.camera);
      return;
    }
    const room = app.project.getState().project?.rooms[0];
    if (!room) return;
    const { viewport } = st;
    const c = presetCamera(room, 'iso', null, { aspect: viewport.w / viewport.h, viewportW: viewport.w, viewportH: viewport.h });
    st.setCamera(c);
    apply(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera, hasRoom]);

  // Camera requests (presets, saved views, projection swap): same projection and animated → fly there; otherwise jump. A swapped
  // camera object is positioned by the effect above once it exists.
  useEffect(() => {
    let raf = 0;
    const unsub = app.camera.subscribe((s, prev) => {
      const req = s.request;
      if (!req || req === prev.request) return;
      const cur = read();
      const same = !!cur && cur.projection === req.camera.projection;
      if (!cur || !same) return;
      if (!req.animate || reducedMotion()) { apply(req.camera); return; }
      cancelAnimationFrame(raf);
      const t0 = performance.now();
      const step = (): void => {
        const u = Math.min(1, (performance.now() - t0) / 380);
        const e = u * u * (3 - 2 * u);
        const mix = (a: number[], b: number[]): [number, number, number] => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
        apply({ ...req.camera, position: mix(cur.position, req.camera.position), target: mix(cur.target, req.camera.target), zoom: cur.zoom + (req.camera.zoom - cur.zoom) * e });
        if (u < 1) raf = requestAnimationFrame(step);
        else app.camera.getState().setCamera(req.camera);
      };
      raf = requestAnimationFrame(step);
    });
    return () => { unsub(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, invalidate]);

  // Orbit/pan/zoom: remember where the camera ended, and fade the walls in front of it (A7).
  useEffect(() => {
    const ctl = controls as unknown as Orbit | null;
    if (!ctl) return;
    const fade = (): void => {
      const c = read();
      if (!c) return;
      scene3d.updateFade({ x: c.position[0], y: c.position[2] }, polarFromVertical(c.position, c.target));
    };
    const end = (): void => { const c = read(); if (c) app.camera.getState().setCamera(c); fade(); };
    ctl.addEventListener('change', fade);
    ctl.addEventListener('end', end);
    fade();
    return () => { ctl.removeEventListener('change', fade); ctl.removeEventListener('end', end); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls, camera, scene3d, app]);

  // Fly-through (Spec Addition A1, C3): the camera follows the tour path while it plays; orbit controls are off meanwhile.
  useEffect(() => {
    const ctl = controls as unknown as Orbit | null;
    if (!tourPlaying || !ctl) return;
    if (isOrtho(camera)) { app.setProjection('perspective'); return; } // the tour is a perspective shot; this effect re-runs on the new camera
    const project = app.project.getState().project;
    const room = project?.rooms[0];
    if (!project || !room) { app.ui.getState().setTourPlaying(false); return; }
    const tour = buildTour(room, project.savedViews ?? [], tourLoop);
    if (!tour.loop && tourTime.current >= tour.duration) tourTime.current = 0;
    ctl.enabled = false;
    let raf = 0;
    let last = performance.now();
    const frame = (): void => {
      const now = performance.now();
      tourTime.current += Math.min(0.5, (now - last) / 1000); // real elapsed time, so a slow graphics card skips frames instead of slowing the tour
      last = now;
      const pose = sampleTour(tour, tourTime.current);
      apply({ position: pose.position, target: pose.target, projection: 'perspective', zoom: 1 });
      app.ui.getState().setTourProgress({ stop: stopAt(tour, tourTime.current), total: tour.stops.length });
      if (!tour.loop && tourTime.current >= tour.duration) { app.ui.getState().setTourPlaying(false); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ctl.enabled = true;
      const c = read();
      if (c) app.camera.getState().setCamera(c);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourPlaying, tourLoop, controls, camera, app]);

  // Walk mode (Spec Addition A1, C4): first person at eye height, with collision. The orbit camera is parked and restored afterwards;
  // the camera is placed directly (OrbitControls would clamp a level or upward look).
  useEffect(() => {
    const ctl = controls as unknown as Orbit | null;
    if (!walking || !ctl) return;
    if (isOrtho(camera)) { app.setProjection('perspective'); return; }
    const room = app.project.getState().project?.rooms[0];
    const start = room ? walkStart(room) : null;
    if (!room || !start) { app.ui.getState().setWalking(false); return; }
    const parked = read();
    let state = start;
    ctl.enabled = false;
    const input = app.walkInput;
    input.keys.clear();
    let lookYaw = 0;
    let lookPitch = 0;

    const KEYS: Record<string, string> = { w: 'forward', arrowup: 'forward', s: 'back', arrowdown: 'back', a: 'left', d: 'right', arrowleft: 'turnleft', arrowright: 'turnright', shift: 'run' };
    const typing = (t: EventTarget | null): boolean => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'); };
    const keydown = (e: KeyboardEvent): void => { const k = KEYS[e.key.toLowerCase()]; if (k && !typing(e.target)) { input.keys.add(k); e.preventDefault(); } };
    const keyup = (e: KeyboardEvent): void => { const k = KEYS[e.key.toLowerCase()]; if (k) input.keys.delete(k); };
    const blur = (): void => { input.keys.clear(); };

    // drag to look (mouse, pen or one finger); the on-screen pad is a separate element and handles its own pointer
    const el = gl.domElement;
    let drag: { id: number; x: number; y: number } | null = null;
    const pdown = (e: PointerEvent): void => { if (e.button !== 0 || drag) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const pmove = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      lookYaw += (e.clientX - drag.x) * 0.0035;
      lookPitch += -(e.clientY - drag.y) * 0.0035;
      drag.x = e.clientX; drag.y = e.clientY;
    };
    const pup = (e: PointerEvent): void => { if (drag && e.pointerId === drag.id) drag = null; };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointermove', pmove);
    el.addEventListener('pointerup', pup);
    el.addEventListener('pointercancel', pup);

    const place = (): void => {
      const pose = walkPose(state);
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
      camera.updateMatrixWorld();
      scene3d.updateFade({ x: state.position.x, y: state.position.y }, Math.PI / 2);
      invalidate();
    };
    place();
    let raf = 0;
    let last = performance.now();
    const frame = (): void => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = input.keys;
      const frameInput: WalkInput = {
        ...NO_INPUT,
        forward: Math.max(-1, Math.min(1, (k.has('forward') ? 1 : 0) - (k.has('back') ? 1 : 0) + input.padY)),
        strafe: Math.max(-1, Math.min(1, (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0) + input.padX)),
        turn: ((k.has('turnright') ? 1 : 0) - (k.has('turnleft') ? 1 : 0)) * 1.8,
        run: k.has('run'),
        lookYaw, lookPitch,
      };
      lookYaw = 0; lookPitch = 0;
      state = stepWalk(room, state, frameInput, dt);
      place();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      el.removeEventListener('pointerdown', pdown);
      el.removeEventListener('pointermove', pmove);
      el.removeEventListener('pointerup', pup);
      el.removeEventListener('pointercancel', pup);
      input.keys.clear(); input.padX = 0; input.padY = 0;
      ctl.enabled = true;
      if (parked) apply(parked); // back to the orbit camera you left
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, controls, camera, app]);

  // Pointers: the editor takes a gesture that starts on furniture (or places a ghost); everything else orbits.
  useEffect(() => {
    const el = gl.domElement;
    const controller = new Controller3D({
      scene: scene3d, interaction: app.interaction, ui: app.ui,
      camera: () => live.current.camera,
      size: () => ({ w: el.clientWidth || 1, h: el.clientHeight || 1 }),
      setOrbitEnabled: (on) => { if (live.current.controls) live.current.controls.enabled = on; },
    });
    const pointers = new Set<number>();
    const mods = (e: PointerEvent) => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button });
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent): void => {
      if (app.ui.getState().viewMode !== '3d' || app.ui.getState().tourPlaying || app.ui.getState().walking) return;
      pointers.add(e.pointerId);
      if (pointers.size > 1) { controller.cancel(); return; } // two fingers: the camera takes over
      if (e.button !== 0) return;
      const p = local(e);
      if (controller.down(p.x, p.y, mods(e))) el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (app.ui.getState().viewMode !== '3d' || pointers.size > 1) return;
      const p = local(e);
      controller.move(p.x, p.y, mods(e));
    };
    const up = (e: PointerEvent): void => {
      const had = pointers.delete(e.pointerId);
      if (!had || app.ui.getState().viewMode !== '3d') return;
      if (e.type === 'pointercancel') { controller.cancel(); return; }
      if (e.button !== 0) return;
      const p = local(e);
      controller.up(p.x, p.y, mods(e));
    };
    el.addEventListener('pointerdown', down, { capture: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down, { capture: true });
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl, scene3d, app]);

  useEffect(() => { if (active) invalidate(); }, [active, invalidate]);

  return (
    <>
      <primitive object={scene3d.root} />
      {cinematic && quality === 'high' && <PostFx />}
      {projection === 'perspective'
        ? <PerspectiveCamera makeDefault fov={DEFAULT_FOV_DEG} near={0.1} far={500} />
        : <OrthographicCamera makeDefault near={-300} far={600} />}
      <OrbitControls makeDefault enableDamping={false} minDistance={0.5} maxDistance={120} maxPolarAngle={Math.PI / 2 - 0.02} />
    </>
  );
}

export default function Viewport3D() {
  const active = useUi((s) => s.viewMode === '3d');
  return (
    <div className={`stage3d ${active ? '' : 'inactive'}`} data-testid="stage3d" aria-hidden={!active}>
      <Canvas frameloop="demand" flat shadows dpr={[1, 2]} gl={{ antialias: true }}>
        <Host />
      </Canvas>
      {active && <Viewbar3D />}
      {active && <WalkPad />}
    </div>
  );
}
