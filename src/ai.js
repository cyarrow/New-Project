// 電腦玩家：每一步都試算所有合法行動，選讓局面分數最高的那一個。
// 單人模式、新手教學的對手、平衡模擬都用這份程式。
(function (root) {
  'use strict';

  const G = typeof module === 'object' && module.exports ? require('./game.js') : root.ElementGame;
  const { CARDS } = G;

  function minionValue(m) {
    let v = m.atk * 1.2 + m.hp;
    if (m.keywords.includes('guard')) v += 1;
    if (m.keywords.includes('swift')) v += 1;
    if (CARDS[m.cardId].deathrattle) v += 1;
    return v;
  }

  // 從 me 的角度評估局面，分數越高越好
  function evaluate(s, me) {
    if (s.phase === 'over') return s.winner === me ? 1e6 : s.winner === 'draw' ? 0 : -1e6;
    const mine = s.players[me];
    const theirs = s.players[1 - me];
    let v = mine.hp - theirs.hp;
    // 血量低的時候每一滴血更重要
    v += (Math.min(mine.hp, 10) - Math.min(theirs.hp, 10)) * 0.5;
    for (let lane = 0; lane < mine.lanes.length; lane++) {
      const a = mine.lanes[lane];
      const b = theirs.lanes[lane];
      for (const m of a) v += minionValue(m);
      for (const m of b) v -= minionValue(m);
      // 沒人擋的路線代表下回合可以打臉
      if (b.length === 0) for (const m of a) v += m.atk * 0.6;
      if (a.length === 0) for (const m of b) v -= m.atk * 0.6;
    }
    v += (mine.hand.length - theirs.hand.length) * 0.8;
    return v;
  }

  function candidateActions(s) {
    const actions = [];
    const p = s.players[s.current];
    for (const c of p.hand) {
      if (G.playBlocker(s, c.uid)) continue;
      if (CARDS[c.cardId].type === 'minion') {
        for (const lane of G.openLanes(s)) actions.push({ type: 'play', uid: c.uid, lane });
      } else {
        for (const target of G.playTargets(s, c.cardId)) actions.push({ type: 'play', uid: c.uid, target });
      }
    }
    for (const m of p.lanes.flat()) {
      for (const target of G.attackTargets(s, m.uid)) actions.push({ type: 'attack', uid: m.uid, target });
      for (const lane of G.moveOptions(s, m.uid)) actions.push({ type: 'move', uid: m.uid, lane });
    }
    return actions;
  }

  // 手牌裡還沒滿足共鳴需求的元素
  function wantedResonance(p) {
    for (const c of p.hand) {
      const need = CARDS[c.cardId].resonance;
      if (!need) continue;
      for (const [el, n] of Object.entries(need)) if (p.resonance[el] < n) return el;
    }
    return null;
  }

  // 牌組裡最多的元素（共鳴時的預設選擇）
  function mainElement(p) {
    const count = {};
    for (const c of [...p.hand, ...p.deck]) {
      const el = CARDS[c.cardId].element;
      if (el !== 'neutral') count[el] = (count[el] || 0) + 1;
    }
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || 'fire';
  }

  // 成長策略：
  //   smart  看手牌決定（預設）
  //   mana   有得選就擴充
  //   random 隨機
  function chooseGrowth(s, strategy) {
    const opts = G.growthOptions(s);
    const p = s.players[s.current];
    const pick = (choice, element) => (opts.includes(choice) ? { type: 'growth', choice, element } : null);
    const resonance = () => pick('resonance', wantedResonance(p) || mainElement(p));

    if (strategy === 'random') {
      const choice = opts[Math.floor(Math.random() * opts.length)];
      return choice === 'resonance' ? resonance() : pick(choice);
    }
    if (strategy === 'mana') return pick('mana') || pick('draw') || resonance();

    const want = wantedResonance(p);
    if (want && p.maxMana >= 3) return pick('resonance', want) || pick('mana') || pick('draw');
    if (p.hand.length <= 1 && p.maxMana >= 3) return pick('draw') || pick('mana') || resonance();
    return pick('mana') || pick('draw') || resonance();
  }

  // 回傳下一個行動；沒有更好的行動時結束回合
  // opts.difficulty：'normal'（預設，選最好的行動）或 'easy'（新手用，見下方）
  function nextAction(state, opts = {}) {
    const easy = opts.difficulty === 'easy';
    const random = opts.random || Math.random;
    if (state.phase === 'growth') return chooseGrowth(state, opts.growth || (easy ? 'random' : 'smart'));
    // 試算時不需要戰鬥紀錄，拿掉可以快很多
    const s = Object.assign({}, state, { log: [] });
    const me = s.current;
    const base = evaluate(s, me) + 0.01;
    const good = [];
    for (const action of candidateActions(s)) {
      const score = evaluate(G.applyAction(s, action), me);
      if (score > base) good.push({ action, score });
    }
    if (!easy) {
      good.sort((a, b) => b.score - a.score);
      return good.length ? good[0].action : { type: 'endTurn' };
    }
    // 簡單：每回合最多出 1 張牌、法術不打臉、從還不錯的行動裡隨便挑，有時候會提早結束回合
    const options = good.filter(({ action }) => {
      if (action.type !== 'play') return true;
      if (s.playedElements.length >= 1) return false;
      return !(action.target && action.target.kind === 'hero');
    });
    if (!options.length || (s.playedElements.length && random() < 0.3)) return { type: 'endTurn' };
    return options[Math.floor(random() * options.length)].action;
  }

  const api = { evaluate, candidateActions, chooseGrowth, nextAction };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ElementAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
