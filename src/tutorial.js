// 新手教學：固定的牌序與對手劇本，一步一步帶玩家認識規則。
//
// 每個步驟：
//   text    說明文字
//   focus   要發光提示的畫面元素（CSS 選擇器）
//   expect  (action, state) => 這一步允許的行動；沒有 expect 的步驟用「下一步」按鈕前進
//   demo    (state) => 範例行動（自動測試用，確保教學一定走得完）
(function (root) {
  'use strict';

  const G = typeof module === 'object' && module.exports ? require('./game.js') : root.ElementGame;

  const findCard = (s, cardId, p = s.current) => s.players[p].hand.find((c) => c.cardId === cardId);
  const minionOf = (s, cardId, p) => s.players[p].lanes.flat().find((m) => m.cardId === cardId);
  const isGrowth = (choice) => (a) => a.type === 'growth' && a.choice === choice;
  const isEnd = (a) => a.type === 'endTurn';
  const plays = (s, a, cardId) => a.type === 'play' && findCard(s, cardId)?.uid === a.uid;

  const OPPONENT_SCRIPT = {
    // 第 2 回合：教官在左路放新兵
    2: [
      () => ({ type: 'growth', choice: 'mana' }),
      () => ({ type: 'growth', choice: 'draw' }),
      (s) => ({ type: 'play', uid: findCard(s, 'recruit').uid, lane: 0 }),
      () => ({ type: 'endTurn' }),
    ],
    // 第 4 回合：守護隨從擋住中路，左路再放一隻
    4: [
      () => ({ type: 'growth', choice: 'mana' }),
      (s) => ({ type: 'play', uid: findCard(s, 'stone_sentry').uid, lane: 1 }),
      (s) => ({ type: 'play', uid: findCard(s, 'mercenary').uid, lane: 0 }),
      () => ({ type: 'endTurn' }),
    ],
  };

  const STEPS = [
    {
      text: '歡迎來到元素戰線！上方是對手「教官」，下方是你。把對手英雄的生命打到 0 就獲勝。中間的三欄是戰場的左、中、右三路。',
      focus: ['.field'],
    },
    {
      text: '每回合開始要先做「成長選擇」。費用不會自動增加，現在選「擴充」，讓費用上限 +1。',
      focus: ['[data-choice="mana"]'],
      expect: isGrowth('mana'),
      demo: () => ({ type: 'growth', choice: 'mana' }),
    },
    {
      text: '你有 1 費了。點手牌中的「新兵」，再點中路的「放在這裡」。',
      focus: ['.card[data-card="recruit"]', '[data-action="place"][data-lane="1"]'],
      expect: (a, s) => plays(s, a, 'recruit') && a.lane === 1,
      demo: (s) => ({ type: 'play', uid: findCard(s, 'recruit').uid, lane: 1 }),
    },
    {
      text: '剛上場的隨從要等下一回合才能攻擊。按「結束回合」，看看對手怎麼做。',
      focus: ['[data-action="end"]'],
      expect: isEnd,
      demo: () => ({ type: 'endTurn' }),
    },
    {
      text: '對手在左路放了一隻新兵。輪到你了，再選一次「擴充」，費用變成 2。',
      focus: ['[data-choice="mana"]'],
      expect: isGrowth('mana'),
      demo: () => ({ type: 'growth', choice: 'mana' }),
    },
    {
      text: '隨從只能攻擊同一路的敵人。中路對面沒有隨從擋路，所以你的新兵可以直接打英雄：點新兵，再點上方對手的頭像。',
      focus: ['.minion[data-card="recruit"][data-owner="0"]', '[data-action="hero"][data-player="1"]'],
      expect: (a) => a.type === 'attack' && a.target.kind === 'hero',
      demo: (s) => ({ type: 'attack', uid: minionOf(s, 'recruit', 0).uid, target: { kind: 'hero', player: 1 } }),
    },
    {
      text: '法術用完就會消失。點「烈焰術」，再點左路的敵方新兵，把它燒掉。',
      focus: ['.card[data-card="flame_bolt"]', '.minion[data-owner="1"]'],
      expect: (a, s) => plays(s, a, 'flame_bolt') && a.target?.kind === 'minion',
      demo: (s) => ({ type: 'play', uid: findCard(s, 'flame_bolt').uid, target: { kind: 'minion', uid: minionOf(s, 'recruit', 1).uid } }),
    },
    {
      text: '費用用完了，按「結束回合」。',
      focus: ['[data-action="end"]'],
      expect: isEnd,
      demo: () => ({ type: 'endTurn' }),
    },
    {
      text: '對手在中路放了有「守護」的石皮哨兵，擋住你的新兵；左路也多了一隻傭兵劍士。先選「擴充」，費用變成 3。',
      focus: ['[data-choice="mana"]'],
      expect: isGrowth('mana'),
      demo: () => ({ type: 'growth', choice: 'mana' }),
    },
    {
      text: '右路是空的！點你的新兵，再點右路的「移到這裡」（花 1 費）。移動後這回合不能攻擊，但下回合就能從右路直接打英雄。',
      focus: ['.minion[data-card="recruit"][data-owner="0"]', '[data-action="move"][data-lane="2"]'],
      expect: (a) => a.type === 'move' && a.lane === 2,
      demo: (s) => ({ type: 'move', uid: minionOf(s, 'recruit', 0).uid, lane: 2 }),
    },
    {
      text: '還剩 2 費。接下來試試「連擊」：同一回合已經出過同元素的牌，再出同元素的牌就會觸發額外效果。先出一張「火花精靈」，放在中路或左路。',
      focus: ['.card[data-card="spark_sprite"]', '[data-action="place"]'],
      expect: (a, s) => plays(s, a, 'spark_sprite'),
      demo: (s) => ({ type: 'play', uid: findCard(s, 'spark_sprite').uid, lane: 0 }),
    },
    {
      text: '再出第二張「火花精靈」。因為這回合已經出過火屬性的牌，它會觸發連擊，獲得「衝鋒」。',
      focus: ['.card[data-card="spark_sprite"]', '[data-action="place"]'],
      expect: (a, s) => plays(s, a, 'spark_sprite'),
      demo: (s) => ({ type: 'play', uid: findCard(s, 'spark_sprite').uid, lane: 1 }),
    },
    {
      text: '有衝鋒的隨從上場當回合就能攻擊。點發光的火花精靈，再點一個紅色閃爍的目標。注意：有「守護」的隨從會被優先攻擊。',
      focus: ['.minion.can-act', '.targetable'],
      expect: (a) => a.type === 'attack',
      demo: (s) => {
        const m = s.players[0].lanes.flat().find((x) => G.canAttack(s, x.uid));
        return { type: 'attack', uid: m.uid, target: G.attackTargets(s, m.uid)[0] };
      },
    },
    {
      text: '最後介紹另外兩個成長選項：「研讀」多抽 1 張牌；「共鳴」讓一個元素的共鳴值 +1，卡牌上寫「共鳴 X」的效果就會變強，例如烈焰術在火共鳴 2 時傷害從 3 變成 4。每回合要衝費用、補手牌還是累積共鳴，由你決定！',
      focus: ['.hero-bar.me .resonance'],
    },
  ];

  function createTutorialGame() {
    const s = G.createGame({ decks: ['gale', 'deeprock'], names: ['你', '教官'], seed: 7 });
    const cards = (ids) => ids.map((cardId) => ({ uid: s.nextUid++, cardId }));
    const [me, coach] = s.players;
    me.hand = cards(['recruit', 'flame_bolt', 'spark_sprite', 'spark_sprite']);
    me.deck = cards(['mercenary', 'lava_hound', 'harpy_ranger', 'field_scout', 'storm_lord', 'blaze_giant',
      'flame_bolt', 'whirlwind', 'wind_courier', 'recruit', 'lava_hound', 'harpy_ranger', 'field_scout', 'storm_lord', 'blaze_giant']);
    coach.hand = cards(['recruit', 'stone_sentry', 'mercenary', 'deep_watcher']);
    coach.deck = cards(['tide_apprentice', 'rock_golem', 'ancient_guard', 'frost_arrow', 'wave_priest', 'earth_shield',
      'mountain_turtle', 'stone_sentry', 'mercenary', 'deep_watcher', 'tide_apprentice', 'rock_golem', 'ancient_guard', 'frost_arrow', 'wave_priest', 'earth_shield']);
    s.log = ['新手教學開始', '── 第 1 回合：你 ──'];
    return s;
  }

  // 教學中對手的下一個行動；劇本走完就交給電腦
  function opponentAction(s, index) {
    const script = OPPONENT_SCRIPT[s.turn];
    return script && script[index] ? script[index](s) : null;
  }

  const api = { STEPS, createTutorialGame, opponentAction };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ElementTutorial = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
