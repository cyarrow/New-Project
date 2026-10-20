const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game.js');

// 建立一局，並把雙方手牌換成指定的卡，方便測試特定情境
function setup({ hands = [[], []], mana = [8, 8], seed = 1 } = {}) {
  let s = G.createGame({ seed });
  let uid = 1000;
  s.players.forEach((p, i) => {
    p.hand = hands[i].map((cardId) => ({ uid: uid++, cardId }));
    p.maxMana = mana[i];
    p.mana = mana[i];
  });
  s.nextUid = uid;
  return s;
}

const act = (s, a) => G.applyAction(s, a);
const handUid = (s, cardId, p = s.current) => s.players[p].hand.find((c) => c.cardId === cardId).uid;
const hero = (player) => ({ kind: 'hero', player });
const ref = (m) => ({ kind: 'minion', uid: m.uid });

// 跳過成長階段（選研讀，不影響費用）
function toMain(s) {
  while (s.phase === 'growth') s = act(s, { type: 'growth', choice: G.growthOptions(s).find((c) => c !== 'mana'), element: 'fire' });
  return s;
}

function play(s, cardId, extra = {}) {
  return act(s, { type: 'play', uid: handUid(s, cardId), ...extra });
}

// 結束目前回合，並讓下一位玩家進入主要階段
function pass(s) {
  return toMain(act(s, { type: 'endTurn' }));
}

test('開局：先手 3+1 張、後手 4 張，雙方 25 血，第一回合自動有 1 費', () => {
  const s = G.createGame({ seed: 42 });
  assert.equal(s.players[0].hand.length, 4);
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.players[0].deck.length + s.players[0].hand.length, 20);
  assert.equal(s.players[0].hp, 25);
  assert.equal(s.players[0].maxMana, 1);
  assert.equal(s.players[0].mana, 1);
  assert.equal(s.phase, 'growth');
});

test('同一個種子會洗出同樣的牌', () => {
  const a = G.createGame({ seed: 7 });
  const b = G.createGame({ seed: 7 });
  assert.deepEqual(a.players[0].hand, b.players[0].hand);
});

test('成長：擴充讓費用上限 +1 並立刻可用', () => {
  let s = G.createGame({ seed: 1 });
  s = act(s, { type: 'growth', choice: 'mana' });
  assert.equal(s.players[0].maxMana, 2);
  assert.equal(s.players[0].mana, 2);
  assert.equal(s.phase, 'main');
});

test('成長：共鳴增加指定元素', () => {
  let s = G.createGame({ seed: 1 });
  s = act(s, { type: 'growth', choice: 'resonance', element: 'fire' });
  assert.equal(s.players[0].resonance.fire, G.RULES.resonanceGain);
});

test('費用前 3 回合自動成長，之後只能靠擴充', () => {
  let s = G.createGame({ seed: 1 });
  const maxAt = [];
  for (let i = 0; i < 8; i++) {
    if (s.current === 0) maxAt.push(s.players[0].maxMana);
    s = act(s, { type: 'growth', choice: 'draw' });
    s = act(s, { type: 'endTurn' });
  }
  assert.deepEqual(maxAt, [1, 2, 3, 3]);
});

test('後手起始費用 1：第一回合就有 2 費，只做一次成長選擇', () => {
  let s = G.createGame({ seed: 1 });
  s = act(s, { type: 'growth', choice: 'draw' });
  s = act(s, { type: 'endTurn' });
  assert.equal(s.players[1].maxMana, 2);
  assert.equal(s.growth.picksLeft, 1);
});

test('原本的狀態不會被修改', () => {
  const s = G.createGame({ seed: 1 });
  const before = JSON.stringify(s);
  act(s, { type: 'growth', choice: 'mana' });
  assert.equal(JSON.stringify(s), before);
});

test('召喚隨從要付費、要選有空位的路線，每路最多 2 隻', () => {
  let s = toMain(setup({ hands: [['recruit', 'recruit', 'recruit'], []] }));
  s = play(s, 'recruit', { lane: 0 });
  s = play(s, 'recruit', { lane: 0 });
  assert.equal(s.players[0].lanes[0].length, 2);
  assert.equal(s.players[0].mana, 6);
  assert.throws(() => play(s, 'recruit', { lane: 0 }), /空位/);
});

test('費用不足不能出牌', () => {
  const s = toMain(setup({ hands: [['ancient_guard'], []], mana: [3, 3] }));
  assert.throws(() => play(s, 'ancient_guard', { lane: 1 }), /費用不足/);
});

test('隨從上場當回合不能攻擊，衝鋒可以', () => {
  let s = toMain(setup({ hands: [['recruit', 'lava_hound'], []] }));
  s = play(s, 'recruit', { lane: 0 });
  s = play(s, 'lava_hound', { lane: 1 });
  const [recruit] = s.players[0].lanes[0];
  const [hound] = s.players[0].lanes[1];
  assert.equal(G.canAttack(s, recruit.uid), false);
  s = act(s, { type: 'attack', uid: hound.uid, target: hero(1) });
  assert.equal(s.players[1].hp, 22);
});

test('同一路有敵人時不能打英雄，只能打同一路的隨從', () => {
  let s = toMain(setup({ hands: [['recruit'], ['mercenary', 'recruit']] }));
  s = play(s, 'recruit', { lane: 1 });
  s = pass(s);
  s = play(s, 'mercenary', { lane: 1 });
  s = play(s, 'recruit', { lane: 2 });
  s = pass(s);
  const attacker = s.players[0].lanes[1][0];
  const targets = G.attackTargets(s, attacker.uid);
  assert.deepEqual(targets, [ref(s.players[1].lanes[1][0])]);
});

test('對面路線空著時可以直接打英雄', () => {
  let s = toMain(setup({ hands: [['recruit'], ['mercenary']] }));
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  s = play(s, 'mercenary', { lane: 2 });
  s = pass(s);
  const attacker = s.players[0].lanes[0][0];
  const hp = s.players[1].hp;
  s = act(s, { type: 'attack', uid: attacker.uid, target: hero(1) });
  assert.equal(s.players[1].hp, hp - 1);
});

test('路線控制：回合開始時，每條只有自己有隨從的路線對敵方英雄造成 1 點傷害', () => {
  let s = toMain(setup({ hands: [['recruit', 'recruit'], ['mercenary']] }));
  s = play(s, 'recruit', { lane: 0 });
  s = play(s, 'recruit', { lane: 1 });
  s = pass(s);
  s = play(s, 'mercenary', { lane: 1 });
  const hp = s.players[1].hp;
  s = act(s, { type: 'endTurn' });
  assert.equal(s.players[1].hp, hp - 1, '只控制左路（中路有敵人）');
});

test('穿透：擊殺隨從後多出來的傷害打到敵方英雄', () => {
  let s = toMain(setup({ hands: [['ancient_guard'], ['spark_sprite']] }));
  s = play(s, 'ancient_guard', { lane: 0 });
  s = pass(s);
  s = play(s, 'spark_sprite', { lane: 0 });
  s = pass(s);
  const hp = s.players[1].hp;
  const guard = s.players[0].lanes[0][0];
  s = act(s, { type: 'attack', uid: guard.uid, target: ref(s.players[1].lanes[0][0]) });
  assert.equal(s.players[1].lanes[0].length, 0);
  assert.equal(s.players[1].hp, hp - 3, '4 攻打 1 血，多出 3 點');
});

test('隨從互打會同時受傷，死亡會被移除', () => {
  let s = toMain(setup({ hands: [['mercenary'], ['spark_sprite']] }));
  s = play(s, 'mercenary', { lane: 0 });
  s = pass(s);
  s = play(s, 'spark_sprite', { lane: 0 });
  s = pass(s);
  const merc = s.players[0].lanes[0][0];
  const spark = s.players[1].lanes[0][0];
  s = act(s, { type: 'attack', uid: merc.uid, target: ref(spark) });
  assert.equal(s.players[1].lanes[0].length, 0);
  assert.equal(s.players[0].lanes[0][0].hp, 1);
});

test('守護：同一路必須先打守護隨從', () => {
  let s = toMain(setup({ hands: [['recruit'], ['recruit', 'stone_sentry']] }));
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  s = play(s, 'recruit', { lane: 0 });
  s = play(s, 'stone_sentry', { lane: 0 });
  s = pass(s);
  const targets = G.attackTargets(s, s.players[0].lanes[0][0].uid);
  const sentry = s.players[1].lanes[0].find((m) => m.cardId === 'stone_sentry');
  assert.deepEqual(targets, [ref(sentry)]);
});

test('疾風：可以攻擊相鄰路線，相鄰路線有敵人時不能打英雄', () => {
  let s = toMain(setup({ hands: [['harpy_ranger'], ['recruit']] }));
  s = play(s, 'harpy_ranger', { lane: 1 });
  s = pass(s);
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  const harpy = s.players[0].lanes[1][0];
  const targets = G.attackTargets(s, harpy.uid);
  assert.deepEqual(targets, [ref(s.players[1].lanes[0][0])]);
});

test('移動：花 1 費到相鄰路線，移動後本回合不能攻擊', () => {
  let s = toMain(setup({ hands: [['recruit'], []] }));
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  s = pass(s);
  const m = s.players[0].lanes[0][0];
  assert.deepEqual(G.moveOptions(s, m.uid), [1]);
  const mana = s.players[0].mana;
  s = act(s, { type: 'move', uid: m.uid, lane: 1 });
  assert.equal(s.players[0].lanes[1][0].uid, m.uid);
  assert.equal(s.players[0].mana, mana - 1);
  assert.equal(G.canAttack(s, m.uid), false);
  assert.deepEqual(G.moveOptions(s, m.uid), []);
});

test('迅風信使：本回合移動免費且移動後仍可攻擊', () => {
  let s = toMain(setup({ hands: [['recruit', 'wind_courier'], []] }));
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  s = pass(s);
  s = play(s, 'wind_courier', { lane: 2 });
  const m = s.players[0].lanes[0][0];
  const mana = s.players[0].mana;
  s = act(s, { type: 'move', uid: m.uid, lane: 1 });
  assert.equal(s.players[0].mana, mana);
  assert.equal(G.canAttack(s, m.uid), true);
});

test('連擊：同回合先出同元素的牌才觸發', () => {
  let s = toMain(setup({ hands: [['spark_sprite', 'spark_sprite'], []] }));
  s = play(s, 'spark_sprite', { lane: 0 });
  s = play(s, 'spark_sprite', { lane: 1 });
  assert.equal(G.canAttack(s, s.players[0].lanes[0][0].uid), false);
  assert.equal(G.canAttack(s, s.players[0].lanes[1][0].uid), true);
});

test('共鳴：烈焰術在火共鳴 2 時造成 4 點傷害', () => {
  let s = toMain(setup({ hands: [['flame_bolt', 'flame_bolt'], []] }));
  s = play(s, 'flame_bolt', { target: hero(1) });
  assert.equal(s.players[1].hp, 22);
  s.players[0].resonance.fire = 2;
  s = play(s, 'flame_bolt', { target: hero(1) });
  assert.equal(s.players[1].hp, 18);
});

test('共鳴：山脈巨龜在土共鳴 3 時費用 -2', () => {
  const s = setup();
  s.players[0].resonance.earth = 2;
  assert.equal(G.getCost(s.players[0], 'mountain_turtle'), 6);
  s.players[0].resonance.earth = 3;
  assert.equal(G.getCost(s.players[0], 'mountain_turtle'), 4);
});

test('冰霜箭：被凍結的隨從下回合不能攻擊，再下一回合恢復', () => {
  let s = toMain(setup({ hands: [['recruit'], ['frost_arrow']] }));
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  const target = ref(s.players[0].lanes[0][0]);
  s = play(s, 'frost_arrow', { target });
  assert.equal(s.players[0].lanes.flat().length, 0, '1/2 的新兵吃 2 傷會死');

  s = setup({ hands: [['mercenary'], ['frost_arrow']] });
  s = toMain(s);
  s = play(s, 'mercenary', { lane: 0 });
  s = pass(s);
  s = play(s, 'frost_arrow', { target: ref(s.players[0].lanes[0][0]) });
  s = pass(s);
  const merc = s.players[0].lanes[0][0];
  assert.equal(merc.hp, 1);
  assert.equal(G.canAttack(s, merc.uid), false);
  s = pass(s);
  s = pass(s);
  assert.equal(G.canAttack(s, merc.uid), true);
});

test('旋風：把敵方隨從移回手牌', () => {
  let s = toMain(setup({ hands: [['whirlwind'], ['ancient_guard']] }));
  s = pass(s);
  s = play(s, 'ancient_guard', { lane: 1 });
  s = pass(s);
  const handBefore = s.players[1].hand.length;
  s = play(s, 'whirlwind', { target: ref(s.players[1].lanes[1][0]) });
  assert.equal(s.players[1].lanes[1].length, 0);
  assert.equal(s.players[1].hand.length, handBefore + 1);
});

test('遺言：深海守望者死亡時抽 1 張', () => {
  let s = toMain(setup({ hands: [['flame_bolt', 'flame_bolt'], ['deep_watcher']] }));
  s = pass(s);
  s = play(s, 'deep_watcher', { lane: 0 });
  s = pass(s);
  const handBefore = s.players[1].hand.length;
  const w = ref(s.players[1].lanes[0][0]);
  s = play(s, 'flame_bolt', { target: w });
  s = play(s, 'flame_bolt', { target: w });
  assert.equal(s.players[1].lanes[0].length, 0);
  assert.equal(s.players[1].hand.length, handBefore + 1);
});

test('暴風領主的加攻擊只持續到回合結束', () => {
  let s = toMain(setup({ hands: [['recruit', 'storm_lord'], []] }));
  s = play(s, 'recruit', { lane: 0 });
  s = pass(s);
  s = pass(s);
  s = play(s, 'storm_lord', { lane: 1 });
  const r = s.players[0].lanes[0][0];
  assert.equal(G.attackOf(r), 2);
  assert.ok(G.hasKeyword(r, 'swift'));
  s = act(s, { type: 'endTurn' });
  const after = G.findMinion(s, r.uid).minion;
  assert.equal(G.attackOf(after), 1);
  assert.ok(!G.hasKeyword(after, 'swift'));
});

test('牌庫抽乾會受到遞增的疲勞傷害', () => {
  let s = toMain(setup());
  s.players[1].deck = [];
  s = act(s, { type: 'endTurn' });
  assert.equal(s.players[1].hp, 24);
  s = act(s, { type: 'growth', choice: 'draw' });
  assert.equal(s.players[1].hp, 25 - 1 - 2);
});

test('英雄生命歸 0 時對局結束', () => {
  let s = toMain(setup({ hands: [['flame_bolt'], []] }));
  s.players[1].hp = 3;
  s = play(s, 'flame_bolt', { target: hero(1) });
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.throws(() => act(s, { type: 'endTurn' }), /結束/);
});

test('隨機對局可以順利打完（不會卡住或出錯）', () => {
  for (let seed = 1; seed <= 30; seed++) {
    let s = G.createGame({ seed });
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 2000) {
      if (s.phase === 'growth') {
        const opts = G.growthOptions(s);
        const choice = opts[seed % opts.length];
        s = act(s, { type: 'growth', choice, element: 'fire' });
        continue;
      }
      const p = s.players[s.current];
      const playable = p.hand.find((c) => !G.playBlocker(s, c.uid));
      if (playable) {
        const lane = G.openLanes(s)[0];
        const target = G.playTargets(s, playable.cardId)[0];
        s = act(s, { type: 'play', uid: playable.uid, lane, target });
        continue;
      }
      const attacker = p.lanes.flat().find((m) => G.attackTargets(s, m.uid).length);
      if (attacker) {
        const targets = G.attackTargets(s, attacker.uid);
        s = act(s, { type: 'attack', uid: attacker.uid, target: targets[targets.length - 1] });
        continue;
      }
      s = act(s, { type: 'endTurn' });
    }
    assert.equal(s.phase, 'over', `seed ${seed} 沒有打完`);
  }
});
