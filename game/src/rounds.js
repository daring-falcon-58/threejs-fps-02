// Rounds and money: freeze time to buy, a live round won by elimination or by the
// spike, and the economy between rounds. One place owns the phase, the timers, the
// score and the wallet, so the rest of the game reads it instead of tracking its own.
import { WEAPONS, GRENADE } from './weapons.js';

export const [FREEZE_TIME, ROUND_TIME, BOMB_TIME, PLANT_TIME, DEFUSE_TIME] = [4, 100, 35, 3.5, 5];
export const [WIN_ROUNDS, MAX_ROUNDS] = [5, 9];

const BUY_ROWS = [
  ['Digit1', 'rifle', 'AR-47 Heron — rifle', WEAPONS.rifle.price],
  ['Digit2', 'smg', 'Wasp-9 — SMG', WEAPONS.smg.price],
  ['Digit3', 'dmr', 'Longbow — DMR', WEAPONS.dmr.price],
  ['Digit4', 'grenade', 'M-67 Frag grenade', GRENADE.price],
  ['Digit5', 'pistol', 'VK-9 — sidearm', 0],
];
export const BUY_ITEMS = BUY_ROWS.map(([key, item, label, price]) => ({ key, item, label, price }));

export const createRounds = () => {
  const state = {};
  state.phase = 'lobby'; // lobby | freeze | live | roundEnd | matchEnd
  state.round = 0;
  state.score = { vipers: 0, jackals: 0 };
  state.money = 800;
  state.lossStreak = 0;
  state.phaseTime = 0; // time left in the current phase
  state.bomb = { timer: 0, planted: false, site: null, position: null, plantProgress: 0, defuseProgress: 0 };
  state.winner = null;
  state.matchWinner = null;

  const startMatch = () => {
    state.round = 0;
    state.score = { vipers: 0, jackals: 0 };
    state.money = 800;
    state.lossStreak = 0;
    state.matchWinner = null;
    startRound();
  };

  const startRound = () => {
    state.round += 1;
    state.phase = 'freeze';
    state.phaseTime = FREEZE_TIME;
    state.bomb = { timer: 0, planted: false, site: null, position: null, plantProgress: 0, defuseProgress: 0 };
    state.winner = null;
  };

  const goLive = () => {
    state.phase = 'live';
    state.phaseTime = ROUND_TIME;
  };

  const endRound = (winner, reason) => {
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
    const matchOver = state.score.vipers >= WIN_ROUNDS || state.score.jackals >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
    if (matchOver === false) return { winner, reason };
    state.phase = 'matchEnd';
    state.matchWinner = state.score.vipers > state.score.jackals ? 'vipers' : 'jackals';
    return { winner, reason };
  };

  const plant = (site, position) => {
    state.bomb.planted = true;
    state.bomb.site = site;
    state.bomb.position = position;
    state.bomb.timer = BOMB_TIME;
    state.money += 300;
  };

  const canBuy = () => state.phase === 'freeze';

  const buy = (item) => {
    if (canBuy() === false) return { ok: false, reason: 'Buy phase is over' };
    const entry = BUY_ITEMS.find((b) => b.item === item);
    if (entry === undefined) return { ok: false, reason: 'Unknown item' };
    if (entry.price > state.money) return { ok: false, reason: 'Not enough money' };
    state.money -= entry.price;
    return { ok: true, entry };
  };

  const addKillReward = () => {
    state.money += 300;
  };

  const step = (dt) => {
    if (state.phase === 'freeze') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) goLive();
      return null;
    }
    if (state.phase === 'live') {
      state.phaseTime -= dt;
      if (state.bomb.planted) {
        state.bomb.timer -= dt;
        if (state.bomb.timer <= 0) return endRound('vipers', 'detonation');
        return null;
      }
      if (state.phaseTime <= 0) return endRound('jackals', 'time');
      return null;
    }
    if (state.phase === 'roundEnd') {
      state.phaseTime -= dt;
      if (state.phaseTime > 0) return null;
      startRound();
      return { next: true };
    }
    return null;
  };

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
};
