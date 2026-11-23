/*
 * PARTICIPA — Adaptador para GitHub Pages.
 * Modo local sem configuração: demonstração em abas do mesmo navegador.
 * Modo nuvem: Supabase REST com consulta automática a cada 2,5 segundos.
 */
(() => {
  'use strict';
  const cfg = window.PARTICIPA_CONFIG || {};
  const online = /^https:\/\/[a-z0-9.-]+\/??$/i.test((cfg.supabaseUrl || '').trim())
    && String(cfg.supabaseAnonKey || '').length > 20;
  window.PARTICIPA_ONLINE = online;
  const BASE = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const APIKEY = cfg.supabaseAnonKey || '';
  const listeners = new Map();
  const channel = !online && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('participa:salas:v2') : null;
  let currentCode = '';
  let currentRole = '';
  let hostToken = '';
  let currentParticipant = '';
  let revision = '';
  let pollBusy = false;
  const uuid = () => globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const roomStorage = code => `participa_github_room_${code}`;
  const clean = (str, size) => String(str ?? '').trim().slice(0, size);
  const error = message => ({ok: false, error: message});
  const success = fields => ({ok: true, ...fields});
  const root = () => `${location.href.split('?')[0].split('#')[0]}`;
  const urlFor = code => `${root()}?s=${code}`;
  const emitEvent = (name, value) => (listeners.get(name) || []).forEach(fn => { try { fn(value); } catch (err) { console.error(err); } });
  function getLocal(code) {
    try { return JSON.parse(localStorage.getItem(roomStorage(code)) || 'null'); } catch { return null; }
  }
  function storeLocal(room) {
    localStorage.setItem(roomStorage(room.code), JSON.stringify(room));
    channel?.postMessage(room.code);
  }
  function stateLocal(room, host) {
    const slides = host ? room.slides : room.slides.filter(s => s.id === room.activeId);
    return { code: room.code, title: room.title, activeId: room.activeId,
      attendees: Object.keys(room.participants || {}).length,
      slides: slides.map(slide => {
        const answers = slide.answers || [];
        const item = {id:slide.id, type:slide.type, question:slide.question,
          options:slide.options, locked:slide.locked, reveal:slide.reveal,
          epoch:slide.epoch, total:answers.length};
        if (host) {
          return {...item, correctIndex:slide.correctIndex, answers:answers.map(a => ({...a}))};
        }
        if (slide.type === 'poll' || slide.type === 'quiz') {
          item.counts = slide.options.map((_, idx) => answers.filter(a => a.value === idx).length);
          if (slide.type === 'quiz' && slide.reveal) item.correctIndex = slide.correctIndex;
        } else if (slide.type === 'cloud') {
          const words = new Map();
          answers.forEach(a => {
            const key = a.value.toLocaleLowerCase('pt-BR');
            const previous = words.get(key);
            words.set(key, {word: previous?.word || a.value, count: (previous?.count || 0) + 1});
          });
          item.words = [...words.values()].sort((a, b) => b.count - a.count);
        } else {
          item.responses = answers.map(a => ({id:a.id, value:a.value}));
        }
        return item;
      })
    };
  }
  function localCall(event, data) {
    if (event === 'host:create') {
      if (!clean(data.pin, 128) || clean(data.pin,128).length < 4) return error('Escolha um PIN de pelo menos 4 caracteres.');
      const code = (() => { for (let i=0;i<100;i++) { const c = String(Math.floor(Math.random()*900000)+100000); if (!getLocal(c)) return c; } throw Error('Não foi possível gerar um código.'); })();
      const room = {code, title:clean(data.title,90) || 'Encontro interativo', pin:clean(data.pin,128), slides:[], activeId:null, participants:{}};
      storeLocal(room);
      currentCode = code; currentRole = 'host';
      return success({code,url:urlFor(code),state:stateLocal(room,true)});
    }
    if (event === 'host:rejoin') {
      const code = clean(data.code,6), room = getLocal(code);
      if (!room) return error('Sala não encontrada neste navegador.');
      if (room.pin !== String(data.pin || '')) return error('PIN incorreto.');
      currentCode = code; currentRole = 'host';
      return success({code,url:urlFor(code),state:stateLocal(room,true)});
    }
    if (event === 'participant:join') {
      const code = clean(data.code,6), room = getLocal(code);
      if (!room) return error('Sala não encontrada. No modo local, abra o link em outra aba do MESMO navegador; para celulares configure o Supabase.');
      room.participants[clean(data.participantId,64)] = Date.now();
      storeLocal(room);
      currentCode = code; currentRole = 'guest'; currentParticipant = clean(data.participantId,64);
      return success({state:stateLocal(room,false)});
    }
    const room = getLocal(currentCode);
    if (!room) return error('Sala não encontrada.');
    if (event === 'participant:answer') {
      if (currentRole !== 'guest') return error('Entre como participante.');
      const slide = room.slides.find(s => s.id === data.slideId && s.id === room.activeId);
      if (!slide || slide.locked) return error('Esta atividade está fechada para respostas.');
      const mine = slide.answers.filter(a => a.participantId === currentParticipant);
      let val = data.value;
      if (slide.type === 'poll' || slide.type === 'quiz') {
        val = Number(val);
        if (!Number.isInteger(val) || val < 0 || val >= slide.options.length) return error('Alternativa inválida.');
        if (mine.length) return error('Você já respondeu a esta atividade.');
      } else if (slide.type === 'cloud') {
        val = clean(val,38).replace(/\s+/g,' ');
        if (val.length < 2) return error('Escreva pelo menos duas letras.');
        if (mine.length >= 3 || mine.some(a => a.value.toLocaleLowerCase('pt-BR') === val.toLocaleLowerCase('pt-BR'))) return error('Esta palavra já foi enviada ou o limite foi atingido.');
      } else {
        val = clean(val,240);
        if (val.length < 2 || mine.length) return error('Resposta vazia ou já enviada.');
      }
      slide.answers.push({id:uuid(), participantId:currentParticipant, value:val, at:new Date().toISOString()});
      storeLocal(room);
      return success({});
    }
    if (currentRole !== 'host') return error('Ação exclusiva do apresentador.');
    if (event === 'host:add-slide') {
      const type = data.type;
      const question = clean(data.question,170);
      if (!['cloud','poll','quiz','open'].includes(type) || question.length < 5) return error('Informe o tipo e uma pergunta de pelo menos 5 caracteres.');
      const options = ['poll','quiz'].includes(type) ? (data.options || []).map(s => clean(s,80)).filter(Boolean).slice(0,6) : [];
      if (['poll','quiz'].includes(type) && options.length < 2) return error('Informe ao menos duas alternativas.');
      const correctIndex = type === 'quiz' ? Number(data.correctIndex) : null;
      if (type === 'quiz' && (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length)) return error('Alternativa correta inválida.');
      const slide = {id:uuid(), type, question, options, correctIndex, locked:false, reveal:false, epoch:0, answers:[]};
      room.slides.push(slide);
      if (!room.activeId) room.activeId = slide.id;
    } else {
      const slide = room.slides.find(s => s.id === data.slideId);
      if (!slide) return error('Atividade não encontrada.');
      if (event === 'host:activate') room.activeId = slide.id;
      else if (event === 'host:lock') slide.locked = !!data.locked;
      else if (event === 'host:reveal' && slide.type === 'quiz') slide.reveal = !!data.reveal;
      else if (event === 'host:clear') { slide.answers = []; slide.reveal = false; slide.epoch++; }
      else if (event === 'host:delete') { room.slides = room.slides.filter(s => s.id !== slide.id); if (room.activeId === slide.id) room.activeId = room.slides[0]?.id || null; }
      else if (event === 'host:remove-answer') slide.answers = slide.answers.filter(a => a.id !== data.answerId);
      else return error('Ação desconhecida.');
    }
    storeLocal(room);
    return success({});
  }
  async function rpc(name, payload) {
    const response = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json',apikey:APIKEY, Authorization:`Bearer ${APIKEY}`},
      body:JSON.stringify(payload)
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) throw new Error(body?.message || `Erro HTTP ${response.status}`);
    return body;
  }
  async function remoteCall(event, data) {
    if (event === 'host:create') {
      if (String(data.pin || '').length < 4) return error('Escolha um PIN de pelo menos 4 caracteres.');
      const created = await rpc('participa_create_room', {p_title:data.title,p_pin:data.pin});
      currentCode = created.code; currentRole = 'host'; hostToken = created.token;
      sessionStorage.setItem(`participa_token_${currentCode}`,hostToken);
      return success({code:created.code, url:urlFor(created.code), state:await rpc('participa_room_state',{p_code:currentCode,p_token:hostToken})});
    }
    if (event === 'host:rejoin') {
      const logged = await rpc('participa_rejoin_room', {p_code:data.code, p_pin:data.pin});
      if (!logged?.token) return error('PIN inválido ou sala inexistente.');
      currentCode = data.code; currentRole = 'host'; hostToken = logged.token;
      sessionStorage.setItem(`participa_token_${currentCode}`,hostToken);
      return success({code:currentCode,url:urlFor(currentCode),state:await rpc('participa_room_state',{p_code:currentCode,p_token:hostToken})});
    }
    if (event === 'participant:join') {
      await rpc('participa_join_room', {p_code:data.code,p_participant:data.participantId});
      currentCode = data.code; currentRole = 'guest'; currentParticipant = data.participantId;
      return success({state:await rpc('participa_room_state',{p_code:currentCode,p_token:null})});
    }
    if (event === 'participant:answer') {
      await rpc('participa_submit_answer',{p_code:currentCode,p_participant:currentParticipant,p_slide:data.slideId,p_value:typeof data.value === 'number' ? data.value : String(data.value)});
      return success({});
    }
    if (currentRole !== 'host' || !hostToken) return error('Reabra a sessão como apresentador.');
    await rpc('participa_host_action', {p_code:currentCode,p_token:hostToken,p_action:event,p_payload:data});
    return success({});
  }
  async function readState() {
    if (!currentCode) return null;
    if (online) return await rpc('participa_room_state',{p_code:currentCode,p_token:currentRole === 'host' ? hostToken : null});
    const room = getLocal(currentCode);
    return room ? stateLocal(room, currentRole === 'host') : null;
  }
  async function refresh(force = false) {
    if (pollBusy || !currentCode) return;
    pollBusy = true;
    try {
      const state = await readState();
      if (state) {
        const next = JSON.stringify(state);
        if (force || next !== revision) { revision = next; emitEvent('room:state',state); }
      }
    } catch (err) {
      console.warn('Não foi possível atualizar a sala:',err);
    } finally { pollBusy = false; }
  }
  window.participaSocket = {
    connected: true,
    on(name,handler) { const list = listeners.get(name) || []; list.push(handler); listeners.set(name,list); },
    timeout() { return this; },
    emit(event,data,callback) {
      Promise.resolve().then(() => online ? remoteCall(event,data || {}) : localCall(event,data || {}))
        .then(result => { callback?.(null,result); if (result?.ok) refresh(true); })
        .catch(err => {console.error(err); callback?.(null,error(err?.message || 'Falha de conexão.'));});
    }
  };
  channel?.addEventListener('message',evt => { if (evt.data === currentCode) refresh(); });
  window.addEventListener('storage',evt => { if (evt.key === roomStorage(currentCode)) refresh(); });
  setTimeout(() => emitEvent('connect'),0);
  setInterval(() => { if (online) refresh(); },2500);
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('modeBanner');
    if (banner) banner.innerHTML = online
      ? '<strong>Modo on-line configurado.</strong> Compartilhe o link ou o código para participar em outros dispositivos.'
      : '<strong>Demonstração local.</strong> Interface pronta para GitHub Pages; para participação entre celulares, configure o Supabase conforme o arquivo LEIA-ME.md. Sem configuração, teste com duas abas deste navegador.';
    const connected = document.getElementById('connection');
    if (connected) connected.textContent = online ? '● On-line (Supabase)' : '● Prévia local';
  });
})();
