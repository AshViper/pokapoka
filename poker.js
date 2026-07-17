/**
 * テキサスホールデムポーカー ゲームロジック（複数人対応）
 * ローカルルール:
 *   初期金 60 / Dは掛け金なし / BB=10 / SB=BBの半分=5
 *   オールベット負けで借金-60してリスタート
 */

// ========== カード ==========
const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_LIST = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = { 2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14 };

class Card {
  constructor(suit, rank) {
    this.suit = suit;
    this.rank = rank;
    this.value = RANK_VAL[rank];
  }
  toObj() { return { suit: this.suit, rank: this.rank }; }
  static fromObj(o) { return new Card(o.suit, o.rank); }
}

class Deck {
  constructor() {
    this.cards = [];
    for (const s of SUITS)
      for (const r of RANK_LIST)
        this.cards.push(new Card(s, r));
  }
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.random() * (i + 1) | 0;
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
  deal() { return this.cards.pop(); }
}

// ========== 役判定 ==========
function combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [f, ...r] = arr;
  return [...combos(r, k - 1).map(c => [f, ...c]), ...combos(r, k)];
}

function eval5(cards) {
  const v = cards.map(c => c.value).sort((a, b) => b - a);
  const flush = cards.every(c => c.suit === cards[0].suit);
  let straight = false, high = v[0];
  if (new Set(v).size === 5 && v[0] - v[4] === 4) straight = true;
  else if (v[0] === 14 && v[1] === 5 && v[2] === 4 && v[3] === 3 && v[4] === 2) {
    straight = true; high = 5;
  }
  const map = {};
  v.forEach(x => map[x] = (map[x] || 0) + 1);
  const g = Object.entries(map).map(([v, c]) => ({ v: +v, c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);

  if (flush && straight && high === 14) return { rank: 9, name: 'ロイヤルフラッシュ', kickers: [14] };
  if (flush && straight)                return { rank: 8, name: 'ストレートフラッシュ', kickers: [high] };
  if (g[0].c === 4)                     return { rank: 7, name: 'フォーカード', kickers: [g[0].v, g[1].v] };
  if (g[0].c === 3 && g[1].c === 2)     return { rank: 6, name: 'フルハウス', kickers: [g[0].v, g[1].v] };
  if (flush)                            return { rank: 5, name: 'フラッシュ', kickers: v };
  if (straight)                         return { rank: 4, name: 'ストレート', kickers: [high] };
  if (g[0].c === 3)                     return { rank: 3, name: 'スリーカード', kickers: [g[0].v, g[1].v, g[2].v] };
  if (g[0].c === 2 && g[1].c === 2)     return { rank: 2, name: 'ツーペア', kickers: [g[0].v, g[1].v, g[2].v] };
  if (g[0].c === 2)                     return { rank: 1, name: 'ワンペア', kickers: [g[0].v, g[1].v, g[2].v, g[3].v] };
  return { rank: 0, name: 'ハイカード', kickers: v };
}

function evaluateHand(cards) {
  let best = null;
  for (const c of combos(cards, 5)) {
    const r = eval5(c);
    if (!best || compareHands(r, best) > 0) best = r;
  }
  return best;
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < a.kickers.length; i++) {
    if (a.kickers[i] !== b.kickers[i]) return a.kickers[i] - b.kickers[i];
  }
  return 0;
}

// ========== ゲーム管理 ==========
const SB = 5;
const BB = 10;
const START_CHIPS = 60;
const DEBT_PENALTY = 60;

class PokerGame {
  /**
   * @param {string[]} playerIds - 参加者ID配列 [0]=オーナー
   */
  constructor(playerIds) {
    this.players = playerIds.map((id, i) => ({
      id,
      chips: START_CHIPS,
      hole: [],
      bet: 0,
      folded: false,
      acted: false,
      totalBet: 0,
      allIn: false,
      debt: 0,
      seatIndex: i
    }));
    this.communityCards = [];
    this.pot = 0;
    this.phase = 'waiting';  // waiting / preflop / flop / turn / river / showdown
    this.currentPlayer = 0;
    this.currentBet = 0;
    this.dealer = 0;
    this.handNum = 0;
    this.handOver = false;
    this.winner = null;
    this.lastAggressor = -1;
  }

  /** アクティブなプレイヤー（フォールド・オールインしてない） */
  get activePlayers() {
    return this.players.filter(p => !p.folded && !p.allIn);
  }

  /** 新しいハンドを開始 */
  startHand() {
    this.handNum++;
    this.deck = new Deck();
    this.deck.shuffle();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.handOver = false;
    this.winner = null;
    this.lastAggressor = -1;
    this.players.forEach(p => {
      p.hole = []; p.bet = 0; p.folded = false; p.acted = false; p.allIn = false;
    });

    const N = this.players.length;
    this.dealer = (this.handNum - 1) % N;

    // ブラインド支払い
    if (N === 2) {
      // ヘッズアップ: D=掛け金なし、もう一人=BB
      this.postBlind((this.dealer + 1) % N, BB);
    } else {
      this.postBlind((this.dealer + 1) % N, SB);  // SB
      this.postBlind((this.dealer + 2) % N, BB);  // BB
    }

    // ホールカード配布
    for (const p of this.players) {
      p.hole = [this.deck.deal(), this.deck.deal()];
    }

    this.phase = 'preflop';
    // プリフロップは BB の次のプレイヤーから
    const bbIdx = N === 2 ? (this.dealer + 1) % N : (this.dealer + 2) % N;
    this.currentPlayer = this.nextActiveFrom(bbIdx);
  }

  postBlind(idx, amount) {
    const p = this.players[idx];
    const actual = Math.min(amount, Math.max(0, p.chips));
    p.chips -= actual;
    p.bet = actual;
    p.totalBet += actual;
    this.pot += actual;
    this.currentBet = Math.max(this.currentBet, actual);
  }

  /** fromIdx の次のアクティブプレイヤーを返す */
  nextActiveFrom(fromIdx) {
    const N = this.players.length;
    for (let i = 1; i <= N; i++) {
      const idx = (fromIdx + i) % N;
      if (!this.players[idx].folded && !this.players[idx].allIn) return idx;
    }
    return fromIdx;
  }

  /** 指定プレイヤーが取れるアクション一覧 */
  getValidActions(pidx) {
    const p = this.players[pidx];
    if (!p || p.folded || p.allIn) return [];
    const toCall = this.currentBet - p.bet;
    const acts = ['fold'];
    if (toCall === 0) {
      acts.push('check');
      if (p.chips >= BB) acts.push('raise'); // Raise が Bet の代わり
    } else {
      if (p.chips >= toCall) acts.push('call');
      // オールインでもコール扱い
      if (p.chips > 0 && !acts.includes('call')) acts.push('call');
      if (p.chips > toCall) acts.push('raise');
    }
    return acts;
  }

  getMinBet(pidx) {
    const p = this.players[pidx];
    if (this.currentBet === 0) return BB;
    return Math.min(this.currentBet + BB, p.chips + p.bet);
  }

  /** プレイヤーのアクションを処理 */
  processAction(pidx, action, amount) {
    const p = this.players[pidx];
    if (p.folded || p.allIn) return;

    if (action === 'fold') {
      p.folded = true;
      p.acted = true;
      if (this.activePlayers.length <= 1) {
        this.handOver = true;
        const winner = this.activePlayers[0];
        if (winner) {
          winner.chips += this.pot;
          this.winner = { winner: winner.id, winnerIdx: winner.seatIndex, hand: null, handName: 'フォールド', pot: this.pot };
        }
        return;
      }
      this.currentPlayer = this.nextActiveFrom(pidx);
      return;
    }

    if (action === 'check') {
      p.acted = true;
    }

    if (action === 'call') {
      const callAmount = Math.min(this.currentBet - p.bet, p.chips);
      p.chips -= callAmount;
      p.bet += callAmount;
      this.pot += callAmount;
      p.acted = true;
      if (p.chips <= 0) p.allIn = true;
    }

    if (action === 'bet' || action === 'raise') {
      const desiredAdd = amount - p.bet;
      const actualAdd = Math.min(desiredAdd, Math.max(0, p.chips));
      p.chips -= actualAdd;
      p.bet += actualAdd;
      this.currentBet = Math.max(this.currentBet, p.bet);
      this.pot += actualAdd;
      p.acted = true;
      this.lastAggressor = pidx;
      if (p.chips <= 0) p.allIn = true;
      // 他のアクティブプレイヤーの acted をリセット
      for (const op of this.players) {
        if (op !== p && !op.folded && !op.allIn) op.acted = false;
      }
    }

    // 本来はここで checked if round over
    if (this.isRoundOver()) {
      this.advancePhase();
    } else {
      this.currentPlayer = this.nextActiveFrom(pidx);
    }
  }

  /** ベッティングラウンド終了判定 */
  isRoundOver() {
    const active = this.activePlayers;
    if (active.length <= 1) return true;
    const betsEq = active.every(p => p.bet === this.currentBet);
    const allActed = active.every(p => p.acted);
    if (!betsEq || !allActed) return false;
    if (this.lastAggressor === -1) return true;
    const ag = this.players[this.lastAggressor];
    return !ag || ag.folded || ag.acted;
  }

  /** 次のフェーズへ */
  advancePhase() {
    this.players.forEach(p => { p.bet = 0; p.acted = false; });
    this.currentBet = 0;
    this.lastAggressor = -1;

    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this.communityCards.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
    } else if (this.phase === 'flop') {
      this.phase = 'turn';
      this.communityCards.push(this.deck.deal());
    } else if (this.phase === 'turn') {
      this.phase = 'river';
      this.communityCards.push(this.deck.deal());
    } else {
      this.phase = 'showdown';
      this.doShowdown();
      this.handOver = true;
      return;
    }
    // ポストフロップは D の次のアクティブプレイヤーから
    this.currentPlayer = this.nextActiveFrom(this.dealer);
  }

  /** ショーダウン */
  doShowdown() {
    const results = this.players.map(p => ({
      id: p.id,
      hand: p.folded || p.hole.length === 0 ? null : evaluateHand([...p.hole, ...this.communityCards])
    }));

    let best = null;
    let bestPlayers = [];
    for (const r of results) {
      if (!r.hand) continue;
      if (!best || compareHands(r.hand, best) > 0) {
        best = r.hand;
        bestPlayers = [r];
      } else if (compareHands(r.hand, best) === 0) {
        bestPlayers.push(r);
      }
    }

    if (bestPlayers.length === 0) return;

    if (bestPlayers.length === 1) {
      const winner = bestPlayers[0];
      const wi = this.players.findIndex(p => p.id === winner.id);
      this.players[wi].chips += this.pot;
      this.winner = { winner: winner.id, winnerIdx: wi, hand: best, handName: best.name, pot: this.pot };
    } else {
      const split = Math.floor(this.pot / bestPlayers.length);
      let rem = this.pot;
      for (const bp of bestPlayers) {
        const wi = this.players.findIndex(p => p.id === bp.id);
        const share = bestPlayers.indexOf(bp) === bestPlayers.length - 1 ? rem : split;
        this.players[wi].chips += share;
        rem -= share;
      }
      this.winner = { winner: null, winnerIdx: -1, hand: best, handName: best.name + ' (引き分け)', pot: this.pot, split: true };
    }

    // 借金処理: オールインして負けたプレイヤー
    for (const p of this.players) {
      if (p.allIn && !p.folded) {
        // 勝者に含まれているか確認
        const isWinner = this.winner && (this.winner.winner === p.id || (this.winner.split && bestPlayers.some(bp => bp.id === p.id)));
        if (!isWinner) {
          p.debt += DEBT_PENALTY;
          p.chips = START_CHIPS;
        }
      }
    }
  }

  /** 指定プレイヤー用の公開状態を生成 */
  getStateForPlayer(pidx) {
    const isOwner = pidx === 0;
    const showAllCards = isOwner; // オーナーは全員のカードを見られる
    return {
      handNum: this.handNum,
      phase: this.phase,
      pot: this.pot,
      currentBet: this.currentBet,
      communityCards: this.communityCards.map(c => c.toObj()),
      currentPlayer: this.currentPlayer,
      handOver: this.handOver,
      winner: this.winner ? { ...this.winner } : null,
      players: this.players.map((p, i) => ({
        id: p.id,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        debt: p.debt,
        holeCount: p.hole.length,
        hole: (showAllCards || i === pidx) ? p.hole.map(c => c.toObj()) : null,
        hand: (showAllCards || i === pidx) && this.phase === 'showdown' && p.hole.length > 0 ?
          evaluateHand([...p.hole, ...this.communityCards]) : null
      })),
      yourIndex: pidx,
      yourTurn: this.currentPlayer === pidx && !this.handOver,
      validActions: pidx === this.currentPlayer && !this.handOver ? this.getValidActions(pidx) : [],
      minBet: pidx === this.currentPlayer && !this.handOver ? this.getMinBet(pidx) : 0,
      dealer: this.dealer,
      blinds: this.getBlindPositions()
    };
  }

  getBlindPositions() {
    const N = this.players.length;
    if (N === 2) {
      return { dealer: this.dealer, sb: -1, bb: (this.dealer + 1) % N };
    }
    return {
      dealer: this.dealer,
      sb: (this.dealer + 1) % N,
      bb: (this.dealer + 2) % N
    };
  }
}
