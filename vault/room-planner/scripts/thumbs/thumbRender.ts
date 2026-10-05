// Library thumbnails of the real 3D models: one small three-quarter view of each, on a transparent background.
// Not part of the app bundle: scripts/stills-thumbs.mjs loads this through the dev server and saves the pictures to public/models/thumbs/.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { modelCache } from '../../src/render3d/modelCache';

export async function renderThumb(id: string, w: number, l: number, h: number, px: [number, number]): Promise<string | null> {
  if (!modelCache.instance(id, w, l, h)) await modelCache.ready();
  const model = modelCache.instance(id, w, l, h);
  if (!model) return null;

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(px[0], px[1], false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun, model);

  // three-quarter view from the front right, above; the camera backs off until the whole piece fits
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const camera = new THREE.PerspectiveCamera(28, px[0] / px[1], 0.01, 100);
  const dir = new THREE.Vector3(0.85, 0.62, 1.2).normalize();
  const fit = (radius / Math.sin((Math.min(camera.fov, camera.fov * camera.aspect) * Math.PI) / 360)) * 0.92;
  camera.position.copy(centre).addScaledVector(dir, fit);
  camera.lookAt(centre);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  pmrem.dispose();
  renderer.dispose();
  return url;
}
