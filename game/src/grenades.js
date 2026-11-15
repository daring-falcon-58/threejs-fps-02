// Frag grenades: a thrown sphere with gravity and bounces, a 1.4 s fuse, then an
// explosion that damages everything in radius with falloff. Two live grenades at most;
// the meshes and the physics state are pooled, never allocated per throw.
import * as THREE from 'three';
import { GRENADE } from './weapons.js';

const MAX_GRENADES = 2;
const GRAVITY = 14;

export const createGrenades = (scene, world, fx, audio) => {
  const items = Array.from({ length: MAX_GRENADES }, () => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.5, metalness: 0.6 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), fuse: 0, bounced: false };
  });
  let index = 0;

  const throwGrenade = (origin, direction) => {
    const g = items[index];
    index = (index + 1) % MAX_GRENADES;
    g.active = true;
    g.position.copy(origin);
    g.velocity.copy(direction).multiplyScalar(16);
    g.velocity.y += 4.5;
    g.fuse = GRENADE.fuse;
    g.bounced = false;
    g.mesh.visible = true;
    g.mesh.position.copy(origin);
    audio.grenadePin();
  };

  const bounceWall = (g) => {
    if (Math.abs(g.velocity.y) > 1.5) g.velocity.y = -g.velocity.y * 0.42;
    else g.velocity.y = 0;
    g.velocity.x *= 0.6;
    g.velocity.z *= 0.6;
    g.bounced = true;
  };

  const bounceFloor = (g) => {
    g.position.y = 0.09;
    if (Math.abs(g.velocity.y) > 1) g.velocity.y = -g.velocity.y * 0.4;
    else g.velocity.y = 0;
    g.velocity.x *= 0.7;
    g.velocity.z *= 0.7;
    g.bounced = true;
  };

  const stepGrenade = (g, dt, ctx) => {
    if (g.active === false) return;
    g.fuse -= dt;
    g.velocity.y -= GRAVITY * dt;
    const before = g.position.clone();
    g.position.addScaledVector(g.velocity, dt);
    // Bounce off the world: test the new position against colliders, reflect cheaply.
    const hit = world.overlaps(g.position.x, g.position.y, g.position.z, 0.09, 0.18, 0);
    if (hit) {
      g.position.copy(before);
      bounceWall(g);
    }
    if (g.position.y < 0.09) bounceFloor(g);
    g.mesh.position.copy(g.position);
    if (g.fuse > 0) return;
    g.active = false;
    g.mesh.visible = false;
    fx.explosion(g.position);
    audio.explode();
    ctx.onExplode(g.position, GRENADE.radius, GRENADE.damage);
  };

  const step = (dt, ctx) => {
    items.forEach((g) => stepGrenade(g, dt, ctx));
  };

  const reset = () => {
    items.forEach((g) => {
      g.active = false;
      g.mesh.visible = false;
    });
  };

  return { throwGrenade, step, reset };
};
