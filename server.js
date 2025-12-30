const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// เก็บสถานะของห้องและคิวจับคู่
let rooms = {}; 
let matchQueue = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // --- ระบบ Auto Matchmaking ---
  socket.on('find_match', () => {
    matchQueue.push(socket);
    
    if (matchQueue.length >= 2) {
      const player1 = matchQueue.shift();
      const player2 = matchQueue.shift();
      const roomId = 'room_' + Math.random().toString(36).substr(2, 6); // สร้าง ID สุ่ม

      createGameRoom(roomId, player1, player2);
    }
  });

  // --- ระบบสร้างห้อง (Create Room) ---
  socket.on('create_room', () => {
    const roomId = Math.random().toString(36).substr(2, 5).toUpperCase(); // ID สั้นๆ เช่น "5AX9B"
    socket.emit('room_created', roomId);
    socket.join(roomId);
    
    rooms[roomId] = {
      p1: socket,
      p2: null,
      board: Array(9).fill(null),
      turn: 'X'
    };
  });

  // --- ระบบเข้าห้อง (Join Room) ---
  socket.on('join_room', (roomId) => {
    if (rooms[roomId] && !rooms[roomId].p2) {
      const p1 = rooms[roomId].p1;
      const p2 = socket;
      
      // รวม player 2 เข้าห้องที่ player 1 สร้างไว้
      createGameRoom(roomId, p1, p2, true); 
    } else {
      socket.emit('error_msg', 'ไม่พบห้องหรือห้องเต็มแล้ว');
    }
  });

  // --- การเดินเกม (Move) ---
  socket.on('make_move', (data) => {
    const { roomId, index, symbol } = data;
    const room = rooms[roomId];

    if (room && room.board[index] === null && room.turn === symbol) {
      room.board[index] = symbol;
      room.turn = symbol === 'X' ? 'O' : 'X'; // สลับตา

      io.to(roomId).emit('update_board', {
        board: room.board,
        turn: room.turn
      });

      checkWinner(roomId, room);
    }
  });

  // --- เมื่อผู้เล่นหลุด ---
  socket.on('disconnect', () => {
    // ลบออกจากคิวถ้ากำลังรอ
    matchQueue = matchQueue.filter(s => s.id !== socket.id);
    // แจ้งเตือนในห้อง (Logic นี้สามารถขยายเพิ่มได้เพื่อจัดการห้องที่ค้าง)
  });
});

// ฟังก์ชันเริ่มเกม
function createGameRoom(roomId, p1, p2, isCustom = false) {
  p1.join(roomId);
  p2.join(roomId);

  if(!isCustom) { // ถ้าไม่ใช่ห้อง Custom ต้องสร้าง object ห้องใหม่
      rooms[roomId] = { p1, p2, board: Array(9).fill(null), turn: 'X' };
  } else {
      rooms[roomId].p2 = p2; // อัปเดต p2
  }

  // ส่งสัญญาณเริ่มเกม
  p1.emit('game_start', { symbol: 'X', roomId: roomId });
  p2.emit('game_start', { symbol: 'O', roomId: roomId });
}

// เช็คผู้ชนะ
function checkWinner(roomId, room) {
  const wins = [
    [0,1,2], [3,4,5], [6,7,8], // แนวนอน
    [0,3,6], [1,4,7], [2,5,8], // แนวตั้ง
    [0,4,8], [2,4,6]           // แนวทแยง
  ];

  for (let condition of wins) {
    const [a, b, c] = condition;
    if (room.board[a] && room.board[a] === room.board[b] && room.board[a] === room.board[c]) {
      io.to(roomId).emit('game_over', { winner: room.board[a] });
      delete rooms[roomId]; // จบเกมลบห้อง
      return;
    }
  }

  if (!room.board.includes(null)) {
    io.to(roomId).emit('game_over', { winner: 'Draw' });
    delete rooms[roomId];
  }
}
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
