// SABLE LINE boot: one fixed-step simulation, one render loop. The player leads
// four Viper bots against five Jackal bots in round-based tactical play: plant the
// spike at A or B, or eliminate the other team. ?shot=start|play|site|end with
// &seed=N stages a deterministic frame for a capture, renders it twice, then
// freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { PALETTE } from './palette.js';
import { createInput } from './input.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeaponSystem, WEAPONS, GRENADE } from './weapons.js';
import { createEffects } from './effects.js';
import { createBots } from './bots.js';
import { createRounds, BUY_ITEMS, PLANT_TIME } from './rounds.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;

// Launch parameters: a staged capture (?shot=...&seed=N) or a live match.
const readLaunch = () => {
  const query = new URLSearchParams(location.search);
  const staged = query.get('shot');
  const seed = Number.parseInt(query.get('seed') ?? '1', 10) || 1;
  return { staged, random: mulberry32(staged ? seed : (Date.now() % 2147483647)) };
};
const { staged, random } = readLaunch();

const makeRenderer = () => {
  const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.setSize(innerWidth, innerHeight);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game').appendChild(r.domElement);
  return r;
};
const renderer = makeRenderer();

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const makeCamera = () => {
  const cam = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 160);
  scene.add(cam);
  return cam;
};
const camera = makeCamera();

const world = createWorld(scene);
const fx = createEffects(scene);
const audio = createAudio();
const rounds = createRounds();
const player = createPlayer(world);
const weapon = createWeaponSystem(camera);
const bots = createBots(scene, world, random, fx, audio);
const grenades = createGrenades(scene, world, fx, audio);
const hud = createHud();
const onLockChange = (locked) => {
  if (staged) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuy(false);
    buyOpen = false;
    return;
  }
  if (matchStarted === false || rounds.state.phase === 'matchEnd') return;
  if (player.state.alive) hud.showOverlay(started ? 'paused' : 'start');
};
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootTargets = [...world.shootables, ...bots.shootables];
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// The player's hitbox for bot raycasts: invisible to the eye, solid to a ray.
const makeHitMesh = (geometry, extra) => {
  const mesh = new THREE.Mesh(geometry, playerHitMat);
  mesh.userData = { player: true, ...extra };
  scene.add(mesh);
  return mesh;
};
const playerHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerHitMesh = makeHitMesh(new THREE.BoxGeometry(0.68, 1.72, 0.68), {});
const playerHeadMesh = makeHitMesh(new THREE.SphereGeometry(0.2, 8, 6), { part: 'head' });
const botRaycastTargets = [...shootTargets, playerHitMesh, playerHeadMesh];

const playerEntity = { position: player.state.position, team: 'vipers', isPlayer: true };
let noises = [];
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let prevReload = false;
let prevGrenade = false;
let prevBuy = false;
let prevMute = false;
const prevBuyKeys = new Set();
let plantHeld = false;
let lastBeep = 0;
let buyOpen = false;
let owned = new Set(['pistol']);
let matchStarted = false;

const noise = (x, z, radius) => {
  noises.push({ x, z, radius });
};

const syncCamera = () => {
  const body = player.state;
  const pos = body.position;
  camera.position.set(pos.x, pos.y + body.eye, pos.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const want = 74 / weapon.zoomFactor();
  const off = camera.fov - want;
  if (off > 0.05 || off < -0.05) {
    camera.fov = want + off * 0.7;
    camera.updateProjectionMatrix();
  }
  playerHitMesh.position.set(pos.x, pos.y + 0.86, pos.z);
  playerHeadMesh.position.set(pos.x, pos.y + body.eye, pos.z);
};

const aimAt = (point) => {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.pitch = Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1));
  body.yaw = Math.atan2(-dx, -dz);
  syncCamera();
};

const onKill = (bot, attacker, headshot) => {
  const byPlayer = attacker === playerEntity;
  hud.killfeed(`${byPlayer ? 'You' : attacker.name} ✕ ${bot.name}${headshot ? ' (headshot)' : ''}`);
  if (byPlayer === false) {
    checkRoundEnd();
    return;
  }
  rounds.addKillReward();
  audio.kill();
  hud.hitMarker(true, 220);
  // A kill by anyone can end the round.
  checkRoundEnd();
};

const onPlayerDamage = (amount, fromBot) => {
  if (player.state.alive === false) return;
  const died = player.damage(amount);
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(player.state.health);
  if (died === false) return;
  hud.showOverlay('dead');
  if (document.pointerLockElement) document.exitPointerLock();
  hud.killfeed(`${fromBot.name} ✕ You`);
  checkRoundEnd();
};

const onDefused = () => {
  const result = rounds.endRound('jackals', 'defused');
  if (result) onRoundEnd(result);
};

const pickDefuser = () => {
  if (rounds.state.bomb.planted === false) return null;
  const site = rounds.state.bomb.site === 'A' ? world.sites[0] : world.sites[1];
  let best = null;
  let bestDist = Infinity;
  bots.bots.forEach((bot) => {
    if (bot.team !== 'jackals' || bot.alive === false) return;
    const d = bot.position.distanceToSquared(site.center);
    if (d >= bestDist) return;
    bestDist = d;
    best = bot;
  });
  return best;
};

const enemiesOf = (bot) => {
  const foes = bots.bots.filter((other) => other.alive && other.team !== bot.team);
  if (bot.team === 'jackals' && player.state.alive) foes.push(playerEntity);
  return foes;
};

const onExplode = (position, radius, damage) => {
  bots.bots.forEach((bot) => {
    if (bot.alive === false) return;
    const d = bot.position.distanceTo(position);
    if (d >= radius) return;
    bots.damageBot(bot, damage * (1 - (d / radius) * 0.75), 'body', playerEntity, botCtx());
  });
  // The player in the blast.
  if (player.state.alive === false) return;
  tmpVec.copy(player.state.position);
  tmpVec.y += 1;
  const d = tmpVec.distanceTo(position);
  if (d >= radius) return;
  onPlayerDamage(damage * (1 - (d / radius) * 0.75) * 0.6, { name: 'M-67' });
};

const botCtx = () => {
  const ctx = {};
  ctx.time = elapsed;
  // The round number lets bots sharpen as the match goes on: a bot that has
  // seen the player win rounds reacts a touch faster than in round 1.
  ctx.round = rounds.state.round;
  ctx.enemiesOf = enemiesOf;
  ctx.raycastTargets = botRaycastTargets;
  ctx.noises = noises;
  ctx.noise = noise;
  ctx.bomb = rounds.state.bomb;
  ctx.playerAlive = player.state.alive;
  ctx.playerPos = player.state.position;
  ctx.onKill = onKill;
  ctx.onBotHit = () => {};
  ctx.onPlayerDamage = onPlayerDamage;
  ctx.onDefused = onDefused;
  ctx.pickDefuser = pickDefuser;
  return ctx;
};

const checkRoundEnd = () => {
  if (rounds.state.phase !== 'live') return;
  const vipersAlive = bots.aliveCount('vipers') + (player.state.alive ? 1 : 0);
  const jackalsAlive = bots.aliveCount('jackals');
  // Spike still ticks: the round ends at detonation, handled by rounds.step,
  // and the Jackals must defuse before the timer ends.
  if (rounds.state.bomb.planted) return;
  const end = (winner) => {
    const result = rounds.endRound(winner, 'elimination');
    if (result) onRoundEnd(result);
  };
  if (jackalsAlive === 0) end('vipers');
  else if (vipersAlive === 0) end('jackals');
};

const onRoundEnd = (result) => {
  const won = result.winner === 'vipers';
  let reasonText = '';
  if (result.reason === 'elimination') reasonText = 'Enemy team eliminated';
  else if (result.reason === 'detonation') reasonText = 'Spike detonated';
  else if (result.reason === 'defused') reasonText = 'Spike defused';
  else if (result.reason === 'time') reasonText = 'Time expired — site held';
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reasonText}  ·  ${rounds.state.score.vipers} — ${rounds.state.score.jackals}`, 3600);
  if (won) audio.roundWin();
  else audio.roundLose();
  if (rounds.state.phase !== 'matchEnd') return;
  setTimeout(() => {
    hud.showMatchEnd(rounds.state.score.vipers, rounds.state.score.jackals, won);
    if (document.pointerLockElement) document.exitPointerLock();
  }, 1500);
};

const respawnRound = () => {
  const plan = bots.spawnRound(rounds.state.round, null);
  player.reset(world.spawns.vipers[1], Math.PI);
  weapon.equip(owned.has('rifle') ? 'rifle' : 'pistol');
  weapon.refill();
  weapon.state.grenades = owned.has('grenade') ? 1 : 0;
  grenades.reset();
  fx.reset();
  buyOpen = false;
  hud.setHealth(100);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.score.vipers, rounds.state.score.jackals);
  hud.setBomb(null, 0);
  hud.showBuy(false);
  return plan;
};

const startMatch = () => {
  matchStarted = true;
  owned.clear();
  owned.add('pistol');
  rounds.startMatch();
  hud.hideOverlay();
  respawnRound();
  hud.banner('ROUND 1', 'Buy phase — press B for the buy menu', 3000);
};

const restart = () => {
  startMatch();
  input.requestLock();
};

hud.onPlay(() => {
  if (staged) return;
  audio.unlock();
  if (matchStarted && rounds.state.phase !== 'matchEnd') {
    input.requestLock();
    return;
  }
  restart();
});

hud.onBuy((item) => {
  buyItem(item);
});

const buyItem = (item) => {
  const result = rounds.buy(item);
  if (result.ok === false) {
    audio.denied();
    return;
  }
  audio.buy();
  hud.buyFlash(item);
  if (item !== 'grenade') {
    owned.add(item);
    weapon.equip(item);
  } else {
    owned.add('grenade');
    weapon.state.grenades = 1;
  }
  hud.setMoney(rounds.state.money);
  hud.setGrenades(weapon.state.grenades);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
};

const shoot = (spread) => {
  if (weapon.takeRound() === false) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  for (const axis of ['x', 'y', 'z']) direction[axis] += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootTargets, false)[0];
  const muzzle = tmpVec2.copy(camera.position).addScaledVector(direction, 0.7);
  if (hit === undefined) {
    tmpVec.copy(camera.position).addScaledVector(direction, 80);
    fx.tracer(muzzle, tmpVec);
  } else {
    fx.tracer(muzzle, hit.point);
    const ud = hit.object.userData;
    if (ud && ud.bot && ud.bot.alive) {
      const damage = weapon.damageAt(hit.distance, ud.part);
      bots.damageBot(ud.bot, damage, ud.part, playerEntity, botCtx());
      hud.hitMarker(ud.bot.health <= 0, 120);
      audio.hit();
      if (ud.bot.health <= 0) checkRoundEnd();
    } else {
      fx.impact(hit.point);
    }
  }
  weapon.pullTrigger();
  const recoil = weapon.recoil();
  player.recoil(recoil + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(weapon.state.kind);
  noise(player.state.position.x, player.state.position.z, 26);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  return true;
};

const advanceRound = (dt) => {
  const roundEvent = rounds.step(dt);
  if (roundEvent === null || roundEvent === undefined) return;
  if (roundEvent.next) {
    respawnRound();
    hud.banner(`ROUND ${rounds.state.round}`, 'Buy phase — press B for the buy menu', 3000);
  } else if (roundEvent.winner) onRoundEnd(roundEvent);
};

const updateBomb = () => {
  if (rounds.state.bomb.planted === false) return;
  // Bomb beeps accelerate as the timer runs down.
  const interval = 0.25 + rounds.state.bomb.timer * (0.75 / 35);
  if (lastBeep + interval < elapsed) {
    lastBeep = elapsed;
    audio.beep(rounds.state.bomb.timer < 10);
  }
  hud.setBomb(`SPIKE — ${Math.ceil(rounds.state.bomb.timer)}s`, 1 - rounds.state.bomb.timer / 35);
};

const updateActors = (dt) => {
  const phase = rounds.state.phase;
  if (phase !== 'live' && phase !== 'freeze') return;
  player.step(dt, input.state.keys);
  weapon.step(dt);
  // Bots hold still during the freeze (buy) phase; they fight once the round is live.
  if (phase === 'live') bots.step(dt, botCtx());
  grenades.step(dt, { onExplode });
  fx.step(dt);
};

const updatePlant = (dt) => {
  const body = player.state;
  const planting = rounds.state.phase === 'live' && rounds.state.bomb.planted === false && body.alive;
  const inSite = planting
    ? world.sites.find((s) => (body.position.x - s.center.x) * (body.position.x - s.center.x) + (body.position.z - s.center.z) * (body.position.z - s.center.z) < s.radius * s.radius)
    : null;
  if (inSite !== null && input.pressed('KeyE')) {
    rounds.state.bomb.plantProgress += dt;
    hud.setBomb(`PLANTING SPIKE — ${inSite.id}`, rounds.state.bomb.plantProgress / PLANT_TIME);
    if (rounds.state.bomb.plantProgress < PLANT_TIME) return;
    rounds.plant(inSite.id, inSite.center);
    audio.plant();
    hud.banner('SPIKE PLANTED', `Site ${inSite.id} — defend it for ${35} seconds`, 3000);
    hud.killfeed(`You planted the spike at ${inSite.id}`);
    hud.setMoney(rounds.state.money);
    return;
  }
  rounds.state.bomb.plantProgress = Math.max(0, rounds.state.bomb.plantProgress - dt * 2);
  if (rounds.state.bomb.planted === false) hud.setBomb(null, 0);
};

const step = (dt) => {
  elapsed += dt;
  advanceRound(dt);
  updateBomb();
  updateActors(dt);
  updatePlant(dt);
  noises = [];
};

const handleBuyAndSwitch = () => {
  if (buyOpen) {
    // Buy keys are edge-triggered: holding 1 must not buy the rifle sixty times.
    BUY_ITEMS.forEach((entry) => {
      const down = input.pressed(entry.key);
      if (down && prevBuyKeys.has(entry.key) === false) buyItem(entry.item);
      if (down) prevBuyKeys.add(entry.key);
      else prevBuyKeys.delete(entry.key);
    });
    return;
  }
  // Weapon switch: 1 pistol, 2 rifle, 3 SMG, 4 DMR — only what is owned.
  [['Digit1', 'pistol'], ['Digit2', 'rifle'], ['Digit3', 'smg'], ['Digit4', 'dmr']].forEach(([code, kind]) => {
    if (input.pressed(code) === false) return;
    if (owned.has(kind) === false) return;
    if (weapon.state.kind === kind) return;
    weapon.equip(kind);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    audio.buy();
  });
};

const pollInput = () => {
  const look = input.takeLook();
  const zoomed = weapon.setZoomed(input.state.aiming && player.state.alive);
  player.look(look.x * (zoomed ? 0.45 : 1), look.y * (zoomed ? 0.45 : 1));
  tryFire();
  tryReload();
  tryGrenade();
  tryBuyToggle();
  handleBuyAndSwitch();
  tryMute();
};

const tryFire = () => {
  const def = weapon.def();
  const firing = input.state.firing && player.state.alive && buyOpen === false && rounds.state.phase !== 'freeze' && rounds.state.phase !== 'lobby';
  if (firing === false || weapon.ready() === false) {
    prevFiring = input.state.firing;
    return;
  }
  if (def.auto || prevFiring === false) shoot(staged ? 0 : weapon.spread(player.groundSpeed()));
  prevFiring = input.state.firing;
};

const tryReload = () => {
  const pressed = input.pressed('KeyR');
  if (pressed && prevReload === false && weapon.reload()) audio.reload();
  prevReload = pressed;
};

const tryGrenade = () => {
  const pressed = input.pressed('KeyG');
  const canThrow = pressed && prevGrenade === false && weapon.state.grenades > 0 && player.state.alive && rounds.state.phase === 'live';
  if (canThrow) {
    weapon.state.grenades -= 1;
    hud.setGrenades(weapon.state.grenades);
    camera.getWorldDirection(direction);
    tmpVec.copy(camera.position).addScaledVector(direction, 0.5);
    grenades.throwGrenade(tmpVec, direction);
  }
  prevGrenade = pressed;
};

const tryBuyToggle = () => {
  const pressed = input.pressed('KeyB');
  if (pressed && prevBuy === false && rounds.canBuy() && player.state.alive) {
    buyOpen = buyOpen === false;
    hud.showBuy(buyOpen);
    if (buyOpen) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else input.requestLock();
  }
  prevBuy = pressed;
};

const tryMute = () => {
  const pressed = input.pressed('KeyM');
  if (pressed && prevMute === false) audio.toggleMute();
  prevMute = pressed;
};

const advanceSim = (dt) => {
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    step(STEP);
    accumulator = accumulator - STEP;
    steps++;
  }
  if (accumulator > STEP * 5) accumulator = 0;
};

const refreshHud = () => {
  hud.setHealth(player.state.health);
  hud.setMoney(rounds.state.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  // The timer runs in the freeze (buy) phase and while the round is live;
  // every other phase shows 0.
  const phase = rounds.state.phase;
  const timer = phase === 'freeze' || phase === 'live' ? rounds.state.phaseTime : 0;
  hud.setTimer(timer);
  hud.setAlive(bots.aliveCount('vipers') + (player.state.alive ? 1 : 0), bots.aliveCount('jackals'));
  hud.setScore(rounds.state.score.vipers, rounds.state.score.jackals);
  hud.setCrosshairSpread(weapon.spread(player.groundSpeed()) * 900 + 4);
  syncCamera();
};

const frame = (now) => {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen === false) {
    pollInput();
    advanceSim(dt);
    refreshHud();
  }
  renderer.render(scene, camera);
};

const settle = (steps) => {
  let index = 0;
  while (index < steps) {
    step(STEP);
    index += 1;
  }
};

const stageStart = () => {
  const body = player.state;
  // T spawn, looking down mid toward A: two Viper bots ahead, dusk light.
  body.position.set(0, 0, 15);
  body.yaw = 0.35;
  body.pitch = 0.01;
  const vipers = bots.bots.filter((b) => b.team === 'vipers');
  vipers[0].yaw = 0.2;
  vipers[0].position.set(-2, 0, 9);
  vipers[1].yaw = -0.3;
  vipers[1].position.set(3, 0, 7);
  settle(30);
  syncCamera();
};

const stagePlay = () => {
  const body = player.state;
  // Mid firefight: a Jackal in the open mid lane, tracer in flight, hitmarker up.
  body.position.set(0, 0, 8);
  body.yaw = 0;
  body.pitch = 0;
  const jackal = bots.bots.find((b) => b.team === 'jackals');
  jackal.yaw = Math.PI;
  jackal.position.set(0.5, 0, -1.5);
  jackal.group.position.copy(jackal.position);
  settle(10);
  aimAt(new THREE.Vector3(0.5, 1.2, -1.5));
  shoot(0);
  hud.hitMarker(false, 4000);
  settle(6);
  syncCamera();
};

const stageSite = () => {
  const body = player.state;
  // A site: the spike is planted, a Viper holds the angle, the site ring glows.
  body.position.set(-13, 0, -4);
  body.yaw = 0.7;
  body.pitch = 0.02;
  rounds.plant('A', world.sites[0].center);
  const viper = bots.bots.find((b) => b.team === 'vipers');
  viper.yaw = 0.9;
  viper.position.set(-15, 0, -6);
  viper.group.position.copy(viper.position);
  const jackal = bots.bots.find((b) => b.team === 'jackals');
  jackal.yaw = 2.6;
  jackal.position.set(-21, 0, -13);
  jackal.group.position.copy(jackal.position);
  settle(20);
  syncCamera();
};

const stageEnd = () => {
  const body = player.state;
  // Round won: banner up, two fallen Jackals in the lane, score 1-0.
  body.position.set(1.5, 0, 6);
  body.yaw = 0;
  body.pitch = 0;
  const fallen = bots.bots.filter((b) => b.team === 'jackals');
  fallen[0].alive = false;
  fallen[0].state = 'dead';
  fallen[0].position.set(-0.5, 0, 1);
  fallen[0].group.position.copy(fallen[0].position);
  fallen[0].group.rotation.set(0, 0.5, 1.2);
  fallen[1].alive = false;
  fallen[1].state = 'dead';
  fallen[1].position.set(2.5, 0, 0);
  fallen[1].group.position.copy(fallen[1].position);
  fallen[1].group.rotation.set(0, -0.8, -1.2);
  settle(10);
  aimAt(new THREE.Vector3(-0.5, 0.3, 1));
  rounds.state.score.vipers = 1;
  hud.setScore(1, 0);
  hud.banner('ROUND WON', 'Enemy team eliminated  ·  1 — 0', 60000);
  syncCamera();
};

const runShot = (name) => {
  hud.hideOverlay();
  hud.showBuy(false);
  startMatch();
  hud.hideBanner();
  rounds.goLive();
  // The staged shots show the rifle: it reads better than the sidearm.
  owned.add('rifle');
  weapon.equip('rifle');
  weapon.refill();
  const stages = { start: stageStart, play: stagePlay, site: stageSite, end: stageEnd };
  const stage = stages[name] || stages.end;
  stage();
  hud.setScore(rounds.state.score.vipers, rounds.state.score.jackals);
  hud.setHealth(player.state.health);
  hud.setMoney(rounds.state.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setTimer(rounds.state.phaseTime);
  hud.setAlive(bots.aliveCount('vipers') + 1, bots.aliveCount('jackals'));
  paintTwiceThenReady();
};

const paintTwiceThenReady = () => {
  let painted = 0;
  const paint = () => {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted++;
    if (painted >= 2) {
      frozen = true;
      window.__shotReady = true;
    }
  };
  requestAnimationFrame(paint);
};

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
hud.setMoney(rounds.state.money);
hud.setScore(0, 0);
hud.setAlive(5, 5);
if (staged) runShot(staged);
else requestAnimationFrame(frame);
