// The arsenal: four guns and a frag grenade, each with its own numbers, view model and
// sound. Spread punishes moving and sustained fire; damage falls off with distance; the
// head is worth 3.5x. The module owns the numbers and the view model; main.js owns the
// ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'VK-9', kind: 'pistol', price: 0, mag: 12, reserve: Infinity, damage: 34,
    headMult: 3.5, legMult: 0.75, fireGap: 0.16, reloadTime: 1.4, auto: false,
    spreadStill: 0.003, spreadMove: 0.02, spreadBloom: 0.012, maxBloom: 0.05,
    recoil: 0.006, range: 40, falloffStart: 18,
  },
  rifle: {
    name: 'AR-47 Heron', kind: 'rifle', price: 2700, mag: 30, reserve: 90, damage: 33,
    headMult: 3.5, legMult: 0.75, fireGap: 0.096, reloadTime: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, spreadBloom: 0.004, maxBloom: 0.055,
    recoil: 0.009, range: 60, falloffStart: 25,
  },
  smg: {
    name: 'Wasp-9', kind: 'smg', price: 1500, mag: 32, reserve: 128, damage: 24,
    headMult: 3.5, legMult: 0.75, fireGap: 0.07, reloadTime: 1.6, auto: true,
    spreadStill: 0.004, spreadMove: 0.034, spreadBloom: 0.005, maxBloom: 0.07,
    recoil: 0.006, range: 35, falloffStart: 14,
  },
  dmr: {
    name: 'Longbow', kind: 'dmr', price: 3800, mag: 5, reserve: 20, damage: 88,
    headMult: 3.5, legMult: 0.75, fireGap: 0.9, reloadTime: 2.6, auto: false,
    spreadStill: 0.0004, spreadMove: 0.05, spreadBloom: 0.03, maxBloom: 0.06,
    recoil: 0.03, range: 90, falloffStart: 40, zoom: 3.2,
  },
};

export const GRENADE = { name: 'M-67 Frag', price: 400, damage: 95, radius: 6.5, fuse: 1.4 };

function buildViewModel(kind) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const model = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  if (kind === 'pistol') {
    add(0.07, 0.09, 0.24, 0, 0, -0.1, body);
    add(0.06, 0.12, 0.08, 0, -0.09, 0.02, grip);
  } else if (kind === 'smg') {
    add(0.08, 0.09, 0.34, 0, 0, -0.12, body);
    add(0.05, 0.16, 0.06, 0, -0.1, -0.02, grip);
    add(0.04, 0.04, 0.2, 0, 0.02, -0.34, accent);
  } else if (kind === 'dmr') {
    add(0.07, 0.08, 0.62, 0, 0, -0.2, body);
    add(0.05, 0.06, 0.14, 0, 0.07, -0.12, accent);
    add(0.06, 0.1, 0.16, 0, -0.08, 0.08, grip);
  } else {
    add(0.09, 0.1, 0.42, 0, 0, -0.12, body);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.5, grip);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.18, grip);
  }
  model.position.set(0.26, -0.23, -0.5);
  return model;
}

export function createWeaponSystem(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.21, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.19, -0.7);
  camera.add(flashLight);

  const models = {};
  for (const kind of Object.keys(WEAPONS)) {
    models[kind] = buildViewModel(kind);
    models[kind].visible = false;
    camera.add(models[kind]);
  }

  // Ammunition is tracked per weapon, so switching away and back never refills a gun.
  const ammo = {};
  for (const [kind, d] of Object.entries(WEAPONS)) ammo[kind] = { mag: d.mag, reserve: d.reserve };

  const state = {
    kind: 'rifle', mag: 30, reserve: 90, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, bloom: 0, zoomed: false, grenades: 0,
  };
  let currentModel = models.rifle;
  currentModel.visible = true;

  function def() {
    return WEAPONS[state.kind];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    currentModel.position.z = -0.5 + state.kick;
    currentModel.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      currentModel.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  function equip(kind) {
    if (!WEAPONS[kind]) return false;
    // Bank the outgoing gun's ammunition, then load the incoming gun's.
    ammo[state.kind] = { mag: state.mag, reserve: state.reserve };
    currentModel.visible = false;
    state.kind = kind;
    currentModel = models[kind];
    currentModel.visible = true;
    state.mag = ammo[kind].mag;
    state.reserve = ammo[kind].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.bloom = 0;
    state.zoomed = false;
    return true;
  }

  function damageAt(distance, part) {
    const d = def();
    let damage = d.damage;
    if (distance > d.falloffStart) {
      damage *= Math.max(0.55, 1 - (distance - d.falloffStart) / d.range);
    }
    if (part === 'head') damage *= d.headMult;
    else if (part === 'leg') damage *= d.legMult;
    return damage;
  }

  return {
    state,
    step,
    equip,
    def,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().fireGap;
      state.flash = 0.06;
      state.kick = def().kind === 'dmr' ? 0.12 : 0.055;
      state.bloom = Math.min(def().maxBloom, state.bloom + def().spreadBloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return false;
      state.reloadLeft = d.reloadTime;
      return true;
    },
    spread(speed) {
      const d = def();
      const moving = Math.min(1, speed / 5.2);
      const base = d.spreadStill + moving * d.spreadMove + state.bloom;
      return state.zoomed ? base * 0.35 : base;
    },
    recoil() {
      return def().recoil * (state.zoomed ? 0.6 : 1);
    },
    damageAt,
    refill() {
      // A new round refills every owned gun.
      for (const [kind, d] of Object.entries(WEAPONS)) ammo[kind] = { mag: d.mag, reserve: d.reserve };
      const d = def();
      state.mag = d.mag;
      state.reserve = d.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
    setZoomed(on) {
      state.zoomed = on && def().zoom !== undefined;
      return state.zoomed;
    },
    zoomFactor() {
      return state.zoomed ? (def().zoom || 1) : 1;
    },
  };
}
