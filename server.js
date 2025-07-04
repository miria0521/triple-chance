const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

let rooms = {};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateDeck() {
  const deck = [];
  for (let i = 1; i <= 10; i++) {
    for (let j = 0; j < 4; j++) deck.push(i);
  }
  return shuffle(deck);
}

io.on("connection", (socket) => {
  socket.emit("roomList", getRoomList());

  socket.on("createRoom", ({ roomId, playerName, maxPlayers }) => {
    if (rooms[roomId]) {
      socket.emit("roomExists");
      return;
    }
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName }],
      maxPlayers,
      started: false,
      ended: false
    };
    socket.join(roomId);
    io.emit("roomList", getRoomList());
    socket.emit("roomJoined", {
      roomId,
      players: rooms[roomId].players,
      maxPlayers,
      hostId: socket.id
    });
  });

  socket.on("joinRoom", ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room || room.started && room.ended) {
      socket.emit("joinFailed", "このルームには参加できません");
      return;
    }

    const existing = room.players.find(p => p.name === playerName);
    if (existing) {
      existing.id = socket.id;
      socket.join(roomId);
      io.to(roomId).emit("actionLog", `${playerName} が再接続しました！`);
      io.to(socket.id).emit("yourHand", existing.hand);
      updateHandCounts(roomId);
      const current = room.players[room.turnIndex];
      io.to(roomId).emit("startTurn", {
        playerName: current.name,
        playerId: current.id
      });
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("joinFailed", "このルームは満員です");
      return;
    }

    const player = { id: socket.id, name: playerName, hand: [] };
    room.players.push(player);
    socket.join(roomId);
    io.emit("roomList", getRoomList());
    io.to(roomId).emit("roomJoined", {
      roomId,
      players: room.players,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId
    });
    if (room.players.length === room.maxPlayers) {
      io.to(room.hostId).emit("showStartButton");
    }
  });

  socket.on("cancelRoom", (roomId) => {
    if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
      delete rooms[roomId];
      io.emit("roomList", getRoomList());
    }
  });

  socket.on("startGame", (roomId) => {
    const room = rooms[roomId];
    if (!room || room.started) return;
    room.started = true;
    room.deck = generateDeck();
    room.players.forEach(p => {
      p.hand = room.deck.splice(0, 3);
    });
    room.players = shuffle(room.players);
    room.turnIndex = 0;
    room.ended = false;
    room.players.forEach(p => {
      io.to(p.id).emit("yourHand", p.hand);
    });
    io.to(roomId).emit("startTurn", {
      playerName: room.players[0].name,
      playerId: room.players[0].id
    });
    updateHandCounts(roomId);
  });

  socket.on("rollDice", (roomId) => {
    const room = rooms[roomId];
    if (!room || room.ended) return;
    const player = room.players[room.turnIndex];
    if (player.id !== socket.id) return;

    const dice = Math.floor(Math.random() * 6) + 1;
    io.to(roomId).emit("diceRolled", dice, player.name);

    if (dice % 2 === 1) {
      const drawn = room.deck.splice(0, dice);
      player.hand.push(...drawn);
      io.to(player.id).emit("yourHand", player.hand);
      io.to(roomId).emit("actionLog", `${player.name} は山札から ${dice}枚 引いた`);
      if (checkVictory(roomId)) return;
      updateHandCounts(roomId);
      nextTurn(roomId);
    } else {
      const targets = room.players.filter(p => p.id !== player.id && p.hand.length > 0);
      if (targets.length === 0) {
        io.to(roomId).emit("actionLog", `${player.name} は奪う相手がいない…`);
        nextTurn(roomId);
        return;
      }
      const target = targets[Math.floor(Math.random() * targets.length)];
      const canDefend = target.hand.some(val => target.hand.filter(x => x === val).length >= 2);
      io.to(roomId).emit("actionLog", `${player.name} は ${target.name} を選んだ！`);
      if (canDefend) {
        io.to(target.id).emit("askDefense", { from: player.name, count: dice });
        room.pendingDefense = {
          targetId: target.id,
          fromId: player.id,
          count: dice,
          timeout: setTimeout(() => {
            stealCards(roomId, player, target, dice);
          }, 10000)
        };
      } else {
        stealCards(roomId, player, target, dice);
      }
    }
  });

  socket.on("defend", ({ roomId, cardValue }) => {
    const room = rooms[roomId];
    const def = room.pendingDefense;
    if (!def || def.targetId !== socket.id) return;

    const target = room.players.find(p => p.id === def.targetId);
    const player = room.players.find(p => p.id === def.fromId);

    let removed = 0;
    target.hand = target.hand.filter(card => {
      if (card === cardValue && removed < 2) {
        removed++;
        return false;
      }
      return true;
    });

    io.to(target.id).emit("yourHand", target.hand);
    io.to(roomId).emit("actionLog", `${target.name} は防御カード(${cardValue})で守った！`);
    clearTimeout(def.timeout);
    room.pendingDefense = null;
    updateHandCounts(roomId);
    if (checkVictory(roomId)) return;
    nextTurn(roomId);
  });

  socket.on("noDefense", (roomId) => {
    const room = rooms[roomId];
    const def = room.pendingDefense;
    if (!def || def.targetId !== socket.id) return;
    const player = room.players.find(p => p.id === def.fromId);
    const target = room.players.find(p => p.id === def.targetId);
    clearTimeout(def.timeout);
    room.pendingDefense = null;
    stealCards(roomId, player, target, def.count);
  });

  socket.on("restartGame", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    room.deck = generateDeck();
    room.players.forEach(p => {
      p.hand = room.deck.splice(0, 3);
    });
    room.players = shuffle(room.players);
    room.turnIndex = 0;
    room.ended = false;
    room.players.forEach(p => {
      io.to(p.id).emit("yourHand", p.hand);
    });
    io.to(roomId).emit("actionLog", `新しいゲームが開始されました！`);
    io.to(roomId).emit("startTurn", {
      playerName: room.players[0].name,
      playerId: room.players[0].id
    });
    updateHandCounts(roomId);
  });

  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const player = room.players.find(p => p.id === socket.id);
      if (!player) continue;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomId];
        io.emit("roomList", getRoomList());
        continue;
      }
      if (room.started && !room.ended) {
        io.to(roomId).emit("actionLog", `${player.name} が退出しました。ゲームは終了します。`);
        io.to(roomId).emit("playerLeft", player.name);
        room.ended = true;
      }
      io.to(roomId).emit("roomJoined", {
        roomId,
        players: room.players,
        maxPlayers: room.maxPlayers,
        hostId: room.hostId
      });
      io.emit("roomList", getRoomList());
    }
  });

  function stealCards(roomId, player, target, count) {
    const taken = target.hand.splice(0, count);
    player.hand.push(...taken);
    io.to(player.id).emit("yourHand", player.hand);
    io.to(target.id).emit("yourHand", target.hand);
    io.to(roomId).emit("actionLog", `${player.name} は ${target.name} から ${taken.length}枚 奪った`);
    if (checkVictory(roomId)) return;
    updateHandCounts(roomId);
    nextTurn(roomId);
  }

  function nextTurn(roomId) {
    const room = rooms[roomId];
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const next = room.players[room.turnIndex];
    io.to(roomId).emit("startTurn", {
      playerName: next.name,
      playerId: next.id
    });
  }

  function checkVictory(roomId) {
    const room = rooms[roomId];
    for (const player of room.players) {
      const count = {};
      for (const card of player.hand) {
        count[card] = (count[card] || 0) + 1;
        if (count[card] === 3) {
          io.to(roomId).emit("gameWon", `${player.name} が『スリー！』で勝利しました！`);
          room.ended = true;
          return true;
        }
      }
    }
    return false;
  }

  function updateHandCounts(roomId) {
    const room = rooms[roomId];
    const handCounts = room.players.map(p => ({
      name: p.name,
      count: p.hand.length
    }));
    io.to(roomId).emit("handCounts", handCounts);
  }

  function getRoomList() {
    return Object.entries(rooms).map(([id, room]) => ({
      roomId: id,
      current: room.players.length,
      max: room.maxPlayers,
      host: room.players[0]?.name || "？"
    }));
  }
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
