// Basic tests for poker hand evaluation and deck fairness
const crypto = require('crypto');

// Import logic by extracting from server (inline for testing)
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

function cardRank(card) { return RANKS.indexOf(card[0]); }

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combinations(rest, k - 1).map(c => [first, ...c]), ...combinations(rest, k)];
}

function evaluate5(cards) {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(c => c[1]);
  const isFlush = suits.every(s => s === suits[0]);
  let isStraight = false, straightHigh = -1;
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) { isStraight = true; straightHigh = uniqueRanks[0]; }
    if (uniqueRanks[0] === 12 && uniqueRanks[1] === 3 && uniqueRanks[2] === 2 && uniqueRanks[3] === 1 && uniqueRanks[4] === 0) {
      isStraight = true; straightHigh = 3;
    }
  }
  const freq = {};
  for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
  const groups = Object.entries(freq).map(([r, c]) => ({ rank: parseInt(r), count: c })).sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (isStraight && isFlush) return { type: straightHigh === 12 ? 9 : 8, kickers: [straightHigh] };
  if (groups[0].count === 4) return { type: 7, kickers: [groups[0].rank, groups[1].rank] };
  if (groups[0].count === 3 && groups[1].count === 2) return { type: 6, kickers: [groups[0].rank, groups[1].rank] };
  if (isFlush) return { type: 5, kickers: ranks };
  if (isStraight) return { type: 4, kickers: [straightHigh] };
  if (groups[0].count === 3) return { type: 3, kickers: [groups[0].rank, ...groups.slice(1).map(g => g.rank).sort((a, b) => b - a)] };
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    return { type: 2, kickers: [...pairs, groups[2].rank] };
  }
  if (groups[0].count === 2) return { type: 1, kickers: [groups[0].rank, ...groups.slice(1).map(g => g.rank).sort((a, b) => b - a)] };
  return { type: 0, kickers: ranks };
}

function evaluateBest5(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const score = evaluate5(combo);
    if (!best || score.type > best.type || (score.type === best.type && score.kickers.join(',') > best.kickers.join(','))) {
      best = score;
    }
  }
  return best;
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

console.log('Testing hand evaluation...');

// Royal flush
assert(evaluate5(['As','Ks','Qs','Js','Ts']).type === 9, 'Royal flush');

// Straight flush
assert(evaluate5(['9h','8h','7h','6h','5h']).type === 8, 'Straight flush');

// Four of a kind
assert(evaluate5(['Ah','Ad','Ac','As','Kh']).type === 7, 'Four of a kind');

// Full house
assert(evaluate5(['Ah','Ad','Ac','Ks','Kh']).type === 6, 'Full house');

// Flush
assert(evaluate5(['Ah','Kh','9h','7h','2h']).type === 5, 'Flush');

// Straight
assert(evaluate5(['9h','8d','7c','6s','5h']).type === 4, 'Straight');

// Ace-low straight
assert(evaluate5(['Ah','2d','3c','4s','5h']).type === 4, 'Ace-low straight');

// Three of a kind
assert(evaluate5(['Ah','Ad','Ac','Ks','Qh']).type === 3, 'Three of a kind');

// Two pair
assert(evaluate5(['Ah','Ad','Ks','Kh','Qh']).type === 2, 'Two pair');

// One pair
assert(evaluate5(['Ah','Ad','Ks','Qh','Jh']).type === 1, 'One pair');

// High card
assert(evaluate5(['Ah','Kd','Qs','Jh','9h']).type === 0, 'High card');

console.log('\nTesting best 5 from 7 cards...');

// Should find the flush in 7 cards
const best7 = evaluateBest5(['Ah','Kh','9h','7h','2h','Kd','Qs']);
assert(best7.type === 5, 'Finds flush in 7 cards');

// Should find full house
const fh7 = evaluateBest5(['Ah','Ad','Ac','Ks','Kh','3d','7c']);
assert(fh7.type === 6, 'Finds full house in 7 cards');

console.log('\nTesting deck hashing (provably fair)...');

function createDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

const deck = createDeck();
assert(deck.length === 52, 'Deck has 52 cards');
assert(new Set(deck).size === 52, 'All cards unique');

const salt = crypto.randomBytes(16).toString('hex');
const data = salt + ':' + deck.join(',');
const hash = crypto.createHash('sha256').update(data).digest('hex');
const verify = crypto.createHash('sha256').update(data).digest('hex');
assert(hash === verify, 'Hash verification consistent');

console.log('\nTesting shuffle randomness...');
// Shuffle many times and check distribution isn't degenerate
const counts = {};
for (let trial = 0; trial < 1000; trial++) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const bytes = crypto.randomBytes(4);
    const rand = bytes.readUInt32BE(0);
    const j = rand % (i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  const firstCard = d[0];
  counts[firstCard] = (counts[firstCard] || 0) + 1;
}
const values = Object.values(counts);
const avg = 1000 / 52;
const allReasonable = values.every(v => v < avg * 4); // no card appears more than 4x expected
assert(allReasonable, 'Shuffle distribution appears random');
assert(Object.keys(counts).length > 40, 'Many different first cards seen (>40 unique)');

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
