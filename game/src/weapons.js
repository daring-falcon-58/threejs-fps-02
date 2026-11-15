// The arsenal: four guns and a frag grenade, each with its own numbers, view model and
// sound. Spread punishes moving and sustained fire; damage falls off with distance; the
// head is worth 3.5x. The module owns the numbers and the view model; main.js owns the
// ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// One row per gun: name, kind, price, mag, reserve, damage, headMult, legMult,
// fireGap, reloadTime, auto, spreadStill, spreadMove, spreadBloom, maxBloom,
// recoil, range, falloffStart, zoom (only the DMR zooms).
const WEAPON_FIELDS = ['name', 'kind', 'price', 'mag', 'reserve', 'damage', 'headMult', 'legMult', 'fireGap', 'reloadTime', 'auto', 'spreadStill', 'spreadMove', 'spreadBloom', 'maxBloom', 'recoil', 'range', 'falloffStart', 'zoom'];
const WEAPON_ROWS = [
  ['VK-9', 'pistol', 0, 12, Infinity, 34, 3.5, 0.75, 0.16, 1.4, false, 0.003, 0.02, 0.012, 0.05, 0.006, 40, 18, undefined],
  ['AR-47 Heron', 'rifle', 2700, 30, 90, 33, 3.5, 0.75, 0.096, 1.9, true, 0.0022, 0.028, 0.004, 0.055, 0.009, 60, 25, undefined],
  ['Wasp-9', 'smg', 1500, 32, 128, 24, 3.5, 0.75, 0.07, 1.6, true, 0.004, 0.034, 0.005, 0.07, 0.006, 35, 14, undefined],
  ['Longbow', 'dmr', 3800, 5, 20, 88, 3.5, 0.75, 0.9, 2.6, false, 0.0004, 0.05, 0.03, 0.06, 0.03, 90, 40, 3.2],
];
export const WEAPONS = Object.fromEntries(WEAPON_ROWS.map((row) => {
  const def = {};
  WEAPON_FIELDS.forEach((field, i) => {
    if (row[i] !== undefined) def[field] = row[i];
  });
  return [row[1], def];
}));

export const GRENADE = Object.fromEntries([['name', 'M-67 Frag'], ['price', 400], ['damage', 95], ['radius', 6.5], ['fuse', 1.4]]);

// View-model parts per gun: [w, h, d, x, y, z, material, tiltX] — receiver,
// barrel, handguard, stock, magazine, grip and sights, so each gun reads as
// the weapon it is instead of a pale slab. Materials are dark gunmetal with
// one amber accent; the sights are bright so they catch the eye.
const VIEW_PARTS = {
  pistol: [
    [0.06, 0.07, 0.22, 0, 0.01, -0.08, 'body', 0],
    [0.055, 0.06, 0.2, 0, -0.03, -0.06, 'grip', 0],
    [0.05, 0.11, 0.07, 0, -0.1, 0.04, 'grip', 0.25],
    [0.012, 0.03, 0.012, 0, 0.06, -0.18, 'sight', 0],
    [0.062, 0.012, 0.08, 0, 0.045, -0.1, 'accent', 0],
  ],
  smg: [
    [0.08, 0.09, 0.3, 0, 0, -0.1, 'body', 0],
    [0.03, 0.03, 0.22, 0, 0.01, -0.34, 'body', 0],
    [0.07, 0.08, 0.2, 0, 0, -0.26, 'grip', 0],
    [0.06, 0.08, 0.14, 0, -0.01, 0.12, 'grip', 0],
    [0.04, 0.18, 0.06, 0, -0.12, -0.06, 'mag', 0],
    [0.012, 0.04, 0.012, 0, 0.06, -0.4, 'sight', 0],
    [0.082, 0.014, 0.12, 0, 0.02, -0.14, 'accent', 0],
  ],
  dmr: [
    [0.07, 0.09, 0.34, 0, 0, -0.08, 'body', 0],
    [0.03, 0.03, 0.42, 0, 0.01, -0.44, 'body', 0],
    [0.05, 0.05, 0.16, 0, 0.075, -0.1, 'grip', 0],
    [0.045, 0.045, 0.01, 0, 0.075, -0.19, 'sight', 0],
    [0.06, 0.09, 0.22, 0, -0.01, 0.16, 'grip', 0],
    [0.045, 0.12, 0.08, 0, -0.1, -0.02, 'mag', 0.12],
    [0.072, 0.012, 0.1, 0, 0.03, -0.12, 'accent', 0],
  ],
  rifle: [
    [0.09, 0.11, 0.3, 0, 0, -0.05, 'body', 0],
    [0.035, 0.035, 0.34, 0, 0.01, -0.36, 'body', 0],
    [0.08, 0.09, 0.26, 0, 0, -0.28, 'grip', 0],
    [0.07, 0.1, 0.2, 0, -0.01, 0.2, 'grip', 0],
    [0.05, 0.16, 0.09, 0, -0.11, -0.02, 'mag', 0.15],
    [0.05, 0.12, 0.07, 0, -0.1, 0.1, 'grip', 0.35],
    [0.015, 0.05, 0.015, 0, 0.075, -0.42, 'sight', 0],
    [0.04, 0.025, 0.015, 0, 0.062, -0.02, 'sight', 0],
    [0.092, 0.015, 0.1, 0, 0.03, -0.12, 'accent', 0],
  ],
};

const buildViewModel = (kind) => {
  const body = new THREE.MeshStandardMaterial({ color: 0x3d434c, roughness: 0.45, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.6, metalness: 0.4 });
  const mag = new THREE.MeshStandardMaterial({ color: 0x2e333a, roughness: 0.5, metalness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const sight = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const mats = { body, grip, mag, accent, sight };
  const model = new THREE.Group();
  (VIEW_PARTS[kind] || VIEW_PARTS.rifle).forEach(([w, h, d, x, y, z, m, tilt]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[m]);
    mesh.position.set(x, y, z);
    if (tilt) mesh.rotation.x = tilt;
    model.add(mesh);
  });
  model.position.set(0.26, -0.23, -0.5);
  model.rotation.y = -0.06;
  return model;
};

export const createWeaponSystem = (camera) => {
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

  const models = Object.fromEntries(Object.keys(WEAPONS).map((kind) => {
    const m = buildViewModel(kind);
    m.visible = false;
    camera.add(m);
    return [kind, m];
  }));

  // Ammunition is tracked per weapon, so switching away and back never refills a gun.
  const ammo = Object.fromEntries(Object.entries(WEAPONS).map(([kind, d]) => [kind, { mag: d.mag, reserve: d.reserve }]));

  const state = {};
  state.kind = 'rifle';
  state.mag = 30;
  state.reserve = 90;
  state.cooldown = 0;
  state.reloadLeft = 0;
  state.flash = 0;
  state.kick = 0;
  state.bloom = 0;
  state.zoomed = false;
  state.grenades = 0;
  let currentModel = models.rifle;
  currentModel.visible = true;

  const def = () => WEAPONS[state.kind];

  const step = (dt) => {
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.flash = Math.max(0, state.flash - dt);
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    currentModel.position.z = -0.5 + state.kick;
    currentModel.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft <= 0) return;
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    currentModel.rotation.x = -0.55 * Math.min(1, (def().reloadTime - state.reloadLeft) * 2);
    if (state.reloadLeft !== 0) return;
    const need = def().mag - state.mag;
    const take = Math.min(need, state.reserve);
    state.mag += take;
    state.reserve -= take;
  };

  const equip = (kind) => {
    if (WEAPONS[kind] === undefined) return false;
    // Bank the outgoing gun's ammunition, then load the incoming gun's.
    ammo[state.kind] = { mag: state.mag, reserve: state.reserve };
    currentModel.visible = false;
    state.kind = kind;
    currentModel = models[kind];
    currentModel.visible = true;
    state.zoomed = false;
    state.bloom = 0;
    state.reloadLeft = 0;
    state.cooldown = 0;
    state.mag = ammo[kind].mag;
    state.reserve = ammo[kind].reserve;
    return true;
  };

  const damageAt = (distance, part) => {
    const d = def();
    let damage = d.damage;
    if (distance > d.falloffStart) {
      damage *= Math.max(0.55, 1 - (distance - d.falloffStart) / d.range);
    }
    damage *= part === 'head' ? d.headMult : part === 'leg' ? d.legMult : 1;
    return damage;
  };

  const ready = () => state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;

  const pullTrigger = () => {
    state.flash = 0.06;
    state.kick = def().kind === 'dmr' ? 0.12 : 0.055;
    state.cooldown = def().fireGap;
    state.bloom = Math.min(def().maxBloom, state.bloom + def().spreadBloom);
  };

  const takeRound = () => {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    return true;
  };

  const reload = () => {
    const d = def();
    if (state.reserve === 0 || state.mag === d.mag || state.reloadLeft > 0) return false;
    state.reloadLeft = d.reloadTime;
    return true;
  };

  const spread = (speed) => {
    const d = def();
    const moving = speed / 5.2 >= 1 ? 1 : speed / 5.2;
    const base = d.spreadStill + moving * d.spreadMove + state.bloom;
    return state.zoomed === false ? base : base * 0.35;
  };

  const recoil = () => def().recoil * (state.zoomed === false ? 1 : 0.6);

  const refill = () => {
    // A new round refills every owned gun.
    Object.entries(WEAPONS).forEach(([kind, d]) => {
      ammo[kind] = { mag: d.mag, reserve: d.reserve };
    });
    const d = def();
    state.mag = d.mag;
    state.reserve = d.reserve;
    state.bloom = 0;
    state.kick = 0;
    state.flash = 0;
    state.reloadLeft = 0;
    state.cooldown = 0;
  };

  const setZoomed = (on) => {
    const hasZoom = def().zoom !== undefined;
    state.zoomed = on && hasZoom;
    return state.zoomed;
  };

  const zoomFactor = () => (state.zoomed === false ? 1 : def().zoom || 1);

  return {
    state,
    step,
    equip,
    def,
    ready,
    pullTrigger,
    takeRound,
    reload,
    spread,
    recoil,
    damageAt,
    refill,
    setZoomed,
    zoomFactor,
  };
};
