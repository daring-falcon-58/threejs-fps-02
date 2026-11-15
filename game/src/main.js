// SABLE LINE: boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate. The player leads four Viper bots against five Jackal bots in round
// based tactical play: plant the spike at A or B, or eliminate the other team.
// ?shot=start|play|site|end with &seed=N stages a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSystem, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { createRounds, BUY_ITEMS, PLANT_TIME } from './rounds.js';
import { createGrenades } from './grenades.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const fx = createEffects(scene);
const audio = createAudio();
const rounds = createRounds();
const player = createPlayer(world);
const weapon = createWeaponSystem(camera);
const bots = createBots(scene, world, random, fx, audio);
const grenades = createGrenades(scene, world, fx, audio);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootTargets = world.shootables.concat(bots.shootables);
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// The player's hitbox for bot raycasts: invisible to the eye, solid to a ray.
const playerHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerHitMesh = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.72, 0.68), playerHitMat);
playerHitMesh.userData = { player: true };
const playerHeadMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), playerHitMat);
playerHeadMesh.userData = { player: true, part: 'head' };
scene.add(playerHitMesh, playerHeadMesh);
const botRaycastTargets = shootTargets.concat([playerHitMesh, playerHeadMesh]);

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

function noise(x, z, radius) {
  noises.push({ x, z, radius });
}

function syncCamera() {
  const body = player.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const zoom = weapon.zoomFactor();
  const targetFov = 74 / zoom;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.3;
    camera.updateProjectionMatrix();
  }
  playerHitMesh.position.set(body.position.x, body.position.y + 0.86, body.position.z);
  playerHeadMesh.position.set(body.position.x, body.position.y + body.eye, body.position.z);
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function onKill(bot, attacker, headshot) {
  const attackerName = attacker === playerEntity ? 'You' : attacker.name;
  hud.killfeed(`${attackerName} ✕ ${bot.name}${headshot ? ' (headshot)' : ''}`);
  if (attacker === playerEntity) {
    rounds.addKillReward();
    audio.kill();
    hud.hitMarker(true, 220);
  }
  // A kill by anyone can end the round.
  checkRoundEnd();
}

function onPlayerDamage(amount, fromBot) {
  if (!player.state.alive) return;
  const died = player.damage(amount);
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(player.state.health);
  if (died) {
    hud.showOverlay('dead');
    if (document.pointerLockElement) document.exitPointerLock();
    hud.killfeed(`${fromBot.name} ✕ You`);
    checkRoundEnd();
  }
}

function onDefused() {
  const result = rounds.endRound('jackals', 'defused');
  if (result) onRoundEnd(result);
}

function pickDefuser() {
  if (!rounds.state.bomb.planted) return null;
  const site = rounds.state.bomb.site === 'A' ? world.sites[0] : world.sites[1];
  let best = null;
  let bestDist = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'jackals' || !bot.alive) continue;
    const d = bot.position.distanceToSquared(site.center);
    if (d < bestDist) { bestDist = d; best = bot; }
  }
  return best;
}

function enemiesOf(bot) {
  const list = [];
  if (bot.team === 'jackals') {
    for (const other of bots.bots) if (other.team === 'vipers' && other.alive) list.push(other);
    if (player.state.alive) list.push(playerEntity);
  } else {
    for (const other of bots.bots) if (other.team === 'jackals' && other.alive) list.push(other);
  }
  return list;
}

function onExplode(position, radius, damage) {
  // Bots in the blast.
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.position.distanceTo(position);
    if (d < radius) {
      const amount = damage * (1 - (d / radius) * 0.75);
      bots.damageBot(bot, amount, 'body', playerEntity, botCtx());
    }
  }
  // The player in the blast.
  if (player.state.alive) {
    tmpVec.copy(player.state.position);
    tmpVec.y += 1;
    const d = tmpVec.distanceTo(position);
    if (d < radius) onPlayerDamage(damage * (1 - (d / radius) * 0.75) * 0.6, { name: 'M-67' });
  }
}

function botCtx() {
  return {
    time: elapsed,
    // The round number lets bots sharpen as the match goes on: a bot that has
    // seen the player win rounds reacts a touch faster than in round 1.
    round: rounds.state.round,
    enemiesOf,
    raycastTargets: botRaycastTargets,
    noises,
    noise,
    bomb: rounds.state.bomb,
    playerAlive: player.state.alive,
    playerPos: player.state.position,
    onKill,
    onBotHit: () => {},
    onPlayerDamage,
    onDefused,
    pickDefuser,
  };
}

function checkRoundEnd() {
  if (rounds.state.phase !== 'live') return;
  const vipersAlive = bots.aliveCount('vipers') + (player.state.alive ? 1 : 0);
  const jackalsAlive = bots.aliveCount('jackals');
  if (rounds.state.bomb.planted) {
    if (jackalsAlive === 0) {
      // Spike still ticks: the round ends at detonation, handled by rounds.step.
      return;
    }
    if (vipersAlive === 0) return; // Jackals must defuse before the timer ends.
    return;
  }
  if (jackalsAlive === 0) {
    const result = rounds.endRound('vipers', 'elimination');
    if (result) onRoundEnd(result);
  } else if (vipersAlive === 0) {
    const result = rounds.endRound('jackals', 'elimination');
    if (result) onRoundEnd(result);
  }
}

function onRoundEnd(result) {
  const won = result.winner === 'vipers';
  const reasonText = {
    elimination: 'Enemy team eliminated',
    detonation: 'Spike detonated',
    defused: 'Spike defused',
    time: 'Time expired — site held',
  }[result.reason] || '';
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', `${reasonText}  ·  ${rounds.state.score.vipers} — ${rounds.state.score.jackals}`, 3600);
  if (won) audio.roundWin();
  else audio.roundLose();
  if (rounds.state.phase === 'matchEnd') {
    setTimeout(() => {
      hud.showMatchEnd(rounds.state.score.vipers, rounds.state.score.jackals, won);
      if (document.pointerLockElement) document.exitPointerLock();
    }, 1500);
  }
}

function respawnRound() {
  const plan = bots.spawnRound(rounds.state.round, null);
  const spawn = world.spawns.vipers[1];
  player.reset(spawn, Math.PI);
  weapon.equip(owned.has('rifle') ? 'rifle' : 'pistol');
  weapon.refill();
  weapon.state.grenades = owned.has('grenade') ? 1 : 0;
  grenades.reset();
  fx.reset();
  buyOpen = false;
  hud.showBuy(false);
  hud.setHealth(100);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.score.vipers, rounds.state.score.jackals);
  hud.setBomb(null, 0);
  return plan;
}

function startMatch() {
  matchStarted = true;
  owned = new Set(['pistol']);
  rounds.startMatch();
  respawnRound();
  hud.hideOverlay();
  hud.banner(`ROUND 1`, 'Buy phase — press B for the buy menu', 3000);
}

function restart() {
  startMatch();
  input.requestLock();
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (!matchStarted || rounds.state.phase === 'matchEnd') restart();
  else input.requestLock();
});

hud.onBuy((item) => {
  buyItem(item);
});

function buyItem(item) {
  const result = rounds.buy(item);
  if (!result.ok) {
    audio.denied();
    return;
  }
  audio.buy();
  hud.buyFlash(item);
  if (item === 'grenade') {
    owned.add('grenade');
    weapon.state.grenades = 1;
  } else {
    owned.add(item);
    weapon.equip(item);
  }
  hud.setMoney(rounds.state.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setGrenades(weapon.state.grenades);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuy(false);
    buyOpen = false;
  } else if (matchStarted && rounds.state.phase !== 'matchEnd') {
    if (player.state.alive) hud.showOverlay(started ? 'paused' : 'start');
  }
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootTargets, false)[0];
  const muzzle = tmpVec2.copy(camera.position).addScaledVector(direction, 0.7);
  if (hit) {
    fx.tracer(muzzle, hit.point);
    const ud = hit.object.userData;
    if (ud && ud.bot && ud.bot.alive) {
      const dist = hit.distance;
      const damage = weapon.damageAt(dist, ud.part);
      bots.damageBot(ud.bot, damage, ud.part, playerEntity, botCtx());
      hud.hitMarker(ud.bot.health <= 0, 120);
      audio.hit();
      if (ud.bot.health <= 0) checkRoundEnd();
    } else {
      fx.impact(hit.point);
    }
  } else {
    tmpVec.copy(camera.position).addScaledVector(direction, 80);
    fx.tracer(muzzle, tmpVec);
  }
  weapon.pullTrigger();
  const recoil = weapon.recoil();
  player.recoil(recoil + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(weapon.state.kind);
  noise(player.state.position.x, player.state.position.z, 26);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  return true;
}

function step(dt) {
  elapsed += dt;
  const roundEvent = rounds.step(dt);
  if (roundEvent && roundEvent.next) {
    respawnRound();
    hud.banner(`ROUND ${rounds.state.round}`, 'Buy phase — press B for the buy menu', 3000);
  } else if (roundEvent && roundEvent.winner) {
    onRoundEnd(roundEvent);
  }

  // Bomb beeps accelerate as the timer runs down.
  if (rounds.state.bomb.planted) {
    const interval = 0.25 + (rounds.state.bomb.timer / 35) * 0.75;
    if (elapsed - lastBeep > interval) {
      lastBeep = elapsed;
      audio.beep(rounds.state.bomb.timer < 10);
    }
    hud.setBomb(`SPIKE — ${Math.ceil(rounds.state.bomb.timer)}s`, 1 - rounds.state.bomb.timer / 35);
  }

  if (rounds.state.phase === 'live' || rounds.state.phase === 'freeze') {
    player.step(dt, input.state.keys);
    weapon.step(dt);
    // Bots hold still during the freeze (buy) phase; they fight once the round is live.
    if (rounds.state.phase === 'live') bots.step(dt, botCtx());
    grenades.step(dt, { onExplode });
    fx.step(dt);
  }

  // Plant channel: hold E inside a site while the round is live.
  const body = player.state;
  const inSite = rounds.state.phase === 'live' && !rounds.state.bomb.planted && body.alive
    ? world.sites.find((s) => (body.position.x - s.center.x) ** 2 + (body.position.z - s.center.z) ** 2 < s.radius * s.radius)
    : null;
  if (inSite && input.pressed('KeyE')) {
    rounds.state.bomb.plantProgress += dt;
    hud.setBomb(`PLANTING SPIKE — ${inSite.id}`, rounds.state.bomb.plantProgress / PLANT_TIME);
    if (rounds.state.bomb.plantProgress >= PLANT_TIME) {
      rounds.plant(inSite.id, inSite.center);
      audio.plant();
      hud.banner('SPIKE PLANTED', `Site ${inSite.id} — defend it for ${35} seconds`, 3000);
      hud.killfeed(`You planted the spike at ${inSite.id}`);
      hud.setMoney(rounds.state.money);
    }
  } else {
    rounds.state.bomb.plantProgress = Math.max(0, rounds.state.bomb.plantProgress - dt * 2);
    if (!rounds.state.bomb.planted) hud.setBomb(null, 0);
  }

  noises = [];
}

function handleBuyAndSwitch() {
  if (buyOpen) {
    // Buy keys are edge-triggered: holding 1 must not buy the rifle sixty times.
    for (const entry of BUY_ITEMS) {
      const down = input.pressed(entry.key);
      if (down && !prevBuyKeys.has(entry.key)) buyItem(entry.item);
      if (down) prevBuyKeys.add(entry.key);
      else prevBuyKeys.delete(entry.key);
    }
    return;
  }
  // Weapon switch: 1 pistol, 2 rifle, 3 SMG, 4 DMR — only what is owned.
  const switchKeys = [['Digit1', 'pistol'], ['Digit2', 'rifle'], ['Digit3', 'smg'], ['Digit4', 'dmr']];
  for (const [code, kind] of switchKeys) {
    if (input.pressed(code) && owned.has(kind) && weapon.state.kind !== kind) {
      weapon.equip(kind);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
      audio.buy();
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    const zoomed = weapon.setZoomed(input.state.aiming && player.state.alive);
    if (zoomed) player.look(look.x * 0.45, look.y * 0.45);
    else player.look(look.x, look.y);

    const firing = input.state.firing && player.state.alive && !buyOpen && rounds.state.phase !== 'freeze' && rounds.state.phase !== 'lobby';
    const def = weapon.def();
    if (firing && weapon.ready()) {
      if (def.auto || !prevFiring) shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
    }
    prevFiring = input.state.firing;

    const reloadPressed = input.pressed('KeyR');
    if (reloadPressed && !prevReload && weapon.reload()) audio.reload();
    prevReload = reloadPressed;

    const grenadePressed = input.pressed('KeyG');
    if (grenadePressed && !prevGrenade && weapon.state.grenades > 0 && player.state.alive && rounds.state.phase === 'live') {
      weapon.state.grenades -= 1;
      hud.setGrenades(weapon.state.grenades);
      camera.getWorldDirection(direction);
      tmpVec.copy(camera.position).addScaledVector(direction, 0.5);
      grenades.throwGrenade(tmpVec, direction);
    }
    prevGrenade = grenadePressed;

    const buyPressed = input.pressed('KeyB');
    if (buyPressed && !prevBuy && rounds.canBuy() && player.state.alive) {
      buyOpen = !buyOpen;
      hud.showBuy(buyOpen);
      if (buyOpen && document.pointerLockElement) document.exitPointerLock();
      if (!buyOpen) input.requestLock();
    }
    prevBuy = buyPressed;

    handleBuyAndSwitch();

    const mutePressed = input.pressed('KeyM');
    if (mutePressed && !prevMute) audio.toggleMute();
    prevMute = mutePressed;

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;

    // HUD, every frame.
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
    hud.setHealth(player.state.health);
    hud.setMoney(rounds.state.money);
    // The timer runs in the freeze (buy) phase and while the round is live;
    // every other phase shows 0.
    const timer = (rounds.state.phase === 'freeze' || rounds.state.phase === 'live') ? rounds.state.phaseTime : 0;
    hud.setTimer(timer);
    hud.setScore(rounds.state.score.vipers, rounds.state.score.jackals);
    hud.setAlive(bots.aliveCount('vipers') + (player.state.alive ? 1 : 0), bots.aliveCount('jackals'));
    hud.setCrosshairSpread(4 + weapon.spread(player.groundSpeed()) * 900);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  startMatch();
  hud.hideBanner();
  rounds.goLive();
  // The staged shots show the rifle: it reads better than the sidearm.
  owned.add('rifle');
  weapon.equip('rifle');
  weapon.refill();
  const body = player.state;
  if (name === 'start') {
    // T spawn, looking down mid toward A: two Viper bots ahead, dusk light.
    body.position.set(0, 0, 15);
    body.yaw = 0.35;
    body.pitch = 0.01;
    const vipers = bots.bots.filter((b) => b.team === 'vipers');
    vipers[0].position.set(-2, 0, 9);
    vipers[0].yaw = 0.2;
    vipers[1].position.set(3, 0, 7);
    vipers[1].yaw = -0.3;
    settle(30);
    syncCamera();
  } else if (name === 'play') {
    // Mid firefight: a Jackal in the open mid lane, tracer in flight, hitmarker up.
    body.position.set(0, 0, 8);
    body.yaw = 0;
    body.pitch = 0;
    const jackal = bots.bots.find((b) => b.team === 'jackals');
    jackal.position.set(0.5, 0, -1.5);
    jackal.yaw = Math.PI;
    jackal.group.position.copy(jackal.position);
    settle(10);
    aimAt(new THREE.Vector3(0.5, 1.2, -1.5));
    shoot(0);
    hud.hitMarker(false, 4000);
    settle(6);
    syncCamera();
  } else if (name === 'site') {
    // A site: the spike is planted, a Viper holds the angle, the site ring glows.
    body.position.set(-13, 0, -4);
    body.yaw = 0.7;
    body.pitch = 0.02;
    rounds.plant('A', world.sites[0].center);
    const viper = bots.bots.find((b) => b.team === 'vipers');
    viper.position.set(-15, 0, -6);
    viper.yaw = 0.9;
    viper.group.position.copy(viper.position);
    const jackal = bots.bots.find((b) => b.team === 'jackals');
    jackal.position.set(-21, 0, -13);
    jackal.yaw = 2.6;
    jackal.group.position.copy(jackal.position);
    settle(20);
    syncCamera();
  } else {
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
  }
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
  hud.setHealth(player.state.health);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.phaseTime);
  hud.setScore(rounds.state.score.vipers, rounds.state.score.jackals);
  hud.setAlive(bots.aliveCount('vipers') + 1, bots.aliveCount('jackals'));
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name);
hud.setHealth(100);
hud.setMoney(rounds.state.money);
hud.setScore(0, 0);
hud.setAlive(5, 5);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
