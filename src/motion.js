// 畫面更新與動態效果。
// - morph()：只更新有變化的元素，讓卡牌、隨從保持同一個 DOM 元素，動畫才能連續。
// - 彈簧曲線：沒有固定時長的感覺，從目前畫面上的位置出發。
// - FLIP：元素換位置時，從舊位置平滑移到新位置；新隨從從手牌（或對手的牌堆）飛上戰場。
(function (root) {
  'use strict';

  // ── 彈簧 → CSS linear() 曲線 ──
  // damping 1 = 不回彈；小於 1 會稍微超過再回來。response = 大約多快到達（秒）。
  function spring(damping, response) {
    const w = (2 * Math.PI) / response;
    const wd = w * Math.sqrt(Math.max(0, 1 - damping * damping));
    const pos = (t) => (damping >= 1
      ? 1 - (1 + w * t) * Math.exp(-w * t)
      : 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t)));
    let settle = 0;
    for (let t = 0; t < 3; t += 0.005) if (Math.abs(1 - pos(t)) > 0.002) settle = t;
    const duration = settle + 0.005;
    const points = [];
    for (let i = 0; i <= 48; i++) points.push(+pos((duration * i) / 48).toFixed(4));
    points[48] = 1;
    const supported = typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)');
    return {
      easing: supported ? `linear(${points.join(', ')})` : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      duration: Math.round(duration * 1000),
    };
  }

  const SPRING = spring(1, 0.35); // 預設：不回彈
  const BOUNCY = spring(0.8, 0.35); // 有「丟出去」的動作時才用（出牌落地）

  const reduceMotion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ── 只更新有變化的部分 ──
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);

  function morphNode(from, to) {
    for (const { name } of [...from.attributes]) {
      if (!to.hasAttribute(name) && !(name === 'open' && from.tagName === 'DETAILS')) from.removeAttribute(name);
    }
    for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
    if (from.tagName === 'INPUT') {
      if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked');
      else if (from.value !== to.getAttribute('value') && document.activeElement !== from) from.value = to.getAttribute('value') || '';
    }
    morphChildren(from, to);
  }

  function morphChildren(from, to) {
    const oldKids = [...from.childNodes];
    const keyed = new Map();
    const unkeyed = [];
    for (const k of oldKids) {
      const id = keyOf(k);
      if (id) keyed.set(id, k);
      else unkeyed.push(k);
    }
    let u = 0;
    const result = [];
    for (const nk of [...to.childNodes]) {
      const id = keyOf(nk);
      let match = null;
      if (id) {
        match = keyed.get(id);
        if (match && match.nodeName === nk.nodeName) keyed.delete(id);
        else match = null;
      } else {
        const cand = unkeyed[u];
        if (cand && cand.nodeName === nk.nodeName) {
          match = cand;
          u++;
        }
      }
      if (!match) {
        result.push(nk);
      } else {
        if (nk.nodeType === 1) morphNode(match, nk);
        else if (match.nodeValue !== nk.nodeValue) match.nodeValue = nk.nodeValue;
        result.push(match);
      }
    }
    const keep = new Set(result);
    for (const k of oldKids) if (!keep.has(k)) from.removeChild(k);
    result.forEach((node, i) => {
      const at = from.childNodes[i];
      if (at !== node) from.insertBefore(node, at || null);
    });
  }

  function morph(container, html) {
    const next = document.createElement(container.tagName);
    next.innerHTML = html;
    morphChildren(container, next);
  }

  // ── 記錄畫面上目前的位置（含正在進行的動畫，從這裡接續才不會跳）──
  function capture(container) {
    const rects = new Map();
    const clones = new Map();
    container.querySelectorAll('[data-key]').forEach((el) => {
      if (!el.matches('.minion, .card, .portrait, .piles')) return;
      rects.set(el.dataset.key, el.getBoundingClientRect());
      if (el.classList.contains('minion')) clones.set(el.dataset.key, el.cloneNode(true));
    });
    return { rects, clones };
  }

  let layer = null;
  function fxLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  // 在固定位置放一個不能點的分身，用來播放離場或飛行動畫
  function ghost(node, rect) {
    const g = node.cloneNode(true);
    g.classList.add('ghost');
    g.classList.remove('can-act', 'selected', 'targetable', 'tut-focus', 'playable');
    for (const attr of ['data-key', 'data-action', 'data-uid', 'title']) g.removeAttribute(attr);
    g.querySelectorAll('.dmg').forEach((d) => d.remove());
    g.tabIndex = -1;
    Object.assign(g.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    fxLayer().appendChild(g);
    return g;
  }

  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function lungeFrames(from, to) {
    const a = center(from);
    const b = center(to);
    const dx = (b.x - a.x) * 0.55;
    const dy = (b.y - a.y) * 0.55;
    return [
      { transform: 'none' },
      { transform: `translate(${dx}px, ${dy}px) scale(1.06)`, offset: 0.45, easing: 'cubic-bezier(0.5, 0, 1, 1)' },
      { transform: 'none' },
    ];
  }

  const HIT_DELAY = 150; // 攻擊衝到目標的時間點，受擊與傷害數字在這一刻出現

  // 依照「更新前的位置」和這次行動的資訊播放動畫
  function animate(container, before, fx = {}) {
    const after = new Map();
    container.querySelectorAll('.minion[data-key], .card[data-key], .portrait[data-key]').forEach((el) => after.set(el.dataset.key, el));
    const still = reduceMotion.matches;
    const R = (key) => (key ? before.rects.get(key) : null);
    const attack = fx.attack && { ...fx.attack, from: R(fx.attack.key), to: R(fx.attack.targetKey) };

    // 已存在的元素換了位置 → 從舊位置滑過去
    let drawIndex = 0;
    for (const [key, el] of after) {
      if (el.classList.contains('portrait')) continue;
      const old = before.rects.get(key);
      const now = el.getBoundingClientRect();
      if (old) {
        const dx = old.left - now.left;
        const dy = old.top - now.top;
        if (!still && Math.hypot(dx, dy) > 12) {
          el.getAnimations().forEach((a) => a.cancel());
          el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], SPRING);
        }
        continue;
      }
      if (still) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
        continue;
      }
      if (el.classList.contains('minion')) {
        // 新隨從：從打出它的地方飛到戰場
        const src = R(fx.sourceKey);
        if (src) {
          const s = Math.min(src.width / now.width, 1.6);
          const dx = center(src).x - center(now).x;
          const dy = center(src).y - center(now).y;
          el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.7 }, { transform: 'none', opacity: 1 }], BOUNCY);
        } else {
          el.animate([{ transform: 'scale(0.85)', opacity: 0 }, { transform: 'none', opacity: 1 }], SPRING);
        }
      } else {
        // 新手牌：從自己的牌庫抽出來
        const pile = R(fx.deckKey);
        const dx = pile ? center(pile).x - center(now).x : 0;
        const dy = pile ? center(pile).y - center(now).y : 40;
        el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
          { ...SPRING, delay: Math.min(drawIndex++ * 50, 300), fill: 'backwards' });
      }
    }

    // 攻擊：攻擊者衝向目標再彈回，目標在撞到的瞬間震一下
    if (attack && attack.from && attack.to) {
      const attacker = after.get(attack.key);
      if (attacker && !still) {
        attacker.style.zIndex = 5;
        attacker.animate(lungeFrames(attack.from, attack.to), { duration: 380 }).finished
          .then(() => { attacker.style.zIndex = ''; }, () => {});
      }
      const target = after.get(attack.targetKey);
      if (target && !still) {
        target.animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }],
          { duration: 260, delay: HIT_DELAY });
      }
    }

    // 陣亡或被移走的隨從：在原地淡出縮小
    for (const [key, clone] of before.clones) {
      if (after.has(key)) continue;
      const rect = before.rects.get(key);
      const g = ghost(clone, rect);
      const frames = [];
      if (attack && attack.key === key && attack.to && !still) {
        frames.push(...lungeFrames(rect, attack.to).slice(0, 2));
      } else {
        frames.push({ transform: 'none', opacity: 1, offset: 0 }, { transform: 'none', opacity: 1, offset: 0.35 });
      }
      frames.push(still ? { opacity: 0 } : { transform: 'scale(0.8)', opacity: 0, filter: 'blur(4px)' });
      g.animate(frames, { duration: still ? 220 : 460, easing: 'ease-out' }).finished.then(() => g.remove(), () => g.remove());
    }

    // 法術：卡牌飛向目標後消失
    if (fx.spell && fx.spell.card) {
      const targetEl = fx.spell.targetKey && after.get(fx.spell.targetKey);
      const to = targetEl ? targetEl.getBoundingClientRect() : before.rects.get(fx.spell.targetKey);
      const from = R(fx.spell.fromKey);
      if (!from) return;
      const g = ghost(fx.spell.card, { left: center(from).x - 64, top: center(from).y - 88, width: 128, height: 176 });
      if (still || !to) {
        g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 200 }).finished.then(() => g.remove(), () => g.remove());
      } else {
        const dx = center(to).x - center(from).x;
        const dy = center(to).y - center(from).y;
        const frames = fx.spell.reveal
          ? [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1, offset: 0.3 }, { transform: 'scale(1)', opacity: 1, offset: 0.6, easing: 'cubic-bezier(0.5, 0, 1, 1)' }]
          : [{ transform: 'scale(1)', opacity: 1, easing: 'cubic-bezier(0.5, 0, 1, 1)' }];
        frames.push({ transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0 });
        g.animate(frames, { duration: fx.spell.reveal ? 900 : 380 }).finished.then(() => g.remove(), () => g.remove());
      }
    }
  }

  const api = { morph, capture, animate, SPRING, BOUNCY, reduceMotion, HIT_DELAY };
  root.ElementMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
