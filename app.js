// Barber Turnos (VIP) - single-file app logic

// ===== PWA / SW =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ===== HAPTIC + CLICK ULTRA SUTIL (iPhone-friendly) =====
let audioCtx = null;

function ensureAudio(){
  if (audioCtx) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  audioCtx = new Ctx();
  return true;
}

async function unlockAudio(){
  if (!ensureAudio()) return;
  try{
    if (audioCtx.state === 'suspended') await audioCtx.resume();
  }catch(_){ }
}

function iosClick(type = 'soft'){
  if (!ensureAudio()) return;
  if (audioCtx.state === 'suspended'){
    audioCtx.resume?.().catch(()=>{});
  }

  const t0 = audioCtx.currentTime;
  const dur = (type === 'delete') ? 0.030 : 0.018;
  const freq = (type === 'delete') ? 170 : 240;
  const gainPeak = (type === 'delete') ? 0.045 : 0.028; // very low

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + dur);

  gain.gain.setValueAtTime(0.00001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.00001, t0 + dur);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t0);
  osc.stop(t0 + dur + 0.01);
}

// 1s "timer ended" tone (subtle). Runs when we enter overtime the first time.
function timerEndTone(){
  if (!ensureAudio()) return;
  // if audio is still locked, just skip (iOS requires a user gesture)
  if (audioCtx.state === 'suspended') return;
  const t0 = audioCtx.currentTime;
  const dur = 1.0;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';

  // gentle "ding": quick drop in pitch
  osc.frequency.setValueAtTime(880, t0);
  osc.frequency.exponentialRampToValueAtTime(440, t0 + 0.22);
  osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.60);

  gain.gain.setValueAtTime(0.00001, t0);
  gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.00001, t0 + dur);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function haptic(pattern){
  try{ if (navigator.vibrate) navigator.vibrate(pattern); }catch(_){ }
}
function tapHaptic(){
  // Very short vibration on supported devices (Android). iOS Safari generally ignores vibrate.
  haptic(12);
}

// Prolonged alert when entering overtime (1s tone + stronger vibration pattern).
function overtimeAlert(){
  timerEndTone();
  haptic([220,80,220,80,260]);
}


function feedback(kind = 'soft'){
  if (kind === 'delete'){
    haptic([18,30,18]);
    iosClick('delete');
    return;
  }
  if (kind === 'warn'){
    haptic([10,20,10]);
    iosClick('soft');
    return;
  }
  haptic([8]);
  iosClick('soft');
}

window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
window.addEventListener('click', unlockAudio, { once: true });

// Prevent pinch-zoom / page pan (best-effort)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());
// Hard-stop horizontal dragging
document.addEventListener('touchmove', (e) => {
  // allow scroll inside modal sheets and log lists
  const ok = e.target.closest('.modal-sheet') || e.target.closest('.log-list') || e.target.closest('.queue-wrap');
  if (!ok) e.preventDefault();
}, { passive: false });

// ===== RING (ARO CENTRAL) =====
const ringBtn = document.getElementById('ringBtn');
const ringProgress = document.getElementById('ringProgress');
const ringCap = document.getElementById('ringCap');
const ringState = document.getElementById('ringState');
const ringTime = document.getElementById('ringTime');
const ringEnd = document.getElementById('ringEnd');
const ringMeta = document.getElementById('ringMeta');
const ringContent = ringBtn.querySelector('.ring-content');

// UI only: imagen de fondo personalizada para el botón central
const STORAGE_KEY_BTN_BG = 'bt_vip_btnbg_v1';

// UI only: imagen de fondo personalizada para toda la app
const STORAGE_KEY_APP_BG = 'bt_vip_appbg_v1';

function applyButtonBackground(){
  try{
    const dataUrl = localStorage.getItem(STORAGE_KEY_BTN_BG);
    if (!dataUrl){
      ringContent.classList.remove('has-btnbg');
      ringContent.style.removeProperty('--btn-bg');
      return;
    }
    ringContent.classList.add('has-btnbg');
    ringContent.style.setProperty('--btn-bg', `url(${dataUrl})`);
  }catch(_){
    // ignore
  }
}

function applyAppBackground(){
  try{
    const dataUrl = localStorage.getItem(STORAGE_KEY_APP_BG);
    if (!dataUrl){
      document.body.classList.remove('has-appbg');
      document.body.style.removeProperty('--app-bg');
      return;
    }
    document.body.classList.add('has-appbg');
    document.body.style.setProperty('--app-bg', `url(${dataUrl})`);
  }catch(_){
    // ignore
  }
}

const R = 78;
const C = 2 * Math.PI * R;
ringProgress.style.strokeDasharray = `${C}`;
// UI only: en esta versión el aro NO representa progreso (no se "va borrando").
// Se mantiene completo y solo cambia de color según estado + respira con una animación CSS.
ringProgress.style.strokeDashoffset = `0`;

let running = false;
let baseMs = 0;
let startTs = 0;
let rafId = null;
let lastMode = 'normal';
let warnedOvertime = false;

// UI/UX: aviso de "poco tiempo" (amarillo) antes de entrar en overtime.
// Ajustable sin tocar la lógica principal.
const WARNING_MS = 2 * 60 * 1000; // 2 minutos

let currentService = null;   // {serviceKey, speed, durationMin, startedAtTs}
let nextReady = null;        // {serviceKey, speed, durationMin}
let dayLog = [];             // basic day log (MVP)

function pad2(n){ return String(n).padStart(2, '0'); }

function fmtMMSS(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const m = Math.floor(s/60);
  const r = s % 60;
  return `${pad2(m)}:${pad2(r)}`;
}

function fmtHHMM(ts){
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtDurHM(min){
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function setMode(mode){ ringBtn.dataset.mode = mode; }

function setProgress(p01){
  // UI only: ya no animamos el progreso. Dejamos el aro completo y
  // ocultamos el "cap" para evitar la sensación de cuenta regresiva.
  ringProgress.style.strokeDashoffset = `0`;
  ringCap.style.opacity = '0';
}

function tick(){
  const now = Date.now();
  const elapsed = now - startTs;

  if (elapsed <= baseMs){
    const remaining = baseMs - elapsed;
    const mode = (remaining <= WARNING_MS) ? 'warning' : 'normal';
    setMode(mode);
    if (lastMode !== mode){
      lastMode = mode;
      // si veníamos de overtime, habilitamos volver a avisar cuando entre otra vez
      if (mode !== 'overtime') warnedOvertime = false;
    }

    ringState.textContent = 'FINALIZAR';
    ringTime.textContent = fmtMMSS(remaining);

    const endTs = startTs + baseMs;
    ringEnd.textContent = `Termina ${fmtHHMM(endTs)}`;
    ringEnd.style.opacity = '1';

    ringMeta.textContent = currentService ? `En proceso: ${serviceLabel(currentService.serviceKey)}` : 'En proceso';

    setProgress(elapsed / baseMs);
  } else {
    setMode('overtime');
    if (lastMode !== 'overtime'){
      lastMode = 'overtime';
      if (!warnedOvertime){
        feedback('warn');
        overtimeAlert();
        warnedOvertime = true;
      }
    }

    ringState.textContent = 'FINALIZAR';
    ringTime.textContent = `+${fmtMMSS(elapsed - baseMs)}`;
    ringEnd.textContent = 'Fuera de horario';
    ringEnd.style.opacity = '0.75';
    ringMeta.textContent = currentService ? `Demora: ${serviceLabel(currentService.serviceKey)}` : 'Demora';

    const over = elapsed - baseMs;
    const cycle = (over % baseMs) / baseMs;
    setProgress(cycle);
  }

  rafId = requestAnimationFrame(tick);
}

function startTimer(durationMs){
  // feedback here is enough; keep it consistent
  feedback('open');

  running = true;
  ringBtn.dataset.running = '1';
  baseMs = durationMs;
  startTs = Date.now();
  lastMode = 'normal';
  warnedOvertime = false;

  setMode('normal');
  ringCap.style.opacity = '0';
  ringProgress.style.opacity = '1';

  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function stopTimer(){
  feedback('soft');

  running = false;
  ringBtn.dataset.running = '0';
  cancelAnimationFrame(rafId);
  rafId = null;

  setMode('normal');
  ringState.textContent = 'INICIAR';
  ringTime.textContent = '--:--';
  ringEnd.textContent = 'Termina --:--';

  if (nextReady){
    ringMeta.textContent = `Siguiente: ${serviceLabel(nextReady.serviceKey)}`;
    ringEnd.textContent = 'Listo para iniciar';
  } else {
    ringMeta.textContent = 'Libre';
  }

  // UI only: en reposo el progreso no debe verse.
  setProgress(1);
  ringProgress.style.opacity = '0.35';
  ringCap.style.opacity = '0';
}

// ===== SERVICES / RULES (CONFIGURABLE) =====
const STORAGE_KEY_CONFIG = 'bt_vip_config_v1';
const STORAGE_KEY_LOG = 'bt_vip_log_v1';

const DEFAULT_CONFIG = {
  serviceBaseMin: {
    cut: 30,
    cutBeard: 45,
    cutBeardSeal: 60,
    color: 170,
    perm: 160
  },
  sealDeltaMin: { fast: 15, normal: 20, slow: 25 },
  speedDeltaFast: -10,
  speedDeltaSlowShort: 10, // <=60
  speedDeltaSlowLong: 15,  // >60
  yellowThresholdMin: 10,
  limits: [
    { label: '13:00', hour: 13, min: 0 },
    { label: '22:00', hour: 22, min: 0 }
  ]
};

function loadConfig(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    // merge shallow
    const cfg = structuredClone(DEFAULT_CONFIG);
    Object.assign(cfg.serviceBaseMin, parsed.serviceBaseMin || {});
    Object.assign(cfg.sealDeltaMin, parsed.sealDeltaMin || {});
    if (Number.isFinite(parsed.speedDeltaFast)) cfg.speedDeltaFast = parsed.speedDeltaFast;
    if (Number.isFinite(parsed.speedDeltaSlowShort)) cfg.speedDeltaSlowShort = parsed.speedDeltaSlowShort;
    if (Number.isFinite(parsed.speedDeltaSlowLong)) cfg.speedDeltaSlowLong = parsed.speedDeltaSlowLong;
    if (Number.isFinite(parsed.yellowThresholdMin)) cfg.yellowThresholdMin = parsed.yellowThresholdMin;
    if (Array.isArray(parsed.limits) && parsed.limits.length===2) cfg.limits = parsed.limits;
    return cfg;
  }catch(_){
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig(cfg){
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg));
}

let config = loadConfig();

function speedDeltaMin(serviceKey, speed){
  if (speed === 'normal') return 0;
  if (speed === 'fast') return config.speedDeltaFast;

  // slow
  const baseForRule = (serviceKey === 'cutSeal')
    ? (config.serviceBaseMin.cut + config.sealDeltaMin.normal)
    : (config.serviceBaseMin[serviceKey] ?? 0);

  return (baseForRule > 60) ? config.speedDeltaSlowLong : config.speedDeltaSlowShort;
}

function calcDurationMin(serviceKey, speed){
  if (serviceKey === 'cutSeal'){
    return Math.max(5, (config.serviceBaseMin.cut + (config.sealDeltaMin[speed] ?? 0)));
  }
  const base = config.serviceBaseMin[serviceKey];
  return Math.max(5, base + speedDeltaMin(serviceKey, speed));
}

function loadLog(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY_LOG);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(_){
    return [];
  }
}

function saveLog(){
  try{ localStorage.setItem(STORAGE_KEY_LOG, JSON.stringify(dayLog)); }catch(_){ }
}

// Load persisted log
dayLog = loadLog();
// Back-compat: ensure each log item has a stable id for delete actions
dayLog = (Array.isArray(dayLog) ? dayLog : []).map((it, idx) => {
  if (it && it.id) return it;
  const base = (it && (it.startTs || it.endTs)) ? (it.startTs || it.endTs) : Date.now();
  return { ...(it||{}), id: String(base) + '-' + String(idx) };
});
function serviceLabel(key){
  return {
    cut: 'Corte',
    cutBeard: 'Corte + Barba',
    cutSeal: 'Corte + Sellado',
    cutBeardSeal: 'Corte + Barba + Sellado',
    color: 'Color',
    perm: 'Permanente'
  }[key] || key;
}

function speedLabel(s){
  return s === 'fast' ? 'Rápido' : (s === 'slow' ? 'Lento' : 'Normal');
}

function fmtClockHHMM(ts){ return fmtHHMM(ts); }

// Limits + threshold (from config)

function getActiveLimit(nowTs){
  const d = new Date(nowTs);
  const minutesNow = d.getHours()*60 + d.getMinutes();
  const limits = config.limits;
  const limit = (minutesNow < limits[0].hour*60 + limits[0].min) ? limits[0] : limits[1];
  const limitTs = new Date(d);
  limitTs.setHours(limit.hour, limit.min, 0, 0);
  return { limit, limitTs: limitTs.getTime() };
}

function classifyByLimit(endTs){
  const { limitTs } = getActiveLimit(Date.now());
  if (endTs > limitTs) return { color: 'red' };
  if (limitTs - endTs <= (config.yellowThresholdMin*60000)) return { color: 'yellow' };
  return { color: 'ok' };
}

// ===== QUEUE =====
const queueList = document.getElementById('queueList');
let queue = []; // {serviceKey, speed, durationMin, startTs, endTs, status}

function buildPlanForNewItem(nowTs, serviceKey, speed, durationMin){
  if (!running){
    const startNew = nowTs;
    return { startTs: startNew, endTs: startNew + durationMin*60000, becomesCurrent: true };
  }

  const currentEstimatedEnd = startTs + baseMs;
  const lastEnd = queue.length ? queue[queue.length - 1].endTs : currentEstimatedEnd;
  const startNew = lastEnd;
  return { startTs: startNew, endTs: startNew + durationMin*60000, becomesCurrent: false };
}

function rebuildQueuePlans(){
  const now = Date.now();
  let cursor = running ? (startTs + baseMs) : now;

  queue = queue.map((it) => {
    const s = cursor;
    const e = s + it.durationMin*60000;
    cursor = e;
    const cls = classifyByLimit(e);
    return { ...it, startTs: s, endTs: e, status: cls.color };
  });
}

function waitMinutes(startTs_){
  const w = Math.ceil((startTs_ - Date.now())/60000);
  return Math.max(0, w);
}

function getLastPlannedEndTs(){
  const now = Date.now();
  const baseEnd = running ? (startTs + baseMs) : now;
  if (queue.length) return queue[queue.length - 1].endTs;
  return baseEnd;
}

const addClientBtn = document.getElementById('addClientBtn');
function updateAddButtonState(){
  const lastEndTs = getLastPlannedEndTs();
  const cls = classifyByLimit(lastEndTs);
  addClientBtn.dataset.state = cls.color === 'ok' ? 'ok' : cls.color;
}

function serviceIconSvg(key){
  const common = `width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="svc-ic"`;
  const icons = {
    cut: `
      <svg ${common}>
        <path d="M4.5 6.5l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M10.5 12.5l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M13.2 5.8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M19 4.9l-2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M12.9 11l-2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `,
    cutBeard: `
      <svg ${common}>
        <path d="M12 3c3 0 5 2 5 5v2c0 4-2.2 7-5 7s-5-3-5-7V8c0-3 2-5 5-5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M8.5 11.5c1.2 1 2.4 1.5 3.5 1.5s2.3-.5 3.5-1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M9 20h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `,
    cutSeal: `
      <svg ${common}>
        <path d="M7 7l10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M12 20c3-1 4-3 4-5 0-1.6-1-3.2-2.4-4.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `,
    cutBeardSeal: `
      <svg ${common}>
        <path d="M12 3c3 0 5 2 5 5v2c0 4-2.2 7-5 7s-5-3-5-7V8c0-3 2-5 5-5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M18.5 18.5c-1.1 2-3 3.1-6.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M19 10.5c.6 1.2.6 2.3 0 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `,
    color: `
      <svg ${common}>
        <path d="M12 3c3.5 2.2 6 5.3 6 8.2 0 3.2-2.7 5.8-6 5.8s-6-2.6-6-5.8C6 8.3 8.5 5.2 12 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `,
    perm: `
      <svg ${common}>
        <path d="M8 8c2-2 6-2 8 0s2 6 0 8-6 2-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M9 15c1.2 1.2 4.8 1.2 6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `
  };
  return icons[key] || `<svg ${common}><path d="M12 12h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
}

function renderQueue(){
  queueList.innerHTML = '';

  queue.forEach((it, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'swipe-item' + (idx === 0 ? ' is-next' : '');
    wrap.dataset.idx = String(idx);

    // UI: color del botón "Eliminar" según si el cliente cae dentro del límite horario.
    // (verde = dentro / rojo = se pasa)
    wrap.dataset.limit = (it.status === 'red') ? 'over' : 'in';

    const border = it.status === 'red'
      ? 'rgba(255,43,74,0.34)'
      : it.status === 'yellow'
      ? 'rgba(255,220,80,0.28)'
      : 'rgba(127,231,255,0.20)';

    const wait = waitMinutes(it.startTs);

    wrap.innerHTML = `
      <div class="swipe-delete">
        <button class="delete-btn" type="button" data-del="${idx}" data-state="${(it.status === 'red') ? 'danger' : 'safe'}" aria-label="Eliminar">Eliminar</button>
      </div>

      <div class="swipe-content" style="border-color:${border}">
        <div class="q-left">
          <div class="avatar">${serviceIconSvg(it.serviceKey)}</div>
          <div class="q-main">
            <div class="q-title">
              ${idx === 0 ? `<span class="next-badge">PRÓXIMO</span>` : ``}
              ${serviceLabel(it.serviceKey)}
            </div>
            <div class="q-badges">
              <span class="badge">${speedLabel(it.speed)} · ${it.durationMin}m</span>
              <span class="badge">Espera: ${wait}m</span>
            </div>
          </div>
        </div>
        <div class="q-right">
          <div class="q-wait">${wait}m</div>
          <div class="q-times">
            Inicio ${fmtClockHHMM(it.startTs)}<br/>
            Fin ${fmtClockHHMM(it.endTs)}
          </div>
          <div class="chev">›</div>
        </div>
      </div>
    `;

    queueList.appendChild(wrap);
  });

  updateAddButtonState();
}

function closeOpenSwipe(){
  const open = document.querySelector('.swipe-item.is-open');
  if (open) open.classList.remove('is-open');
}

// ===== FINALIZE / START FROM QUEUE (manual) =====
function finalizeCurrent(){
  const endTs = Date.now();

  if (currentService){
    const realMin = Math.max(1, Math.round((endTs - currentService.startedAtTs)/60000));
    dayLog.push({
      id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
      serviceKey: currentService.serviceKey,
      speed: currentService.speed,
      startTs: currentService.startedAtTs,
      endTs,
      estimatedMin: currentService.durationMin,
      realMin
    });
    saveLog();
  }

  currentService = null;
  stopTimer();

  // rebuild queue based on actual finish (now)
  rebuildQueuePlans();

  if (queue.length){
    nextReady = {
      serviceKey: queue[0].serviceKey,
      speed: queue[0].speed,
      durationMin: queue[0].durationMin
    };
    ringMeta.textContent = `Siguiente: ${serviceLabel(nextReady.serviceKey)}`;
    ringEnd.textContent = 'Listo para iniciar';
  } else {
    nextReady = null;
    ringMeta.textContent = 'Libre';
    ringEnd.textContent = 'Termina --:--';
  }

  renderQueue();
  updateAddButtonState();
}

function startFromQueueHead(){
  if (!queue.length || !nextReady) return;

  const item = queue.shift();

  currentService = {
    serviceKey: item.serviceKey,
    speed: item.speed,
    durationMin: item.durationMin,
    startedAtTs: Date.now()
  };

  nextReady = null;
  startTimer(item.durationMin*60000);

  rebuildQueuePlans();
  renderQueue();
  updateAddButtonState();
}

// ===== MODAL =====
const clientModal = document.getElementById('clientModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalSubtitle = document.getElementById('modalSubtitle');
const stepSpeed = document.getElementById('stepSpeed');
const stepService = document.getElementById('stepService');
const chipSpeed = document.getElementById('chipSpeed');
const chipHint = document.getElementById('chipHint');
const limitAlert = document.getElementById('limitAlert');
const alertMsg = document.getElementById('alertMsg');
const alertCancel = document.getElementById('alertCancel');
const alertOk = document.getElementById('alertOk');

let selectedSpeed = null;
let pendingSelection = null;

function openModal(){
  feedback('open');
  clientModal.classList.add('is-open');
  clientModal.setAttribute('aria-hidden','false');
  resetModal();
}

function closeModal(){
  feedback('soft');
  clientModal.classList.remove('is-open');
  clientModal.setAttribute('aria-hidden','true');
}

function resetModal(){
  selectedSpeed = null;
  pendingSelection = null;
  limitAlert.classList.add('is-hidden');

  modalSubtitle.textContent = 'Elegí velocidad';
  stepSpeed.classList.remove('is-hidden');
  stepService.classList.add('is-hidden');

  clientModal.querySelectorAll('.bubble').forEach(b => b.classList.remove('is-selected'));

  chipSpeed.textContent = 'Velocidad: —';
  chipHint.textContent = 'Elegí un servicio';
}

addClientBtn.addEventListener('click', openModal);
modalCloseBtn.addEventListener('click', closeModal);

clientModal.addEventListener('click', (e) => {
  const close = e.target?.dataset?.close === 'true';
  if (close) closeModal();
});

// Speed step
stepSpeed.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-speed]');
  if (!btn) return;

  feedback('select');
  selectedSpeed = btn.dataset.speed;

  stepSpeed.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('is-selected'));
  btn.classList.add('is-selected');

  modalSubtitle.textContent = 'Elegí servicio';
  chipSpeed.textContent = `Velocidad: ${selectedSpeed === 'fast' ? 'Rápido' : selectedSpeed === 'slow' ? 'Lento' : 'Normal'}`;

  stepSpeed.classList.add('is-hidden');
  stepService.classList.remove('is-hidden');
});

// Service step
stepService.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-service]');
  if (!btn || !selectedSpeed) return;

  feedback('select');

  const serviceKey = btn.dataset.service;
  stepService.querySelectorAll('[data-service]').forEach(b => b.classList.remove('is-selected'));
  btn.classList.add('is-selected');

  const durationMin = calcDurationMin(serviceKey, selectedSpeed);
  chipHint.textContent = `Tiempo: ${durationMin} min`;

  const now = Date.now();
  const plan = buildPlanForNewItem(now, serviceKey, selectedSpeed, durationMin);
  const cls = classifyByLimit(plan.endTs);

  if (cls.color === 'red'){
    feedback('warn');
    pendingSelection = { serviceKey, speed: selectedSpeed, durationMin, plan, cls };
    const { limitTs } = getActiveLimit(now);
    alertMsg.textContent = `Terminarías ${fmtClockHHMM(plan.endTs)} (límite ${fmtClockHHMM(limitTs)}).`;
    limitAlert.classList.remove('is-hidden');
    return;
  }

  applyNewItem({ serviceKey, speed: selectedSpeed, durationMin, plan, cls });
  closeModal();
});

alertCancel.addEventListener('click', () => {
  feedback('soft');
  pendingSelection = null;
  limitAlert.classList.add('is-hidden');
});

alertOk.addEventListener('click', () => {
  if (!pendingSelection) return;
  feedback('open');
  applyNewItem(pendingSelection);
  pendingSelection = null;
  closeModal();
});

function applyNewItem(sel){
  const { serviceKey, speed, durationMin, plan } = sel;

  if (plan.becomesCurrent){
    currentService = { serviceKey, speed, durationMin, startedAtTs: Date.now() };
    nextReady = null;
    startTimer(durationMin*60000);
    updateAddButtonState();
    return;
  }

  queue.push({
    serviceKey,
    speed,
    durationMin,
    startTs: plan.startTs,
    endTs: plan.endTs,
    status: classifyByLimit(plan.endTs).color
  });

  rebuildQueuePlans();
  renderQueue();
  updateAddButtonState();
}

// ===== RING CLICK BEHAVIOR (manual next) =====
ringBtn.addEventListener('click', (e) => {
  // UX: solo activar si el toque fue sobre el círculo central visible.
  // (El hitbox de un <button> es rectangular; validamos por distancia.)
  const core = ringBtn.querySelector('.ring-content');
  if (core && typeof e.clientX === 'number' && typeof e.clientY === 'number'){
    const r = core.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const cy = r.top + r.height/2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const rad = Math.min(r.width, r.height)/2;
    if (dist > rad) return;
  }
  tapHaptic();
  if (running){
    finalizeCurrent();
    return;
  }

  if (nextReady){
    feedback('open');
    startFromQueueHead();
    return;
  }

  openModal();
});

// ===== SWIPE TO DELETE (iOS-style) =====
let swipeStartX = 0;
let swipeCurrentX = 0;
let swipeDragging = false;

document.addEventListener('click', (e) => {
  const inside = e.target.closest('.swipe-item');
  if (!inside) closeOpenSwipe();
});

queueList.addEventListener('touchstart', (e) => {
  const item = e.target.closest('.swipe-item');
  if (!item) return;

  const open = document.querySelector('.swipe-item.is-open');
  if (open && open !== item) open.classList.remove('is-open');

  swipeDragging = true;
  swipeStartX = e.touches[0].clientX;
  swipeCurrentX = swipeStartX;

  const content = item.querySelector('.swipe-content');
  if (content) content.style.transition = 'none';
}, { passive: true });

queueList.addEventListener('touchmove', (e) => {
  if (!swipeDragging) return;
  const item = e.target.closest('.swipe-item');
  if (!item) return;

  swipeCurrentX = e.touches[0].clientX;
  const dx = swipeCurrentX - swipeStartX;

  const max = -110;
  const clamped = Math.max(max, Math.min(0, dx));

  const content = item.querySelector('.swipe-content');
  if (content) content.style.transform = `translateX(${clamped}px)`;
}, { passive: true });

queueList.addEventListener('touchend', (e) => {
  if (!swipeDragging) return;
  swipeDragging = false;

  const item = e.target.closest('.swipe-item');
  if (!item) return;

  const content = item.querySelector('.swipe-content');
  if (!content) return;

  content.style.transition = 'transform .18s ease';

  const dx = swipeCurrentX - swipeStartX;
  if (dx < -50){
    feedback('open');
    item.classList.add('is-open');
    content.style.transform = 'translateX(-110px)';
  } else {
    item.classList.remove('is-open');
    content.style.transform = 'translateX(0px)';
  }
});

queueList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (!del) return;

  const idx = Number(del.dataset.del);
  if (Number.isNaN(idx)) return;

  const itemEl = del.closest('.swipe-item');
  if (!itemEl) return;

  feedback('delete');
  itemEl.classList.add('is-removing');

  setTimeout(() => {
    queue.splice(idx, 1);
    rebuildQueuePlans();
    closeOpenSwipe();
    renderQueue();
    updateAddButtonState();
  }, 180);
});

queueList.addEventListener('click', (e) => {
  const item = e.target.closest('.swipe-item');
  if (!item) return;
  if (item.classList.contains('is-open') && !e.target.closest('[data-del]')){
    closeOpenSwipe();
  }
});

// ===== SETTINGS + LOG UI =====
const settingsBtn = document.getElementById('settingsBtn');
const logBtn = document.getElementById('logBtn');

const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const settingsResetBtn = document.getElementById('settingsResetBtn');

const logModal = document.getElementById('logModal');
const logCloseBtn = document.getElementById('logCloseBtn');
const logClearBtn = document.getElementById('logClearBtn');
const logCopyBtn = document.getElementById('logCopyBtn');
const logClients = document.getElementById('logClients');
const logTotal = document.getElementById('logTotal');
const logList = document.getElementById('logList');

// settings inputs
const set_cut = document.getElementById('set_cut');
const set_cutBeard = document.getElementById('set_cutBeard');
const set_cutBeardSeal = document.getElementById('set_cutBeardSeal');
const set_color = document.getElementById('set_color');
const set_perm = document.getElementById('set_perm');

const set_seal_fast = document.getElementById('set_seal_fast');
const set_seal_normal = document.getElementById('set_seal_normal');
const set_seal_slow = document.getElementById('set_seal_slow');

const set_fast_delta = document.getElementById('set_fast_delta');
const set_slow_short = document.getElementById('set_slow_short');
const set_slow_long = document.getElementById('set_slow_long');

function openAnyModal(el){
  if (!el) return;
  feedback('open');
  el.classList.add('is-open');
  el.setAttribute('aria-hidden','false');
}
function closeAnyModal(el){
  if (!el) return;
  feedback('soft');
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden','true');
}

// ===== UI only: Personalización del fondo del botón central =====
const btnBgPickBtn = document.getElementById('btnBgPickBtn');
const btnBgRemoveBtn = document.getElementById('btnBgRemoveBtn');
const btnBgFile = document.getElementById('btnBgFile');

const btnBgModal = document.getElementById('btnBgModal');
const btnBgCanvas = document.getElementById('btnBgCanvas');
const btnBgCircle = document.getElementById('btnBgCircle');
const btnBgCancel = document.getElementById('btnBgCancel');
const btnBgDone = document.getElementById('btnBgDone');
const btnBgZoomIn = document.getElementById('btnBgZoomIn');
const btnBgZoomOut = document.getElementById('btnBgZoomOut');

// UI only: Personalización del fondo de la app
const appBgPickBtn = document.getElementById('appBgPickBtn');
const appBgRemoveBtn = document.getElementById('appBgRemoveBtn');
const appBgFile = document.getElementById('appBgFile');

const appBgModal = document.getElementById('appBgModal');
const appBgCanvas = document.getElementById('appBgCanvas');
const appBgCancel = document.getElementById('appBgCancel');
const appBgDone = document.getElementById('appBgDone');
const appBgZoomIn = document.getElementById('appBgZoomIn');
const appBgZoomOut = document.getElementById('appBgZoomOut');

let editorImg = null;
let editorScale = 1;
let editorOffX = 0;
let editorOffY = 0;
let editorDpr = 1;
let editorStageRect = null;
let editorCircleRect = null;
let editorPointers = new Map(); // pointerId -> {x,y}
let editorPinchStart = null; // {dist, scale, midX, midY, offX, offY}
let editorRaf = 0;

let appEditorImg = null;
let appEditorScale = 1;
let appEditorOffX = 0;
let appEditorOffY = 0;
let appEditorDpr = 1;
let appEditorStageRect = null;
let appEditorPointers = new Map();
let appEditorPinchStart = null;
let appEditorRaf = 0;

function openBtnBgEditor(){
  if (!btnBgModal) return;
  openAnyModal(btnBgModal);
  // wait layout
  setTimeout(resizeBtnBgCanvas, 0);
}

function closeBtnBgEditor(){
  if (!btnBgModal) return;
  closeAnyModal(btnBgModal);
  editorPointers.clear();
  editorPinchStart = null;
}

function resizeBtnBgCanvas(){
  if (!btnBgCanvas) return;
  const stage = btnBgCanvas.closest('.editor-stage');
  if (!stage) return;
  editorStageRect = stage.getBoundingClientRect();
  editorCircleRect = btnBgCircle?.getBoundingClientRect?.() || null;
  editorDpr = Math.min(2.5, window.devicePixelRatio || 1);

  const w = Math.max(1, Math.round(editorStageRect.width * editorDpr));
  const h = Math.max(1, Math.round(editorStageRect.height * editorDpr));
  if (btnBgCanvas.width !== w) btnBgCanvas.width = w;
  if (btnBgCanvas.height !== h) btnBgCanvas.height = h;

  requestEditorDraw();
}

function requestEditorDraw(){
  if (editorRaf) return;
  editorRaf = requestAnimationFrame(()=>{
    editorRaf = 0;
    drawBtnBgEditor();
  });
}

function drawBtnBgEditor(){
  const ctx = btnBgCanvas?.getContext?.('2d');
  if (!ctx || !editorStageRect) return;
  const w = btnBgCanvas.width;
  const h = btnBgCanvas.height;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,w,h);
  // subtle checker background
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0,0,w,h);

  if (!editorImg) return;

  // convert offsets/scale from CSS px -> device px
  const s = editorScale * editorDpr;
  const ox = editorOffX * editorDpr;
  const oy = editorOffY * editorDpr;

  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(editorImg, 0, 0);
}

function editorCircleInfo(){
  if (!editorStageRect || !editorCircleRect) return null;
  const cx = (editorCircleRect.left - editorStageRect.left) + (editorCircleRect.width/2);
  const cy = (editorCircleRect.top - editorStageRect.top) + (editorCircleRect.height/2);
  const r = Math.min(editorCircleRect.width, editorCircleRect.height)/2;
  return { cx, cy, r };
}

function fitImageToCircle(){
  if (!editorImg) return;
  const info = editorCircleInfo();
  if (!info) return;

  // scale so the image covers the circle
  const cover = Math.max((info.r*2) / editorImg.width, (info.r*2) / editorImg.height);
  editorScale = cover;
  // center image on circle
  const imgW = editorImg.width * editorScale;
  const imgH = editorImg.height * editorScale;
  editorOffX = info.cx - imgW/2;
  editorOffY = info.cy - imgH/2;
  requestEditorDraw();
}

function clampImageToCircle(){
  if (!editorImg) return;
  const info = editorCircleInfo();
  if (!info) return;
  const imgW = editorImg.width * editorScale;
  const imgH = editorImg.height * editorScale;

  // bounds so circle always covered
  const minX = info.cx - imgW + info.r;
  const maxX = info.cx - info.r;
  const minY = info.cy - imgH + info.r;
  const maxY = info.cy - info.r;

  editorOffX = Math.min(maxX, Math.max(minX, editorOffX));
  editorOffY = Math.min(maxY, Math.max(minY, editorOffY));
}

function setEditorScaleAroundPoint(newScale, px, py){
  const old = editorScale;
  newScale = Math.max(0.25, Math.min(6, newScale));
  const k = newScale / old;
  // keep point stable
  editorOffX = px - (px - editorOffX) * k;
  editorOffY = py - (py - editorOffY) * k;
  editorScale = newScale;
  clampImageToCircle();
  requestEditorDraw();
}

function openPickedImage(file){
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    editorImg = img;
    openBtnBgEditor();
    // wait for canvas sizing then fit
    setTimeout(()=>{
      resizeBtnBgCanvas();
      fitImageToCircle();
    }, 0);
  };
  img.src = url;
}

function saveCroppedButtonImage(){
  if (!editorImg) return;
  const info = editorCircleInfo();
  if (!info) return;

  const OUT = 512;
  const out = document.createElement('canvas');
  out.width = OUT;
  out.height = OUT;
  const ctx = out.getContext('2d');
  if (!ctx) return;

  // map editor coords -> output coords
  const k = (OUT/2) / info.r;
  const scaleOut = editorScale * k;
  const offXOut = (editorOffX - info.cx) * k + OUT/2;
  const offYOut = (editorOffY - info.cy) * k + OUT/2;

  ctx.clearRect(0,0,OUT,OUT);
  ctx.save();
  ctx.beginPath();
  ctx.arc(OUT/2, OUT/2, OUT/2, 0, Math.PI*2);
  ctx.closePath();
  ctx.clip();

  ctx.setTransform(scaleOut, 0, 0, scaleOut, offXOut, offYOut);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(editorImg, 0, 0);
  ctx.restore();

  try{
    const dataUrl = out.toDataURL('image/jpeg', 0.92);
    localStorage.setItem(STORAGE_KEY_BTN_BG, dataUrl);
  }catch(_){
    // if storage fails, skip
  }
  applyButtonBackground();
}

// UI hooks
btnBgPickBtn?.addEventListener('click', () => {
  feedback('open');
  btnBgFile?.click();
});

btnBgRemoveBtn?.addEventListener('click', () => {
  feedback('delete');
  try{ localStorage.removeItem(STORAGE_KEY_BTN_BG); }catch(_){ }
  applyButtonBackground();
});

btnBgFile?.addEventListener('change', () => {
  const f = btnBgFile.files?.[0];
  // reset input so can pick same file again
  btnBgFile.value = '';
  if (f) openPickedImage(f);
});

btnBgCancel?.addEventListener('click', closeBtnBgEditor);
btnBgDone?.addEventListener('click', () => {
  feedback('select');
  saveCroppedButtonImage();
  closeBtnBgEditor();
});

btnBgZoomIn?.addEventListener('click', () => {
  const info = editorCircleInfo();
  if (!info) return;
  setEditorScaleAroundPoint(editorScale * 1.08, info.cx, info.cy);
});

btnBgZoomOut?.addEventListener('click', () => {
  const info = editorCircleInfo();
  if (!info) return;
  setEditorScaleAroundPoint(editorScale / 1.08, info.cx, info.cy);
});

// Pointer interactions (pan / pinch)
btnBgCanvas?.addEventListener('pointerdown', (e)=>{
  if (!editorImg) return;
  btnBgCanvas.setPointerCapture?.(e.pointerId);
  editorPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (editorPointers.size === 2){
    const pts = Array.from(editorPointers.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx,dy);
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    // convert mid to stage local coords
    const sx = (midX - editorStageRect.left);
    const sy = (midY - editorStageRect.top);
    editorPinchStart = { dist, scale: editorScale, midX: sx, midY: sy, offX: editorOffX, offY: editorOffY };
  } else {
    editorPinchStart = null;
  }
});

btnBgCanvas?.addEventListener('pointermove', (e)=>{
  if (!editorImg) return;
  if (!editorPointers.has(e.pointerId)) return;
  const prev = editorPointers.get(e.pointerId);
  editorPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (editorPointers.size === 1 && prev){
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    editorOffX += dx;
    editorOffY += dy;
    clampImageToCircle();
    requestEditorDraw();
    return;
  }

  if (editorPointers.size === 2 && editorPinchStart){
    const pts = Array.from(editorPointers.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx,dy);
    const scale = editorPinchStart.scale * (dist / editorPinchStart.dist);
    setEditorScaleAroundPoint(scale, editorPinchStart.midX, editorPinchStart.midY);
  }
});

function endPointer(e){
  if (!editorPointers.has(e.pointerId)) return;
  editorPointers.delete(e.pointerId);
  if (editorPointers.size < 2) editorPinchStart = null;
}
btnBgCanvas?.addEventListener('pointerup', endPointer);
btnBgCanvas?.addEventListener('pointercancel', endPointer);

window.addEventListener('resize', () => {
  if (btnBgModal?.classList.contains('is-open')) resizeBtnBgCanvas();
});

// ===== UI only: Personalización del fondo de la app (editor pantalla) =====
function openAppBgEditor(){
  if (!appBgModal) return;
  openAnyModal(appBgModal);
  setTimeout(resizeAppBgCanvas, 0);
}

function closeAppBgEditor(){
  if (!appBgModal) return;
  closeAnyModal(appBgModal);
  appEditorPointers.clear();
  appEditorPinchStart = null;
}

function resizeAppBgCanvas(){
  if (!appBgCanvas) return;
  const stage = appBgCanvas.closest('.editor-stage');
  if (!stage) return;
  appEditorStageRect = stage.getBoundingClientRect();
  appEditorDpr = Math.min(2.5, window.devicePixelRatio || 1);

  const w = Math.max(1, Math.round(appEditorStageRect.width * appEditorDpr));
  const h = Math.max(1, Math.round(appEditorStageRect.height * appEditorDpr));
  if (appBgCanvas.width !== w) appBgCanvas.width = w;
  if (appBgCanvas.height !== h) appBgCanvas.height = h;
  requestAppEditorDraw();
}

function requestAppEditorDraw(){
  if (appEditorRaf) return;
  appEditorRaf = requestAnimationFrame(()=>{
    appEditorRaf = 0;
    drawAppBgEditor();
  });
}

function drawAppBgEditor(){
  const ctx = appBgCanvas?.getContext?.('2d');
  if (!ctx || !appEditorStageRect) return;
  const w = appBgCanvas.width;
  const h = appBgCanvas.height;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0,0,w,h);
  if (!appEditorImg) return;
  const s = appEditorScale * appEditorDpr;
  const ox = appEditorOffX * appEditorDpr;
  const oy = appEditorOffY * appEditorDpr;
  ctx.setTransform(s,0,0,s,ox,oy);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(appEditorImg,0,0);
}

function fitImageToStage(){
  if (!appEditorImg || !appEditorStageRect) return;
  const stageW = appEditorStageRect.width;
  const stageH = appEditorStageRect.height;
  const cover = Math.max(stageW / appEditorImg.width, stageH / appEditorImg.height);
  appEditorScale = cover;
  const imgW = appEditorImg.width * appEditorScale;
  const imgH = appEditorImg.height * appEditorScale;
  appEditorOffX = (stageW - imgW) / 2;
  appEditorOffY = (stageH - imgH) / 2;
  clampImageToStage();
  requestAppEditorDraw();
}

function clampImageToStage(){
  if (!appEditorImg || !appEditorStageRect) return;
  const stageW = appEditorStageRect.width;
  const stageH = appEditorStageRect.height;
  const imgW = appEditorImg.width * appEditorScale;
  const imgH = appEditorImg.height * appEditorScale;
  const minX = stageW - imgW;
  const maxX = 0;
  const minY = stageH - imgH;
  const maxY = 0;
  appEditorOffX = Math.min(maxX, Math.max(minX, appEditorOffX));
  appEditorOffY = Math.min(maxY, Math.max(minY, appEditorOffY));
}

function setAppEditorScaleAroundPoint(newScale, px, py){
  const old = appEditorScale;
  newScale = Math.max(0.25, Math.min(6, newScale));
  const k = newScale / old;
  appEditorOffX = px - (px - appEditorOffX) * k;
  appEditorOffY = py - (py - appEditorOffY) * k;
  appEditorScale = newScale;
  clampImageToStage();
  requestAppEditorDraw();
}

function openPickedAppBgImage(file){
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    appEditorImg = img;
    openAppBgEditor();
    setTimeout(()=>{
      resizeAppBgCanvas();
      fitImageToStage();
    }, 0);
  };
  img.src = url;
}

function saveAppBackgroundImage(){
  if (!appEditorImg || !appEditorStageRect) return;
  const stageW = Math.max(1, appEditorStageRect.width);
  const stageH = Math.max(1, appEditorStageRect.height);
  const maxDim = 1600;
  const scale = Math.min(maxDim / stageW, maxDim / stageH, 2);
  const OUTW = Math.max(480, Math.round(stageW * scale));
  const OUTH = Math.max(480, Math.round(stageH * scale));

  const out = document.createElement('canvas');
  out.width = OUTW;
  out.height = OUTH;
  const ctx = out.getContext('2d');
  if (!ctx) return;

  const kx = OUTW / stageW;
  const ky = OUTH / stageH;
  const s = appEditorScale * kx;
  const ox = appEditorOffX * kx;
  const oy = appEditorOffY * ky;
  ctx.clearRect(0,0,OUTW,OUTH);
  ctx.setTransform(s,0,0,s,ox,oy);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(appEditorImg,0,0);

  try{
    const dataUrl = out.toDataURL('image/jpeg', 0.9);
    localStorage.setItem(STORAGE_KEY_APP_BG, dataUrl);
  }catch(_){ }
  applyAppBackground();
}

// UI hooks (app background)
appBgPickBtn?.addEventListener('click', () => {
  feedback('open');
  appBgFile?.click();
});

appBgRemoveBtn?.addEventListener('click', () => {
  feedback('delete');
  try{ localStorage.removeItem(STORAGE_KEY_APP_BG); }catch(_){ }
  applyAppBackground();
});

appBgFile?.addEventListener('change', () => {
  const f = appBgFile.files?.[0];
  appBgFile.value = '';
  if (f) openPickedAppBgImage(f);
});

appBgCancel?.addEventListener('click', closeAppBgEditor);
appBgDone?.addEventListener('click', () => {
  feedback('select');
  saveAppBackgroundImage();
  closeAppBgEditor();
});

appBgZoomIn?.addEventListener('click', () => {
  if (!appEditorStageRect) return;
  setAppEditorScaleAroundPoint(appEditorScale * 1.08, appEditorStageRect.width/2, appEditorStageRect.height/2);
});

appBgZoomOut?.addEventListener('click', () => {
  if (!appEditorStageRect) return;
  setAppEditorScaleAroundPoint(appEditorScale / 1.08, appEditorStageRect.width/2, appEditorStageRect.height/2);
});

appBgCanvas?.addEventListener('pointerdown', (e)=>{
  if (!appEditorImg) return;
  appBgCanvas.setPointerCapture?.(e.pointerId);
  appEditorPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (appEditorPointers.size === 2){
    const pts = Array.from(appEditorPointers.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx,dy);
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const sx = (midX - appEditorStageRect.left);
    const sy = (midY - appEditorStageRect.top);
    appEditorPinchStart = { dist, scale: appEditorScale, midX: sx, midY: sy };
  } else {
    appEditorPinchStart = null;
  }
});

appBgCanvas?.addEventListener('pointermove', (e)=>{
  if (!appEditorImg) return;
  if (!appEditorPointers.has(e.pointerId)) return;
  const prev = appEditorPointers.get(e.pointerId);
  appEditorPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (appEditorPointers.size === 1 && prev){
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    appEditorOffX += dx;
    appEditorOffY += dy;
    clampImageToStage();
    requestAppEditorDraw();
    return;
  }

  if (appEditorPointers.size === 2 && appEditorPinchStart){
    const pts = Array.from(appEditorPointers.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    const dist = Math.hypot(dx,dy);
    const scale = appEditorPinchStart.scale * (dist / appEditorPinchStart.dist);
    setAppEditorScaleAroundPoint(scale, appEditorPinchStart.midX, appEditorPinchStart.midY);
  }
});

function endAppPointer(e){
  if (!appEditorPointers.has(e.pointerId)) return;
  appEditorPointers.delete(e.pointerId);
  if (appEditorPointers.size < 2) appEditorPinchStart = null;
}
appBgCanvas?.addEventListener('pointerup', endAppPointer);
appBgCanvas?.addEventListener('pointercancel', endAppPointer);

window.addEventListener('resize', () => {
  if (appBgModal?.classList.contains('is-open')) resizeAppBgCanvas();
});

// close by backdrop
document.addEventListener('click', (e)=>{
  const b = e.target.closest('.modal-backdrop');
  if (!b) return;
  const modal = b.closest('.modal');
  if (modal) closeAnyModal(modal);
});

function fillSettingsForm(){
  set_cut.value = config.serviceBaseMin.cut;
  set_cutBeard.value = config.serviceBaseMin.cutBeard;
  set_cutBeardSeal.value = config.serviceBaseMin.cutBeardSeal;
  set_color.value = config.serviceBaseMin.color;
  set_perm.value = config.serviceBaseMin.perm;

  set_seal_fast.value = config.sealDeltaMin.fast;
  set_seal_normal.value = config.sealDeltaMin.normal;
  set_seal_slow.value = config.sealDeltaMin.slow;

  set_fast_delta.value = config.speedDeltaFast;
  set_slow_short.value = config.speedDeltaSlowShort;
  set_slow_long.value = config.speedDeltaSlowLong;
}

function readInt(input, fallback){
  const v = Number(input?.value);
  return Number.isFinite(v) ? v : fallback;
}

function applyConfigFromForm(){
  const cfg = structuredClone(config);

  cfg.serviceBaseMin.cut = readInt(set_cut, cfg.serviceBaseMin.cut);
  cfg.serviceBaseMin.cutBeard = readInt(set_cutBeard, cfg.serviceBaseMin.cutBeard);
  cfg.serviceBaseMin.cutBeardSeal = readInt(set_cutBeardSeal, cfg.serviceBaseMin.cutBeardSeal);
  cfg.serviceBaseMin.color = readInt(set_color, cfg.serviceBaseMin.color);
  cfg.serviceBaseMin.perm = readInt(set_perm, cfg.serviceBaseMin.perm);

  cfg.sealDeltaMin.fast = readInt(set_seal_fast, cfg.sealDeltaMin.fast);
  cfg.sealDeltaMin.normal = readInt(set_seal_normal, cfg.sealDeltaMin.normal);
  cfg.sealDeltaMin.slow = readInt(set_seal_slow, cfg.sealDeltaMin.slow);

  cfg.speedDeltaFast = readInt(set_fast_delta, cfg.speedDeltaFast);
  cfg.speedDeltaSlowShort = readInt(set_slow_short, cfg.speedDeltaSlowShort);
  cfg.speedDeltaSlowLong = readInt(set_slow_long, cfg.speedDeltaSlowLong);

  // sanitize
  cfg.serviceBaseMin.cut = Math.max(5, cfg.serviceBaseMin.cut);
  cfg.serviceBaseMin.cutBeard = Math.max(5, cfg.serviceBaseMin.cutBeard);
  cfg.serviceBaseMin.cutBeardSeal = Math.max(5, cfg.serviceBaseMin.cutBeardSeal);
  cfg.serviceBaseMin.color = Math.max(5, cfg.serviceBaseMin.color);
  cfg.serviceBaseMin.perm = Math.max(5, cfg.serviceBaseMin.perm);
  cfg.sealDeltaMin.fast = Math.max(0, cfg.sealDeltaMin.fast);
  cfg.sealDeltaMin.normal = Math.max(0, cfg.sealDeltaMin.normal);
  cfg.sealDeltaMin.slow = Math.max(0, cfg.sealDeltaMin.slow);

  config = cfg;
  saveConfig(config);

  // If there are queued clients, recompute their durations in-place (keep service + speed)
  queue = queue.map(q => ({...q, durationMin: calcDurationMin(q.serviceKey, q.speed)}));
  rebuildQueuePlans();
  renderQueue();
  updateAddButtonState();
}

function resetConfig(){
  config = structuredClone(DEFAULT_CONFIG);
  saveConfig(config);
  fillSettingsForm();
  queue = queue.map(q => ({...q, durationMin: calcDurationMin(q.serviceKey, q.speed)}));
  rebuildQueuePlans();
  renderQueue();
  updateAddButtonState();
}

settingsBtn?.addEventListener('click', ()=>{
  fillSettingsForm();
  openAnyModal(settingsModal);
});
settingsCloseBtn?.addEventListener('click', ()=> closeAnyModal(settingsModal));
settingsSaveBtn?.addEventListener('click', ()=>{
  feedback('select');
  applyConfigFromForm();
  closeAnyModal(settingsModal);
});
settingsResetBtn?.addEventListener('click', ()=>{
  feedback('warn');
  resetConfig();
});

function renderLog(){
  const items = [...dayLog].sort((a,b)=>a.startTs-b.startTs);
  const totalMin = items.reduce((s,it)=>s + (it.realMin||0), 0);

  logClients.textContent = String(items.length);
  logTotal.textContent = fmtDurHM(totalMin);

  logList.innerHTML = '';
  if (!items.length){
    const empty = document.createElement('div');
    empty.className = 'log-item';
    empty.innerHTML = `<div class="t"><span>Sin registros</span><span>—</span></div><div class="s">Cuando finalizás un cliente, aparece acá.</div>`;
    logList.appendChild(empty);
    return;
  }

  for (const it of items){
    const div = document.createElement('div');
    div.className = 'log-item';
    const title = `${serviceLabel(it.serviceKey)} · ${speedLabel(it.speed)}`;
    const dur = fmtDurHM(it.realMin);
    // backfill id for legacy entries
    if (!it.id) it.id = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    div.innerHTML = `
      <div class="t">
        <span>${title}</span>
        <span class="log-right">
          <span class="log-dur">${dur}</span>
          <button class="log-del" type="button" aria-label="Eliminar registro" data-id="${it.id}">✕</button>
        </span>
      </div>
      <div class="s">${fmtHHMM(it.startTs)} → ${fmtHHMM(it.endTs)} · Est.: ${fmtDurHM(it.estimatedMin)}</div>
    `;
    logList.appendChild(div);
  }
}

// Eliminar 1 registro con confirmación (para evitar borrados accidentales)
logList?.addEventListener('click', (e)=>{
  const btn = e.target.closest('.log-del');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  if (!id) return;
  feedback('soft');
  const ok = confirm('¿Eliminar este registro?');
  if (!ok) return;
  feedback('delete');
  dayLog = dayLog.filter(it => String(it.id) !== String(id));
  saveLog();
  renderLog();
});

logBtn?.addEventListener('click', ()=>{
  renderLog();
  openAnyModal(logModal);
});
logCloseBtn?.addEventListener('click', ()=> closeAnyModal(logModal));

logClearBtn?.addEventListener('click', ()=>{
  feedback('warn');
  dayLog = [];
  saveLog();
  renderLog();
});

logCopyBtn?.addEventListener('click', async ()=>{
  feedback('select');
  const items = [...dayLog].sort((a,b)=>a.startTs-b.startTs);
  const totalMin = items.reduce((s,it)=>s + (it.realMin||0), 0);

  const lines = [];
  lines.push(`Registro (Clientes: ${items.length}, Tiempo: ${fmtDurHM(totalMin)})`);
  for (const it of items){
    lines.push(`- ${fmtHHMM(it.startTs)}–${fmtHHMM(it.endTs)} | ${serviceLabel(it.serviceKey)} (${speedLabel(it.speed)}) | ${fmtDurHM(it.realMin)} (Est. ${fmtDurHM(it.estimatedMin)})`);
  }
  const text = lines.join('\n');

  try{
    await navigator.clipboard.writeText(text);
  }catch(_){
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); }catch(__){ }
    ta.remove();
  }
});

// ===== INIT =====
function init(){
  // initial UI state
  setMode('normal');
  ringState.textContent = 'INICIAR';
  ringTime.textContent = '--:--';
  ringEnd.textContent = 'Termina --:--';
  ringMeta.textContent = 'Libre';
  // UI only: en reposo el aro de progreso no debe verse "encendido".
  setProgress(1);
  ringCap.style.opacity = '0';
  updateAddButtonState();
  fillSettingsForm();
  applyButtonBackground();
  applyAppBackground();

}

init();

