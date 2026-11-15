// The yard floor, painted rather than flat: a canvas asphalt texture with
// speckle, oil stains, expansion joints and hairline cracks, plus a faded
// painted letter marking each bomb site on the ground itself.
import * as THREE from 'three';

const TEX_W = 512;
const TEX_H = 512;

export const createGroundTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2a2620';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  // Speckle: thousands of single-pixel flecks, lighter and darker than base.
  for (let i = 0; i < 5200; i += 1) {
    const light = Math.random() < 0.5;
    ctx.fillStyle = light
      ? `rgba(74, 66, 54, ${(0.05 + Math.random() * 0.12).toFixed(2)})`
      : `rgba(20, 17, 12, ${(0.05 + Math.random() * 0.14).toFixed(2)})`;
    ctx.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  // Oil stains: soft dark blooms, wider than they are tall.
  for (let i = 0; i < 14; i += 1) {
    const x = Math.random() * TEX_W;
    const y = Math.random() * TEX_H;
    const r = 26 + Math.random() * 64;
    const stain = ctx.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, `rgba(12, 11, 9, ${(0.1 + Math.random() * 0.1).toFixed(2)})`);
    stain.addColorStop(1, 'rgba(12, 11, 9, 0)');
    ctx.fillStyle = stain;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Expansion joints: a faint grid, one seam every 128 px.
  ctx.strokeStyle = 'rgba(18, 15, 11, 0.55)';
  ctx.lineWidth = 2;
  for (let g = 0; g <= TEX_W; g += 128) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, TEX_H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(TEX_W, g);
    ctx.stroke();
  }
  // Hairline cracks: short wandering dark polylines.
  ctx.strokeStyle = 'rgba(14, 12, 9, 0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i += 1) {
    let x = Math.random() * TEX_W;
    let y = Math.random() * TEX_H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s += 1) {
      x += (Math.random() - 0.5) * 46;
      y += (Math.random() - 0.5) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

// A faded painted letter lying flat on the ground at a bomb site.
export const createSiteLetter = (letter) => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.font = '700 190px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(236, 231, 219, 0.5)';
  ctx.fillText(letter, 128, 134);
  // Wear: punch a few transparent speckles out of the paint.
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.25 + Math.random() * 0.5})`;
    ctx.fillRect(40 + Math.random() * 176, 50 + Math.random() * 156, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  ctx.globalCompositeOperation = 'source-over';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  decal.rotation.x = -Math.PI / 2;
  return decal;
};
