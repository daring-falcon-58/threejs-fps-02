// Player movement: acceleration, friction, gravity, crouch and jump, resolved by the
// world's shared box mover one axis at a time, so a wall never swallows the player.
// The same mover drives the bots, so the player and the bots obey the same physics.
import * as THREE from 'three';

const [RADIUS, STAND_HEIGHT, CROUCH_HEIGHT, STAND_EYE, CROUCH_EYE] = [0.34, 1.72, 1.12, 1.6, 1.02];
const [WALK_SPEED, CROUCH_SPEED, GROUND_ACCEL, AIR_ACCEL, FRICTION, GRAVITY, JUMP_SPEED] = [5.2, 2.4, 42, 9, 9, 20, 6.2];

export const createPlayer = (world) => {
  const player = {};
  player.position = new THREE.Vector3(0, 0, 16);
  player.velocity = new THREE.Vector3();
  player.yaw = 0;
  player.pitch = 0;
  player.eye = STAND_EYE;
  player.onGround = true;
  player.crouching = false;
  player.height = STAND_HEIGHT;
  player.health = 100;
  player.alive = true;
  const wish = new THREE.Vector3();

  const look = (dx, dy, sensitivity = 0.0022) => {
    player.yaw -= dx * sensitivity;
    player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sensitivity, -1.45, 1.45);
  };

  const recoil = (pitchKick, yawKick) => {
    player.yaw += yawKick;
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
  };

  const updateCrouch = (keys, dt) => {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && player.crouching === false) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (crouching === false && player.crouching && world.overlaps(player.position.x, player.position.y, player.position.z, RADIUS, STAND_HEIGHT, 0.02) === false) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);
  };

  const axis = (keys, positive, negative) => (keys.has(negative) ? -1 : 0) + (keys.has(positive) ? 1 : 0);

  const updateMove = (dt, keys) => {
    const forward = axis(keys, 'KeyW', 'KeyS');
    const strafe = axis(keys, 'KeyD', 'KeyA');
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(cos * strafe - sin * forward, 0, -sin * strafe - cos * forward).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, dt * (player.onGround ? GROUND_ACCEL : AIR_ACCEL) / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.onGround = false;
      player.velocity.y = JUMP_SPEED;
    }
    player.onGround = world.moveBody(player.position, player.velocity, dt, RADIUS, player.height, GRAVITY);
    player.velocity.y = Math.max(-30, player.velocity.y);
  };

  const step = (dt, keys) => {
    if (player.alive === false) return;
    updateCrouch(keys, dt);
    updateMove(dt, keys);
  };

  const damage = (amount) => {
    if (player.alive === false) return false;
    player.health -= amount;
    if (player.health > 0) return false;
    player.health = 0;
    player.alive = false;
    return true;
  };

  const reset = (position, yaw) => {
    player.eye = STAND_EYE;
    player.height = STAND_HEIGHT;
    player.crouching = false;
    player.alive = true;
    player.health = 100;
    player.pitch = 0;
    player.yaw = yaw;
    player.velocity.multiplyScalar(0);
    player.position.copy(position);
  };

  const groundSpeed = () => Math.hypot(player.velocity.x, player.velocity.z);

  return { state: player, step, look, recoil, damage, reset, groundSpeed };
};
