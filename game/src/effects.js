// Combat feedback: tracers, impact sparks, blood puffs and explosion smoke. Everything
// is pooled and reused: no mesh, line or vector is allocated inside the per-frame loop.
import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 320;

export function createEffects(scene) {
  // Tracers: a pool of thin lines, each fading out over 70 ms.
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Particles: one Points cloud, positions and velocities kept in flat arrays.
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let particleIndex = 0;

  const tmpColor = new THREE.Color();

  function spawnParticle(x, y, z, vx, vy, vz, lifeTime, colorHex) {
    const i = particleIndex;
    particleIndex = (particleIndex + 1) % MAX_PARTICLES;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
    life[i] = lifeTime;
    maxLife[i] = lifeTime;
    tmpColor.setHex(colorHex);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }

  function burst(point, count, speed, colorHex, up = 1) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      spawnParticle(
        point.x, point.y, point.z,
        Math.cos(a) * Math.cos(b) * s, (Math.sin(b) + up) * s * 0.7, Math.sin(a) * Math.cos(b) * s,
        0.25 + Math.random() * 0.45, colorHex,
      );
    }
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.07);
        if (tracer.life <= 0) tracer.line.visible = false;
      }
    }
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (life[i] <= 0) continue;
      anyAlive = true;
      life[i] -= dt;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3 + 1] -= 6 * dt;
      if (positions[i * 3 + 1] < 0.02) {
        positions[i * 3 + 1] = 0.02;
        velocities[i * 3 + 1] = 0;
      }
      if (life[i] <= 0) positions[i * 3 + 1] = -100;
    }
    if (anyAlive) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    }
  }

  return {
    step,
    tracer(from, to) {
      const tracer = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % MAX_TRACERS;
      const attr = tracer.line.geometry.attributes.position;
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      tracer.line.material.opacity = 0.9;
      tracer.line.visible = true;
      tracer.life = 0.07;
    },
    impact(point) {
      burst(point, 10, 2.4, 0xffc46b, 0.4);
      burst(point, 5, 1.2, 0x8b98a5, 0.6);
    },
    blood(point) {
      burst(point, 14, 2.0, 0x8e1f1f, 0.5);
    },
    explosion(point) {
      burst(point, 60, 7, 0xffa63d, 1.2);
      burst(point, 30, 4, 0x555c66, 1.6);
      burst(point, 20, 2.5, 0x2a2f36, 2.0);
    },
    smoke(point) {
      burst(point, 24, 1.6, 0x9aa4ae, 1.8);
    },
    reset() {
      for (const tracer of tracers) {
        tracer.life = 0;
        tracer.line.visible = false;
      }
      life.fill(0);
      for (let i = 0; i < MAX_PARTICLES; i += 1) positions[i * 3 + 1] = -100;
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
