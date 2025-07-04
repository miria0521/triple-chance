const socket = io();
let myName = "";
let currentRoom = "";
let isMyTurn = false;

// 🔸 ルーム作成
document.getElementById("createBtn").onclick = () => {
  myName = document.getElementById("playerName").value;
  const roomId = document.getElementById("createRoomId").value;
  const maxPlayers = parseInt(document.getElementById("maxPlayers").value);
  if (!myName || !roomId) return alert("名前とルームIDを入力してください");
  socket.emit("createRoom", { roomId, playerName: myName, maxPlayers });
};

// 🔸 キャンセル
document.getElementById("cancelBtn").onclick = () => {
  socket.emit("cancelRoom", currentRoom);
  location.reload();
};

// 🔸 ルーム参加
document.getElementById("joinBtn").onclick = () => {
  myName = document.getElementById("playerName").value;
  const roomId = document.getElementById("createRoomId").value;
  if (!roomId) return;
  if (!myName) {
    document.getElementById("errorMsg").innerText = "プレイヤー名を入力してください";
    return;
  }
  socket.emit("joinRoom", { roomId, playerName: myName });
};

// 🔸 ルーム一覧をクリックで入力補助
function joinRoom(roomId) {
  document.getElementById("createRoomId").value = roomId;
}

// 🔸 ルーム一覧表示
socket.on("roomList", (list) => {
  const listDiv = document.getElementById("roomList");
  listDiv.innerHTML = "";
  list.forEach(room => {
    const div = document.createElement("div");
    div.className = "room-entry";
    div.innerHTML = `
      <strong>ルームID:</strong> ${room.roomId}<br>
      <strong>ホスト:</strong> ${room.host}<br>
      <strong>人数:</strong> ${room.current}/${room.max}
      <br><button onclick="joinRoom('${room.roomId}')">このルームを選択</button>
    `;
    listDiv.appendChild(div);
  });
});

// 🔸 ルームに入ったときの処理
socket.on("roomJoined", ({ roomId, players, maxPlayers, hostId }) => {
  currentRoom = roomId;
  const isHost = socket.id === hostId;
  document.getElementById("lobby").style.display = "none";
  document.getElementById("waitingRoom").style.display = "block";
  document.getElementById("roomInfo").innerText = `ルームID: ${roomId}（${players.length}/${maxPlayers}人）`;
  document.getElementById("playersList").innerText = `参加者: ${players.map(p => p.name).join("、")}`;
  document.getElementById("startArea").style.display = (players.length === maxPlayers && isHost) ? "block" : "none";
});

// 🔸 同じルーム名
socket.on("roomExists", () => alert("このルームIDは既に存在します"));
socket.on("joinFailed", msg => alert(msg));

// 🔸 ゲーム開始
document.getElementById("startGameBtn").onclick = () => {
  socket.emit("startGame", currentRoom);
  document.getElementById("waitingRoom").style.display = "none";
  document.getElementById("gameArea").style.display = "block";
};

// 🔸 手札受信
socket.on("yourHand", (cards) => {
  const container = document.getElementById("yourCards");
  container.innerHTML = "";
  cards.forEach(card => {
    const div = document.createElement("div");
    div.className = "card";
    div.textContent = card;
    container.appendChild(div);
  });
});

// 🔸 ターン通知
socket.on("startTurn", ({ playerName, playerId }) => {
  isMyTurn = socket.id === playerId;
  document.getElementById("turnInfo").textContent = isMyTurn ? "あなたのターンです！" : `${playerName} のターン`;
  document.getElementById("rollBtn").disabled = !isMyTurn;
});

// 🔸 サイコロ演出
document.getElementById("rollBtn").onclick = () => {
  if (!isMyTurn) return;
  const dice = document.getElementById("diceResult");
  dice.classList.add("dice-rolling");
  dice.textContent = "🎲";
  setTimeout(() => {
    socket.emit("rollDice", currentRoom);
  }, 1000);
};

socket.on("diceRolled", (value, name) => {
  const dice = document.getElementById("diceResult");
  dice.classList.remove("dice-rolling");
  dice.textContent = `🎲 ${value}`;
});

// 🔸 アクションログ
socket.on("actionLog", (msg) => {
  const log = document.getElementById("gameLog");
  const p = document.createElement("p");
  p.textContent = msg;
  log.prepend(p);
});

// 🔸 手札枚数表示
socket.on("handCounts", (list) => {
  const ul = document.getElementById("handCountsList");
  ul.innerHTML = "";
  list.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.name}: ${p.count}枚`;
    ul.appendChild(li);
  });
});

// 🔸 防御通知
socket.on("askDefense", ({ from, count }) => {
  document.getElementById("defenseArea").style.display = "block";
  document.getElementById("defenseMessage").textContent = `${from} に ${count}枚 奪われそう！防御する？`;
  const handElems = document.querySelectorAll("#yourCards .card");
  const counts = {};
  handElems.forEach(card => {
    const val = parseInt(card.textContent);
    counts[val] = (counts[val] || 0) + 1;
  });
  const options = document.getElementById("defenseOptions");
  options.innerHTML = "";
  Object.keys(counts).forEach(val => {
    if (counts[val] >= 2) {
      const btn = document.createElement("button");
      btn.textContent = `${val}を2枚で防御`;
      btn.onclick = () => {
        socket.emit("defend", { roomId: currentRoom, cardValue: parseInt(val) });
        document.getElementById("defenseArea").style.display = "none";
      };
      options.appendChild(btn);
    }
  });
});

// 🔸 防御しない
document.getElementById("noDefenseBtn").onclick = () => {
  socket.emit("noDefense", currentRoom);
  document.getElementById("defenseArea").style.display = "none";
};

// 🔸 勝利表示
socket.on("gameWon", (msg) => {
  const log = document.getElementById("gameLog");
  const p = document.createElement("p");
  p.innerHTML = `<strong style="color: green;">${msg}</strong>`;
  log.prepend(p);
  document.getElementById("rollBtn").disabled = true;
  isMyTurn = false;
  document.getElementById("endGameControls").style.display = "block";
  document.getElementById("restartBtn").style.display = "inline-block";
});

// 🔸 途中退出
socket.on("playerLeft", (name) => {
  const log = document.getElementById("gameLog");
  const p = document.createElement("p");
  p.innerHTML = `<span style="color: red;">${name} が途中で抜けました。ゲームは終了扱いです。</span>`;
  log.prepend(p);
  document.getElementById("rollBtn").disabled = true;
  isMyTurn = false;
  document.getElementById("endGameControls").style.display = "block";
  document.getElementById("restartBtn").style.display = "none";
});

// 🔸 リスタート
document.getElementById("restartBtn").onclick = () => {
  socket.emit("restartGame", currentRoom);
  document.getElementById("endGameControls").style.display = "none";
  document.getElementById("gameLog").innerHTML = "";
  document.getElementById("yourCards").innerHTML = "";
  document.getElementById("handCountsList").innerHTML = "";
  document.getElementById("diceResult").textContent = "🎲 ?";
};

// 🔸 終了ボタン
document.getElementById("exitBtn").onclick = () => {
  location.reload();
};
