// 規則實驗：比較不同規則設定下的平衡數據。
// 用法：node tools/experiment.js [每組對局數，預設 300]
const G = require('../src/game.js');
const AI = require('../src/ai.js');

const GAMES = Number(process.argv[2]) || 300;
const BASE = JSON.parse(JSON.stringify(G.RULES));

function playGame(decks, strategies, seed) {
  let s = G.createGame({ decks, seed });
  while (s.phase !== 'over') s = G.applyAction(s, AI.nextAction(s, { growth: strategies[s.current] }));
  return s;
}

// 回傳 [座位 0 勝率, 平均總回合, 疲勞比例]
function series(decks, strategies) {
  let wins = 0, turns = 0, fatigue = 0;
  for (let i = 0; i < GAMES; i++) {
    const s = playGame(decks, strategies, 1000 + i);
    if (s.winner === 0) wins++;
    else if (s.winner === 'draw') wins += 0.5;
    turns += s.turn;
    if (s.players.some((p) => p.fatigue > 0)) fatigue++;
  }
  return [wins / GAMES, turns / GAMES, fatigue / GAMES];
}

// 卡牌原始數值，每組實驗前還原；設定裡的 cards 欄位可以覆寫，例如 { "harpy_ranger": { "hp": 3 } }
const CARD_FIELDS = ['cost', 'atk', 'hp', 'resonance', 'keywords'];
const BASE_CARDS = {};
for (const [id, c] of Object.entries(G.CARDS)) {
  BASE_CARDS[id] = {};
  for (const f of CARD_FIELDS) BASE_CARDS[id][f] = JSON.parse(JSON.stringify(c[f] ?? null));
}

function measure(label, config) {
  const { cards = {}, ...overrides } = config;
  for (const [id, base] of Object.entries(BASE_CARDS)) Object.assign(G.CARDS[id], JSON.parse(JSON.stringify(base)), cards[id] || {});
  Object.assign(G.RULES, JSON.parse(JSON.stringify(BASE)), overrides);
  const runs = {
    galeMirror: series(['gale', 'gale'], ['smart', 'smart']),
    rockMirror: series(['deeprock', 'deeprock'], ['smart', 'smart']),
    galeFirst: series(['gale', 'deeprock'], ['smart', 'smart']),
    rockFirst: series(['deeprock', 'gale'], ['smart', 'smart']),
    smartFirst: series(['gale', 'gale'], ['smart', 'mana']),
    manaFirst: series(['gale', 'gale'], ['mana', 'smart']),
  };
  const all = Object.values(runs);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const firstWin = (runs.galeMirror[0] + runs.rockMirror[0]) / 2;
  const galeWin = (runs.galeFirst[0] + (1 - runs.rockFirst[0])) / 2;
  const smartWin = (runs.smartFirst[0] + (1 - runs.manaFirst[0])) / 2;
  const turns = all.reduce((a, r) => a + r[1], 0) / all.length;
  const fatigue = all.reduce((a, r) => a + r[2], 0) / all.length;
  console.log(`| ${label} | ${pct(firstWin)} | ${pct(galeWin)} | ${pct(smartWin)} | ${turns.toFixed(1)}（約 ${Math.round((turns * 40) / 60)} 分）| ${pct(fatigue)} |`);
}

const EXPERIMENTS = {
  '目前規則': {},
  'v0.1 原始規則': {
    startHp: 25, startMana: [0, 1], startHand: [3, 4], autoManaTurns: 0, secondPlayerPicks: 2, laneControlDamage: 0, trample: false, resonanceGain: 1,
    cards: {
      wave_priest: { resonance: { water: 2 }, amount: 3 }, mountain_turtle: { resonance: { earth: 2 } },
      tide_apprentice: { amount: 2 }, wind_courier: { hp: 1 }, whirlwind: { cost: 2 }, stone_sentry: { hp: 3 },
    },
  },
  '不用控制路線': { laneControlDamage: 0 },
  '不用穿透': { trample: false },
  '共鳴 +1': { resonanceGain: 1 },
};

// 也可以從 JSON 檔讀入要比較的設定：node tools/experiment.js 200 configs.json
const configFile = process.argv[3] && process.argv[3].endsWith('.json') ? process.argv[3] : null;
if (configFile) {
  for (const k of Object.keys(EXPERIMENTS)) delete EXPERIMENTS[k];
  Object.assign(EXPERIMENTS, JSON.parse(require('fs').readFileSync(configFile, 'utf8')));
}
const only = configFile ? [] : process.argv.slice(3);
console.log(`每組 ${GAMES} 局\n`);
console.log('| 規則 | 先手勝率（鏡像） | 烈風勝率 | 看手牌成長 vs 只擴充 | 平均總回合 | 打到疲勞 |');
console.log('|---|---|---|---|---|---|');
for (const [label, o] of Object.entries(EXPERIMENTS)) if (!only.length || only.includes(label)) measure(label, o);
