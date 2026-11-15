// The dusk sky over Kestrel Yard: a gradient dome (deep slate overhead,
// a warm amber band at the horizon), a scatter of early stars, and one low
// sun glowing in the west. The dome is a plain backdrop — it never catches
// fog, so it stays readable from anywhere in the yard.
import * as THREE from 'three';

const SKY_W = 1024;
const SKY_H = 512;

const paintSkyCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = SKY_W;
  canvas.height = SKY_H;
  const ctx = canvas.getContext('2d');
  const band = ctx.createLinearGradient(0, 0, 0, SKY_H);
  band.addColorStop(0.0, '#070a10');
  band.addColorStop(0.3, '#12161f');
  band.addColorStop(0.4, '#1d222c');
  band.addColorStop(0.44, '#6b4423');
  band.addColorStop(0.48, '#a86a2e');
  band.addColorStop(0.54, '#3a2a1c');
  band.addColorStop(1.0, '#14100c');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, SKY_W, SKY_H);
  // Early stars, only above the horizon band, each a single bright speck.
  for (let i = 0; i < 190; i += 1) {
    const x = Math.random() * SKY_W;
    const y = Math.random() * SKY_H * 0.42;
    const alpha = 0.25 + Math.random() * 0.65;
    const size = Math.random() < 0.12 ? 2 : 1;
    ctx.fillStyle = `rgba(230, 238, 255, ${alpha.toFixed(2)})`;
    ctx.fillRect(x, y, size, size);
  }
  return canvas;
};

const paintSunCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  glow.addColorStop(0, 'rgba(255, 224, 170, 1)');
  glow.addColorStop(0.22, 'rgba(255, 178, 90, 0.95)');
  glow.addColorStop(0.48, 'rgba(255, 140, 50, 0.38)');
  glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);
  return canvas;
};

export const createSky = (scene) => {
  const skyTexture = new THREE.CanvasTexture(paintSkyCanvas());
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(140, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -10;
  scene.add(dome);
  // Low sun in the west, where the directional light already comes from.
  const sunTexture = new THREE.CanvasTexture(paintSunCanvas());
  sunTexture.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTexture, transparent: true, fog: false, depthWrite: false,
  }));
  sun.scale.set(30, 30, 1);
  sun.position.set(-105, 16, 38);
  scene.add(sun);
  return { dome, sun };
};
