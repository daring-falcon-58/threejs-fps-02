// Bots: 5v5. The player leads four Viper bots against five Jackal bots. Each bot is a
// small state machine — MOVE along the waypoint graph, HOLD a position, ENGAGE a seen
// enemy, PLANT or DEFUSE the spike — with vision (field of view plus line of sight),
// hearing (gunshots pull bots toward the noise), burst fire with aim error, and roles
// that change when the spike is planted. One Raycaster and a handful of reused vectors
// serve every bot; nothing is allocated in the per-frame loop.
import * as THREE from 'three';
import { pick, range } from './rng.js';
import { PALETTE } from './palette.js';

const [EYE_HEIGHT, BODY_RADIUS, BODY_HEIGHT] = [1.5, 0.34, 1.7];
const [WALK_SPEED, HOLD_SPEED] = [4.1, 2.0];
const [VISION_RANGE, VISION_HALF_FOV, HEAR_RANGE] = [38, 1.05, 26];
const [REACT_MIN, REACT_MAX] = [0.32, 0.62];
// Bots sharpen as the match goes on: each round past the first trims the
// reaction delay by 3%, down to a 30% cut, so late rounds feel faster.
// Round 1 is untouched (factor 1), which keeps the staged captures identical.
const REACT_RAMP_PER_ROUND = 0.03;
const REACT_RAMP_FLOOR = 0.7;

const VIPER_NAMES = ['Kite', 'Rook', 'Fable', 'Noor'];
const JACKAL_NAMES = ['Vex', 'Hale', 'Mira', 'Doss', 'Pike'];
const PLANS = ['split', 'stackA', 'stackB', 'mid'];
const PLAN_JACKALS = [
  ['aSite', 'aSite', 'bSite', 'bSite', 'mid'],
  ['aSite', 'aSite', 'aSite', 'mid', 'bSite'],
  ['bSite', 'bSite', 'bSite', 'mid', 'aSite'],
  ['mid', 'mid', 'aSite', 'bSite', 'midTop'],
];

const buildBotMesh = (team) => {
  const trim = team === 'vipers' ? PALETTE.teal : PALETTE.rust;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.85, metalness: 0.15 });
  const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(trim), roughness: 0.5, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.9, metalness: 0 });
  const group = new THREE.Group();
  const add = (geometry, material, x, y, z, shadow) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (shadow) mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const torso = add(new THREE.BoxGeometry(0.52, 0.68, 0.3), bodyMat, 0, 1.05, 0, true);
  const chest = add(new THREE.BoxGeometry(0.54, 0.1, 0.32), trimMat, 0, 1.28, 0, false);
  const head = add(new THREE.SphereGeometry(0.17, 12, 10), skinMat, 0, 1.58, 0, true);
  const visor = add(new THREE.BoxGeometry(0.24, 0.07, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(trim) }), 0, 1.6, 0.15, false);
  const legL = add(new THREE.BoxGeometry(0.18, 0.7, 0.2), bodyMat, -0.14, 0.35, 0, false);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(legR);
  const gun = add(new THREE.BoxGeometry(0.08, 0.09, 0.55), bodyMat, 0.2, 1.25, -0.25, false);
  return { group, torso, head, legL, legR };
};

const wrapAngle = (a) => {
  let w = a;
  while (w > Math.PI) w -= Math.PI * 2;
  while (w < -Math.PI) w += Math.PI * 2;
  return w;
};

export const createBots = (scene, world, random, fx, audio) => {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const [tmpDir, tmpTarget, tmpEye, tmpMove, tmpFacing, tmpMuzzle] = Array.from({ length: 6 }, () => new THREE.Vector3());
  const bots = [];
  const shootables = [];

  const makeBot = (team, name, index) => {
    const parts = buildBotMesh(team);
    parts.group.visible = false;
    scene.add(parts.group);
    const bot = {};
    bot.team = team;
    bot.name = name;
    bot.index = index;
    bot.parts = parts;
    bot.group = parts.group;
    bot.position = new THREE.Vector3();
    bot.velocity = new THREE.Vector3();
    bot.yaw = 0;
    bot.health = 100;
    bot.alive = false;
    bot.onGround = true;
    bot.state = 'idle';
    bot.path = [];
    bot.pathIndex = 0;
    bot.holdUntil = 0;
    bot.target = null;
    bot.lastSeen = null;
    bot.lastSeenAt = -99;
    bot.reactAt = 0;
    bot.burstLeft = 0;
    bot.burstTimer = 0;
    bot.skill = 0.55 + random() * 0.25;
    bot.role = 'roam';
    bot.site = null;
    bot.channel = 0;
    bot.channelKind = null;
    bot.heardAt = -99;
    bot.heardPos = null;
    bot.investigateAt = 0;
    bot.thinkTimer = random() * 0.2;
    bot.visionTimer = random() * 0.15;
    bot.strafeDir = 1;
    bot.strafeTimer = 0;
    bot.fallT = 0;
    bot.bobPhase = random() * 6;
    parts.torso.userData = { bot, part: 'body' };
    parts.head.userData = { bot, part: 'head' };
    parts.legL.userData = { bot, part: 'leg' };
    parts.legR.userData = { bot, part: 'leg' };
    shootables.push(parts.torso, parts.head, parts.legL, parts.legR);
    return bot;
  };

  VIPER_NAMES.forEach((name, i) => bots.push(makeBot('vipers', name, i)));
  JACKAL_NAMES.forEach((name, i) => bots.push(makeBot('jackals', name, i)));

  const resetBot = (bot, spawn, yaw) => {
    bot.position.copy(spawn);
    bot.velocity.multiplyScalar(0);
    bot.yaw = yaw;
    bot.group.visible = true;
    bot.group.rotation.set(0, yaw, 0);
    bot.group.position.copy(bot.position);
    bot.health = 100;
    bot.alive = true;
    bot.state = 'move';
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.lastSeen = null;
    bot.channel = 0;
    bot.channelKind = null;
    bot.fallT = 0;
  };

  const spawnRound = (roundNumber, bombSite) => {
    const planIndex = (roundNumber - 1) % PLANS.length;
    const plan = PLANS[planIndex];
    const jackalAssignments = PLAN_JACKALS[planIndex];
    bots.filter((b) => b.team === 'jackals').forEach((bot, i) => {
      resetBot(bot, world.spawns.jackals[i], 0);
      bot.role = 'hold';
      bot.site = jackalAssignments[i];
      bot.path = world.route(world.nearestNode(bot.position), jackalAssignments[i]);
      bot.pathIndex = 0;
    });
    const viperRoles = ['follow', 'follow', 'pushA', 'pushB'];
    bots.filter((b) => b.team === 'vipers').forEach((bot, i) => {
      resetBot(bot, world.spawns.vipers[i], Math.PI);
      bot.role = viperRoles[i];
      bot.site = viperRoles[i] === 'pushA' ? 'aSite' : viperRoles[i] === 'pushB' ? 'bSite' : null;
      bot.path = [];
      bot.pathIndex = 0;
    });
    return plan;
  };

  const eyeOf = (bot) => tmpEye.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);

  const canSee = (bot, enemyPos, enemyEyeY) => {
    tmpDir.set(enemyPos.x - bot.position.x, enemyEyeY - (bot.position.y + EYE_HEIGHT), enemyPos.z - bot.position.z);
    const dist = tmpDir.length();
    if (dist > VISION_RANGE) return false;
    tmpDir.divideScalar(dist || 1);
    tmpFacing.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const facing = tmpFacing.dot(tmpDir);
    if (facing < Math.cos(VISION_HALF_FOV) && dist > 4) return false;
    const eye = eyeOf(bot);
    return world.segmentBlocked(eye.x, eye.y, eye.z, enemyPos.x, enemyEyeY, enemyPos.z) === false;
  };

  const damageBot = (bot, amount, part, attacker, ctx) => {
    if (bot.alive === false) return;
    bot.health -= amount;
    tmpTarget.copy(bot.position);
    tmpTarget.y += part === 'head' ? 1.58 : 1.1;
    fx.blood(tmpTarget);
    if (bot.health > 0) {
      // Being shot at snaps the bot's attention to its attacker.
      if (attacker && attacker.position) {
        bot.lastSeen = attacker.position.clone ? attacker.position.clone() : attacker.position;
        bot.lastSeenAt = ctx.time;
        bot.target = attacker;
      }
      return;
    }
    bot.health = 0;
    bot.alive = false;
    bot.state = 'dead';
    bot.fallT = 0.0001;
    ctx.onKill(bot, attacker, part === 'head');
  };

  const shootAt = (bot, targetPos, targetEyeY, ctx) => {
    // Aim error grows with distance and target speed; bots miss, especially far away.
    const dx = targetPos.x - bot.position.x;
    const dy = targetEyeY - (bot.position.y + EYE_HEIGHT);
    const dz = targetPos.z - bot.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const error = (1.6 - bot.skill) * (0.012 + dist * 0.0016);
    tmpDir.set(
      (random() * 2 - 1) * error + dx / dist,
      (random() * 2 - 1) * error + dy / dist,
      (random() * 2 - 1) * error + dz / dist,
    ).normalize();
    const eye = eyeOf(bot);
    // The ray starts at the muzzle, 0.6 m ahead of the eye, so a bot never shoots
    // its own head mesh.
    tmpMuzzle.set(eye.x + 0.6 * tmpDir.x, eye.y - 0.1, eye.z + 0.6 * tmpDir.z);
    raycaster.set(tmpMuzzle, tmpDir);
    const hit = raycaster.intersectObjects(ctx.raycastTargets, false)[0];
    const muzzle = tmpMuzzle;
    if (hit === undefined) {
      tmpTarget.copy(eye).addScaledVector(tmpDir, 60);
      fx.tracer(muzzle, tmpTarget);
    } else {
      fx.tracer(muzzle, hit.point);
      const ud = hit.object.userData;
      if (ud && ud.bot && ud.bot !== bot && ud.bot.alive) {
        const falloff = dist > 25 ? 0.7 : 1;
        const partMult = ud.part === 'head' ? 3.5 : ud.part === 'leg' ? 0.75 : 1;
        const dmg = 33 * falloff * partMult;
        damageBot(ud.bot, dmg, ud.part, bot, ctx);
        if (ud.bot.team === 'jackals' && bot.team === 'vipers') ctx.onBotHit(ud.bot, dmg);
      } else if (ud && ud.player) {
        ctx.onPlayerDamage(33 * (dist > 25 ? 0.7 : 1), bot);
      } else {
        fx.impact(hit.point);
      }
    }
    audio.shot('rifle', true);
    ctx.noise(bot.position.x, bot.position.z, HEAR_RANGE);
  };

  const steer = (bot, dt, speed) => {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = world.nodes[bot.path[bot.pathIndex]];
    tmpMove.set(node.x - bot.position.x, 0, node.z - bot.position.z);
    const dist = Math.hypot(tmpMove.x, tmpMove.z);
    if (dist < 0.7) {
      bot.pathIndex += 1;
      return bot.pathIndex >= bot.path.length;
    }
    tmpMove.divideScalar(dist);
    const targetYaw = Math.atan2(-tmpMove.x, -tmpMove.z);
    const dyaw = wrapAngle(targetYaw - bot.yaw);
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
    bot.velocity.x = tmpMove.x * speed;
    bot.velocity.z = tmpMove.z * speed;
    return false;
  };

  const updateDeadBot = (bot, dt) => {
    if (bot.fallT <= 0 || bot.fallT >= 1) return;
    bot.fallT = Math.min(1, bot.fallT + dt * 2.4);
    bot.group.rotation.z = bot.fallT * Math.PI * 0.48;
    bot.group.position.y = bot.position.y + Math.sin(bot.fallT * Math.PI) * 0.08;
  };

  const scanVision = (bot, ctx) => {
    bot.visionTimer = 0.15;
    const enemies = ctx.enemiesOf(bot);
    // A dead target is dropped at once; never shoot a corpse.
    if (bot.target && enemies.includes(bot.target) === false) {
      bot.target = null;
      if (bot.state === 'engage') bot.state = 'move';
    }
    let best = null;
    let bestDist = Infinity;
    enemies.forEach((other) => {
      const d = bot.position.distanceToSquared(other.position);
      if (d >= bestDist) return;
      if (canSee(bot, other.position, other.position.y + EYE_HEIGHT) === false) return;
      best = other;
      bestDist = d;
    });
    if (best === null) {
      if (bot.state === 'engage' && ctx.time - bot.lastSeenAt > 2.2) {
        bot.target = null;
        bot.state = 'move';
      }
      return;
    }
    bot.target = best;
    bot.lastSeen = best.position;
    bot.lastSeenAt = ctx.time;
    if (bot.state === 'engage') return;
    bot.state = 'engage';
    // Reaction delay shrinks with the round (see REACT_RAMP_* above):
    // a bot in round 5 is already ~12% quicker off the mark than in
    // round 1, and the ramp bottoms out at 30% faster.
    const round = ctx.round || 1;
    const ramp = Math.max(REACT_RAMP_FLOOR, 1 - (round - 1) * REACT_RAMP_PER_ROUND);
    bot.reactAt = ctx.time + range(random, REACT_MIN, REACT_MAX) * (1.4 - bot.skill) * ramp;
    bot.burstLeft = 0;
  };

  const listenForNoise = (bot, ctx) => {
    ctx.noises.forEach((noise) => {
      const d2 = (noise.x - bot.position.x) * (noise.x - bot.position.x) + (noise.z - bot.position.z) * (noise.z - bot.position.z);
      if (d2 >= noise.radius * noise.radius) return;
      if (ctx.time - bot.heardAt <= 1.5) return;
      bot.heardAt = ctx.time;
      if (bot.state === 'engage') return;
      bot.heardPos = { x: noise.x, z: noise.z };
      bot.path = world.route(world.nearestNode(bot.position), world.nearestNode(new THREE.Vector3(noise.x, 0, noise.z)));
      bot.pathIndex = 0;
      bot.state = 'move';
    });
  };

  const thinkRoles = (bot, ctx) => {
    bot.thinkTimer = 1.2 + random() * 0.8;
    if (bot.state === 'engage') return;
    if (ctx.bomb.planted) {
      const siteNode = ctx.bomb.site === 'A' ? 'aSite' : 'bSite';
      if (bot.team === 'jackals' && bot.role === 'hold') {
        // One jackal defuses; the others hold the site.
        const defuser = ctx.pickDefuser(bot);
        if (defuser === bot) {
          bot.state = 'defuse';
          bot.path = world.route(world.nearestNode(bot.position), siteNode);
          bot.pathIndex = 0;
        } else if (bot.pathIndex >= bot.path.length) {
          bot.path = world.route(world.nearestNode(bot.position), siteNode);
          bot.pathIndex = 0;
          bot.state = 'move';
        }
      } else if (bot.team === 'vipers' && (bot.pathIndex >= bot.path.length || bot.role === 'follow')) {
        bot.path = world.route(world.nearestNode(bot.position), siteNode);
        bot.pathIndex = 0;
        bot.state = 'move';
      }
      return;
    }
    if (bot.role === 'follow' && ctx.playerAlive) {
      const near = world.nearestNode(ctx.playerPos);
      if (bot.pathIndex >= bot.path.length || bot.path[bot.path.length - 1] !== near) {
        bot.path = world.route(world.nearestNode(bot.position), near);
        bot.pathIndex = 0;
        bot.state = 'move';
      }
      return;
    }
    if (bot.role === 'follow' && ctx.playerAlive === false) {
      // The leader is down: push the nearer site instead of standing still.
      bot.role = bot.position.x < 0 ? 'pushA' : 'pushB';
      bot.site = bot.role === 'pushA' ? 'aSite' : 'bSite';
      bot.path = world.route(world.nearestNode(bot.position), bot.site);
      bot.pathIndex = 0;
      bot.state = 'move';
      return;
    }
    if (bot.pathIndex >= bot.path.length && bot.state !== 'hold') {
      if (bot.role === 'hold') {
        bot.state = 'hold';
        bot.holdUntil = ctx.time + range(random, 2, 5);
        bot.yaw += range(random, -1.2, 1.2);
      } else if (bot.role === 'pushA' || bot.role === 'pushB') {
        bot.state = 'hold';
        bot.holdUntil = ctx.time + range(random, 3, 6);
      }
    }
  };

  const actEngage = (bot, dt, ctx) => {
    const t = bot.target.position;
    const targetYaw = Math.atan2(-(t.x - bot.position.x), -(t.z - bot.position.z));
    bot.yaw += Math.max(-4 * dt, Math.min(4 * dt, wrapAngle(targetYaw - bot.yaw)));
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeTimer = 0.5 + random() * 0.7;
      bot.strafeDir = random() < 0.5 ? -1 : 1;
    }
    const dist = bot.position.distanceTo(t);
    const closing = dist > 14;
    const moveSpeed = closing ? WALK_SPEED * 0.7 : 0;
    if (closing) {
      bot.velocity.x = -Math.sin(bot.yaw) * WALK_SPEED * 0.7;
      bot.velocity.z = -Math.cos(bot.yaw) * WALK_SPEED * 0.7;
    } else {
      bot.velocity.x = Math.cos(bot.yaw) * bot.strafeDir * HOLD_SPEED * 0.7;
      bot.velocity.z = -Math.sin(bot.yaw) * bot.strafeDir * HOLD_SPEED * 0.7;
    }
    if (ctx.time < bot.reactAt) return moveSpeed;
    bot.burstTimer -= dt;
    if (bot.burstLeft <= 0 && bot.burstTimer <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.burstTimer = 0.096;
    } else if (bot.burstLeft > 0 && bot.burstTimer <= 0) {
      bot.burstLeft -= 1;
      bot.burstTimer = bot.burstLeft > 0 ? 0.096 : 0.7 + random() * 0.5;
      shootAt(bot, bot.target.position, bot.target.position.y + EYE_HEIGHT, ctx);
    }
    return moveSpeed;
  };

  const actDefuse = (bot, dt, ctx) => {
    if (steer(bot, dt, WALK_SPEED) === false) {
      bot.channel = 0;
      return 0;
    }
    bot.channel += dt;
    bot.channelKind = 'defuse';
    if (bot.channel >= 5) ctx.onDefused(bot);
    return 0;
  };

  const actMove = (bot, dt, ctx) => {
    if (steer(bot, dt, WALK_SPEED) === false) return 0;
    bot.velocity.x = 0;
    bot.velocity.z = 0;
    if (bot.role === 'hold' || bot.role === 'pushA' || bot.role === 'pushB') {
      bot.state = 'hold';
      bot.holdUntil = ctx.time + range(random, 2, 5);
    }
    return 0;
  };

  const actHold = (bot, dt, ctx) => {
    bot.velocity.x = 0;
    bot.velocity.z = 0;
    bot.yaw += Math.sin(ctx.time * 0.4 + bot.bobPhase) * 0.0012;
    if (ctx.time <= bot.holdUntil || bot.role !== 'hold') return 0;
    // Rotate between nearby nodes so holders do not stand still all round.
    // Nearby only: a B-site holder must not wander to the T spawn.
    const here = world.nearestNode(bot.position);
    const options = Object.keys(world.nodes).filter((n) => {
      if (n === here) return false;
      const node = world.nodes[n];
      return (node.x - bot.position.x) * (node.x - bot.position.x) + (node.z - bot.position.z) * (node.z - bot.position.z) < 18 * 18;
    });
    if (options.length === 0) {
      bot.holdUntil = ctx.time + range(random, 2, 5);
      return 0;
    }
    bot.path = world.route(here, pick(random, options));
    bot.pathIndex = 0;
    bot.state = 'move';
    return 0;
  };

  const separate = (bot) => {
    bots.forEach((other) => {
      if (other === bot || other.alive === false) return;
      const dx = bot.position.x - other.position.x;
      const dz = bot.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 0.64 || d2 <= 0.0001) return;
      const d = Math.sqrt(d2);
      bot.position.x += (dx / d) * (0.8 - d) * 0.5;
      bot.position.z += (dz / d) * (0.8 - d) * 0.5;
    });
  };

  const integrate = (bot, dt, speed) => {
    bot.onGround = world.moveBody(bot.position, bot.velocity, dt, BODY_RADIUS, BODY_HEIGHT, 20);
    bot.bobPhase += dt * (speed > 0.1 ? 9 : 2);
    const bob = speed > 0.1 ? Math.sin(bot.bobPhase) * 0.03 : 0;
    bot.group.position.set(bot.position.x, bot.position.y + bob, bot.position.z);
    bot.group.rotation.set(0, bot.yaw, 0);
  };

  const stepBot = (bot, dt, ctx) => {
    if (bot.alive === false) {
      updateDeadBot(bot, dt);
      return;
    }
    bot.thinkTimer -= dt;
    bot.visionTimer -= dt;
    if (bot.visionTimer <= 0) scanVision(bot, ctx);
    listenForNoise(bot, ctx);
    if (bot.thinkTimer <= 0) thinkRoles(bot, ctx);
    let speed = 0;
    if (bot.state === 'engage' && bot.target) speed = actEngage(bot, dt, ctx);
    else if (bot.state === 'defuse') speed = actDefuse(bot, dt, ctx);
    else if (bot.state === 'move') speed = actMove(bot, dt, ctx);
    else if (bot.state === 'hold') speed = actHold(bot, dt, ctx);
    separate(bot);
    integrate(bot, dt, speed);
  };

  const step = (dt, ctx) => {
    bots.forEach((bot) => stepBot(bot, dt, ctx));
  };

  return {
    bots,
    shootables,
    spawnRound,
    step,
    damageBot,
    aliveCount(team) {
      return bots.reduce((n, b) => n + (b.team === team && b.alive ? 1 : 0), 0);
    },
    reset() {
      bots.forEach((bot) => {
        bot.alive = false;
        bot.group.visible = false;
      });
    },
  };
};
