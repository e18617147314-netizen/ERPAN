const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

// ============================================================
// Poker Hand Evaluator
// ============================================================

const RANKS = '23456789TJQKA';
const SUITS = 'shdc'; // spades, hearts, diamonds, clubs

function cardRank(card) {
  return RANKS.indexOf(card[0]);
}

function cardSuit(card) {
  return card[1];
}

// Hand categories (higher = better)
const HAND_TYPES = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
};

const HAND_NAMES = [
  '高牌', '一对', '两对', '三条', '顺子',
  '同花', '葫芦', '四条', '同花顺', '皇家同花顺'
];

function evaluateBest5(cards) {
  // From 7 cards, find the best 5-card hand
  let best = null;
  const combos = combinations(cards, 5);
  for (const combo of combos) {
    const score = evaluate5(combo);
    if (!best || compareHands(score, best) > 0) {
      best = score;
    }
  }
  return best;
}

function evaluate5(cards) {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = -1;

  // Normal straight check
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      isStraight = true;
      straightHigh = uniqueRanks[0];
    }
    // Ace-low straight (A-2-3-4-5)
    if (uniqueRanks[0] === 12 && uniqueRanks[1] === 3 && uniqueRanks[2] === 2 && uniqueRanks[3] === 1 && uniqueRanks[4] === 0) {
      isStraight = true;
      straightHigh = 3; // 5 is the high card in A-2-3-4-5
    }
  }

  // Count rank frequencies
  const freq = {};
  for (const r of ranks) {
    freq[r] = (freq[r] || 0) + 1;
  }
  const groups = Object.entries(freq)
    .map(([r, c]) => ({ rank: parseInt(r), count: c }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (isStraight && isFlush) {
    if (straightHigh === 12) {
      return { type: HAND_TYPES.ROYAL_FLUSH, kickers: [straightHigh] };
    }
    return { type: HAND_TYPES.STRAIGHT_FLUSH, kickers: [straightHigh] };
  }

  if (groups[0].count === 4) {
    return {
      type: HAND_TYPES.FOUR_OF_A_KIND,
      kickers: [groups[0].rank, groups[1].rank]
    };
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      type: HAND_TYPES.FULL_HOUSE,
      kickers: [groups[0].rank, groups[1].rank]
    };
  }

  if (isFlush) {
    return { type: HAND_TYPES.FLUSH, kickers: ranks };
  }

  if (isStraight) {
    return { type: HAND_TYPES.STRAIGHT, kickers: [straightHigh] };
  }

  if (groups[0].count === 3) {
    const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
    return {
      type: HAND_TYPES.THREE_OF_A_KIND,
      kickers: [groups[0].rank, ...kickers]
    };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    return {
      type: HAND_TYPES.TWO_PAIR,
      kickers: [...pairs, groups[2].rank]
    };
  }

  if (groups[0].count === 2) {
    const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
    return {
      type: HAND_TYPES.ONE_PAIR,
      kickers: [groups[0].rank, ...kickers]
    };
  }

  return { type: HAND_TYPES.HIGH_CARD, kickers: ranks };
}

function compareHands(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const ak = a.kickers[i] ?? -1;
    const bk = b.kickers[i] ?? -1;
    if (ak !== bk) return ak - bk;
  }
  return 0;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// ============================================================
// Provably Fair Deck
// ============================================================

function createDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  // Fisher-Yates shuffle with crypto-secure random
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const bytes = crypto.randomBytes(4);
    const rand = bytes.readUInt32BE(0);
    const j = rand % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function hashDeck(deck, salt) {
  const data = salt + ':' + deck.join(',');
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ============================================================
// Game Room
// ============================================================

class Player {
  constructor(id, name, ws) {
    this.id = id;
    this.name = name;
    this.ws = ws;
    this.chips = 1000; // starting chips
    this.hand = [];
    this.bet = 0;       // bet in current round
    this.totalBet = 0;  // total bet in current hand
    this.folded = false;
    this.allIn = false;
    this.sittingOut = false;
    this.connected = true;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

class Room {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.players = [];
    this.state = 'waiting'; // waiting | playing
    this.smallBlind = 10;
    this.bigBlind = 20;
    this.dealerIndex = -1;
    this.currentPlayerIndex = -1;
    this.communityCards = [];
    this.pot = 0;
    this.pots = []; // for side pots
    this.deck = [];
    this.deckSalt = '';
    this.deckHash = '';
    this.round = ''; // preflop, flop, turn, river
    this.currentBet = 0;
    this.minRaise = 0;
    this.lastRaiserIndex = -1;
    this.handHistory = [];
    this.actionTimer = null;
    this.previousDeckInfo = null; // for verification
  }

  addPlayer(player) {
    if (this.players.length >= 9) return false;
    if (this.players.find(p => p.id === player.id)) return false;
    this.players.push(player);
    return true;
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      this.players.splice(idx, 1);
    }
  }

  activePlayers() {
    return this.players.filter(p => !p.folded && !p.sittingOut && p.chips > 0);
  }

  playersInHand() {
    return this.players.filter(p => !p.folded && !p.sittingOut);
  }

  playersCanAct() {
    return this.players.filter(p => !p.folded && !p.sittingOut && !p.allIn);
  }

  broadcast(msg) {
    for (const p of this.players) {
      p.send(msg);
    }
  }

  broadcastState() {
    for (const p of this.players) {
      p.send(this.getStateFor(p.id));
    }
  }

  getStateFor(playerId) {
    const me = this.players.find(p => p.id === playerId);
    return {
      type: 'state',
      room: this.code,
      state: this.state,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      pot: this.pot,
      pots: this.pots,
      communityCards: this.communityCards,
      round: this.round,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      currentPlayerIndex: this.currentPlayerIndex,
      dealerIndex: this.dealerIndex,
      deckHash: this.deckHash,
      previousDeckInfo: this.previousDeckInfo,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        totalBet: p.totalBet,
        folded: p.folded,
        allIn: p.allIn,
        sittingOut: p.sittingOut,
        connected: p.connected,
        hand: p.id === playerId ? p.hand : (this.state === 'showdown' && !p.folded ? p.hand : []),
        isMe: p.id === playerId,
        isHost: p.id === this.hostId,
      })),
      myIndex: this.players.findIndex(p => p.id === playerId),
    };
  }

  startHand() {
    if (this.players.filter(p => !p.sittingOut && p.chips > 0).length < 2) {
      this.broadcast({ type: 'error', message: '需要至少2名玩家才能开始' });
      return;
    }

    this.state = 'playing';

    // Save previous deck for verification
    if (this.deck.length > 0) {
      this.previousDeckInfo = {
        salt: this.deckSalt,
        deck: this.deck.join(','),
        hash: this.deckHash,
      };
    }

    // Reset players
    for (const p of this.players) {
      p.hand = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      if (p.chips <= 0) p.sittingOut = true;
    }

    this.communityCards = [];
    this.pot = 0;
    this.pots = [];
    this.currentBet = 0;
    this.handHistory = [];

    // Shuffle and hash deck
    this.deckSalt = crypto.randomBytes(16).toString('hex');
    this.deck = shuffleDeck(createDeck());
    this.deckHash = hashDeck(this.deck, this.deckSalt);

    // Move dealer
    this.dealerIndex = this.nextActivePlayer(this.dealerIndex);

    // Post blinds
    const activePlayers = this.players.filter(p => !p.sittingOut && p.chips > 0);
    if (activePlayers.length === 2) {
      // Heads up: dealer posts small blind
      const sbIndex = this.dealerIndex;
      const bbIndex = this.nextActivePlayer(sbIndex);
      this.postBlind(sbIndex, this.smallBlind);
      this.postBlind(bbIndex, this.bigBlind);
      this.currentPlayerIndex = sbIndex; // SB acts first preflop in heads up
    } else {
      const sbIndex = this.nextActivePlayer(this.dealerIndex);
      const bbIndex = this.nextActivePlayer(sbIndex);
      this.postBlind(sbIndex, this.smallBlind);
      this.postBlind(bbIndex, this.bigBlind);
      this.currentPlayerIndex = this.nextActivePlayer(bbIndex);
    }

    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    this.lastRaiserIndex = -1;
    this.round = 'preflop';

    // Deal hole cards
    let deckIdx = 0;
    for (const p of this.players) {
      if (!p.sittingOut && p.chips >= 0) {
        p.hand = [this.deck[deckIdx++], this.deck[deckIdx++]];
      }
    }
    // Store remaining deck index for community cards
    this._deckIdx = deckIdx;

    this.broadcast({
      type: 'newHand',
      deckHash: this.deckHash,
      dealer: this.dealerIndex,
    });

    this.broadcastState();
  }

  postBlind(playerIndex, amount) {
    const p = this.players[playerIndex];
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.bet = actual;
    p.totalBet = actual;
    this.pot += actual;
    if (p.chips === 0) p.allIn = true;
  }

  nextActivePlayer(fromIndex) {
    let idx = (fromIndex + 1) % this.players.length;
    let safety = 0;
    while (safety < this.players.length) {
      const p = this.players[idx];
      if (!p.sittingOut && p.chips >= 0 && !p.folded) return idx;
      idx = (idx + 1) % this.players.length;
      safety++;
    }
    return fromIndex;
  }

  handleAction(playerId, action, amount) {
    const playerIdx = this.players.findIndex(p => p.id === playerId);
    if (playerIdx === -1 || playerIdx !== this.currentPlayerIndex) return;
    if (this.state !== 'playing') return;

    const player = this.players[playerIdx];
    if (player.folded || player.allIn) return;

    switch (action) {
      case 'fold':
        player.folded = true;
        this.handHistory.push({ player: player.name, action: 'fold' });
        break;

      case 'check':
        if (player.bet < this.currentBet) {
          player.send({ type: 'error', message: '当前不能过牌，需要跟注或加注' });
          return;
        }
        this.handHistory.push({ player: player.name, action: 'check' });
        break;

      case 'call': {
        const toCall = Math.min(this.currentBet - player.bet, player.chips);
        player.chips -= toCall;
        player.bet += toCall;
        player.totalBet += toCall;
        this.pot += toCall;
        if (player.chips === 0) player.allIn = true;
        this.handHistory.push({ player: player.name, action: 'call', amount: toCall });
        break;
      }

      case 'raise': {
        const raiseAmount = parseInt(amount);
        if (isNaN(raiseAmount)) return;

        // Total bet the player wants to have
        const totalTarget = raiseAmount;
        const needToAdd = totalTarget - player.bet;

        if (needToAdd > player.chips) {
          // All-in
          const allInAmount = player.chips;
          player.bet += allInAmount;
          player.totalBet += allInAmount;
          this.pot += allInAmount;
          player.chips = 0;
          player.allIn = true;
          if (player.bet > this.currentBet) {
            const raiseSize = player.bet - this.currentBet;
            if (raiseSize >= this.minRaise || player.allIn) {
              this.minRaise = Math.max(this.minRaise, raiseSize);
              this.currentBet = player.bet;
              this.lastRaiserIndex = playerIdx;
            }
          }
          this.handHistory.push({ player: player.name, action: 'all-in', amount: allInAmount });
          break;
        }

        // Validate minimum raise
        const raiseSize = totalTarget - this.currentBet;
        if (raiseSize < this.minRaise && needToAdd < player.chips) {
          player.send({ type: 'error', message: `最小加注为 ${this.currentBet + this.minRaise}` });
          return;
        }

        player.chips -= needToAdd;
        player.bet = totalTarget;
        player.totalBet += needToAdd;
        this.pot += needToAdd;
        if (player.chips === 0) player.allIn = true;
        this.minRaise = Math.max(this.minRaise, raiseSize);
        this.currentBet = totalTarget;
        this.lastRaiserIndex = playerIdx;
        this.handHistory.push({ player: player.name, action: 'raise', amount: totalTarget });
        break;
      }

      case 'allin': {
        const allInAmount = player.chips;
        player.bet += allInAmount;
        player.totalBet += allInAmount;
        this.pot += allInAmount;
        player.chips = 0;
        player.allIn = true;
        if (player.bet > this.currentBet) {
          const raiseSize = player.bet - this.currentBet;
          if (raiseSize >= this.minRaise) {
            this.minRaise = raiseSize;
          }
          this.currentBet = player.bet;
          this.lastRaiserIndex = playerIdx;
        }
        this.handHistory.push({ player: player.name, action: 'all-in', amount: allInAmount });
        break;
      }

      default:
        return;
    }

    this.advanceAction();
  }

  advanceAction() {
    // Check if only one player left
    const remaining = this.playersInHand();
    if (remaining.length === 1) {
      this.awardPot([remaining[0]]);
      return;
    }

    // Check if we can still have action
    const canAct = this.playersCanAct();
    const needToAct = canAct.filter(p => p.bet < this.currentBet || (this.lastRaiserIndex === -1 && p.bet === 0 && this.currentBet === 0));

    // Move to next player who can act
    let nextIdx = this.nextActivePlayer(this.currentPlayerIndex);
    let loopCount = 0;
    while (loopCount < this.players.length) {
      const next = this.players[nextIdx];
      if (!next.folded && !next.sittingOut && !next.allIn) {
        // Check if betting round is complete
        if (this.isRoundComplete(nextIdx)) {
          this.nextRound();
          return;
        }
        this.currentPlayerIndex = nextIdx;
        this.broadcastState();
        return;
      }
      nextIdx = this.nextActivePlayer(nextIdx);
      loopCount++;
    }

    // All remaining players are all-in or folded
    this.nextRound();
  }

  isRoundComplete(nextIdx) {
    const activePlayers = this.players.filter(p => !p.folded && !p.sittingOut && !p.allIn);

    // If no one can act, round is complete
    if (activePlayers.length === 0) return true;

    // If only one can act and they've matched the bet, round is complete
    if (activePlayers.length === 1 && activePlayers[0].bet >= this.currentBet) {
      // But on preflop, big blind gets option
      return true;
    }

    // All active players have matched the current bet
    const allMatched = activePlayers.every(p => p.bet === this.currentBet);

    // In preflop, if we've gone around to the last raiser or everyone checked
    if (allMatched) {
      if (this.lastRaiserIndex === -1) {
        // No one raised - check if we've gone around
        // Round complete if next player already had a chance
        if (nextIdx === this.getFirstToAct()) return true;
      } else {
        if (nextIdx === this.lastRaiserIndex) return true;
      }
    }

    return false;
  }

  getFirstToAct() {
    if (this.round === 'preflop') {
      const activePlayers = this.players.filter(p => !p.sittingOut && p.chips >= 0);
      if (activePlayers.length === 2) {
        return this.dealerIndex; // heads up
      }
      const bbIndex = this.nextActivePlayer(this.nextActivePlayer(this.dealerIndex));
      return this.nextActivePlayer(bbIndex);
    }
    return this.nextActivePlayer(this.dealerIndex);
  }

  nextRound() {
    // Reset bets for new round
    for (const p of this.players) {
      p.bet = 0;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastRaiserIndex = -1;

    const remaining = this.playersInHand();
    const canAct = remaining.filter(p => !p.allIn);

    switch (this.round) {
      case 'preflop':
        this.round = 'flop';
        this._deckIdx++; // burn
        this.communityCards.push(
          this.deck[this._deckIdx++],
          this.deck[this._deckIdx++],
          this.deck[this._deckIdx++]
        );
        break;
      case 'flop':
        this.round = 'turn';
        this._deckIdx++; // burn
        this.communityCards.push(this.deck[this._deckIdx++]);
        break;
      case 'turn':
        this.round = 'river';
        this._deckIdx++; // burn
        this.communityCards.push(this.deck[this._deckIdx++]);
        break;
      case 'river':
        this.showdown();
        return;
    }

    // If only one player can act (or zero), run out remaining cards
    if (canAct.length <= 1) {
      // All-in runout - just go to next round immediately
      this.broadcastState();
      setTimeout(() => this.nextRound(), 1500);
      return;
    }

    // Set first to act post-flop (first active player after dealer)
    this.currentPlayerIndex = this.nextActivePlayer(this.dealerIndex);
    // Skip folded and all-in players
    let safety = 0;
    while (safety < this.players.length) {
      const p = this.players[this.currentPlayerIndex];
      if (!p.folded && !p.sittingOut && !p.allIn) break;
      this.currentPlayerIndex = this.nextActivePlayer(this.currentPlayerIndex);
      safety++;
    }

    this.broadcastState();
  }

  showdown() {
    this.state = 'showdown';
    this.round = 'showdown';

    const remaining = this.playersInHand();

    // Evaluate hands
    const results = remaining.map(p => {
      const allCards = [...p.hand, ...this.communityCards];
      const best = evaluateBest5(allCards);
      return { player: p, hand: best };
    });

    // Calculate side pots
    const sidePots = this.calculateSidePots();

    // Award each pot
    const winnings = {};
    for (const p of this.players) winnings[p.id] = 0;

    for (const pot of sidePots) {
      const eligible = results.filter(r =>
        pot.eligible.includes(r.player.id)
      );
      eligible.sort((a, b) => compareHands(b.hand, a.hand));

      // Find winners (might be ties)
      const bestHand = eligible[0].hand;
      const winners = eligible.filter(r => compareHands(r.hand, bestHand) === 0);

      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;

      for (const w of winners) {
        const award = share + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        w.player.chips += award;
        winnings[w.player.id] += award;
      }
    }

    // Build results message
    const showdownResults = results.map(r => ({
      playerId: r.player.id,
      playerName: r.player.name,
      hand: r.player.hand,
      handType: HAND_NAMES[r.hand.type],
      handRank: r.hand.type,
      winnings: winnings[r.player.id],
    }));

    this.broadcast({
      type: 'showdown',
      results: showdownResults,
      deckSalt: this.deckSalt,
      deckOrder: this.deck.join(','),
      deckHash: this.deckHash,
    });

    this.previousDeckInfo = {
      salt: this.deckSalt,
      deck: this.deck.join(','),
      hash: this.deckHash,
    };

    this.broadcastState();
  }

  awardPot(winners) {
    this.state = 'showdown';
    const sidePots = this.calculateSidePots();
    const winnings = {};
    for (const p of this.players) winnings[p.id] = 0;

    for (const pot of sidePots) {
      const eligibleWinners = winners.filter(w => pot.eligible.includes(w.id));
      if (eligibleWinners.length > 0) {
        const share = Math.floor(pot.amount / eligibleWinners.length);
        let remainder = pot.amount - share * eligibleWinners.length;
        for (const w of eligibleWinners) {
          const award = share + (remainder > 0 ? 1 : 0);
          remainder = Math.max(0, remainder - 1);
          w.chips += award;
          winnings[w.id] += award;
        }
      } else {
        // Return to eligible players equally
        const share = Math.floor(pot.amount / pot.eligible.length);
        let remainder = pot.amount - share * pot.eligible.length;
        for (const eid of pot.eligible) {
          const p = this.players.find(pl => pl.id === eid);
          if (p) {
            const award = share + (remainder > 0 ? 1 : 0);
            remainder = Math.max(0, remainder - 1);
            p.chips += award;
            winnings[p.id] += award;
          }
        }
      }
    }

    this.broadcast({
      type: 'handWon',
      winners: winners.map(w => ({
        playerId: w.id,
        playerName: w.name,
        winnings: winnings[w.id],
      })),
      deckSalt: this.deckSalt,
      deckOrder: this.deck.join(','),
      deckHash: this.deckHash,
    });

    this.previousDeckInfo = {
      salt: this.deckSalt,
      deck: this.deck.join(','),
      hash: this.deckHash,
    };

    this.broadcastState();
  }

  calculateSidePots() {
    const inHand = this.players.filter(p => !p.sittingOut);
    const bets = inHand.map(p => ({ id: p.id, totalBet: p.totalBet, folded: p.folded }));
    bets.sort((a, b) => a.totalBet - b.totalBet);

    const pots = [];
    let processed = 0;

    const uniqueBets = [...new Set(bets.map(b => b.totalBet))].sort((a, b) => a - b);

    for (const level of uniqueBets) {
      if (level <= processed) continue;
      const contribution = level - processed;
      let potAmount = 0;
      const eligible = [];

      for (const b of bets) {
        if (b.totalBet > processed) {
          potAmount += Math.min(contribution, b.totalBet - processed);
        }
        if (b.totalBet >= level && !b.folded) {
          eligible.push(b.id);
        }
      }

      if (potAmount > 0) {
        pots.push({ amount: potAmount, eligible });
      }
      processed = level;
    }

    // If no pots generated, create one main pot
    if (pots.length === 0) {
      pots.push({
        amount: this.pot,
        eligible: this.playersInHand().map(p => p.id),
      });
    }

    return pots;
  }

  setChips(playerId, amount) {
    const p = this.players.find(pl => pl.id === playerId);
    if (p) {
      p.chips = amount;
      p.sittingOut = false;
    }
  }
}

// ============================================================
// Server
// ============================================================

const rooms = new Map();
const playerRooms = new Map(); // playerId -> roomCode

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res);
  } else if (req.url === '/favicon.ico') {
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let playerId = null;
  let playerName = null;
  let roomCode = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'createRoom': {
        playerId = crypto.randomBytes(8).toString('hex');
        playerName = (msg.name || '玩家').slice(0, 12);
        roomCode = generateRoomCode();

        const room = new Room(roomCode, playerId);
        const player = new Player(playerId, playerName, ws);
        room.addPlayer(player);
        rooms.set(roomCode, room);
        playerRooms.set(playerId, roomCode);

        ws.send(JSON.stringify({
          type: 'roomCreated',
          roomCode,
          playerId,
          playerName,
        }));

        room.broadcastState();
        break;
      }

      case 'joinRoom': {
        const code = (msg.roomCode || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        if (room.players.length >= 9) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
          return;
        }

        playerId = crypto.randomBytes(8).toString('hex');
        playerName = (msg.name || '玩家').slice(0, 12);
        roomCode = code;

        const player = new Player(playerId, playerName, ws);
        room.addPlayer(player);
        playerRooms.set(playerId, roomCode);

        ws.send(JSON.stringify({
          type: 'roomJoined',
          roomCode,
          playerId,
          playerName,
        }));

        room.broadcast({
          type: 'playerJoined',
          playerName,
          playerCount: room.players.length,
        });

        room.broadcastState();
        break;
      }

      case 'rejoin': {
        const code = (msg.roomCode || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        const existing = room.players.find(p => p.id === msg.playerId);
        if (!existing) {
          ws.send(JSON.stringify({ type: 'error', message: '玩家不在房间中' }));
          return;
        }

        playerId = existing.id;
        playerName = existing.name;
        roomCode = code;
        existing.ws = ws;
        existing.connected = true;

        ws.send(JSON.stringify({
          type: 'roomJoined',
          roomCode,
          playerId,
          playerName,
        }));

        room.broadcastState();
        break;
      }

      case 'startGame': {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (playerId !== room.hostId) {
          ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
          return;
        }
        room.startHand();
        break;
      }

      case 'action': {
        const room = rooms.get(roomCode);
        if (!room) return;
        room.handleAction(playerId, msg.action, msg.amount);
        break;
      }

      case 'nextHand': {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (playerId !== room.hostId) {
          ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始下一手' }));
          return;
        }
        room.startHand();
        break;
      }

      case 'setChips': {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (playerId !== room.hostId) {
          ws.send(JSON.stringify({ type: 'error', message: '只有房主可以设置筹码' }));
          return;
        }
        const targetId = msg.targetId || playerId;
        const amount = parseInt(msg.amount);
        if (isNaN(amount) || amount < 0) return;
        room.setChips(targetId, amount);
        room.broadcastState();
        break;
      }

      case 'setBlinds': {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (playerId !== room.hostId) {
          ws.send(JSON.stringify({ type: 'error', message: '只有房主可以设置盲注' }));
          return;
        }
        const sb = parseInt(msg.smallBlind);
        const bb = parseInt(msg.bigBlind);
        if (isNaN(sb) || isNaN(bb) || sb <= 0 || bb <= 0) return;
        room.smallBlind = sb;
        room.bigBlind = bb;
        room.broadcastState();
        break;
      }

      case 'forceRestart': {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (playerId !== room.hostId) {
          ws.send(JSON.stringify({ type: 'error', message: '只有房主可以重新开始' }));
          return;
        }
        // Reset to waiting state so host can start fresh
        room.state = 'waiting';
        for (const p of room.players) {
          p.hand = [];
          p.bet = 0;
          p.totalBet = 0;
          p.folded = false;
          p.allIn = false;
          if (p.chips <= 0) p.chips = 1000; // auto rebuy
        }
        room.communityCards = [];
        room.pot = 0;
        room.currentBet = 0;
        room.round = '';
        room.broadcast({ type: 'newHand' });
        room.broadcastState();
        break;
      }

      case 'chat': {
        const room = rooms.get(roomCode);
        if (!room) return;
        room.broadcast({
          type: 'chat',
          playerName,
          message: (msg.message || '').slice(0, 200),
        });
        break;
      }

      case 'kickPlayer': {
        const room = rooms.get(roomCode);
        if (!room) return;
        if (playerId !== room.hostId) return;
        const target = room.players.find(p => p.id === msg.targetId);
        if (target && target.id !== room.hostId) {
          target.send({ type: 'kicked' });
          room.removePlayer(target.id);
          playerRooms.delete(target.id);
          room.broadcastState();
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (roomCode && playerId) {
      const room = rooms.get(roomCode);
      if (room) {
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          player.connected = false;
          player.ws = null;
          room.broadcastState();

          // Clean up empty rooms after delay
          setTimeout(() => {
            const room = rooms.get(roomCode);
            if (room && room.players.every(p => !p.connected)) {
              rooms.delete(roomCode);
            }
          }, 300000); // 5 minutes
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`德扑服务器运行在 http://localhost:${PORT}`);
});
