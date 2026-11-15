// Rounds and money: freeze time to buy, a live round won by elimination or by the
// spike, and the economy between rounds. One place owns the phase, the timers, the
// score and the wallet, so the rest of the game reads it instead of tracking its own.
import { WEAPONS, GRENADE } from './weapons.js';

export const FREEZE_TIME = 4;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export const BUY_ITEMS = [
  { key: 'Digit1', item: 'rifle', label: 'AR-47 Heron — rifle', price: WEAPONS.rifle.price },
  { key: 'Digit2', item: 'smg', label: 'Wasp-9 — SMG', price: WEAPONS.smg.price },
  { key: 'Digit3', item: 'dmr', label: 'Longbow — DMR', price: WEAPONS.dmr.price },
  { key: 'Digit4', item: 'grenade', label: 'M-67 Frag grenade', price: GRENADE.price },
  { key: 'Digit5', item: 'pistol', label: 'VK-9 — sidearm', price: 0 },
];

export function createRounds() {
  const state = {
    phase: 'lobby', // lobby | freeze | live | roundEnd | matchEnd
    round: 0,
    score: { vipers: 0, jackals: 0 },
    money: 800,
    lossStreak: 0,
    phaseTime: 0, // time left in the current phase
    bomb: { planted: false, site: null, position: null, timer: 0, plantProgress: 0, defuseProgress: 0 },
    winner: null,
    matchWinner: null,
  };

  function startMatch() {
    state.round = 0;
    state.score.vipers = 0;
    state.score.jackals = 0;
    state.money = 800;
    state.lossStreak = 0;
    state.matchWinner = null;
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.phase = 'freeze';
    state.phaseTime = FREEZE_TIME;
    state.bomb.planted = false;
    state.bomb.site = null;
    state.bomb.position = null;
    state.bomb.timer = 0;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
    state.winner = null;
  }

  function goLive() {
    state.phase = 'live';
    state.phaseTime = ROUND_TIME;
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return null;
    state.winner = winner;
    state.phase = 'roundEnd';
    state.phaseTime = 4;
    if (winner === 'vipers') {
      state.score.vipers += 1;
      state.money += 3250;
      state.lossStreak = 0;
    } else {
      state.score.jackals += 1;
      state.lossStreak += 1;
      state.money += 1900 + 500 * Math.min(state.lossStreak - 1, 2);
    }
    if (state.score.vipers >= WIN_ROUNDS || state.score.jackals >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'matchEnd';
      state.matchWinner = state.score.vipers > state.score.jackals ? 'vipers' : 'jackals';
    }
    return { winner, reason };
  }

  function plant(site, position) {
    state.bomb.planted = true;
    state.bomb.site = site;
    state.bomb.position = position;
    state.bomb.timer = BOMB_TIME;
    state.money += 300;
  }

  function canBuy() {
    return state.phase === 'freeze';
  }

  function buy(item) {
    if (!canBuy()) return { ok: false, reason: 'Buy phase is over' };
    const entry = BUY_ITEMS.find((b) => b.item === item);
    if (!entry) return { ok: false, reason: 'Unknown item' };
    if (entry.price > state.money) return { ok: false, reason: 'Not enough money' };
    state.money -= entry.price;
    return { ok: true, entry };
  }

  function addKillReward() {
    state.money += 300;
  }

  function step(dt) {
    if (state.phase === 'freeze') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) goLive();
    } else if (state.phase === 'live') {
      state.phaseTime -= dt;
      if (state.bomb.planted) {
        state.bomb.timer -= dt;
        if (state.bomb.timer <= 0) return endRound('vipers', 'detonation');
      } else if (state.phaseTime <= 0) {
        return endRound('jackals', 'time');
      }
    } else if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        if (state.phase === 'matchEnd') return null;
        startRound();
        return { next: true };
      }
    }
    return null;
  }

  return {
    state,
    startMatch,
    startRound,
    goLive,
    endRound,
    plant,
    canBuy,
    buy,
    addKillReward,
    step,
  };
}
