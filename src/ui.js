// 畫面：把遊戲狀態畫出來，並把點擊轉成 applyAction() 的行動。
(function () {
  'use strict';

  const G = window.ElementGame;
  const { CARDS, DECKS, ELEMENTS, KEYWORDS, LANE_NAMES, RULES } = G;
  const app = document.getElementById('app');

  let game = null;
  let settings = { decks: ['gale', 'deeprock'], names: ['玩家 1', '玩家 2'], soloTest: false };
  let selected = null; // { kind: 'hand' | 'minion', uid }
  let handoff = false;
  let pickingElement = false;
  let toastText = '';
  let toastTimer = null;
  const seen = new Set();
  const lastHp = new Map();

  const esc = (str) => String(str).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const sameRef = (a, b) => a.kind === b.kind && (a.kind === 'hero' ? a.player === b.player : a.uid === b.uid);

  // ── 選取狀態推導出的提示 ──
  function selection() {
    const info = { targets: [], lanes: [], moves: [], hint: '' };
    if (!game || game.phase !== 'main' || !selected) return info;
    if (selected.kind === 'hand') {
      const card = game.players[game.current].hand.find((c) => c.uid === selected.uid);
      const def = CARDS[card.cardId];
      if (def.type === 'minion') {
        info.lanes = G.openLanes(game);
        info.hint = `選擇要放置 ${def.name} 的路線`;
      } else {
        info.targets = G.playTargets(game, card.cardId);
        info.hint = `選擇 ${def.name} 的目標`;
      }
    } else {
      const m = G.findMinion(game, selected.uid).minion;
      info.targets = G.attackTargets(game, selected.uid);
      info.moves = G.moveOptions(game, selected.uid);
      const name = CARDS[m.cardId].name;
      info.hint = info.targets.length ? `選擇 ${name} 的攻擊目標` : `${name} 本回合不能攻擊，可以移動`;
    }
    return info;
  }

  // ── 元件 ──
  function elementChip(el) {
    return `<span class="chip el-${el}">${ELEMENTS[el].name}</span>`;
  }

  function hitMark(key, hp) {
    const prev = lastHp.get(key);
    lastHp.set(key, hp);
    return prev !== undefined && hp < prev ? `<span class="dmg" aria-hidden="true">-${prev - hp}</span>` : '';
  }

  function heroBar(p, sel, isMe) {
    const player = game.players[p];
    const ref = { kind: 'hero', player: p };
    const targetable = sel.targets.some((t) => sameRef(t, ref));
    const gems = [];
    for (let i = 0; i < RULES.maxMana; i++) {
      const cls = i < player.mana ? 'full' : i < player.maxMana ? 'spent' : 'locked';
      gems.push(`<i class="gem ${cls}"></i>`);
    }
    const res = G.RESONANCE_ELEMENTS.filter((el) => player.resonance[el] > 0)
      .map((el) => `<span class="chip el-${el}">${ELEMENTS[el].name} ${player.resonance[el]}</span>`)
      .join('');
    return `
      <div class="hero-bar ${isMe ? 'me' : 'opp'} ${game.current === p && game.phase !== 'over' ? 'active' : ''}">
        <button class="portrait ${targetable ? 'targetable' : ''}" data-action="hero" data-player="${p}"
          ${targetable ? '' : 'tabindex="-1"'} aria-label="${esc(player.name)}，生命 ${player.hp}">
          <span class="hp-num">${player.hp}</span>${hitMark(`h${p}`, player.hp)}
        </button>
        <div class="hero-info">
          <div class="hero-name">${esc(player.name)} <span class="deck-name">${DECKS[player.deckId].name}</span></div>
          <div class="mana" title="費用 ${player.mana} / ${player.maxMana}">${gems.join('')}
            <span class="mana-num">${player.mana}/${player.maxMana}</span></div>
          <div class="resonance">${res || '<span class="muted">尚無共鳴</span>'}</div>
        </div>
        <div class="piles">
          <span><b>${player.hand.length}</b> 手牌</span>
          <span><b>${player.deck.length}</b> 牌庫</span>
        </div>
      </div>`;
  }

  function minionTile(m, owner, sel) {
    const def = CARDS[m.cardId];
    const ref = { kind: 'minion', uid: m.uid };
    const mine = owner === game.current;
    const classes = ['minion', `el-${def.element}`];
    if (sel.targets.some((t) => sameRef(t, ref))) classes.push('targetable');
    if (selected && selected.kind === 'minion' && selected.uid === m.uid) classes.push('selected');
    if (mine && game.phase === 'main' && (G.canAttack(game, m.uid) || G.moveOptions(game, m.uid).length)) {
      classes.push('can-act');
    }
    if (m.frozen) classes.push('frozen');
    if (mine && m.sleeping) classes.push('sleeping');
    if (!seen.has(m.uid)) classes.push('enter');
    const tags = [...new Set([...m.keywords, ...m.tempKeywords])].map((k) => KEYWORDS[k]);
    if (m.frozen) tags.push('凍結');
    const atk = G.attackOf(m);
    return `
      <button class="${classes.join(' ')}" data-action="minion" data-uid="${m.uid}"
        title="${esc(def.name)}${def.text ? '：' + esc(def.text) : ''}">
        <span class="m-name">${def.name}</span>
        <span class="m-tags">${tags.map((t) => `<em>${t}</em>`).join('')}</span>
        <span class="stats">
          <span class="atk ${atk > def.atk ? 'up' : ''}">${atk}</span>
          <span class="hp ${m.hp < m.maxHp ? 'hurt' : m.maxHp > def.hp ? 'up' : ''}">${m.hp}</span>
        </span>
        ${hitMark(m.uid, m.hp)}
      </button>`;
  }

  function lane(i, sel) {
    const me = game.current;
    const opp = 1 - me;
    const enemy = game.players[opp].lanes[i].map((m) => minionTile(m, opp, sel)).join('');
    const mine = game.players[me].lanes[i].map((m) => minionTile(m, me, sel)).join('');
    const place = sel.lanes.includes(i)
      ? `<button class="slot place" data-action="place" data-lane="${i}">放在這裡</button>` : '';
    const move = sel.moves.includes(i)
      ? `<button class="slot place" data-action="move" data-lane="${i}">移到這裡（${G.moveCost(game)} 費）</button>` : '';
    return `
      <div class="lane">
        <div class="lane-half enemy">${enemy}</div>
        <div class="lane-label">${LANE_NAMES[i]}</div>
        <div class="lane-half mine">${mine}${place}${move}</div>
      </div>`;
  }

  function handCard(c) {
    const def = CARDS[c.cardId];
    const player = game.players[game.current];
    const cost = G.getCost(player, c.cardId);
    const playable = game.phase === 'main' && !G.playBlocker(game, c.uid);
    const isSel = selected && selected.kind === 'hand' && selected.uid === c.uid;
    return `
      <button class="card el-${def.element} ${playable ? 'playable' : ''} ${isSel ? 'selected' : ''}"
        data-action="hand" data-uid="${c.uid}">
        <span class="cost ${cost < def.cost ? 'reduced' : ''}"><span>${cost}</span></span>
        <span class="c-name">${def.name}</span>
        <span class="c-type">${ELEMENTS[def.element].name} · ${def.type === 'minion' ? '隨從' : '法術'}</span>
        <span class="c-text">${esc(def.text)}</span>
        ${def.type === 'minion' ? `<span class="stats"><span class="atk">${def.atk}</span><span class="hp">${def.hp}</span></span>` : ''}
      </button>`;
  }

  function growthPanel() {
    const player = game.players[game.current];
    const opts = G.growthOptions(game);
    const btn = (choice, title, desc) => `
      <button class="growth-opt" data-action="growth" data-choice="${choice}" ${opts.includes(choice) ? '' : 'disabled'}>
        <b>${title}</b><span>${desc}</span>
      </button>`;
    const picker = pickingElement ? `
      <div class="element-picker">
        <span>要共鳴哪個元素？</span>
        ${G.RESONANCE_ELEMENTS.map((el) => `<button class="chip-btn el-${el}" data-action="resonate" data-element="${el}">
          ${ELEMENTS[el].name}（${player.resonance[el]}）</button>`).join('')}
        <button class="link" data-action="cancel-pick">取消</button>
      </div>` : '';
    return `
      <section class="growth" aria-label="成長選擇">
        <div class="growth-head">
          <h2>成長選擇</h2>
          <span>${game.growth.picksLeft > 1 ? `後手補償：本回合可選 ${game.growth.picksLeft} 項（不能重複）` : '三選一'}</span>
        </div>
        <div class="growth-opts">
          ${btn('mana', '擴充', player.maxMana >= RULES.maxMana ? '費用已達上限' : `費用上限 ${player.maxMana} → ${player.maxMana + 1}`)}
          ${btn('draw', '研讀', '多抽 1 張牌')}
          ${btn('resonance', '共鳴', '選一個元素，共鳴值 +1')}
        </div>
        ${picker}
      </section>`;
  }

  function actionBar(sel) {
    const hint = sel.hint || '點手牌出牌，點自己的隨從攻擊或移動';
    return `
      <div class="action-bar">
        <span class="hint">${esc(hint)}</span>
        ${selected ? '<button class="btn ghost" data-action="cancel">取消</button>' : ''}
        <button class="btn primary" data-action="end">結束回合</button>
      </div>`;
  }

  // ── 畫面 ──
  function renderSetup() {
    const seat = (i) => `
      <fieldset class="seat">
        <legend>${i === 0 ? '先手' : '後手'}</legend>
        <label class="field-label" for="name-${i}">名字</label>
        <input id="name-${i}" type="text" maxlength="12" value="${esc(settings.names[i])}">
        <div class="deck-opts" role="radiogroup" aria-label="選擇牌組">
          ${Object.entries(DECKS).map(([id, d]) => `
            <label class="deck-opt">
              <input type="radio" name="deck-${i}" id="deck-${i}-${id}" value="${id}" ${settings.decks[i] === id ? 'checked' : ''}>
              <span><b>${d.name}</b><small>${d.desc}</small></span>
            </label>`).join('')}
        </div>
      </fieldset>`;
    app.innerHTML = `
      <main class="setup">
        <h1 class="logo">元素戰線</h1>
        <p class="tagline">每回合三選一：擴充費用、多抽一張、或累積元素共鳴。把隨從排進三條戰線，先打倒對方英雄的人獲勝。</p>
        <div class="seats">${seat(0)}${seat(1)}</div>
        <label class="check"><input type="checkbox" id="solo-test" ${settings.soloTest ? 'checked' : ''}>
          一個人測試（跳過換人畫面）</label>
        <button class="btn primary big" data-action="start">開始對戰</button>
        <details class="rules">
          <summary>規則速覽</summary>
          <ul>
            <li>英雄 ${RULES.startHp} 血，牌組 20 張，費用最多 ${RULES.maxMana} 點。先手起手 3 張、後手 4 張。</li>
            <li>每回合開始抽 1 張，然後做一次<b>成長選擇</b>：擴充（費用上限 +1）、研讀（多抽 1 張）或共鳴（某元素 +1）。費用不會自動成長。</li>
            <li>戰場分左、中、右三路，每路每方最多 2 隻隨從。隨從只能攻擊同一路的敵人；同一路沒有敵人時才能打英雄。</li>
            <li>花 1 費可以把隨從移到相鄰的路，移動後本回合不能攻擊。</li>
            <li><b>連擊</b>：本回合已打出同元素的牌時觸發。<b>共鳴 X</b>：該元素共鳴值達到 X 時觸發。</li>
            <li><b>衝鋒</b>：上場就能攻擊。<b>疾風</b>：也能攻擊相鄰路線。<b>守護</b>：同一路的敵人要先打它。</li>
          </ul>
        </details>
      </main>`;
  }

  function renderGame() {
    const me = game.current;
    const sel = selection();
    const player = game.players[me];
    const logItems = game.log.slice(-60).reverse().map((l) => `<li class="${l.startsWith('──') ? 'turn' : ''}">${esc(l)}</li>`).join('');

    let overlay = '';
    if (game.phase === 'over') {
      const title = game.winner === 'draw' ? '平手' : `${esc(game.players[game.winner].name)} 獲勝`;
      overlay = `
        <div class="overlay" role="dialog" aria-modal="true" aria-label="對局結束">
          <div class="panel">
            <p class="eyebrow">第 ${game.turn} 回合結束</p>
            <h2>${title}</h2>
            <p>${esc(game.players[0].name)} 剩 ${game.players[0].hp} 血，${esc(game.players[1].name)} 剩 ${game.players[1].hp} 血。</p>
            <div class="panel-actions">
              <button class="btn primary" data-action="again">再來一局</button>
              <button class="btn ghost" data-action="menu">回到選單</button>
            </div>
          </div>
        </div>`;
    } else if (handoff) {
      overlay = `
        <div class="overlay opaque" role="dialog" aria-modal="true" aria-label="換人">
          <div class="panel">
            <p class="eyebrow">第 ${game.turn} 回合</p>
            <h2>輪到 ${esc(player.name)}</h2>
            <p>請把畫面交給 ${esc(player.name)}，另一位玩家先別看手牌。</p>
            <div class="panel-actions"><button class="btn primary" data-action="ready">開始我的回合</button></div>
          </div>
        </div>`;
    }

    app.innerHTML = `
      <div class="game">
        <div class="board">
          ${heroBar(1 - me, sel, false)}
          <section class="field" aria-label="戰場">${[0, 1, 2].map((i) => lane(i, sel)).join('')}</section>
          ${heroBar(me, sel, true)}
          ${game.phase === 'growth' ? growthPanel() : actionBar(sel)}
          <section class="hand" aria-label="手牌">${player.hand.map(handCard).join('') || '<p class="muted">沒有手牌</p>'}</section>
        </div>
        <aside class="log" aria-label="戰鬥紀錄">
          <div class="log-head"><h2>戰鬥紀錄</h2><button class="link" data-action="menu">回到選單</button></div>
          <ol>${logItems}</ol>
        </aside>
      </div>
      ${overlay}`;

    for (const p of game.players) for (const m of p.lanes.flat()) seen.add(m.uid);
  }

  function render() {
    if (game) renderGame();
    else renderSetup();
    if (toastText) {
      const t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      t.textContent = toastText;
      app.appendChild(t);
    }
  }

  function toast(text) {
    toastText = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastText = '';
      const t = app.querySelector('.toast');
      if (t) t.remove();
    }, 2200);
  }

  function dispatch(action) {
    try {
      game = G.applyAction(game, action);
      selected = null;
    } catch (err) {
      toast(err.message);
    }
    render();
  }

  function newGame() {
    seen.clear();
    lastHp.clear();
    selected = null;
    pickingElement = false;
    game = G.createGame({ decks: settings.decks, names: settings.names });
    handoff = !settings.soloTest;
    render();
  }

  // ── 點擊處理 ──
  function onTarget(ref) {
    if (selected.kind === 'hand') dispatch({ type: 'play', uid: selected.uid, target: ref });
    else dispatch({ type: 'attack', uid: selected.uid, target: ref });
  }

  const handlers = {
    start() {
      for (let i = 0; i < 2; i++) {
        settings.names[i] = document.getElementById(`name-${i}`).value.trim() || `玩家 ${i + 1}`;
        settings.decks[i] = document.querySelector(`input[name="deck-${i}"]:checked`).value;
      }
      settings.soloTest = document.getElementById('solo-test').checked;
      newGame();
    },
    hand(el) {
      const uid = Number(el.dataset.uid);
      if (selected && selected.kind === 'hand' && selected.uid === uid) {
        selected = null;
        return render();
      }
      const blocker = G.playBlocker(game, uid);
      if (blocker) {
        toast(blocker);
        return render();
      }
      selected = { kind: 'hand', uid };
      render();
    },
    place(el) {
      dispatch({ type: 'play', uid: selected.uid, lane: Number(el.dataset.lane) });
    },
    move(el) {
      dispatch({ type: 'move', uid: selected.uid, lane: Number(el.dataset.lane) });
    },
    minion(el) {
      const uid = Number(el.dataset.uid);
      const ref = { kind: 'minion', uid };
      const sel = selection();
      if (sel.targets.some((t) => sameRef(t, ref))) return onTarget(ref);
      if (selected && selected.kind === 'minion' && selected.uid === uid) {
        selected = null;
        return render();
      }
      const found = G.findMinion(game, uid);
      if (game.phase !== 'main' || found.owner !== game.current) return;
      const m = found.minion;
      if (G.canAttack(game, uid) || G.moveOptions(game, uid).length) {
        selected = { kind: 'minion', uid };
      } else {
        toast(m.sleeping ? '剛上場的隨從要等下回合才能攻擊' : m.frozen ? '這隻隨從被凍結了' : '這隻隨從本回合已經行動過了');
      }
      render();
    },
    hero(el) {
      const ref = { kind: 'hero', player: Number(el.dataset.player) };
      if (selection().targets.some((t) => sameRef(t, ref))) onTarget(ref);
    },
    growth(el) {
      if (el.dataset.choice === 'resonance') {
        pickingElement = true;
        return render();
      }
      dispatch({ type: 'growth', choice: el.dataset.choice });
    },
    resonate(el) {
      pickingElement = false;
      dispatch({ type: 'growth', choice: 'resonance', element: el.dataset.element });
    },
    'cancel-pick'() {
      pickingElement = false;
      render();
    },
    cancel() {
      selected = null;
      render();
    },
    end() {
      dispatch({ type: 'endTurn' });
      if (game.phase !== 'over' && !settings.soloTest) {
        handoff = true;
        render();
      }
    },
    ready() {
      handoff = false;
      render();
    },
    again: newGame,
    menu() {
      game = null;
      render();
    },
  };

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el && handlers[el.dataset.action]) return handlers[el.dataset.action](el);
    if (!el && selected && !e.target.closest('input, label')) {
      selected = null;
      render();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (selected || pickingElement)) {
      selected = null;
      pickingElement = false;
      render();
    }
  });

  // 預覽環境更新頁面時保留對局（一般瀏覽器中沒有作用）
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ game, settings, handoff }));
  function boot(data) {
    if (data && data.settings) settings = data.settings;
    if (data && data.game) {
      game = data.game;
      handoff = !!data.handoff;
    }
    render();
  }
  if (hot && hot.ready) hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
