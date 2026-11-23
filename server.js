'use strict';
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 120000 });
const PORT = Number(process.env.PORT || 3000);
const MODERATOR_PIN = String(process.env.MODERATOR_PIN || '0510'); // Altere na producao
const rooms = new Map(); // Versao inicial: armazenamento em memoria

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_, res) => res.json({ ok: true, sessions: rooms.size }));
app.get('/api/qr/:code', async (req, res) => {
  const code = String(req.params.code || '');
  if (!/^\d{6}$/.test(code) || !rooms.has(code)) return res.status(404).send('Sessao nao encontrada');
  const forwarded = req.get('x-forwarded-proto');
  const proto = forwarded ? forwarded.split(',')[0] : req.protocol;
  const url = `${proto}://${req.get('host')}/?s=${code}`;
  try {
    const img = await QRCode.toBuffer(url, { margin: 2, width: 420, errorCorrectionLevel: 'M' });
    res.type('png').send(img);
  } catch { res.sendStatus(500); }
});

const safeText = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const types = new Set(['cloud', 'poll', 'quiz', 'open']);
function newCode() {
  let code;
  do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
  return code;
}
function getUrl(socket, code) {
  const headers = socket.handshake.headers;
  const proto = (headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${headers.host}/?s=${code}`;
}
function stripSlide(slide, host, active) {
  const base = {
    id: slide.id, type: slide.type, question: slide.question,
    options: slide.options, locked: slide.locked, total: slide.answers.length,
    reveal: slide.reveal, active, epoch: slide.epoch,
  };
  if (host) {
    base.correctIndex = slide.correctIndex;
    base.answers = slide.answers;
  } else if (active) {
    // Nunca revelar identificador de participantes ou respostas individuais fora de perguntas abertas.
    if (slide.type === 'poll' || slide.type === 'quiz') {
      base.counts = slide.options.map((_, idx) => slide.answers.filter(a => a.value === idx).length);
      if (slide.type === 'quiz' && slide.reveal) base.correctIndex = slide.correctIndex;
    } else if (slide.type === 'cloud') {
      const counts = new Map();
      slide.answers.forEach(a => {
        const key = a.value.toLocaleLowerCase('pt-BR');
        const prior = counts.get(key);
        counts.set(key, { word: prior ? prior.word : a.value, count: (prior?.count || 0) + 1 });
      });
      base.words = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 120);
    } else {
      base.responses = slide.answers.map(a => ({ id: a.id, value: a.value }));
    }
  }
  return base;
}
function snapshot(room, isHost) {
  return {
    code: room.code, title: room.title, activeId: room.activeId,
    attendees: new Set(room.participants.values()).size,
    slides: isHost ? room.slides.map(s => stripSlide(s, true, room.activeId === s.id))
      : room.slides.filter(s => s.id === room.activeId).map(s => stripSlide(s, false, true))
  };
}
function emitState(room) {
  if (room.hostId) io.to(room.hostId).emit('room:state', snapshot(room, true));
  io.to(`audience:${room.code}`).emit('room:state', snapshot(room, false));
}
function hostRoom(socket) {
  if (!socket.data.isHost || !socket.data.code) return null;
  const room = rooms.get(socket.data.code);
  return room && room.hostId === socket.id ? room : null;
}
function answer(socket, callback, payload) {
  const room = rooms.get(socket.data.code);
  if (!room || !socket.data.participantId || socket.data.isHost) return callback({ ok: false, error: 'Entre como participante.' });
  const slide = room.slides.find(s => s.id === room.activeId && s.id === payload?.slideId);
  if (!slide || slide.locked) return callback({ ok: false, error: 'Esta atividade nao esta recebendo respostas.' });
  const now = Date.now();
  if (now - (socket.data.lastAnswerAt || 0) < 800) return callback({ ok: false, error: 'Aguarde um instante antes de enviar.' });
  const mine = slide.answers.filter(a => a.participantId === socket.data.participantId);
  let value;
  if (slide.type === 'poll' || slide.type === 'quiz') {
    value = Number(payload?.value);
    if (!Number.isInteger(value) || value < 0 || value >= slide.options.length) return callback({ ok: false, error: 'Alternativa invalida.' });
    if (mine.length) return callback({ ok: false, error: 'Sua resposta ja foi registrada.' });
  } else if (slide.type === 'cloud') {
    value = safeText(payload?.value, 38).replace(/\s+/g, ' ');
    if (value.length < 2) return callback({ ok: false, error: 'Escreva pelo menos duas letras.' });
    if (mine.length >= 3) return callback({ ok: false, error: 'Limite de tres palavras por participante.' });
    if (mine.some(a => a.value.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR')))
      return callback({ ok: false, error: 'Voce ja enviou esta palavra.' });
  } else {
    value = safeText(payload?.value, 240);
    if (value.length < 2) return callback({ ok: false, error: 'Escreva uma resposta.' });
    if (mine.length) return callback({ ok: false, error: 'Sua resposta ja foi registrada.' });
  }
  slide.answers.push({ id: crypto.randomUUID(), participantId: socket.data.participantId, value, at: new Date().toISOString() });
  socket.data.lastAnswerAt = now;
  callback({ ok: true });
  emitState(room);
}

io.on('connection', socket => {
  socket.on('host:create', ({ pin, title } = {}, ack = () => {}) => {
    if (String(pin) !== MODERATOR_PIN) return ack({ ok: false, error: 'PIN incorreto.' });
    const code = newCode();
    const room = { code, title: safeText(title || 'Encontro interativo', 90), hostId: socket.id,
      participants: new Map(), activeId: null, slides: [], createdAt: Date.now() };
    rooms.set(code, room);
    socket.data = { isHost: true, code };
    socket.join(`host:${code}`);
    ack({ ok: true, code, url: getUrl(socket, code), state: snapshot(room, true) });
  });
  socket.on('host:rejoin', ({ pin, code } = {}, ack = () => {}) => {
    if (String(pin) !== MODERATOR_PIN) return ack({ ok: false, error: 'PIN incorreto.' });
    const room = rooms.get(String(code));
    if (!room) return ack({ ok: false, error: 'Sala nao encontrada. Os dados sao temporarios.' });
    room.hostId = socket.id;
    socket.data = { isHost: true, code: String(code) };
    socket.join(`host:${code}`);
    ack({ ok: true, code: String(code), url: getUrl(socket, code), state: snapshot(room, true) });
    emitState(room);
  });
  socket.on('participant:join', ({ code, participantId } = {}, ack = () => {}) => {
    code = safeText(code, 6);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Codigo nao encontrado.' });
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(participantId || ''))) return ack({ ok: false, error: 'Identificador invalido.' });
    if (socket.data.code && socket.data.code !== code) {
      const old = rooms.get(socket.data.code);
      if (old) { old.participants.delete(socket.id); socket.leave(`audience:${old.code}`); emitState(old); }
    }
    socket.data = { isHost: false, code, participantId };
    room.participants.set(socket.id, participantId);
    socket.join(`audience:${code}`);
    ack({ ok: true, state: snapshot(room, false) });
    emitState(room);
  });
  socket.on('host:add-slide', (payload = {}, ack = () => {}) => {
    const room = hostRoom(socket);
    if (!room) return ack({ ok: false, error: 'Acesso de apresentador necessario.' });
    if (room.slides.length >= 60) return ack({ ok: false, error: 'Limite de 60 atividades por sessao.' });
    const type = safeText(payload.type, 10);
    const question = safeText(payload.question, 170);
    if (!types.has(type) || question.length < 5) return ack({ ok: false, error: 'Escolha o tipo e escreva uma pergunta.' });
    const options = (type === 'poll' || type === 'quiz') ? (Array.isArray(payload.options) ? payload.options : [])
      .map(o => safeText(o, 80)).filter(Boolean).slice(0, 6) : [];
    if ((type === 'poll' || type === 'quiz') && options.length < 2) return ack({ ok: false, error: 'Informe ao menos duas alternativas.' });
    const correctIndex = type === 'quiz' ? Number(payload.correctIndex) : null;
    if (type === 'quiz' && (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length))
      return ack({ ok: false, error: 'Selecione uma alternativa correta.' });
    const slide = { id: crypto.randomUUID(), type, question, options, correctIndex, answers: [], locked: false, reveal: false, epoch: 0 };
    room.slides.push(slide);
    if (!room.activeId) room.activeId = slide.id;
    ack({ ok: true });
    emitState(room);
  });
  socket.on('host:activate', ({ slideId } = {}, ack = () => {}) => {
    const room = hostRoom(socket);
    if (!room || !room.slides.some(s => s.id === slideId)) return ack({ ok: false, error: 'Atividade nao encontrada.' });
    room.activeId = slideId;
    ack({ ok: true }); emitState(room);
  });
  socket.on('host:lock', ({ slideId, locked } = {}, ack = () => {}) => {
    const room = hostRoom(socket), slide = room?.slides.find(s => s.id === slideId);
    if (!slide) return ack({ ok: false, error: 'Atividade nao encontrada.' });
    slide.locked = Boolean(locked);
    ack({ ok: true }); emitState(room);
  });
  socket.on('host:reveal', ({ slideId, reveal } = {}, ack = () => {}) => {
    const room = hostRoom(socket), slide = room?.slides.find(s => s.id === slideId);
    if (!slide || slide.type !== 'quiz') return ack({ ok: false, error: 'Quiz nao encontrado.' });
    slide.reveal = Boolean(reveal);
    ack({ ok: true }); emitState(room);
  });
  socket.on('host:clear', ({ slideId } = {}, ack = () => {}) => {
    const room = hostRoom(socket), slide = room?.slides.find(s => s.id === slideId);
    if (!slide) return ack({ ok: false, error: 'Atividade nao encontrada.' });
    slide.answers = []; slide.reveal = false; slide.epoch++;
    ack({ ok: true }); emitState(room);
  });
  socket.on('host:remove-answer', ({ slideId, answerId } = {}, ack = () => {}) => {
    const room = hostRoom(socket), slide = room?.slides.find(s => s.id === slideId);
    if (!slide) return ack({ ok: false, error: 'Atividade nao encontrada.' });
    slide.answers = slide.answers.filter(a => a.id !== answerId);
    ack({ ok: true }); emitState(room);
  });
  socket.on('host:delete', ({ slideId } = {}, ack = () => {}) => {
    const room = hostRoom(socket);
    if (!room) return ack({ ok: false, error: 'Acesso de apresentador necessario.' });
    room.slides = room.slides.filter(s => s.id !== slideId);
    if (room.activeId === slideId) room.activeId = room.slides[0]?.id || null;
    ack({ ok: true }); emitState(room);
  });
  socket.on('participant:answer', (payload, ack = () => {}) => answer(socket, ack, payload));
  socket.on('disconnect', () => {
    if (!socket.data.code) return;
    const room = rooms.get(socket.data.code);
    if (!room) return;
    room.participants.delete(socket.id);
    if (room.hostId === socket.id) room.hostId = null;
    emitState(room);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`PARTICIPA AO VIVO: http://localhost:${PORT}`);
  if (MODERATOR_PIN === '0510') console.warn('AVISO: troque MODERATOR_PIN antes de expor na internet.');
});
