// 規則引擎：只處理遊戲邏輯，不碰畫面。
// 畫面、電腦 AI、之後的線上對戰都透過 applyAction() 操作同一份規則。
(function (root) {
  'use strict';

  const Cards = typeof module === 'object' && module.exports ? require('./cards.js') : root.ElementCards;
  const { CARDS, DECKS, ELEMENTS, KEYWORDS, GLOSSARY } = Cards;

  const RULES = {
    startHp: 25,
    maxMana: 8,
    laneCount: 3,
    laneSize: 2,
    handLimit: 8,
    startHand: [3, 3],
    startMana: [0, 1], // 後手補償：起始費用上限 1
    moveCost: 1,
    studyDraw: 1,
    resonanceGain: 2,
    autoManaTurns: 3, // 每位玩家前幾個回合費用上限自動 +1
    growthOnAutoTurns: true, // 自動成長的回合是否還要做成長選擇
    manaDelay: false, // 擴充的新水晶要下回合才能用
    secondPlayerPicks: 1, // 後手第一回合的成長選擇次數
    secondPlayerBonusMana: 0, // 後手第一回合額外多出的暫時費用
    laneControlDamage: 1, // 回合開始時，每條「只有你有隨從」的路線對敵方英雄造成的傷害
    trample: true, // 擊殺隨從後多出來的傷害打到敵方英雄
  };

  const RESONANCE_ELEMENTS = ['fire', 'water', 'wind', 'earth'];
  const GROWTH_CHOICES = ['mana', 'draw', 'resonance'];
  const LANE_NAMES = ['左路', '中路', '右路'];

  // ── 亂數（可指定種子，方便重現對局與測試）──
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(s, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const clone = (s) => JSON.parse(JSON.stringify(s));

  // ── 查詢 ──
  function findMinion(s, uid) {
    for (let p = 0; p < 2; p++) {
      const lanes = s.players[p].lanes;
      for (let lane = 0; lane < lanes.length; lane++) {
        const index = lanes[lane].findIndex((m) => m.uid === uid);
        if (index >= 0) return { minion: lanes[lane][index], owner: p, lane, index };
      }
    }
    return null;
  }

  function hasKeyword(m, kw) {
    return m.keywords.includes(kw) || m.tempKeywords.includes(kw);
  }

  function attackOf(m) {
    return m.atk + m.tempAtk;
  }

  function getCost(player, cardId) {
    const card = CARDS[cardId];
    const mod = card.costMod ? card.costMod(player) : 0;
    return Math.max(0, card.cost + mod);
  }

  function refName(s, ref) {
    if (ref.kind === 'hero') return s.players[ref.player].name;
    const found = findMinion(s, ref.uid);
    return found ? CARDS[found.minion.cardId].name : '?';
  }

  function sameRef(a, b) {
    return a.kind === b.kind && (a.kind === 'hero' ? a.player === b.player : a.uid === b.uid);
  }

  // ── 狀態變化 ──
  function log(s, text) {
    s.log.push(text);
  }

  function drawCards(s, p, n) {
    const player = s.players[p];
    for (let i = 0; i < n; i++) {
      if (player.deck.length === 0) {
        player.fatigue += 1;
        player.hp -= player.fatigue;
        log(s, `${player.name} 的牌庫空了，受到 ${player.fatigue} 點疲勞傷害`);
        continue;
      }
      const card = player.deck.shift();
      if (player.hand.length >= RULES.handLimit) {
        log(s, `${player.name} 手牌已滿，${CARDS[card.cardId].name} 被棄掉`);
      } else {
        player.hand.push(card);
      }
    }
  }

  function damage(s, ref, amount) {
    if (amount <= 0) return;
    if (ref.kind === 'hero') {
      s.players[ref.player].hp -= amount;
    } else {
      const found = findMinion(s, ref.uid);
      if (found) found.minion.hp -= amount;
    }
  }

  function heal(s, ref, amount) {
    if (ref.kind === 'hero') {
      const p = s.players[ref.player];
      p.hp = Math.min(RULES.startHp, p.hp + amount);
    } else {
      const found = findMinion(s, ref.uid);
      if (found) found.minion.hp = Math.min(found.minion.maxHp, found.minion.hp + amount);
    }
  }

  function createMinion(s, cardId) {
    const card = CARDS[cardId];
    return {
      uid: s.nextUid++,
      cardId,
      atk: card.atk,
      hp: card.hp,
      maxHp: card.hp,
      keywords: card.keywords.slice(),
      tempAtk: 0,
      tempKeywords: [],
      sleeping: !card.keywords.includes('charge'),
      attacked: false,
      moved: false,
      moveLocked: false,
      frozen: false,
      frozenAt: 0,
    };
  }

  // 卡牌效果可以使用的工具（見 cards.js）
  function effectApi(s) {
    return {
      ref: (m) => ({ kind: 'minion', uid: m.uid }),
      heroRef: (p) => ({ kind: 'hero', player: p }),
      minionOf: (ref) => (ref.kind === 'minion' ? findMinion(s, ref.uid)?.minion : null),
      locate: (ref) => findMinion(s, ref.uid),
      resonance: (p, el) => s.players[p].resonance[el],
      laneMinions: (p, lane) => s.players[p].lanes[lane].slice(),
      allMinions: (p) => s.players[p].lanes.flat(),
      damage: (ref, n) => damage(s, ref, n),
      heal: (ref, n) => heal(s, ref, n),
      draw: (p, n) => drawCards(s, p, n),
      giveKeyword(m, kw) {
        if (!m || m.keywords.includes(kw)) return;
        m.keywords.push(kw);
        if (kw === 'charge') m.sleeping = false;
      },
      removeKeyword(m, kw) {
        if (!m) return;
        m.keywords = m.keywords.filter((k) => k !== kw);
        m.tempKeywords = m.tempKeywords.filter((k) => k !== kw);
      },
      buff(ref, atk, hp) {
        const found = ref.kind === 'minion' && findMinion(s, ref.uid);
        if (!found) return;
        found.minion.atk += atk;
        found.minion.hp += hp;
        found.minion.maxHp += hp;
      },
      tempBuff(m, atk, kw) {
        m.tempAtk += atk;
        if (kw && !m.tempKeywords.includes(kw)) m.tempKeywords.push(kw);
      },
      freeze(ref) {
        const found = ref.kind === 'minion' && findMinion(s, ref.uid);
        if (!found) return;
        found.minion.frozen = true;
        found.minion.frozenAt = s.turn;
      },
      bounce(ref) {
        const found = ref.kind === 'minion' && findMinion(s, ref.uid);
        if (!found) return;
        const { minion, owner, lane, index } = found;
        s.players[owner].lanes[lane].splice(index, 1);
        const hand = s.players[owner].hand;
        if (hand.length >= RULES.handLimit) {
          log(s, `${CARDS[minion.cardId].name} 被吹走，但手牌已滿而消失`);
        } else {
          hand.push({ uid: s.nextUid++, cardId: minion.cardId });
        }
      },
      setFreeMoves(p) {
        s.players[p].freeMoves = true;
      },
    };
  }

  // 移除死亡隨從、觸發遺言、檢查勝負
  function resolveDeaths(s) {
    for (;;) {
      const dead = [];
      for (let p = 0; p < 2; p++) {
        const lanes = s.players[p].lanes;
        for (let lane = 0; lane < lanes.length; lane++) {
          lanes[lane] = lanes[lane].filter((m) => {
            if (m.hp > 0) return true;
            dead.push({ minion: m, owner: p, lane });
            return false;
          });
        }
      }
      if (dead.length === 0) break;
      const g = effectApi(s);
      for (const d of dead) {
        const card = CARDS[d.minion.cardId];
        log(s, `${card.name} 陣亡`);
        if (card.deathrattle) card.deathrattle(g, { player: d.owner, lane: d.lane, minion: d.minion });
      }
    }
    const dead = s.players.map((p) => p.hp <= 0);
    if (dead[0] || dead[1]) {
      s.phase = 'over';
      s.winner = dead[0] && dead[1] ? 'draw' : dead[0] ? 1 : 0;
      log(s, s.winner === 'draw' ? '雙方同歸於盡，平手！' : `${s.players[s.winner].name} 獲勝！`);
    }
  }

  function startTurn(s) {
    const p = s.players[s.current];
    const ownTurn = Math.ceil(s.turn / 2);
    const autoTurn = ownTurn <= RULES.autoManaTurns;
    if (autoTurn) p.maxMana = Math.min(RULES.maxMana, p.maxMana + 1);
    p.mana = p.maxMana + (s.turn === 2 ? RULES.secondPlayerBonusMana : 0);
    p.freeMoves = false;
    for (const m of p.lanes.flat()) {
      m.sleeping = false;
      m.attacked = false;
      m.moved = false;
      m.moveLocked = false;
    }
    s.playedElements = [];
    log(s, `── 第 ${s.turn} 回合：${p.name} ──`);
    if (RULES.laneControlDamage) {
      const enemy = s.players[1 - s.current];
      const held = p.lanes.filter((l, i) => l.length > 0 && enemy.lanes[i].length === 0).length;
      if (held) {
        enemy.hp -= held * RULES.laneControlDamage;
        log(s, `${p.name} 控制 ${held} 條路線，對 ${enemy.name} 造成 ${held * RULES.laneControlDamage} 點傷害`);
      }
    }
    drawCards(s, s.current, 1);
    s.phase = autoTurn && !RULES.growthOnAutoTurns ? 'main' : 'growth';
    // 後手第一回合可以做兩次不同的成長選擇
    s.growth = { picksLeft: s.turn === 2 ? RULES.secondPlayerPicks : 1, picked: [] };
    if (s.growth.picksLeft === 0) s.phase = 'main';
    resolveDeaths(s);
  }

  // ── 建立新對局 ──
  function createGame(opts = {}) {
    const deckIds = opts.decks || ['gale', 'deeprock'];
    const names = opts.names || ['玩家 1', '玩家 2'];
    const s = {
      rng: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
      nextUid: 1,
      turn: 1,
      current: 0,
      phase: 'growth',
      winner: null,
      growth: { picksLeft: 1, picked: [] },
      playedElements: [],
      log: [],
      players: [],
    };
    for (let i = 0; i < 2; i++) {
      const deck = DECKS[deckIds[i]];
      if (!deck) throw new Error(`找不到牌組：${deckIds[i]}`);
      s.players.push({
        name: names[i],
        deckId: deckIds[i],
        hp: RULES.startHp,
        maxMana: RULES.startMana[i],
        mana: 0,
        deck: shuffle(s, deck.cards.map((cardId) => ({ uid: s.nextUid++, cardId }))),
        hand: [],
        lanes: Array.from({ length: RULES.laneCount }, () => []),
        resonance: { fire: 0, water: 0, wind: 0, earth: 0 },
        fatigue: 0,
        freeMoves: false,
      });
    }
    log(s, `對局開始：${names[0]}（${DECKS[deckIds[0]].name}）vs ${names[1]}（${DECKS[deckIds[1]].name}）`);
    drawCards(s, 0, RULES.startHand[0]);
    drawCards(s, 1, RULES.startHand[1]);
    startTurn(s);
    return s;
  }

  // ── 合法行動查詢（畫面與 AI 用）──
  function growthOptions(s) {
    if (s.phase !== 'growth') return [];
    const p = s.players[s.current];
    return GROWTH_CHOICES.filter((c) => !s.growth.picked.includes(c) && !(c === 'mana' && p.maxMana >= RULES.maxMana));
  }

  function openLanes(s, p = s.current) {
    const lanes = [];
    s.players[p].lanes.forEach((l, i) => {
      if (l.length < RULES.laneSize) lanes.push(i);
    });
    return lanes;
  }

  function playTargets(s, cardId, p = s.current) {
    const kind = CARDS[cardId].target;
    if (!kind) return [];
    const minionRefs = (owner) => s.players[owner].lanes.flat().map((m) => ({ kind: 'minion', uid: m.uid }));
    switch (kind) {
      case 'any':
        return [...minionRefs(0), ...minionRefs(1), { kind: 'hero', player: 0 }, { kind: 'hero', player: 1 }];
      case 'anyMinion':
        return [...minionRefs(0), ...minionRefs(1)];
      case 'enemyMinion':
        return minionRefs(1 - p);
      case 'friendlyMinion':
        return minionRefs(p);
      default:
        return [];
    }
  }

  // 回傳不能打出的原因；可以打出則回傳 null
  function playBlocker(s, uid) {
    if (s.phase !== 'main') return s.phase === 'growth' ? '請先完成成長選擇' : '對局已結束';
    const p = s.players[s.current];
    const card = p.hand.find((c) => c.uid === uid);
    if (!card) return '這張牌不在你的手牌中';
    const def = CARDS[card.cardId];
    if (getCost(p, card.cardId) > p.mana) return '費用不足';
    if (def.type === 'minion' && openLanes(s).length === 0) return '戰場已滿';
    if (def.type === 'spell' && def.target && playTargets(s, card.cardId).length === 0) return '沒有可選的目標';
    return null;
  }

  function canAttack(s, uid) {
    if (s.phase !== 'main') return false;
    const found = findMinion(s, uid);
    if (!found || found.owner !== s.current) return false;
    const m = found.minion;
    return !m.sleeping && !m.attacked && !m.frozen && !m.moveLocked && attackOf(m) > 0;
  }

  function attackTargets(s, uid) {
    if (!canAttack(s, uid)) return [];
    const { minion, lane } = findMinion(s, uid);
    const enemy = s.players[1 - s.current];
    const reach = [lane];
    if (hasKeyword(minion, 'swift')) reach.push(lane - 1, lane + 1);
    const targets = [];
    let blocked = false;
    for (const l of reach) {
      if (l < 0 || l >= RULES.laneCount) continue;
      const ms = enemy.lanes[l];
      if (ms.length) blocked = true;
      const guards = ms.filter((m) => hasKeyword(m, 'guard'));
      for (const m of guards.length ? guards : ms) targets.push({ kind: 'minion', uid: m.uid });
    }
    if (!blocked) targets.push({ kind: 'hero', player: 1 - s.current });
    return targets;
  }

  function moveCost(s) {
    return s.players[s.current].freeMoves ? 0 : RULES.moveCost;
  }

  // 回傳可以移動到的路線
  function moveOptions(s, uid) {
    if (s.phase !== 'main') return [];
    const found = findMinion(s, uid);
    if (!found || found.owner !== s.current || found.minion.moved) return [];
    if (s.players[s.current].mana < moveCost(s)) return [];
    return [found.lane - 1, found.lane + 1].filter(
      (l) => l >= 0 && l < RULES.laneCount && s.players[s.current].lanes[l].length < RULES.laneSize,
    );
  }

  // ── 執行行動 ──
  // action 形式：
  //   { type: 'growth', choice: 'mana' | 'draw' | 'resonance', element? }
  //   { type: 'play', uid, lane?, target? }
  //   { type: 'attack', uid, target }
  //   { type: 'move', uid, lane }
  //   { type: 'endTurn' }
  // 回傳新的狀態（不修改原本的），不合法時丟出錯誤。
  function applyAction(state, action) {
    const s = clone(state);
    if (s.phase === 'over') throw new Error('對局已結束');
    const me = s.current;
    const p = s.players[me];

    switch (action.type) {
      case 'growth': {
        if (s.phase !== 'growth') throw new Error('現在不是成長階段');
        if (!growthOptions(s).includes(action.choice)) throw new Error('不能選這個成長選項');
        if (action.choice === 'mana') {
          p.maxMana += 1;
          if (!RULES.manaDelay) p.mana += 1;
          log(s, `${p.name} 選擇擴充：費用上限變為 ${p.maxMana}`);
        } else if (action.choice === 'draw') {
          log(s, `${p.name} 選擇研讀：多抽 ${RULES.studyDraw} 張牌`);
          drawCards(s, me, RULES.studyDraw);
        } else {
          if (!RESONANCE_ELEMENTS.includes(action.element)) throw new Error('請選擇要共鳴的元素');
          p.resonance[action.element] += RULES.resonanceGain;
          log(s, `${p.name} 選擇共鳴：${ELEMENTS[action.element].name}共鳴 ${p.resonance[action.element]}`);
        }
        s.growth.picked.push(action.choice);
        s.growth.picksLeft -= 1;
        if (s.growth.picksLeft === 0) s.phase = 'main';
        break;
      }

      case 'play': {
        const blocker = playBlocker(s, action.uid);
        if (blocker) throw new Error(blocker);
        const handIndex = p.hand.findIndex((c) => c.uid === action.uid);
        const cardId = p.hand[handIndex].cardId;
        const def = CARDS[cardId];
        if (def.type === 'minion' && !openLanes(s).includes(action.lane)) throw new Error('請選擇有空位的路線');
        if (def.target) {
          if (!action.target) throw new Error('請選擇目標');
          if (!playTargets(s, cardId).some((t) => sameRef(t, action.target))) throw new Error('不能選擇這個目標');
        }
        p.hand.splice(handIndex, 1);
        p.mana -= getCost(p, cardId);
        const combo = def.element !== 'neutral' && s.playedElements.includes(def.element);
        s.playedElements.push(def.element);
        const ctx = { player: me, lane: action.lane, target: action.target || null, combo };
        if (def.type === 'minion') {
          ctx.minion = createMinion(s, cardId);
          p.lanes[action.lane].push(ctx.minion);
          log(s, `${p.name} 在${LANE_NAMES[action.lane]}召喚 ${def.name}${combo ? '（連擊）' : ''}`);
        } else {
          const on = ctx.target ? `，目標：${refName(s, ctx.target)}` : '';
          log(s, `${p.name} 施放 ${def.name}${on}${combo ? '（連擊）' : ''}`);
        }
        if (def.onPlay) def.onPlay(effectApi(s), ctx);
        break;
      }

      case 'attack': {
        if (!canAttack(s, action.uid)) throw new Error('這隻隨從現在不能攻擊');
        if (!attackTargets(s, action.uid).some((t) => sameRef(t, action.target))) throw new Error('不能攻擊這個目標');
        const attacker = findMinion(s, action.uid).minion;
        attacker.attacked = true;
        log(s, `${CARDS[attacker.cardId].name} 攻擊 ${refName(s, action.target)}`);
        if (action.target.kind === 'hero') {
          damage(s, action.target, attackOf(attacker));
        } else {
          const defender = findMinion(s, action.target.uid).minion;
          const back = attackOf(defender);
          const def = CARDS[attacker.cardId];
          // 卡牌可以有攻擊加成（例如對守護隨從）和穿透倍率
          const bonus = def.attackBonus ? def.attackBonus({ guard: hasKeyword(defender, 'guard') }) : 0;
          const hit = attackOf(attacker) + bonus;
          const excess = (hit - Math.max(0, defender.hp)) * (def.trampleMultiplier || 1);
          damage(s, action.target, hit);
          attacker.hp -= back;
          if (RULES.trample && excess > 0) {
            damage(s, { kind: 'hero', player: 1 - me }, excess);
            log(s, `穿透：${excess} 點傷害打到 ${s.players[1 - me].name}`);
          }
        }
        break;
      }

      case 'move': {
        if (!moveOptions(s, action.uid).includes(action.lane)) throw new Error('不能移動到那裡');
        const { minion, lane, index } = findMinion(s, action.uid);
        p.lanes[lane].splice(index, 1);
        p.lanes[action.lane].push(minion);
        p.mana -= moveCost(s);
        minion.moved = true;
        if (!p.freeMoves) minion.moveLocked = true;
        log(s, `${CARDS[minion.cardId].name} 移動到${LANE_NAMES[action.lane]}`);
        break;
      }

      case 'endTurn': {
        if (s.phase !== 'main') throw new Error('請先完成成長選擇');
        for (const m of p.lanes.flat()) {
          m.tempAtk = 0;
          m.tempKeywords = [];
          if (m.frozen && m.frozenAt < s.turn) m.frozen = false;
        }
        s.current = 1 - me;
        s.turn += 1;
        startTurn(s);
        return s;
      }

      default:
        throw new Error(`未知的行動：${action.type}`);
    }

    resolveDeaths(s);
    return s;
  }

  const api = {
    RULES, LANE_NAMES, RESONANCE_ELEMENTS, CARDS, DECKS, ELEMENTS, KEYWORDS, GLOSSARY,
    createGame, applyAction,
    getCost, findMinion, hasKeyword, attackOf,
    growthOptions, openLanes, playTargets, playBlocker, canAttack, attackTargets, moveOptions, moveCost,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ElementGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
