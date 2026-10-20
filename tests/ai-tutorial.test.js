const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game.js');
const AI = require('../src/ai.js');
const T = require('../src/tutorial.js');

test('電腦玩家對打可以打完，而且每一步都是合法行動', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = G.createGame({ seed, decks: seed % 2 ? ['gale', 'deeprock'] : ['deeprock', 'gale'] });
    let steps = 0;
    while (s.phase !== 'over') {
      assert.ok(steps++ < 3000, `seed ${seed} 卡住了`);
      s = G.applyAction(s, AI.nextAction(s));
    }
  }
});

test('電腦玩家看得到致命一擊', () => {
  let s = G.createGame({ seed: 3 });
  s.players[0].hand = [{ uid: 900, cardId: 'flame_bolt' }];
  s.players[0].maxMana = 2;
  s.players[0].mana = 2;
  s.players[1].hp = 3;
  s.phase = 'main';
  const a = AI.nextAction(s);
  assert.equal(a.type, 'play');
  assert.deepEqual(a.target, { kind: 'hero', player: 1 });
});

test('每種成長策略都只會選合法的選項', () => {
  for (const strategy of ['smart', 'mana', 'random']) {
    let s = G.createGame({ seed: 5 });
    for (let i = 0; i < 40 && s.phase !== 'over'; i++) {
      const a = s.phase === 'growth' ? AI.chooseGrowth(s, strategy) : AI.nextAction(s);
      s = G.applyAction(s, a);
    }
  }
});

test('新手教學的每一步都走得完', () => {
  let s = T.createTutorialGame();
  let comboSeen = false;
  for (const [i, step] of T.STEPS.entries()) {
    if (!step.expect) continue;
    const action = step.demo(s);
    assert.ok(step.expect(action, s), `第 ${i + 1} 步的範例行動不符合教學要求`);
    s = G.applyAction(s, action);
    comboSeen ||= s.players[0].lanes.flat().some((m) => m.cardId === 'spark_sprite' && m.keywords.includes('charge'));
    // 對手回合照劇本走
    let n = 0;
    while (s.current === 1) {
      const a = T.opponentAction(s, n++);
      assert.ok(a, `第 ${s.turn} 回合對手劇本不完整`);
      s = G.applyAction(s, a);
    }
  }
  assert.notEqual(s.phase, 'over');
  assert.ok(comboSeen, '第二隻火花精靈應該觸發連擊獲得衝鋒');
});
