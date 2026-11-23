'use strict';
const $ = id => document.getElementById(id);
const socket = io({ reconnection: true });
const labels = { cloud: 'Nuvem de palavras', poll: 'Enquete', quiz: 'Quiz', open: 'Resposta aberta' };
const symbols = { cloud: '☁', poll: '▥', quiz: '✦', open: '✎' };
let mode = 'welcome';
let roomCode = '';
let roomState = null;
let joinUrl = '';
let toastTimeout = null;
let lastSlideId = null;
let chosenHostPin = '';
let guestFeedback = '';
let submitting = false;
let wasConnected = false;
const participantId = (() => {
  const existing = localStorage.getItem('participa_visitor_id');
  if (existing && /^[\w-]{8,64}$/.test(existing)) return existing;
  const id = (crypto.randomUUID ? crypto.randomUUID() : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  localStorage.setItem('participa_visitor_id', id);
  return id;
})();
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 3600);
}
function emit(event, data, callback) {
  socket.timeout(8000).emit(event, data, (err, result) => {
    if (err) return toast('Sem resposta do servidor. Confira a conexao.');
    if (!result?.ok) return toast(result?.error || 'Nao foi possivel concluir a acao.');
    if (callback) callback(result);
  });
}
function showScreen(next) {
  mode = next;
  ['welcome', 'host', 'participant'].forEach(id => $(id).classList.toggle('hidden', id !== next));
  document.title = next === 'host' ? 'Apresentador · PARTICIPA' : next === 'participant' ? 'Participar · PARTICIPA' : 'PARTICIPA · Ao vivo';
}
function hostLogin(result, pin) {
  roomCode = result.code;
  roomState = result.state;
  joinUrl = result.url || `${location.origin}/?s=${roomCode}`;
  chosenHostPin = pin;
  sessionStorage.setItem('participa_host_code', roomCode);
  sessionStorage.setItem('participa_host_pin', pin);
  $('roomCode').textContent = roomCode;
  $('hostTitle').textContent = roomState.title;
  showScreen('host');
  renderHost();
  toast('Sua sala esta pronta. Compartilhe o codigo com os participantes.');
}
function guestLogin(result, code) {
  roomCode = code;
  roomState = result.state;
  joinUrl = `${location.origin}/?s=${code}`;
  guestFeedback = '';
  lastSlideId = null;
  $('partRoom').textContent = roomCode;
  $('partTitle').textContent = roomState.title;
  showScreen('participant');
  renderParticipant();
}
function joinGuest(code) { emit('participant:join', { code, participantId }, result => guestLogin(result, code)); }

socket.on('connect', () => {
  $('connection').textContent = '● Conectado';
  $('connection').classList.remove('off');
  if (wasConnected && mode === 'participant' && roomCode) joinGuest(roomCode);
  if (wasConnected && mode === 'host' && roomCode && chosenHostPin) {
    emit('host:rejoin', { pin: chosenHostPin, code: roomCode }, result => {
      roomState = result.state;
      renderHost();
    });
  }
  wasConnected = true;
});
socket.on('disconnect', () => {
  $('connection').textContent = '● Sem conexao';
  $('connection').classList.add('off');
});
socket.on('room:state', state => {
  if (state.code !== roomCode) return;
  roomState = state;
  if (mode === 'host') renderHost();
  if (mode === 'participant') renderParticipant();
});

$('tabHost').addEventListener('click', () => {
  $('tabHost').classList.add('active'); $('tabGuest').classList.remove('active');
  $('hostForm').classList.remove('hidden'); $('guestForm').classList.add('hidden');
});
$('tabGuest').addEventListener('click', () => {
  $('tabGuest').classList.add('active'); $('tabHost').classList.remove('active');
  $('guestForm').classList.remove('hidden'); $('hostForm').classList.add('hidden');
});
$('hostForm').addEventListener('submit', e => {
  e.preventDefault();
  const pin = $('moderatorPin').value;
  emit('host:create', { pin, title: $('sessionTitle').value }, result => hostLogin(result, pin));
});
$('restoreBtn').addEventListener('click', () => {
  const pin = $('moderatorPin').value, code = $('restoreCode').value.trim();
  if (!/^\d{6}$/.test(code)) return toast('Informe o codigo de 6 digitos.');
  emit('host:rejoin', { pin, code }, result => hostLogin(result, pin));
});
$('guestForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('guestCode').value.trim();
  if (!/^\d{6}$/.test(code)) return toast('Digite um codigo de seis digitos.');
  joinGuest(code);
});
$('backHomeHost').addEventListener('click', () => {
  if (confirm('Sair do painel? A sessao permanecera disponivel enquanto o servidor estiver ativo.')) {
    sessionStorage.removeItem('participa_host_pin');
    sessionStorage.removeItem('participa_host_code');
    location.href = '/';
  }
});
$('leaveGuest').addEventListener('click', () => location.href = '/');

function activityHtml(slide, isHost) {
  if (!slide) return `<div class="stage-empty"><span class="big-symbol">✳</span><h2>${isHost ? 'Sua sala está aberta.' : 'Aguarde a primeira pergunta.'}</h2><p>${isHost ? 'Crie uma atividade para começar a interação.' : 'O apresentador ainda não iniciou.'}</p></div>`;
  let visual = '';
  if (slide.type === 'cloud') {
    const counts = slide.words || (() => {
      const map = new Map();
      slide.answers.forEach(a => {
        const key = a.value.toLocaleLowerCase('pt-BR');
        const previous = map.get(key);
        map.set(key, { word: previous?.word || a.value, count: (previous?.count || 0) + 1 });
      });
      return [...map.values()].sort((a, b) => b.count - a.count);
    })();
    const max = Math.max(1, ...counts.map(x => x.count));
    visual = counts.length ? `<div class="cloud-wrap">${counts.map(w => `<span class="word" style="font-size:clamp(18px,${Math.round(20 + 26 * Math.pow(w.count / max, .65))}px,62px)">${esc(w.word)}</span>`).join('')}</div>` : `<p class="empty-responses">As palavras aparecerão aqui à medida que forem enviadas.<br>Uma palavra pode abrir muitos diálogos.</p>`;
  } else if (slide.type === 'poll' || slide.type === 'quiz') {
    const counts = slide.counts || slide.options.map((_, idx) => slide.answers.filter(a => a.value === idx).length);
    const total = counts.reduce((a, b) => a + b, 0);
    visual = `<div class="bars">${slide.options.map((label, i) => {
      const percent = total ? Math.round(100 * counts[i] / total) : 0;
      const correct = slide.reveal && slide.type === 'quiz' && slide.correctIndex === i;
      return `<div class="bar-row"><div class="bar-label">${correct ? '✓ ' : ''}${esc(label)}</div><div class="bar-track"><div class="bar-fill${correct ? ' correct' : ''}" style="width:${percent}%"></div></div><div class="bar-number">${percent}%</div></div>`;
    }).join('')}</div>`;
  } else {
    const answers = slide.answers || slide.responses || [];
    visual = answers.length ? `<div class="open-grid">${answers.map(a => `<div class="open-note">${isHost ? `<button class="note-remove" type="button" title="Remover resposta" data-remove="${esc(a.id)}">×</button>` : ''}${esc(a.value)}</div>`).join('')}</div>` : `<p class="empty-responses">As respostas abertas aparecerão aqui.<br>Escutar também é uma forma de aprender.</p>`;
  }
  return `<span class="stage-subtitle">${esc(labels[slide.type])} ${slide.locked ? ' · RESPOSTAS BLOQUEADAS' : ' · AO VIVO'}</span><h2 class="stage-title">${esc(slide.question)}</h2>${visual}`;
}
function activeSlide() { return roomState?.slides.find(s => s.id === roomState.activeId) || null; }
function renderHost() {
  if (!roomState) return;
  const active = activeSlide();
  $('attendeeCount').textContent = roomState.attendees;
  $('slidesCount').textContent = roomState.slides.length;
  $('stageHeadline').textContent = active ? labels[active.type] : 'Bem-vindos!';
  $('slideList').innerHTML = roomState.slides.length ? roomState.slides.map((s, i) => `<button class="slide-item ${s.id === roomState.activeId ? 'active' : ''}" data-activate="${esc(s.id)}"><span class="slide-n">${symbols[s.type]}</span><span class="slide-meta"><strong>${i + 1}. ${esc(s.question)}</strong><small>${esc(labels[s.type])} · ${s.answers.length} contribuições</small></span>${s.id === roomState.activeId ? '<span class="active-indicator">●</span>' : ''}</button>`).join('') : '<p class="muted">Crie sua primeira interação.</p>';
  $('stageContent').innerHTML = activityHtml(active, true);
  $('stageCount').textContent = `${active?.answers.length || 0} contribuições`;
  ['lockSlide', 'clearSlide', 'deleteSlide'].forEach(id => $(id).disabled = !active);
  $('lockSlide').textContent = active?.locked ? '🔓 Reabrir respostas' : '🔒 Bloquear respostas';
  $('revealQuiz').classList.toggle('hidden', active?.type !== 'quiz');
  $('revealQuiz').textContent = active?.reveal ? 'Ocultar resposta correta' : '✓ Revelar resposta correta';
}
$('slideList').addEventListener('click', e => {
  const btn = e.target.closest('[data-activate]');
  if (btn) emit('host:activate', { slideId: btn.dataset.activate });
});
$('stageContent').addEventListener('click', e => {
  const remove = e.target.closest('[data-remove]');
  const active = activeSlide();
  if (remove && active) emit('host:remove-answer', { slideId: active.id, answerId: remove.dataset.remove });
});
$('lockSlide').addEventListener('click', () => {
  const slide = activeSlide(); if (slide) emit('host:lock', { slideId: slide.id, locked: !slide.locked });
});
$('revealQuiz').addEventListener('click', () => {
  const slide = activeSlide(); if (slide) emit('host:reveal', { slideId: slide.id, reveal: !slide.reveal });
});
$('clearSlide').addEventListener('click', () => {
  const slide = activeSlide();
  if (slide && confirm('Apagar todas as respostas desta atividade? Esta acao nao pode ser desfeita.')) emit('host:clear', { slideId: slide.id });
});
$('deleteSlide').addEventListener('click', () => {
  const slide = activeSlide();
  if (slide && confirm('Excluir esta atividade e suas respostas?')) emit('host:delete', { slideId: slide.id });
});
$('fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('stage').requestFullscreen?.().catch(() => toast('Tela cheia indisponivel neste navegador.'));
});
$('openGuest').addEventListener('click', () => {
  if (joinUrl) window.open(joinUrl, '_blank', 'noopener,noreferrer');
});
$('copyCode').addEventListener('click', () => {
  navigator.clipboard?.writeText(joinUrl).then(() => toast('Link copiado!'), () => toast(`Compartilhe: ${joinUrl}`));
});
$('showQR').addEventListener('click', () => {
  $('qrImage').src = `/api/qr/${encodeURIComponent(roomCode)}`;
  $('qrCodeText').textContent = roomCode;
  $('qrDialog').showModal();
});
$('qrCopyLink').addEventListener('click', () => {
  navigator.clipboard?.writeText(joinUrl).then(() => toast('Link copiado!'), () => toast(`Compartilhe: ${joinUrl}`));
});
$('toggleCreator').addEventListener('click', () => $('creator').classList.remove('hidden'));
$('closeCreator').addEventListener('click', () => $('creator').classList.add('hidden'));
const tips = {
  cloud: 'Cada participante pode enviar até três palavras. As mais repetidas ganham destaque.',
  poll: 'Cada participante escolhe uma alternativa. Os percentuais atualizam ao vivo.',
  quiz: 'Defina uma única resposta correta. Você decide quando revelar o gabarito.',
  open: 'Cada participante envia uma resposta de até 240 caracteres. O apresentador pode remover respostas inadequadas.'
};
function syncQuestionType() {
  const type = $('questionType').value;
  $('optionsFields').classList.toggle('hidden', type !== 'poll' && type !== 'quiz');
  $('quizFields').classList.toggle('hidden', type !== 'quiz');
  $('typeTip').textContent = tips[type];
  renderCorrectOptions();
}
function renderCorrectOptions() {
  const values = $('answerOptions').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0,6);
  const current = Number($('correctIndex').value);
  $('correctIndex').innerHTML = values.map((v,i) => `<option value="${i}" ${current === i ? 'selected' : ''}>${i + 1}. ${esc(v)}</option>`).join('');
}
$('questionType').addEventListener('change', syncQuestionType);
$('answerOptions').addEventListener('input', renderCorrectOptions);
syncQuestionType();
$('createForm').addEventListener('submit', e => {
  e.preventDefault();
  const type = $('questionType').value;
  const options = $('answerOptions').value.split('\n').map(v => v.trim()).filter(Boolean).slice(0,6);
  const payload = { type, question: $('questionText').value, options, correctIndex: Number($('correctIndex').value || 0) };
  emit('host:add-slide', payload, () => {
    $('questionText').value = '';
    $('answerOptions').value = '';
    $('creator').classList.add('hidden');
    toast('Atividade adicionada. Selecione-a na lista para projetar.');
  });
});
function csvCell(v) {
  let value = String(v ?? '');
  if (/^[=+@-]/.test(value)) value = "'" + value;
  return `"${value.replace(/"/g, '""')}"`;
}
function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('exportCSV').addEventListener('click', () => {
  if (!roomState) return;
  const lines = [['Sala','Atividade','Tipo','Pergunta','Participante (anonimo)','Resposta','Data']];
  roomState.slides.forEach((s, idx) => s.answers.forEach(a => {
    const val = (s.type === 'poll' || s.type === 'quiz') ? s.options[a.value] : a.value;
    lines.push([roomCode, idx + 1, labels[s.type], s.question, a.participantId, val, a.at]);
  }));
  const csv = '\uFEFF' + lines.map(line => line.map(csvCell).join(';')).join('\r\n');
  download(`participa_${roomCode}_respostas.csv`, csv, 'text/csv;charset=utf-8');
  toast('Relatorio CSV exportado.');
});
$('exportJSON').addEventListener('click', () => {
  if (!roomState) return;
  download(`participa_${roomCode}_sessao.json`, JSON.stringify({ exportadoEm: new Date().toISOString(), ...roomState }, null, 2), 'application/json');
  toast('Relatorio JSON exportado.');
});

function sentKey(slide) { return `participa_sent_${roomCode}_${slide.id}_${slide.epoch || 0}`; }
function sentCount(slide) { return Number(localStorage.getItem(sentKey(slide)) || 0); }
function recordSent(slide) { localStorage.setItem(sentKey(slide), String(sentCount(slide) + 1)); }
function renderParticipant() {
  if (!roomState) return;
  $('partCount').textContent = `${roomState.attendees} participante(s) conectado(s)`;
  $('partTitle').textContent = roomState.title;
  const slide = activeSlide();
  if (!slide) {
    $('participantBody').innerHTML = '<div class="waiting"><div class="waiting-art">✳</div><h2>Você está na sala!</h2><p>Aguarde o apresentador iniciar a atividade.</p></div>';
    return;
  }
  if (lastSlideId !== slide.id) { lastSlideId = slide.id; guestFeedback = ''; }
  const count = sentCount(slide);
  const limit = slide.type === 'cloud' ? 3 : 1;
  const answered = count >= limit;
  const complete = slide.locked || answered;
  let html = `<div class="part-type">${esc(labels[slide.type])}</div><h2 class="participant-question">${esc(slide.question)}</h2>`;
  if (slide.locked) {
    html += '<div class="success-state"><span class="success-mark">🔒</span><h3>Respostas encerradas</h3><p>O apresentador bloqueou o envio por enquanto.</p></div>';
  } else if (answered) {
    html += `<div class="success-state"><span class="success-mark">✓</span><h3>Resposta registrada!</h3><p>Obrigado por participar. Acompanhe os resultados na tela de apresentação.</p></div>`;
  } else if (slide.type === 'poll' || slide.type === 'quiz') {
    html += `<p class="participant-help">Selecione uma alternativa. ${slide.type === 'quiz' ? 'A resposta correta pode ser revelada pelo apresentador.' : 'Sua escolha sera computada automaticamente.'}</p><div class="choices">${slide.options.map((opt, i) => `<button type="button" class="choice" data-vote="${i}"><span>${String.fromCharCode(65 + i)}</span>${esc(opt)}</button>`).join('')}</div>`;
  } else {
    const cloud = slide.type === 'cloud';
    html += `<p class="participant-help">${cloud ? `Você pode enviar até três palavras ou expressões curtas (${count}/3 enviadas).` : 'Escreva sua opinião em até 240 caracteres.'}</p><form id="answerForm" class="answer-form">${cloud ? '<input id="textAnswer" aria-label="Sua palavra" placeholder="Digite uma palavra ou expressão..." maxlength="38" required />' : '<textarea id="textAnswer" rows="5" aria-label="Sua resposta" placeholder="Escreva sua reflexão..." maxlength="240" required></textarea>'}<button class="primary full" type="submit">Enviar contribuição <span>→</span></button></form>`;
  }
  if (guestFeedback) html += `<p class="participant-help">${esc(guestFeedback)}</p>`;
  if (complete && (slide.type === 'poll' || slide.type === 'quiz')) {
    html += `<p class="participant-help">${slide.total} voto(s) registrados${slide.type === 'quiz' && slide.reveal && Number.isInteger(slide.correctIndex) ? ` · Resposta correta: ${esc(slide.options[slide.correctIndex])}` : ''}.</p>`;
  }
  $('participantBody').innerHTML = html;
}
function sendAnswer(slide, value) {
  if (submitting) return;
  submitting = true;
  emit('participant:answer', { slideId: slide.id, value }, () => {
    recordSent(slide);
    guestFeedback = slide.type === 'cloud' ? 'Sua palavra foi recebida!' : '';
    submitting = false;
    renderParticipant();
  });
  // Evita bloqueio em caso de erro de rede ou rejeicao do servidor.
  setTimeout(() => { submitting = false; }, 1200);
}
$('participantBody').addEventListener('click', e => {
  const button = e.target.closest('[data-vote]');
  const slide = activeSlide();
  if (button && slide && (slide.type === 'poll' || slide.type === 'quiz')) sendAnswer(slide, Number(button.dataset.vote));
});
$('participantBody').addEventListener('submit', e => {
  if (e.target.id !== 'answerForm') return;
  e.preventDefault();
  const slide = activeSlide();
  if (slide) sendAnswer(slide, $('textAnswer').value);
});

const sharedCode = new URLSearchParams(location.search).get('s');
if (sharedCode && /^\d{6}$/.test(sharedCode)) {
  $('guestCode').value = sharedCode;
  $('tabGuest').click();
  socket.on('connect', () => { if (mode === 'welcome') joinGuest(sharedCode); });
  if (socket.connected) joinGuest(sharedCode);
} else {
  const prevCode = sessionStorage.getItem('participa_host_code');
  const prevPin = sessionStorage.getItem('participa_host_pin');
  if (prevCode && prevPin) {
    $('restoreCode').value = prevCode;
    $('moderatorPin').value = prevPin;
    socket.on('connect', () => { if (mode === 'welcome') emit('host:rejoin', { code: prevCode, pin: prevPin }, result => hostLogin(result, prevPin)); });
  }
}
