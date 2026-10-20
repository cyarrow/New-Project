// 牌組對戰表：每副牌組兩兩對打（先後手各一半），統計勝率、對局長度、打到疲勞的比例。
// 用法：node tools/matchups.js [每組對局數，預設 200] [設定.json] [亂數種子起點，預設 5000]
// 設定檔可以覆寫規則與卡牌數值，例如 { "trample": false, "cards": { "magma_lizard": { "hp": 2 } } }
const fs = require('fs');
const G = require('../src/game.js');
const AI = require('../src/ai.js');

const GAMES = Number(process.argv[2]) || 200;
const config = process.argv[3] && process.argv[3] !== '-' ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
const SEED = Number(process.argv[4]) || 5000;
const { cards = {}, ...rules } = config;
Object.assign(G.RULES, rules);
for (const [id, fields] of Object.entries(cards)) Object.assign(G.CARDS[id], fields);

const deckIds = Object.keys(G.DECKS);
const name = (id) => G.DECKS[id].name;
const pct = (x) => `${Math.round(x * 100)}%`;

function series(first, second) {
  let firstWins = 0, turns = 0, fatigue = 0;
  for (let i = 0; i < GAMES; i++) {
    let s = G.createGame({ decks: [first, second], seed: SEED + i });
    while (s.phase !== 'over') s = G.applyAction(s, AI.nextAction(s));
    if (s.winner === 0) firstWins++;
    else if (s.winner === 'draw') firstWins += 0.5;
    turns += s.turn;
    if (s.players.some((p) => p.fatigue > 0)) fatigue++;
  }
  return { firstWin: firstWins / GAMES, turns: turns / GAMES, fatigue: fatigue / GAMES };
}

const results = {};
for (const a of deckIds) for (const b of deckIds) results[`${a}>${b}`] = series(a, b);

console.log(`每組 ${GAMES} 局（先後手各打一組）\n`);
console.log(`| 列 對 欄 的勝率 | ${deckIds.map(name).join(' | ')} | 平均 |`);
console.log(`|---|${deckIds.map(() => '---').join('|')}|---|`);
for (const a of deckIds) {
  const row = [];
  let sum = 0, n = 0;
  for (const b of deckIds) {
    if (a === b) {
      row.push('—');
      continue;
    }
    const w = (results[`${a}>${b}`].firstWin + (1 - results[`${b}>${a}`].firstWin)) / 2;
    row.push(pct(w));
    sum += w;
    n++;
  }
  console.log(`| ${name(a)} | ${row.join(' | ')} | ${pct(sum / n)} |`);
}

console.log('\n| 對局 | 平均總回合 | 打到疲勞 |');
console.log('|---|---|---|');
for (const a of deckIds) {
  for (const b of deckIds) {
    if (deckIds.indexOf(b) < deckIds.indexOf(a)) continue;
    const r1 = results[`${a}>${b}`];
    const r2 = results[`${b}>${a}`];
    const turns = (r1.turns + r2.turns) / 2;
    console.log(`| ${name(a)} vs ${name(b)} | ${turns.toFixed(1)}（約 ${Math.round((turns * 40) / 60)} 分）| ${pct((r1.fatigue + r2.fatigue) / 2)} |`);
  }
}

const mirrors = deckIds.map((id) => results[`${id}>${id}`].firstWin);
console.log(`\n先手勝率（同牌組對打平均）：${pct(mirrors.reduce((a, b) => a + b, 0) / mirrors.length)}`);
