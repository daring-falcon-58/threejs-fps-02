// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, money, kill feed and
// the overlay panels (start, buy, round end, match end). It never touches the simulation;
// main.js pushes numbers in and reads callbacks out.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreVipers = $('score-vipers');
  const scoreJackals = $('score-jackals');
  const pipsVipers = $('pips-vipers');
  const pipsJackals = $('pips-jackals');
  const feed = $('killfeed');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombStatus = $('bomb-status');
  const bombFill = $('bomb-fill');
  const damageVignette = $('damage-vignette');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const grenadeCount = $('grenade-count');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  function setText(el, value, key) {
    if (last[key] !== value) {
      last[key] = value;
      el.textContent = value;
    }
  }

  const BUY_COPY = {
    start: { title: 'SABLE LINE', copy: 'Plant the spike at A or B — or wipe the Jackals out. Click to play.', action: 'Click to play' },
    paused: { title: 'SABLE LINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
    dead: { title: 'You are down', copy: 'Your team fights on. The round ends when one side is gone.', action: 'Spectate' },
  };

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve === Infinity ? '∞' : reserve}`, 'res');
      setText(weaponName, name, 'wname');
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setGrenades(count) {
      setText(grenadeCount, `◉ ${count}`, 'gren');
    },
    setHealth(health) {
      setText(healthNum, String(Math.ceil(health)), 'hp');
      healthFill.style.width = `${Math.max(0, health)}%`;
      healthFill.classList.toggle('low', health <= 30);
    },
    setMoney(money) {
      setText(moneyValue, `$${money}`, 'money');
      setText(buyMoney, `$${money}`, 'buymoney');
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 'timer');
      timerValue.classList.toggle('urgent', s <= 10);
    },
    setScore(vipers, jackals) {
      setText(scoreVipers, String(vipers), 'sv');
      setText(scoreJackals, String(jackals), 'sj');
    },
    setAlive(vipers, jackals) {
      const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n);
      setText(pipsVipers, dots(vipers), 'pv');
      setText(pipsJackals, dots(jackals), 'pj');
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      setTimeout(() => damageVignette.classList.remove('on'), 180);
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    banner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    hideBanner() {
      banner.classList.remove('on');
    },
    setBomb(text, progress) {
      if (!text) {
        bombStatus.hidden = true;
        return;
      }
      bombStatus.hidden = false;
      bombStatus.querySelector('span').textContent = text;
      bombFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showBuy(show) {
      buyMenu.hidden = !show;
    },
    buyFlash(item) {
      const el = buyMenu.querySelector(`[data-item="${item}"]`);
      if (el) {
        el.classList.add('bought');
        setTimeout(() => el.classList.remove('bought'), 300);
      }
    },
    showOverlay(mode, score) {
      const text = BUY_COPY[mode];
      if (!text) return;
      title.textContent = text.title;
      copy.textContent = mode === 'dead' ? `${text.copy}` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    showMatchEnd(vipers, jackals, won) {
      title.textContent = won ? 'VICTORY — Sable Line is yours' : 'DEFEAT — the Jackals hold the yard';
      copy.textContent = `Final score ${vipers} — ${jackals}. Play again to run it back.`;
      play.textContent = 'Play again';
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyMenu.querySelectorAll('[data-item]').forEach((el) => {
        el.addEventListener('click', () => handler(el.dataset.item));
      });
    },
  };
}
