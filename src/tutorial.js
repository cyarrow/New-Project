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
      text: '歡迎來到元素戰線！上方是對手「教官」，下方是你。把對手英雄的生命打到 0 就獲勝。中間的三欄是戰場的左、中、右三路。看不懂某張牌時，長按它（電腦也可以按右鍵）就會顯示完整說明。',
      focus: ['.field'],
    },
    {
      text: '前 3 個回合，費用上限會在回合開始時自動 +1，所以你現在有 1 費。接著每回合都要做一次「成長選擇」：現在選「擴充」，讓費用上限再 +1。',
      focus: ['[data-choice="mana"]'],
      expect: isGrowth('mana'),
      demo: () => ({ type: 'growth', choice: 'mana' }),
    },
    {
      text: '你有 2 費了。點手牌中的「新兵」，再點中路的「放在這裡」。',
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
      text: '你的新兵獨佔了中路（對面沒有隨從），這叫「控制路線」：每回合開始時，對手會受到 1 點傷害。這回合試試「共鳴」：點「共鳴」，再選「火」，火的共鳴值會 +2。',
      focus: ['[data-choice="resonance"]', '[data-action="resonate"][data-element="fire"]'],
      expect: (a) => a.type === 'growth' && a.choice === 'resonance' && a.element === 'fire',
      demo: () => ({ type: 'growth', choice: 'resonance', element: 'fire' }),
    },
    {
      text: '隨從只能攻擊同一路的敵人。中路對面沒有隨從擋路，所以你的新兵可以直接打英雄：點新兵，再點上方對手的頭像。',
      focus: ['.minion[data-card="recruit"][data-owner="0"]', '[data-action="hero"][data-player="1"]'],
      expect: (a) => a.type === 'attack' && a.target.kind === 'hero',
      demo: (s) => ({ type: 'attack', uid: minionOf(s, 'recruit', 0).uid, target: { kind: 'hero', player: 1 } }),
    },
    {
      text: '烈焰術寫著「共鳴 2：改為 4 點」。你的火共鳴已經是 2，所以它現在會造成 4 點傷害。點「烈焰術」，再點左路的敵方新兵，把它燒掉。',
      focus: ['.card[data-card="flame_bolt"]', '.minion[data-owner="1"]'],
      expect: (a, s) => plays(s, a, 'flame_bolt') && a.target?.kind === 'minion',
      demo: (s) => ({ type: 'play', uid: findCard(s, 'flame_bolt').uid, target: { kind: 'minion', uid: minionOf(s, 'recruit', 1).uid } }),
    },
    {
      text: '這回合做得差不多了，按「結束回合」。',
      focus: ['[data-action="end"]'],
      expect: isEnd,
      demo: () => ({ type: 'endTurn' }),
    },
    {
      text: '對手在中路放了有「守護」的石皮哨兵，擋住你的新兵；左路也多了一隻傭兵劍士。這是費用自動成長的最後一個回合，選「擴充」讓費用變成 5。',
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
      text: '接下來試試「連擊」：同一回合已經出過同元素的牌，再出同元素的牌就會觸發額外效果。先出一張「火花精靈」，放在中路或左路。',
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
      text: '有衝鋒的隨從上場當回合就能攻擊。點發光的火花精靈，再點一個紅色閃爍的目標。注意：有「守護」的隨從會被優先攻擊。打死隨從後如果還有多的傷害，會「穿透」打到對手英雄。',
      focus: ['.minion.can-act', '.targetable'],
      expect: (a) => a.type === 'attack',
      demo: (s) => {
        const m = s.players[0].lanes.flat().find((x) => G.canAttack(s, x.uid));
        return { type: 'attack', uid: m.uid, target: G.attackTargets(s, m.uid)[0] };
      },
    },
    {
      text: '最後一個成長選項是「研讀」：多抽 1 張牌。從第 4 回合開始，費用不會再自動增加，每回合要衝費用、補手牌還是累積共鳴，由你決定！記得多搶空著的路線，持續給對手壓力。',
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
    // 教官的牌組比較弱，血量也比較少，教學結束後把這局打完不會太難
    coach.deck = cards(['tide_apprentice', 'recruit', 'ancient_guard', 'mercenary', 'deep_watcher', 'stone_sentry',
      'recruit', 'tide_apprentice', 'mercenary', 'frost_arrow', 'recruit', 'deep_watcher', 'ancient_guard', 'stone_sentry', 'mercenary', 'recruit']);
    coach.hp = 18;
    s.log = ['新手教學開始', '── 第 1 回合：你 ──'];
    return s;
  }

  // 教學中對手的下一個行動；劇本走完就交給簡單的電腦
  function opponentAction(s, index) {
    const script = OPPONENT_SCRIPT[s.turn];
    return script && script[index] ? script[index](s) : null;
  }

  const api = { STEPS, createTutorialGame, opponentAction };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ElementTutorial = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
