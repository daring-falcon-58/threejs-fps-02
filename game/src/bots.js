// Bots: 5v5. The player leads four Viper bots against five Jackal bots. Each bot is a
// small state machine — MOVE along the waypoint graph, HOLD a position, ENGAGE a seen
// enemy, PLANT or DEFUSE the spike — with vision (field of view plus line of sight),
// hearing (gunshots pull bots toward the noise), burst fire with aim error, and roles
// that change when the spike is planted. One Raycaster and a handful of reused vectors
// serve every bot; nothing is allocated in the per-frame loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { pick, range } from './rng.js';

const EYE_HEIGHT = 1.5;
const BODY_RADIUS = 0.34;
const BODY_HEIGHT = 1.7;
const WALK_SPEED = 4.1;
const HOLD_SPEED = 2.0;
const VISION_RANGE = 38;
const VISION_HALF_FOV = 1.05;
const HEAR_RANGE = 26;
const REACT_MIN = 0.32;
const REACT_MAX = 0.62;
// Bots sharpen as the match goes on: each round past the first trims the
// reaction delay by 3%, down to a 30% cut, so late rounds feel faster.
// Round 1 is untouched (factor 1), which keeps the staged captures identical.
const REACT_RAMP_PER_ROUND = 0.03;
const REACT_RAMP_FLOOR = 0.7;

const VIPER_NAMES = ['Kite', 'Rook', 'Fable', 'Noor'];
const JACKAL_NAMES = ['Vex', 'Hale', 'Mira', 'Doss', 'Pike'];
const PLANS = ['split', 'stackA', 'stackB', 'mid'];

function buildBotMesh(team) {
  const trim = team === 'vipers' ? PALETTE.teal : PALETTE.rust;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.85, metalness: 0.15 });
  const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(trim), roughness: 0.5, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.9, metalness: 0 });
  const group = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), bodyMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  group.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.1, 0.32), trimMat);
  chest.position.y = 1.28;
  group.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skinMat);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(trim) }));
  visor.position.set(0, 1.6, 0.15);
  group.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), bodyMat);
  legL.position.set(-0.14, 0.35, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.55), bodyMat);
  gun.position.set(0.2, 1.25, -0.25);
  group.add(gun);
  return { group, torso, head, legL, legR };
}

export function createBots(scene, world, random, fx, audio) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const tmpDir = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const tmpMove = new THREE.Vector3();
  const tmpFacing = new THREE.Vector3();
  const tmpMuzzle = new THREE.Vector3();
  const bots = [];
  let shootables = [];

  function makeBot(team, name, index) {
    const parts = buildBotMesh(team);
    parts.group.visible = false;
    scene.add(parts.group);
    const bot = {
      team, name, index,
      parts, group: parts.group,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0, health: 100, alive: false, onGround: true,
      state: 'idle', path: [], pathIndex: 0, holdUntil: 0,
      target: null, lastSeen: null, lastSeenAt: -99, reactAt: 0,
      burstLeft: 0, burstTimer: 0, skill: 0.55 + random() * 0.25,
      role: 'roam', site: null, channel: 0, channelKind: null,
      heardAt: -99, heardPos: null, investigateAt: 0,
      thinkTimer: random() * 0.2, visionTimer: random() * 0.15,
      strafeDir: 1, strafeTimer: 0, fallT: 0, bobPhase: random() * 6,
    };
    parts.torso.userData = { bot, part: 'body' };
    parts.head.userData = { bot, part: 'head' };
    parts.legL.userData = { bot, part: 'leg' };
    parts.legR.userData = { bot, part: 'leg' };
    shootables.push(parts.torso, parts.head, parts.legL, parts.legR);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) bots.push(makeBot('vipers', VIPER_NAMES[i], i));
  for (let i = 0; i < 5; i += 1) bots.push(makeBot('jackals', JACKAL_NAMES[i], i));

  function resetBot(bot, spawn, yaw) {
    bot.position.copy(spawn);
    bot.velocity.set(0, 0, 0);
    bot.yaw = yaw;
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
    bot.group.visible = true;
    bot.group.rotation.set(0, yaw, 0);
    bot.group.position.copy(bot.position);
  }

  function spawnRound(roundNumber, bombSite) {
    const plan = PLANS[(roundNumber - 1) % PLANS.length];
    const jackalAssignments = {
      split: ['aSite', 'aSite', 'bSite', 'bSite', 'mid'],
      stackA: ['aSite', 'aSite', 'aSite', 'mid', 'bSite'],
      stackB: ['bSite', 'bSite', 'bSite', 'mid', 'aSite'],
      mid: ['mid', 'mid', 'aSite', 'bSite', 'midTop'],
    }[plan];
    const jackals = bots.filter((b) => b.team === 'jackals');
    jackals.forEach((bot, i) => {
      resetBot(bot, world.spawns.jackals[i], 0);
      bot.role = 'hold';
      bot.site = jackalAssignments[i];
      bot.path = world.route(world.nearestNode(bot.position), jackalAssignments[i]);
      bot.pathIndex = 0;
    });
    const vipers = bots.filter((b) => b.team === 'vipers');
    const viperRoles = ['follow', 'follow', 'pushA', 'pushB'];
    vipers.forEach((bot, i) => {
      resetBot(bot, world.spawns.vipers[i], Math.PI);
      bot.role = viperRoles[i];
      bot.site = viperRoles[i] === 'pushA' ? 'aSite' : viperRoles[i] === 'pushB' ? 'bSite' : null;
      bot.path = [];
      bot.pathIndex = 0;
    });
    return plan;
  }

  function eyeOf(bot) {
    tmpEye.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    return tmpEye;
  }

  function canSee(bot, enemyPos, enemyEyeY) {
    tmpDir.set(enemyPos.x - bot.position.x, enemyEyeY - (bot.position.y + EYE_HEIGHT), enemyPos.z - bot.position.z);
    const dist = tmpDir.length();
    if (dist > VISION_RANGE) return false;
    tmpDir.divideScalar(dist || 1);
    tmpFacing.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (tmpFacing.dot(tmpDir) < Math.cos(VISION_HALF_FOV) && dist > 4) return false;
    const eye = eyeOf(bot);
    return !world.segmentBlocked(eye.x, eye.y, eye.z, enemyPos.x, enemyEyeY, enemyPos.z);
  }

  function damageBot(bot, amount, part, attacker, ctx) {
    if (!bot.alive) return;
    bot.health -= amount;
    tmpTarget.copy(bot.position);
    tmpTarget.y += part === 'head' ? 1.58 : 1.1;
    fx.blood(tmpTarget);
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.fallT = 0.0001;
      ctx.onKill(bot, attacker, part === 'head');
    } else {
      // Being shot at snaps the bot's attention to its attacker.
      if (attacker && attacker.position) {
        bot.lastSeen = attacker.position.clone ? attacker.position.clone() : attacker.position;
        bot.lastSeenAt = ctx.time;
        bot.target = attacker;
      }
    }
  }

  function shootAt(bot, targetPos, targetEyeY, ctx) {
    // Aim error grows with distance and target speed; bots miss, especially far away.
    const dx = targetPos.x - bot.position.x;
    const dy = targetEyeY - (bot.position.y + EYE_HEIGHT);
    const dz = targetPos.z - bot.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const error = (0.012 + dist * 0.0016) * (1.6 - bot.skill);
    tmpDir.set(
      dx / dist + (random() * 2 - 1) * error,
      dy / dist + (random() * 2 - 1) * error,
      dz / dist + (random() * 2 - 1) * error,
    ).normalize();
    const eye = eyeOf(bot);
    // The ray starts at the muzzle, 0.6 m ahead of the eye, so a bot never shoots
    // its own head mesh.
    tmpMuzzle.set(eye.x + tmpDir.x * 0.6, eye.y - 0.1, eye.z + tmpDir.z * 0.6);
    raycaster.set(tmpMuzzle, tmpDir);
    const targets = ctx.raycastTargets;
    const hit = raycaster.intersectObjects(targets, false)[0];
    const muzzle = tmpMuzzle;
    if (hit) {
      fx.tracer(muzzle, hit.point);
      const ud = hit.object.userData;
      if (ud && ud.bot && ud.bot !== bot && ud.bot.alive) {
        const dmg = 33 * (dist > 25 ? 0.7 : 1) * (ud.part === 'head' ? 3.5 : ud.part === 'leg' ? 0.75 : 1);
        damageBot(ud.bot, dmg, ud.part, bot, ctx);
        if (ud.bot.team === 'jackals' && bot.team === 'vipers') ctx.onBotHit(ud.bot, dmg);
      } else if (ud && ud.player) {
        const dmg = 33 * (dist > 25 ? 0.7 : 1);
        ctx.onPlayerDamage(dmg, bot);
      } else {
        fx.impact(hit.point);
      }
    } else {
      tmpTarget.copy(eye).addScaledVector(tmpDir, 60);
      fx.tracer(muzzle, tmpTarget);
    }
    audio.shot('rifle', true);
    ctx.noise(bot.position.x, bot.position.z, HEAR_RANGE);
  }

  function steer(bot, dt, speed) {
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
    let dyaw = targetYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, dyaw));
    bot.velocity.x = tmpMove.x * speed;
    bot.velocity.z = tmpMove.z * speed;
    return false;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      if (bot.fallT > 0 && bot.fallT < 1) {
        bot.fallT = Math.min(1, bot.fallT + dt * 2.4);
        bot.group.rotation.z = bot.fallT * Math.PI * 0.48;
        bot.group.position.y = bot.position.y + Math.sin(bot.fallT * Math.PI) * 0.08;
      }
      return;
    }
    bot.thinkTimer -= dt;
    bot.visionTimer -= dt;

    // ---- Vision: scan for the nearest visible enemy on the fixed tick ----
    if (bot.visionTimer <= 0) {
      bot.visionTimer = 0.15;
      const enemies = ctx.enemiesOf(bot);
      // A dead target is dropped at once; never shoot a corpse.
      if (bot.target && !enemies.includes(bot.target)) {
        bot.target = null;
        if (bot.state === 'engage') bot.state = 'move';
      }
      let best = null;
      let bestDist = Infinity;
      for (const other of enemies) {
        const d = bot.position.distanceToSquared(other.position);
        if (d < bestDist && canSee(bot, other.position, other.position.y + EYE_HEIGHT)) {
          best = other;
          bestDist = d;
        }
      }
      if (best) {
        bot.target = best;
        bot.lastSeen = best.position;
        bot.lastSeenAt = ctx.time;
        if (bot.state !== 'engage') {
          bot.state = 'engage';
          // Reaction delay shrinks with the round (see REACT_RAMP_* above):
          // a bot in round 5 is already ~12% quicker off the mark than in
          // round 1, and the ramp bottoms out at 30% faster.
          const round = ctx.round || 1;
          const ramp = Math.max(REACT_RAMP_FLOOR, 1 - (round - 1) * REACT_RAMP_PER_ROUND);
          bot.reactAt = ctx.time + range(random, REACT_MIN, REACT_MAX) * (1.4 - bot.skill) * ramp;
          bot.burstLeft = 0;
        }
      } else if (bot.state === 'engage' && ctx.time - bot.lastSeenAt > 2.2) {
        bot.target = null;
        bot.state = 'move';
      }
    }

    // ---- Hearing: a nearby gunshot pulls the bot toward the noise ----
    for (const noise of ctx.noises) {
      const d2 = (noise.x - bot.position.x) ** 2 + (noise.z - bot.position.z) ** 2;
      if (d2 < noise.radius * noise.radius && ctx.time - bot.heardAt > 1.5) {
        bot.heardAt = ctx.time;
        if (bot.state !== 'engage') {
          bot.heardPos = { x: noise.x, z: noise.z };
          bot.path = world.route(world.nearestNode(bot.position), world.nearestNode(new THREE.Vector3(noise.x, 0, noise.z)));
          bot.pathIndex = 0;
          bot.state = 'move';
        }
      }
    }

    // ---- Roles: follow the player, converge on a planted spike, defuse ----
    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = 1.2 + random() * 0.8;
      if (bot.state !== 'engage') {
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
          } else if (bot.team === 'vipers') {
            if (bot.pathIndex >= bot.path.length || bot.role === 'follow') {
              bot.path = world.route(world.nearestNode(bot.position), siteNode);
              bot.pathIndex = 0;
              bot.state = 'move';
            }
          }
        } else if (bot.role === 'follow' && ctx.playerAlive) {
          const near = world.nearestNode(ctx.playerPos);
          if (bot.pathIndex >= bot.path.length || bot.path[bot.path.length - 1] !== near) {
            bot.path = world.route(world.nearestNode(bot.position), near);
            bot.pathIndex = 0;
            bot.state = 'move';
          }
        } else if (bot.role === 'follow' && !ctx.playerAlive) {
          // The leader is down: push the nearer site instead of standing still.
          bot.role = bot.position.x < 0 ? 'pushA' : 'pushB';
          bot.site = bot.role === 'pushA' ? 'aSite' : 'bSite';
          bot.path = world.route(world.nearestNode(bot.position), bot.site);
          bot.pathIndex = 0;
          bot.state = 'move';
        } else if (bot.role === 'hold' && bot.pathIndex >= bot.path.length && bot.state !== 'hold') {
          bot.state = 'hold';
          bot.holdUntil = ctx.time + range(random, 2, 5);
          bot.yaw += range(random, -1.2, 1.2);
        } else if ((bot.role === 'pushA' || bot.role === 'pushB') && bot.pathIndex >= bot.path.length && bot.state !== 'hold') {
          bot.state = 'hold';
          bot.holdUntil = ctx.time + range(random, 3, 6);
        }
      }
    }

    // ---- Movement and combat ----
    let speed = 0;
    if (bot.state === 'engage' && bot.target) {
      // Face the target, strafe, and fire in bursts after the reaction delay.
      const t = bot.target.position;
      const targetYaw = Math.atan2(-(t.x - bot.position.x), -(t.z - bot.position.z));
      let dyaw = targetYaw - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.yaw += Math.max(-4 * dt, Math.min(4 * dt, dyaw));
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 0.5 + random() * 0.7;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const dist = bot.position.distanceTo(t);
      if (dist > 14) {
        speed = WALK_SPEED * 0.7;
        bot.velocity.x = -Math.sin(bot.yaw) * speed;
        bot.velocity.z = -Math.cos(bot.yaw) * speed;
      } else {
        bot.velocity.x = Math.cos(bot.yaw) * bot.strafeDir * HOLD_SPEED * 0.7;
        bot.velocity.z = -Math.sin(bot.yaw) * bot.strafeDir * HOLD_SPEED * 0.7;
      }
      if (ctx.time >= bot.reactAt) {
        bot.burstTimer -= dt;
        if (bot.burstLeft <= 0 && bot.burstTimer <= 0) {
          bot.burstLeft = 3 + Math.floor(random() * 3);
          bot.burstTimer = 0.096;
        } else if (bot.burstLeft > 0 && bot.burstTimer <= 0) {
          bot.burstLeft -= 1;
          bot.burstTimer = bot.burstLeft > 0 ? 0.096 : 0.7 + random() * 0.5;
          const eyeY = bot.target.position.y + EYE_HEIGHT;
          shootAt(bot, bot.target.position, eyeY, ctx);
        }
      }
    } else if (bot.state === 'defuse') {
      const arrived = steer(bot, dt, WALK_SPEED);
      if (arrived) {
        bot.channel += dt;
        bot.channelKind = 'defuse';
        if (bot.channel >= 5) ctx.onDefused(bot);
      } else {
        bot.channel = 0;
      }
    } else if (bot.state === 'move') {
      const arrived = steer(bot, dt, WALK_SPEED);
      if (arrived) {
        bot.velocity.x = 0;
        bot.velocity.z = 0;
        if (bot.role === 'hold' || bot.role === 'pushA' || bot.role === 'pushB') {
          bot.state = 'hold';
          bot.holdUntil = ctx.time + range(random, 2, 5);
        }
      }
    } else if (bot.state === 'hold') {
      bot.velocity.x = 0;
      bot.velocity.z = 0;
      bot.yaw += Math.sin(ctx.time * 0.4 + bot.bobPhase) * 0.0012;
      if (ctx.time > bot.holdUntil && bot.role === 'hold') {
        // Rotate between nearby nodes so holders do not stand still all round.
        // Nearby only: a B-site holder must not wander to the T spawn.
        const here = world.nearestNode(bot.position);
        const options = Object.keys(world.nodes).filter((n) => {
          if (n === here) return false;
          const node = world.nodes[n];
          return (node.x - bot.position.x) ** 2 + (node.z - bot.position.z) ** 2 < 18 * 18;
        });
        if (options.length) {
          bot.path = world.route(here, pick(random, options));
          bot.pathIndex = 0;
          bot.state = 'move';
        } else {
          bot.holdUntil = ctx.time + range(random, 2, 5);
        }
      }
    }

    // Separation: bots do not stack on each other.
    for (const other of bots) {
      if (other === bot || !other.alive) continue;
      const dx = bot.position.x - other.position.x;
      const dz = bot.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        bot.position.x += (dx / d) * (0.8 - d) * 0.5;
        bot.position.z += (dz / d) * (0.8 - d) * 0.5;
      }
    }

    bot.onGround = world.moveBody(bot.position, bot.velocity, dt, BODY_RADIUS, BODY_HEIGHT, 20);
    bot.bobPhase += dt * (speed > 0.1 ? 9 : 2);
    const bob = speed > 0.1 ? Math.sin(bot.bobPhase) * 0.03 : 0;
    bot.group.position.set(bot.position.x, bot.position.y + bob, bot.position.z);
    bot.group.rotation.set(0, bot.yaw, 0);
  }

  function step(dt, ctx) {
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  return {
    bots,
    shootables,
    spawnRound,
    step,
    damageBot,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    reset() {
      for (const bot of bots) {
        bot.alive = false;
        bot.group.visible = false;
      }
    },
  };
}
