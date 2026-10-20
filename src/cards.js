// 卡牌資料：想改數值或新增卡牌，只要改這個檔案。
//
// 每張卡的欄位：
//   id        程式內部用的代號（英文，不可重複）
//   name      卡名
//   element   fire / water / wind / earth / neutral
//   type      minion（隨從）或 spell（法術）
//   cost      費用
//   atk, hp   攻擊 / 生命（只有隨從需要）
//   keywords  關鍵字：charge（衝鋒）、swift（疾風）、guard（守護）
//   target    法術或登場效果需要的目標：any / anyMinion / enemyMinion / friendlyMinion
//   text      卡面說明文字
//   costMod   (player) => 費用增減
//   onPlay    (g, ctx) => 打出時的效果（登場 / 法術）
//   deathrattle (g, ctx) => 遺言效果
//
// ctx 內容：player（出牌者編號）、minion（剛上場的隨從）、lane（路線）、
//           target（選擇的目標）、combo（是否觸發連擊）
(function (root) {
  'use strict';

  const ELEMENTS = {
    fire: { name: '火' },
    water: { name: '水' },
    wind: { name: '風' },
    earth: { name: '土' },
    neutral: { name: '中立' },
  };

  const KEYWORDS = {
    charge: '衝鋒',
    swift: '疾風',
    guard: '守護',
  };

  const CARD_LIST = [
    // ── 火 ──
    {
      id: 'spark_sprite', name: '火花精靈', element: 'fire', type: 'minion', cost: 1, atk: 2, hp: 1,
      text: '連擊：獲得衝鋒',
      onPlay(g, ctx) {
        if (ctx.combo) g.giveKeyword(ctx.minion, 'charge');
      },
    },
    {
      id: 'flame_bolt', name: '烈焰術', element: 'fire', type: 'spell', cost: 2, target: 'any',
      text: '造成 3 點傷害。共鳴 2：改為 4 點',
      onPlay(g, ctx) {
        g.damage(ctx.target, g.resonance(ctx.player, 'fire') >= 2 ? 4 : 3);
      },
    },
    {
      id: 'lava_hound', name: '熔岩獵犬', element: 'fire', type: 'minion', cost: 3, atk: 3, hp: 2,
      keywords: ['charge'], text: '衝鋒',
    },
    {
      id: 'blaze_giant', name: '炎爆巨人', element: 'fire', type: 'minion', cost: 5, atk: 5, hp: 4,
      text: '登場：對同一路所有敵方隨從造成 2 點傷害',
      onPlay(g, ctx) {
        for (const m of g.laneMinions(1 - ctx.player, ctx.lane)) g.damage(g.ref(m), 2);
      },
    },

    // ── 水 ──
    {
      id: 'tide_apprentice', name: '潮汐學徒', element: 'water', type: 'minion', cost: 1, atk: 1, hp: 2,
      text: '登場：為你的英雄恢復 2 點生命',
      onPlay(g, ctx) {
        g.heal(g.heroRef(ctx.player), 2);
      },
    },
    {
      id: 'frost_arrow', name: '冰霜箭', element: 'water', type: 'spell', cost: 2, target: 'anyMinion',
      text: '對一隻隨從造成 2 點傷害並凍結。連擊：抽 1 張牌',
      onPlay(g, ctx) {
        g.damage(ctx.target, 2);
        g.freeze(ctx.target);
        if (ctx.combo) g.draw(ctx.player, 1);
      },
    },
    {
      id: 'deep_watcher', name: '深海守望者', element: 'water', type: 'minion', cost: 3, atk: 2, hp: 4,
      text: '遺言：抽 1 張牌',
      deathrattle(g, ctx) {
        g.draw(ctx.player, 1);
      },
    },
    {
      id: 'wave_priest', name: '浪潮祭司', element: 'water', type: 'minion', cost: 4, atk: 3, hp: 5,
      text: '共鳴 2 登場：為所有友方角色恢復 3 點生命',
      onPlay(g, ctx) {
        if (g.resonance(ctx.player, 'water') < 2) return;
        g.heal(g.heroRef(ctx.player), 3);
        for (const m of g.allMinions(ctx.player)) g.heal(g.ref(m), 3);
      },
    },

    // ── 風 ──
    {
      id: 'wind_courier', name: '迅風信使', element: 'wind', type: 'minion', cost: 1, atk: 1, hp: 1,
      text: '登場：本回合移動隨從不花費用，且移動後仍可攻擊',
      onPlay(g, ctx) {
        g.setFreeMoves(ctx.player);
      },
    },
    {
      id: 'whirlwind', name: '旋風', element: 'wind', type: 'spell', cost: 2, target: 'enemyMinion',
      text: '將一隻敵方隨從移回對手手牌',
      onPlay(g, ctx) {
        g.bounce(ctx.target);
      },
    },
    {
      id: 'harpy_ranger', name: '鷹身游俠', element: 'wind', type: 'minion', cost: 3, atk: 3, hp: 2,
      keywords: ['swift'], text: '疾風',
    },
    {
      id: 'storm_lord', name: '暴風領主', element: 'wind', type: 'minion', cost: 5, atk: 4, hp: 4,
      text: '登場：本回合所有友方隨從 +1 攻擊並獲得疾風',
      onPlay(g, ctx) {
        for (const m of g.allMinions(ctx.player)) g.tempBuff(m, 1, 'swift');
      },
    },

    // ── 土 ──
    {
      id: 'stone_sentry', name: '石皮哨兵', element: 'earth', type: 'minion', cost: 1, atk: 1, hp: 3,
      keywords: ['guard'], text: '守護',
    },
    {
      id: 'earth_shield', name: '大地之盾', element: 'earth', type: 'spell', cost: 2, target: 'friendlyMinion',
      text: '一隻友方隨從 +0/+3 並獲得守護',
      onPlay(g, ctx) {
        g.buff(ctx.target, 0, 3);
        g.giveKeyword(g.minionOf(ctx.target), 'guard');
      },
    },
    {
      id: 'rock_golem', name: '岩石魔像', element: 'earth', type: 'minion', cost: 4, atk: 3, hp: 6,
      keywords: ['guard'], text: '守護',
    },
    {
      id: 'mountain_turtle', name: '山脈巨龜', element: 'earth', type: 'minion', cost: 6, atk: 5, hp: 8,
      text: '共鳴 2：費用 -2',
      costMod(player) {
        return player.resonance.earth >= 2 ? -2 : 0;
      },
    },

    // ── 中立 ──
    { id: 'recruit', name: '新兵', element: 'neutral', type: 'minion', cost: 1, atk: 1, hp: 2, text: '' },
    { id: 'mercenary', name: '傭兵劍士', element: 'neutral', type: 'minion', cost: 2, atk: 2, hp: 3, text: '' },
    {
      id: 'field_scout', name: '戰場斥候', element: 'neutral', type: 'minion', cost: 2, atk: 2, hp: 1,
      text: '登場：抽 1 張牌',
      onPlay(g, ctx) {
        g.draw(ctx.player, 1);
      },
    },
    { id: 'ancient_guard', name: '古代守衛', element: 'neutral', type: 'minion', cost: 4, atk: 4, hp: 4, text: '' },
  ];

  const CARDS = {};
  for (const c of CARD_LIST) CARDS[c.id] = Object.assign({ keywords: [], target: null }, c);

  // 預組牌組：每張卡放 2 份，共 20 張
  const DECKS = {
    gale: {
      name: '烈風',
      desc: '火 + 風｜快攻',
      cards: ['spark_sprite', 'flame_bolt', 'lava_hound', 'blaze_giant', 'wind_courier',
        'whirlwind', 'harpy_ranger', 'storm_lord', 'recruit', 'field_scout'],
    },
    deeprock: {
      name: '深岩',
      desc: '水 + 土｜控制',
      cards: ['tide_apprentice', 'frost_arrow', 'deep_watcher', 'wave_priest', 'stone_sentry',
        'earth_shield', 'rock_golem', 'mountain_turtle', 'mercenary', 'ancient_guard'],
    },
  };
  for (const d of Object.values(DECKS)) d.cards = d.cards.flatMap((id) => [id, id]);

  const api = { ELEMENTS, KEYWORDS, CARDS, DECKS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ElementCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
