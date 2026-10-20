// 畫面：把遊戲狀態畫出來，並把點擊轉成 applyAction() 的行動。
(function () {
  'use strict';

  const G = window.ElementGame;
  const AI = window.ElementAI;
  const T = window.ElementTutorial;
  const M = window.ElementMotion;
  if (!M.reduceMotion.matches) {
    document.documentElement.style.setProperty('--spring', M.SPRING.easing);
    document.documentElement.style.setProperty('--spring-dur', `${M.SPRING.duration}ms`);
  }
  const { CARDS, DECKS, ELEMENTS, KEYWORDS, LANE_NAMES, RULES } = G;
  const app = document.getElementById('app');

  const MODES = {
    tutorial: { name: '新手教學', desc: '第一次玩從這裡開始，大約 3 分鐘' },
    ai: { name: '對戰電腦', desc: '一個人練習，電腦當對手' },
    hotseat: { name: '雙人同機', desc: '和朋友用同一台電腦輪流玩' },
  };

  let settings = { mode: 'tutorial', decks: ['gale', 'deeprock'], names: ['玩家 1', '玩家 2'], soloTest: false };
  let game = null;
  let mode = null; // 目前這局的模式
  let tutorial = null; // { step, scriptIndex }
  let selected = null; // { kind: 'hand' | 'minion', uid }
  let handoff = false;
  let pickingElement = false;
  let aiTimer = null;
  let toastText = '';
  let toastId = 0;
  let toastTimer = null;
  let hitSeq = 0;
  const lastHp = new Map();

  const esc = (str) => String(str).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const sameRef = (a, b) => a.kind === b.kind && (a.kind === 'hero' ? a.player === b.player : a.uid === b.uid);
  const refKey = (ref) => (!ref ? null : ref.kind === 'hero' ? `p${ref.player}` : `m${ref.uid}`);

  // 畫面下方是誰：雙人同機時跟著目前玩家，其他模式固定是玩家 1
  const viewer = () => (mode === 'hotseat' ? game.current : 0);
  const humanTurn = () => game.phase !== 'over' && game.current === viewer();
  const tutorialStep = () => (tutorial ? T.STEPS[tutorial.step] : null);

  // ── 選取狀態推導出的提示 ──
  function selection() {
    const info = { targets: [], lanes: [], moves: [], hint: '' };
    if (!game || game.phase !== 'main' || !selected || !humanTurn()) return info;
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
  function hitMark(key, hp) {
    const prev = lastHp.get(key);
    lastHp.set(key, hp);
    return prev !== undefined && hp < prev
      ? `<span class="dmg" data-key="dmg${++hitSeq}" aria-hidden="true">-${prev - hp}</span>` : '';
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
      <div class="hero-bar ${isMe ? 'me' : 'opp'} ${game.current === p && game.phase !== 'over' ? 'active' : ''}" data-key="hero${p}">
        <button class="portrait ${targetable ? 'targetable' : ''}" data-action="hero" data-player="${p}" data-key="p${p}"
          ${targetable ? '' : 'tabindex="-1"'} aria-label="${esc(player.name)}，生命 ${player.hp}">
          <span class="hp-num">${Math.max(0, player.hp)}</span>${hitMark(`h${p}`, player.hp)}
        </button>
        <div class="hero-info">
          <div class="hero-name">${esc(player.name)} <span class="deck-name">${DECKS[player.deckId].name}</span></div>
          <div class="mana" title="費用 ${player.mana} / ${player.maxMana}">${gems.join('')}
            <span class="mana-num">${player.mana}/${player.maxMana}</span></div>
          <div class="resonance">${res || '<span class="muted">尚無共鳴</span>'}</div>
        </div>
        <div class="piles" data-key="pile${p}">
          <span><b>${player.hand.length}</b> 手牌</span>
          <span><b>${player.deck.length}</b> 牌庫</span>
        </div>
      </div>`;
  }

  function minionTile(m, owner, sel) {
    const def = CARDS[m.cardId];
    const ref = { kind: 'minion', uid: m.uid };
    const mine = owner === game.current && humanTurn();
    const classes = ['minion', `el-${def.element}`];
    if (sel.targets.some((t) => sameRef(t, ref))) classes.push('targetable');
    if (selected && selected.kind === 'minion' && selected.uid === m.uid) classes.push('selected');
    if (mine && game.phase === 'main' && (G.canAttack(game, m.uid) || G.moveOptions(game, m.uid).length)) {
      classes.push('can-act');
    }
    if (m.frozen) classes.push('frozen');
    if (owner === game.current && m.sleeping) classes.push('sleeping');
    const tags = [...new Set([...m.keywords, ...m.tempKeywords])].map((k) => KEYWORDS[k]);
    if (m.frozen) tags.push('凍結');
    const atk = G.attackOf(m);
    return `
      <button class="${classes.join(' ')}" data-action="minion" data-uid="${m.uid}" data-key="m${m.uid}" data-card="${m.cardId}" data-owner="${owner}"
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
    const me = viewer();
    const opp = 1 - me;
    const enemy = game.players[opp].lanes[i].map((m) => minionTile(m, opp, sel)).join('');
    const mine = game.players[me].lanes[i].map((m) => minionTile(m, me, sel)).join('');
    const place = sel.lanes.includes(i)
      ? `<button class="slot place" data-action="place" data-lane="${i}" data-key="place${i}">放在這裡</button>` : '';
    const move = sel.moves.includes(i)
      ? `<button class="slot place" data-action="move" data-lane="${i}" data-key="move${i}">移到這裡（${G.moveCost(game)} 費）</button>` : '';
    return `
      <div class="lane" data-key="lane${i}">
        <div class="lane-half enemy">${enemy}</div>
        <div class="lane-label">${LANE_NAMES[i]}</div>
        <div class="lane-half mine">${mine}${place}${move}</div>
      </div>`;
  }

  function cardFace(cardId, cost, attrs = '', extra = '') {
    const def = CARDS[cardId];
    return `
      <button class="card el-${def.element} ${extra}" ${attrs}>
        <span class="cost ${cost < def.cost ? 'reduced' : ''}"><span>${cost}</span></span>
        <span class="c-name">${def.name}</span>
        <span class="c-type">${ELEMENTS[def.element].name} · ${def.type === 'minion' ? '隨從' : '法術'}</span>
        <span class="c-text">${esc(def.text)}</span>
        ${def.type === 'minion' ? `<span class="stats"><span class="atk">${def.atk}</span><span class="hp">${def.hp}</span></span>` : ''}
      </button>`;
  }

  function handCard(c) {
    const player = game.players[viewer()];
    const playable = humanTurn() && game.phase === 'main' && !G.playBlocker(game, c.uid);
    const isSel = selected && selected.kind === 'hand' && selected.uid === c.uid;
    return cardFace(c.cardId, G.getCost(player, c.cardId),
      `data-action="hand" data-uid="${c.uid}" data-key="c${c.uid}" data-card="${c.cardId}"`,
      `${playable ? 'playable' : ''} ${isSel ? 'selected' : ''}`);
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
          ${btn('draw', '研讀', `多抽 ${RULES.studyDraw} 張牌`)}
          ${btn('resonance', '共鳴', `選一個元素，共鳴值 +${RULES.resonanceGain}`)}
        </div>
        ${picker}
      </section>`;
  }

  function actionBar(sel) {
    if (!humanTurn()) {
      return `<div class="action-bar"><span class="hint thinking">${esc(game.players[game.current].name)} 行動中…</span></div>`;
    }
    const hint = sel.hint || '點手牌出牌，點自己的隨從攻擊或移動';
    return `
      <div class="action-bar">
        <span class="hint">${esc(hint)}</span>
        ${selected ? '<button class="btn ghost" data-action="cancel">取消</button>' : ''}
        <button class="btn primary" data-action="end">結束回合</button>
      </div>`;
  }

  function tutorPanel() {
    if (!tutorial) return '';
    const total = T.STEPS.length;
    if (tutorial.step >= total) {
      return `
        <section class="tutor done" aria-live="polite">
          <span class="tutor-step">教學完成</span>
          <p>你已經學會所有基本規則了！可以把這局打完，或開始一場正式的對戰。</p>
          <div class="tutor-actions">
            <button class="btn primary" data-action="tut-continue">繼續打完這局</button>
            <button class="btn ghost" data-action="tut-ai">對戰電腦（新的一局）</button>
          </div>
        </section>`;
    }
    const step = tutorialStep();
    const waiting = !humanTurn();
    return `
      <section class="tutor" aria-live="polite">
        <span class="tutor-step">教學 ${tutorial.step + 1} / ${total}</span>
        <p>${waiting ? '教官正在行動，看看他做了什麼…' : esc(step.text)}</p>
        ${!step.expect && !waiting ? '<div class="tutor-actions"><button class="btn primary" data-action="tut-next">下一步</button></div>' : ''}
      </section>`;
  }

  // ── 畫面 ──
  function setupHtml() {
    const m = settings.mode;
    const seat = (i) => {
      const isAi = m === 'ai' && i === 1;
      return `
      <fieldset class="seat">
        <legend>${isAi ? '電腦（後手）' : m === 'ai' ? '你（先手）' : i === 0 ? '先手' : '後手'}</legend>
        ${isAi ? '' : `<label class="field-label" for="name-${i}">名字</label>
        <input id="name-${i}" type="text" maxlength="12" value="${esc(settings.names[i])}">`}
        <div class="deck-opts" role="radiogroup" aria-label="選擇牌組">
          ${Object.entries(DECKS).map(([id, d]) => `
            <label class="deck-opt">
              <input type="radio" name="deck-${i}" id="deck-${i}-${id}" value="${id}" ${settings.decks[i] === id ? 'checked' : ''}>
              <span><b>${d.name}</b><small>${d.desc}</small></span>
            </label>`).join('')}
        </div>
      </fieldset>`;
    };
    return `
      <main class="setup" data-key="setup">
        <h1 class="logo">元素戰線</h1>
        <p class="tagline">每回合三選一：擴充費用、多抽一張、或累積元素共鳴。把隨從排進三條戰線，先打倒對方英雄的人獲勝。</p>
        <div class="modes" role="radiogroup" aria-label="遊戲模式">
          ${Object.entries(MODES).map(([id, info]) => `
            <label class="mode-opt">
              <input type="radio" name="mode" id="mode-${id}" value="${id}" ${m === id ? 'checked' : ''}>
              <span><b>${info.name}</b><small>${info.desc}</small></span>
            </label>`).join('')}
        </div>
        ${m === 'tutorial' ? '' : `<div class="seats">${seat(0)}${seat(1)}</div>`}
        ${m === 'hotseat' ? `<label class="check"><input type="checkbox" id="solo-test" ${settings.soloTest ? 'checked' : ''}>
          一個人測試（跳過換人畫面）</label>` : ''}
        <button class="btn primary big" data-action="start">${m === 'tutorial' ? '開始教學' : '開始對戰'}</button>
        <details class="rules">
          <summary>規則速覽</summary>
          <ul>
            <li>英雄 ${RULES.startHp} 血，牌組 20 張，費用最多 ${RULES.maxMana} 點。先手起手 3 張；後手起手 4 張、起始費用 1，第一回合可以做兩次成長選擇。</li>
            <li>每回合開始抽 1 張，然後做一次<b>成長選擇</b>：擴充（費用上限 +1）、研讀（多抽 1 張）或共鳴（某元素 +1）。費用不會自動成長。</li>
            <li>戰場分左、中、右三路，每路每方最多 2 隻隨從。隨從只能攻擊同一路的敵人；同一路沒有敵人時才能打英雄。</li>
            <li>花 1 費可以把隨從移到相鄰的路，移動後本回合不能攻擊。</li>
            <li><b>連擊</b>：本回合已打出同元素的牌時觸發。<b>共鳴 X</b>：該元素共鳴值達到 X 時觸發。</li>
            <li><b>衝鋒</b>：上場就能攻擊。<b>疾風</b>：也能攻擊相鄰路線。<b>守護</b>：同一路的敵人要先打它。</li>
          </ul>
        </details>
      </main>`;
  }

  function overlayHtml() {
    const player = game.players[game.current];
    if (game.phase === 'over') {
      let title;
      if (game.winner === 'draw') title = '平手';
      else if (mode === 'hotseat') title = `${esc(game.players[game.winner].name)} 獲勝`;
      else title = game.winner === 0 ? '你贏了！' : `${esc(game.players[1].name)} 獲勝`;
      return `
        <div class="overlay" role="dialog" aria-modal="true" aria-label="對局結束">
          <div class="panel">
            <p class="eyebrow">第 ${game.turn} 回合結束</p>
            <h2>${title}</h2>
            <p>${esc(game.players[0].name)} 剩 ${Math.max(0, game.players[0].hp)} 血，${esc(game.players[1].name)} 剩 ${Math.max(0, game.players[1].hp)} 血。</p>
            <div class="panel-actions">
              <button class="btn primary" data-action="again">再來一局</button>
              <button class="btn ghost" data-action="menu">回到選單</button>
            </div>
          </div>
        </div>`;
    }
    if (handoff) {
      return `
        <div class="overlay opaque" role="dialog" aria-modal="true" aria-label="換人">
          <div class="panel">
            <p class="eyebrow">第 ${game.turn} 回合</p>
            <h2>輪到 ${esc(player.name)}</h2>
            <p>請把畫面交給 ${esc(player.name)}，另一位玩家先別看手牌。</p>
            <div class="panel-actions"><button class="btn primary" data-action="ready">開始我的回合</button></div>
          </div>
        </div>`;
    }
    return '';
  }

  function turnBanner() {
    if (game.phase === 'over' || (mode === 'hotseat' && !settings.soloTest)) return '';
    const name = game.players[game.current].name;
    const text = mode !== 'hotseat' && humanTurn() ? '你的回合' : `${esc(name)}的回合`;
    return `<div class="turn-banner ${humanTurn() ? 'mine' : ''}" data-key="banner${game.turn}" role="status">${text}</div>`;
  }

  function gameHtml() {
    const me = viewer();
    const sel = selection();
    const logItems = game.log.slice(-60).reverse().map((l) => `<li class="${l.startsWith('──') ? 'turn' : ''}">${esc(l)}</li>`).join('');
    const showGrowth = game.phase === 'growth' && humanTurn();
    return `
      <div class="game" data-key="game">
        <div class="board">
          ${heroBar(1 - me, sel, false)}
          <section class="field" aria-label="戰場">${[0, 1, 2].map((i) => lane(i, sel)).join('')}</section>
          ${heroBar(me, sel, true)}
          <div class="dock">
            ${tutorPanel()}
            ${showGrowth ? growthPanel() : actionBar(sel)}
            <section class="hand" aria-label="手牌">${game.players[me].hand.map(handCard).join('') || '<p class="muted">沒有手牌</p>'}</section>
          </div>
        </div>
        <aside class="log" aria-label="戰鬥紀錄">
          <div class="log-head"><h2>戰鬥紀錄</h2><button class="link" data-action="menu">回到選單</button></div>
          <ol>${logItems}</ol>
        </aside>
      </div>
      ${turnBanner()}
      ${overlayHtml()}`;
  }

  // fx：這次行動要播放的動畫資訊（見 actionFx）
  function render(fx = {}) {
    const before = M.capture(app);
    let html = game ? gameHtml() : setupHtml();
    if (toastText) html += `<div class="toast" role="status" data-key="toast${toastId}">${esc(toastText)}</div>`;
    M.morph(app, html);
    const step = tutorialStep();
    if (game && step && humanTurn()) {
      for (const sel of step.focus || []) app.querySelectorAll(sel).forEach((el) => el.classList.add('tut-focus'));
    }
    if (game) M.animate(app, before, Object.assign({ deckKey: `pile${viewer()}` }, fx));
  }

  function toast(text) {
    toastText = text;
    toastId += 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastText = '';
      render();
    }, 2200);
  }

  // 出牌從哪裡飛出來、攻擊誰，給動畫用
  function actionFx(action) {
    const fx = {};
    const p = game.current;
    if (action.type === 'play') {
      const card = game.players[p].hand.find((c) => c.uid === action.uid);
      const fromKey = p === viewer() ? `c${action.uid}` : `pile${p}`;
      if (card && CARDS[card.cardId].type === 'spell') {
        const holder = document.createElement('div');
        holder.innerHTML = cardFace(card.cardId, G.getCost(game.players[p], card.cardId));
        fx.spell = { card: holder.firstElementChild, fromKey, targetKey: refKey(action.target), reveal: p !== viewer() };
      } else {
        fx.sourceKey = fromKey;
      }
    } else if (action.type === 'attack') {
      fx.attack = { key: `m${action.uid}`, targetKey: refKey(action.target) };
    }
    return fx;
  }

  // ── 電腦 / 教學對手的回合 ──
  function runOpponent() {
    clearTimeout(aiTimer);
    if (!game || game.phase === 'over' || mode === 'hotseat' || game.current === 0) return;
    aiTimer = setTimeout(() => {
      let action = tutorial ? T.opponentAction(game, tutorial.scriptIndex++) : null;
      if (!action) action = AI.nextAction(game);
      let fx = {};
      try {
        fx = actionFx(action);
        game = G.applyAction(game, action);
      } catch (err) {
        fx = {};
        game = G.applyAction(game, { type: 'endTurn' });
      }
      render(fx);
      runOpponent();
    }, game.phase === 'growth' ? 500 : 850);
  }

  function dispatch(action) {
    const step = tutorialStep();
    if (step && !step.expect) {
      toast('先看完教學說明，再按「下一步」');
      return render();
    }
    if (step && !step.expect(action, game)) {
      toast('先照著上方的教學提示操作喔');
      selected = null;
      return render();
    }
    let fx = {};
    try {
      fx = actionFx(action);
      game = G.applyAction(game, action);
      selected = null;
      if (step) tutorial.step += 1;
      if (tutorial && action.type === 'endTurn') tutorial.scriptIndex = 0;
    } catch (err) {
      toast(err.message);
    }
    render(fx);
    runOpponent();
  }

  function readSetup() {
    for (let i = 0; i < 2; i++) {
      const name = document.getElementById(`name-${i}`);
      if (name) settings.names[i] = name.value.trim() || `玩家 ${i + 1}`;
      const deck = document.querySelector(`input[name="deck-${i}"]:checked`);
      if (deck) settings.decks[i] = deck.value;
    }
    const solo = document.getElementById('solo-test');
    if (solo) settings.soloTest = solo.checked;
  }

  function startMode(m) {
    clearTimeout(aiTimer);
    lastHp.clear();
    selected = null;
    pickingElement = false;
    mode = m;
    tutorial = null;
    handoff = false;
    if (m === 'tutorial') {
      game = T.createTutorialGame();
      tutorial = { step: 0, scriptIndex: 0 };
    } else {
      const names = m === 'ai' ? [settings.names[0], '電腦'] : settings.names.slice();
      game = G.createGame({ decks: settings.decks, names });
      handoff = m === 'hotseat' && !settings.soloTest;
    }
    render();
    runOpponent();
  }

  // ── 點擊處理 ──
  function onTarget(ref) {
    if (selected.kind === 'hand') dispatch({ type: 'play', uid: selected.uid, target: ref });
    else dispatch({ type: 'attack', uid: selected.uid, target: ref });
  }

  // 只有輪到真人玩家時才能操作的動作
  const PLAYER_ACTIONS = new Set(['hand', 'place', 'move', 'minion', 'hero', 'growth', 'resonate', 'end']);

  const handlers = {
    start() {
      readSetup();
      startMode(settings.mode);
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
      if (selection().targets.some((t) => sameRef(t, ref))) return onTarget(ref);
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
      if (mode === 'hotseat' && game.phase !== 'over' && !settings.soloTest) {
        handoff = true;
        render();
      }
    },
    ready() {
      handoff = false;
      render();
    },
    'tut-next'() {
      tutorial.step += 1;
      render();
    },
    'tut-continue'() {
      tutorial = null;
      mode = 'ai';
      render();
      runOpponent();
    },
    'tut-ai'() {
      settings.mode = 'ai';
      startMode('ai');
    },
    again() {
      startMode(mode);
    },
    menu() {
      clearTimeout(aiTimer);
      game = null;
      tutorial = null;
      render();
    },
  };

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el && handlers[el.dataset.action]) {
      if (PLAYER_ACTIONS.has(el.dataset.action) && !humanTurn()) return;
      return handlers[el.dataset.action](el);
    }
    if (!el && selected && !e.target.closest('input, label')) {
      selected = null;
      render();
    }
  });

  app.addEventListener('change', (e) => {
    if (e.target.name !== 'mode') return;
    readSetup();
    settings.mode = e.target.value;
    render();
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
  if (hot && hot.snapshot) hot.snapshot(() => ({ game, mode, tutorial, settings, handoff }));
  function boot(data) {
    if (data && data.settings) settings = Object.assign(settings, data.settings);
    if (data && data.game) {
      game = data.game;
      mode = data.mode || 'hotseat';
      tutorial = data.tutorial || null;
      handoff = !!data.handoff;
    }
    render();
    if (game) runOpponent();
  }
  if (hot && hot.ready) hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
