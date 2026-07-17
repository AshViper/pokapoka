/**
 * PeerJS ルーム管理（オーナー制）
 * オーナーがルームを作り、他のプレイヤーが入室する
 * ID 形式: NET-XXXX
 */

// ===== UI 参照 =====
const myIdDiv = document.getElementById('myId');
const roomIdSpan = document.getElementById('roomId');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinInput = document.getElementById('joinInput');
const joinBtn = document.getElementById('joinBtn');
const statusDiv = document.getElementById('status');
const playerListEl = document.getElementById('playerList');
const startGameBtnArea = document.getElementById('startGameBtnArea');

// ===== 状態 =====
let isOwner = false;
let myPeerId = '';
const connections = new Map();     // peerId → DataConnection (owner only)
let hostConn = null;               // 入室者のホスト接続 (non-owner only)
const playerData = [];             // { id, chips, debt }

// ===== 参加受付フラグ =====
let allowJoins = true;
function setAllowJoins(v) { allowJoins = v; }

// ===== コールバック =====
let onPokerMessage = null;  // (msg, senderId) => void
function setOnPokerMessage(cb) { onPokerMessage = cb; }

// ===== 送信 =====
function sendToPlayer(peerId, msg) {
  const conn = connections.get(peerId);
  if (conn && conn.open) conn.send({ _type: 'poker', ...msg });
}
function broadcastToPlayers(msg) {
  for (const [pid, conn] of connections) {
    if (conn.open) conn.send({ _type: 'poker', ...msg });
  }
}
function sendToHost(msg) {
  if (hostConn && hostConn.open) hostConn.send({ _type: 'poker', ...msg });
}
// owner → 全員, non-owner → host
function sendPokerMessage(msg) {
  if (isOwner) broadcastToPlayers(msg);
  else sendToHost(msg);
}
function sendPokerMessageTo(targetId, msg) {
  if (isOwner) sendToPlayer(targetId, msg);
}

// ===== ログ =====
function addLog(text) {
  const el = document.getElementById('logArea');
  const div = document.createElement('div'); div.textContent = text;
  el.appendChild(div); el.scrollTop = el.scrollHeight;
}

// ===== NET-XXXX =====
const randomSuffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
const myId = 'NET-' + randomSuffix;

// ===== Peer =====
const peer = new Peer(myId);

peer.on('open', (id) => {
  myPeerId = id;
  myIdDiv.textContent = id;
  roomIdSpan.textContent = id;
  statusDiv.textContent = 'ルームを作成するか、IDを入力して入室してください';
  addLog('あなたのID: ' + id);
});

// ===== ルーム作成 =====
createRoomBtn.addEventListener('click', () => {
  if (isOwner) return;
  isOwner = true;
  createRoomBtn.disabled = true;
  joinBtn.disabled = true;
  joinInput.disabled = true;
  playerData.push({ id: myPeerId, chips: 60, debt: 0 });
  updatePlayerList();
  startGameBtnArea.style.display = 'block';
  addLog('ルームを作成しました。ID: ' + myPeerId);
  statusDiv.textContent = '参加者を待っています... (' + myPeerId + ')';
});

// ===== 入室 =====
joinBtn.addEventListener('click', () => {
  const targetId = joinInput.value.trim();
  if (!targetId) return;
  if (targetId === myPeerId) { addLog('自分には接続できません'); return; }
  statusDiv.textContent = '接続中...';
  const conn = peer.connect(targetId, { reliable: true });

  conn.on('open', () => {
    hostConn = conn;
    isOwner = false;
    createRoomBtn.disabled = true;
    joinBtn.disabled = true;
    joinInput.disabled = true;
    addLog('ルーム ' + targetId + ' に入室しました');
    statusDiv.textContent = '入室済み: ' + targetId;
    conn.send({ _type: 'poker', action: 'joinRoom', playerId: myPeerId });
  });

  conn.on('data', (data) => {
    if (data && data._type === 'poker' && onPokerMessage) {
      onPokerMessage(data, targetId);
    }
  });

  conn.on('close', () => {
    addLog('ホストとの接続が切れました');
    hostConn = null; statusDiv.textContent = '切断されました';
  });

  conn.on('error', () => { addLog('接続失敗'); statusDiv.textContent = '接続失敗'; });
});

// ===== 接続受付（owner のみ） =====
peer.on('connection', (conn) => {
  if (!isOwner || !allowJoins) return;

  conn.on('data', (data) => {
    if (!data || typeof data !== 'object' || data._type !== 'poker') return;

    if (data.action === 'joinRoom') {
      const pid = data.playerId || conn.peer;
      if (!connections.has(pid)) {
        connections.set(pid, conn);
        playerData.push({ id: pid, chips: 60, debt: 0 });
        addLog(pid + ' が入室しました');
        updatePlayerList();
        broadcastRoomState();
      }
    } else {
      if (onPokerMessage) onPokerMessage(data, conn.peer);
    }
  });

  conn.on('close', () => {
    const pid = conn.peer;
    if (connections.has(pid)) {
      connections.delete(pid);
      const idx = playerData.findIndex(p => p.id === pid);
      if (idx >= 0) playerData.splice(idx, 1);
      addLog(pid + ' が退出しました');
      updatePlayerList();
      broadcastRoomState();
    }
  });
});

// ===== ルーム状態通知 =====
function broadcastRoomState() {
  const msg = { action: 'roomState', players: playerData.map(p => ({ id: p.id, chips: p.chips, debt: p.debt })) };
  if (isOwner) broadcastToPlayers(msg);
  updatePlayerList();
}

// ===== UI =====
function updatePlayerList() {
  playerListEl.innerHTML = '';
  for (const p of playerData) {
    const d = document.createElement('div');
    d.className = 'player-item';
    const isMe = p.id === myPeerId;
    d.innerHTML = (isMe ? '★ 自分' : '● ' + p.id) +
      ' <span class="chips">' + p.chips + '</span>' +
      (p.debt > 0 ? ' <span class="debt">借金:' + p.debt + '</span>' : '');
    playerListEl.appendChild(d);
  }
}

// ===== 外部公開 =====
window.sendPokerMessage = sendPokerMessage;
window.sendPokerMessageTo = sendPokerMessageTo;
window.sendToHost = sendToHost;
window.broadcastToPlayers = broadcastToPlayers;
window.isOwnerFn = () => isOwner;
window.getPlayerData = () => playerData;
window.getMyId = () => myPeerId;
window.addLog = addLog;
window.setOnPokerMessage = setOnPokerMessage;
window.setAllowJoins = setAllowJoins;
