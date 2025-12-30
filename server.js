const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

// 1. รับ Port จาก Environment Variable ของ Render (ถ้าไม่มีใช้ 3000)
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// 2. ตั้งค่า Socket.io แบบ Production (แก้เรื่อง CORS และความเสถียร)
const io = new Server(server, {
  cors: {
    origin: "*", // อนุญาตทุกโดเมน (แก้ปัญหา Cross-Origin)
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000, // รอสัญญาณตอบรับนานขึ้น (กันหลุดเวลาเน็ตมือถือแกว่ง)
  pingInterval: 25000
});

// เสิร์ฟไฟล์ Static (index.html)
app.use(express.static(path.join(__dirname, '.')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// State เก็บข้อมูลเกม
let rooms = {}; 
let matchQueue = [];

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // --- Auto Matchmaking ---
  socket.on('find_match', () => {
    // ป้องกันการกดหาห้องซ้ำ
    if (matchQueue.includes(socket)) return;

    matchQueue.push(socket);
    
    if (matchQueue.length >= 2) {
      const player1 = matchQueue.shift();
      const player2 = matchQueue.shift();
      
      // ตรวจสอบว่าผู้เล่นยัง online อยู่ไหมก่อนจับคู่
      if(player1.connected && player2.connected) {
          const roomId = 'auto_' + Math.random().toString(36).substr(2, 6);
          createGameRoom(roomId, player1, player2);
      } else {
          // ถ้ามีคนหลุด ให้เอาคนที่เหลือกลับเข้าคิว
          if(player1.connected) matchQueue.unshift(player1);
          if(player2.connected) matchQueue.unshift(player2);
      }
    }
  });

  // --- Create Custom Room ---
  socket.on('create_room', () => {
    const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
    socket.emit('room_created', roomId);
    socket.join(roomId);
    
    rooms[roomId] = {
      p1: socket,
      p2: null,
      board: Array(9).fill(null),
      turn: 'X',
      type: 'custom'
    };
  });

  // --- Join Room ---
  socket.on('join_room', (roomId) => {
    // แปลงเป็นตัวพิมพ์ใหญ่และตัดช่องว่าง
    roomId = roomId.trim().toUpperCase();

    if (rooms[roomId] && !rooms[roomId].p2) {
      const p1 = rooms[roomId].p1;
      const p2 = socket;
      createGameRoom(roomId, p1, p2, true); 
    } else {
      socket.emit('error_msg', '❌ ไม่พบห้อง หรือห้องเต็มแล้ว');
    }
  });

  // --- Move Logic ---
  socket.on('make_move', (data) => {
    const { roomId, index, symbol } = data;
    const room = rooms[roomId];

    if (room && room.board[index] === null && room.turn === symbol) {
      room.board[index] = symbol;
      room.turn = symbol === 'X' ? 'O' : 'X';

      io.to(roomId).emit('update_board', {
        board: room.board,
        turn: room.turn
      });

      checkWinner(roomId, room);
    }
  });

  // --- Disconnect Handling (สำคัญมากสำหรับ Production) ---
  socket.on('disconnect', () => {
    // 1. ลบออกจากคิวรอ
    matchQueue = matchQueue.filter(s => s.id !== socket.id);

    // 2. หาว่าอยู่ห้องไหน แล้วแจ้งฝ่ายตรงข้ามว่าชนะบาย
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.p1 === socket || room.p2 === socket) {
        io.to(roomId).emit('game_over', { winner: 'Opponent Left', isDisconnect: true });
        delete rooms[roomId]; // ลบห้องทิ้งเพื่อคืน Ram
        break;
      }
    }
  });
});

function createGameRoom(roomId, p1, p2, isCustom = false) {
  p1.join(roomId);
  p2.join(roomId);

  if(!isCustom) {
      rooms[roomId] = { p1, p2, board: Array(9).fill(null), turn: 'X' };
  } else {
      rooms[roomId].p2 = p2;
  }

  p1.emit('game_start', { symbol: 'X', roomId: roomId });
  p2.emit('game_start', { symbol: 'O', roomId: roomId });
}

function checkWinner(roomId, room) {
  const wins = [
    [0,1,2], [3,4,5], [6,7,8], 
    [0,3,6], [1,4,7], [2,5,8], 
    [0,4,8], [2,4,6]
  ];

  for (let condition of wins) {
    const [a, b, c] = condition;
    if (room.board[a] && room.board[a] === room.board[b] && room.board[a] === room.board[c]) {
      io.to(roomId).emit('game_over', { winner: room.board[a] });
      delete rooms[roomId];
      return;
    }
  }

  if (!room.board.includes(null)) {
    io.to(roomId).emit('game_over', { winner: 'Draw' });
    delete rooms[roomId];
  }
}

// เริ่ม Server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
