// 平衡模擬：讓兩個電腦玩家對打很多局，統計勝率、對局長度和成長選擇。
// 用法：node tools/simulate.js [每組對局數，預設 200]
const G = require('../src/game.js');
const AI = require('../src/ai.js');

const GAMES = Number(process.argv[2]) || 200;
const SECONDS_PER_TURN = 40; // 估算真人每回合的思考時間

function playGame(decks, strategies, seed) {
  let s = G.createGame({ decks, seed });
  const picks = [{ mana: 0, draw: 0, resonance: 0 }, { mana: 0, draw: 0, resonance: 0 }];
  const cardsPlayed = {};
  let steps = 0;
  while (s.phase !== 'over') {
    if (++steps > 5000) throw new Error(`seed ${seed} 卡住了`);
    const action = AI.nextAction(s, { growth: strategies[s.current] });
    if (action.type === 'growth') picks[s.current][action.choice]++;
    if (action.type === 'play') {
      const id = s.players[s.current].hand.find((c) => c.uid === action.uid).cardId;
      cardsPlayed[id] = (cardsPlayed[id] || 0) + 1;
    }
    s = G.applyAction(s, action);
  }
  return {
    winner: s.winner,
    turns: s.turn,
    picks,
    cardsPlayed,
    maxMana: s.players.map((p) => p.maxMana),
    fatigue: s.players.some((p) => p.fatigue > 0),
  };
}

function run(label, decks, strategies) {
  const r = { wins: [0, 0], draws: 0, turns: [], picks: [{ mana: 0, draw: 0, resonance: 0 }, { mana: 0, draw: 0, resonance: 0 }], fatigue: 0 };
  for (let i = 0; i < GAMES; i++) {
    const g = playGame(decks, strategies, 1000 + i);
    if (g.winner === 'draw') r.draws++;
    else r.wins[g.winner]++;
    r.turns.push(g.turns);
    if (g.fatigue) r.fatigue++;
    for (let p = 0; p < 2; p++) for (const k in g.picks[p]) r.picks[p][k] += g.picks[p][k];
  }
  r.turns.sort((a, b) => a - b);
  const avg = r.turns.reduce((a, b) => a + b, 0) / GAMES;
  const pct = (n) => `${((n / GAMES) * 100).toFixed(0)}%`;
  const mix = (p) => {
    const total = p.mana + p.draw + p.resonance;
    return `擴充 ${((p.mana / total) * 100).toFixed(0)}% / 研讀 ${((p.draw / total) * 100).toFixed(0)}% / 共鳴 ${((p.resonance / total) * 100).toFixed(0)}%`;
  };
  const name = (i) => `${G.DECKS[decks[i]].name}(${strategies[i]})`;
  console.log(`\n## ${label}`);
  console.log(`先手 ${name(0)} 勝 ${pct(r.wins[0])}｜後手 ${name(1)} 勝 ${pct(r.wins[1])}｜平手 ${pct(r.draws)}`);
  console.log(`總回合數：平均 ${avg.toFixed(1)}，中位數 ${r.turns[GAMES >> 1]}，最短 ${r.turns[0]}，最長 ${r.turns[GAMES - 1]}` +
    `（約 ${((avg * SECONDS_PER_TURN) / 60).toFixed(0)} 分鐘）`);
  console.log(`打到疲勞的對局：${pct(r.fatigue)}`);
  console.log(`先手成長：${mix(r.picks[0])}`);
  console.log(`後手成長：${mix(r.picks[1])}`);
  return r;
}

function cardUsage() {
  const totals = {};
  for (let i = 0; i < GAMES; i++) {
    for (const decks of [['gale', 'deeprock'], ['deeprock', 'gale']]) {
      const g = playGame(decks, ['smart', 'smart'], 5000 + i);
      for (const [id, n] of Object.entries(g.cardsPlayed)) totals[id] = (totals[id] || 0) + n;
    }
  }
  console.log('\n## 每局平均打出次數（每種卡牌組裡有 2 張）');
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  for (const [id, n] of rows) console.log(`${G.CARDS[id].name.padEnd(6, '　')} ${(n / (GAMES * 2)).toFixed(2)}`);
}

console.log(`每組 ${GAMES} 局`);
run('烈風 vs 深岩', ['gale', 'deeprock'], ['smart', 'smart']);
run('深岩 vs 烈風', ['deeprock', 'gale'], ['smart', 'smart']);
run('烈風 鏡像', ['gale', 'gale'], ['smart', 'smart']);
run('深岩 鏡像', ['deeprock', 'deeprock'], ['smart', 'smart']);
run('成長策略：看手牌 vs 只擴充（烈風鏡像）', ['gale', 'gale'], ['smart', 'mana']);
run('成長策略：只擴充 vs 看手牌（烈風鏡像）', ['gale', 'gale'], ['mana', 'smart']);
run('成長策略：看手牌 vs 只擴充（深岩鏡像）', ['deeprock', 'deeprock'], ['smart', 'mana']);
run('成長策略：只擴充 vs 看手牌（深岩鏡像）', ['deeprock', 'deeprock'], ['mana', 'smart']);
run('成長策略：看手牌 vs 隨機（烈風 vs 深岩）', ['gale', 'deeprock'], ['smart', 'random']);
cardUsage();
