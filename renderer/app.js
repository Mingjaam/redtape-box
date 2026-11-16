// Red Tape — 화면 컨트롤러 (상태 기계 + UI)
import { Box3D } from './box3d.js';
import { sfx } from './sfx.js';
import { describe, IDLE_LINES, THINK_LINES } from './activity.js';
import { renderMarkdown } from './md.js';
import { EXT_COLORS, ROLE_TEXT } from './textures.js';

const noop = () => {};
// 데스크톱 앱이 아니면(웹 미리보기) 파일은 브라우저 안에서만 다루고, 작업은 데모로 재생한다.
const WEB = !window.box;
const api = window.box || webApi();
function webApi() {
  const files = new Map();
  let n = 0;
  const info = (f) => ({ path: f.__id, name: f.name, size: f.size, ext: (f.name.split('.').pop() || '').toLowerCase() });
  const keep = (f) => { if (!f.__id) { f.__id = `web:${++n}`; files.set(f.__id, f); } return f.__id; };
  return {
    pathFor: keep,
    statFiles: async (paths) => paths.map((p) => files.get(p)).filter(Boolean).map(info),
    pickFiles: () => new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
      input.onchange = () => { const list = [...input.files]; list.forEach(keep); resolve(list.map(info)); };
      input.oncancel = () => resolve([]);
      input.click();
    }),
    thumb: async (p) => {
      const f = files.get(p);
      return f && /^image\//.test(f.type) ? { url: URL.createObjectURL(f), kind: 'thumb' } : null;
    },
    setIgnore: noop, dragStart: noop, dragEnd: noop, menu: noop,
    startJob: async () => ({ ok: false, error: '웹 미리보기에서는 데모만 재생돼요' }), cancelJob: noop, onJobEvent: noop,
    open: noop, reveal: noop, dragOut: noop, getConfig: async () => ({ web: true }), onConfig: noop, onMenu: noop, savePng: noop,
  };
}

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[(Math.random() * a.length) | 0];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = (p) => String(p || '').split(/[\\/]/).pop();
const pad = (n) => String(n).padStart(2, '0');
const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad((s / 60) | 0)}:${pad(s % 60)}`; };
const human = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}초` : `${(s / 60) | 0}분 ${s % 60}초`; };

const params = new URLSearchParams(location.search);
if (params.has('shot')) document.body.classList.add('shot');
if (!window.box) document.body.classList.add('web');

// ───────────────────────── 상태 ─────────────────────────
const S = {
  phase: 'idle', // idle | sending | working | done | failed
  items: [],      // {id, path, name, ext, size, role, thumb}
  job: null,
  follow: [],     // 결과 화면에서 추가로 넣은 파일
  marker: '',
  lastSay: 0,
  overBox: false,
  press: null,
  winDrag: false,
  draggingOut: false,
  demo: false,
};
let cfg = { sound: true, clickThrough: true, jobCounter: 0 };

const el = {
  canvas: $('#gl'), bubble: $('#bubble'), bubbleText: $('#bubbleText'), tip: $('#tip'),
  waybill: $('#waybill'), chips: $('#chips'), prompt: $('#prompt'), presets: $('#presets'), send: $('#send'), wbNo: $('#wbNo'),
  receipt: $('#receipt'), rcLog: $('#rcLog'), rcNo: $('#rcNo'), rcTime: $('#rcTime'), rcModel: $('#rcModel'), rcElapsed: $('#rcElapsed'), rcSteps: $('#rcSteps'), cancel: $('#cancel'),
  postit: $('#postit'), piList: $('#piList'), piCount: $('#piCount'),
  result: $('#result'), rsStamp: $('#rsStamp'), rsTitle: $('#rsTitle'), rsStats: $('#rsStats'), rsFiles: $('#rsFiles'), rsSummary: $('#rsSummary'), rsDragHint: $('#rsDragHint'),
  fuChips: $('#fuChips'), fuPrompt: $('#fuPrompt'), fuSend: $('#fuSend'),
  rsPraise: $('#rsPraise'), rsFolder: $('#rsFolder'), rsNew: $('#rsNew'),
};

// 폰트가 준비된 뒤 3D 텍스처(매직 글씨 등)를 그린다
await Promise.race([
  Promise.all([document.fonts.load('40px "Nanum Pen Script"', '서류 상자'), document.fonts.load('12px "Nanum Gothic Coding"', '작업')]),
  sleep(1500),
]).catch(noop);

const box = new Box3D(el.canvas);
box.on('sound', (n) => sfx[n]());
box.on('land', () => sfx.drop());

// ───────────────────────── 말풍선 ─────────────────────────
let sayTimer = 0, typeTimer = 0;
function say(text, ms = 3200) {
  S.lastSay = Date.now();
  clearTimeout(sayTimer);
  clearInterval(typeTimer);
  el.bubble.classList.remove('pop');
  void el.bubble.offsetWidth;
  el.bubble.classList.add('show', 'pop');
  // 타자기 효과
  const chars = [...text];
  let i = 0;
  el.bubbleText.textContent = '';
  typeTimer = setInterval(() => {
    i = Math.min(chars.length, i + 2);
    el.bubbleText.textContent = chars.slice(0, i).join('');
    if (i >= chars.length) clearInterval(typeTimer);
  }, 22);
  if (ms) sayTimer = setTimeout(hush, ms);
}
function hush() { el.bubble.classList.remove('show'); }

// ───────────────────────── 툴팁 ─────────────────────────
function showTip(text, x, y) {
  el.tip.textContent = text;
  el.tip.classList.add('show');
  const w = el.tip.offsetWidth;
  el.tip.style.left = `${Math.min(420 - w - 6, Math.max(6, x - w / 2))}px`;
  el.tip.style.top = `${y - 34}px`;
}
function hideTip() { el.tip.classList.remove('show'); }

// ───────────────────────── 파일 넣기 ─────────────────────────
const DOC_EXT = /^(hwpx?|docx?|xlsx?|pdf|pptx?|odt|ods|rtf)$/;
const IMG_EXT = /^(jpe?g|png|heic|gif|webp|bmp|tiff?)$/;
function guessRole(f) {
  const n = (f.name || '').toLowerCase();
  if (/양식|서식|신청서|복명서|보고서|계획서|정산서|청구서|결의서|품의서|template|form/.test(n) && DOC_EXT.test(f.ext)) return 'form';
  if (/영수증|receipt|카드|전표|승차권|탑승권|티켓|ticket|invoice|인보이스|계산서|증빙|보딩/.test(n)) return 'evidence';
  if (IMG_EXT.test(f.ext)) return 'evidence';
  return 'ref';
}

function canAccept() { return S.phase === 'idle' || S.phase === 'done' || S.phase === 'failed'; }

async function addPaths(paths) {
  const files = await api.statFiles(paths);
  if (!files.length) { say('앗, 그건 넣을 수 없어요 🙅', 2400); return; }
  addFiles(files);
}

// 상자를 새로 만들면 1 증가 → 이전 상자에 대해 예약된 카드 애니메이션은 버린다
let boxGen = 0;

function addFiles(files) {
  if (!canAccept()) { say('지금은 작업 중이에요! 끝나면 넣어 주세요 🙏', 2600); box.wobble(); return; }
  const into = S.phase === 'idle' ? S.items : S.follow;
  const fresh = files.filter((f) => !S.items.some((i) => i.path === f.path) && !S.follow.some((i) => i.path === f.path)).slice(0, 40);
  if (!fresh.length) { say('이미 상자에 들어 있어요 😉', 2200); return; }
  // 목록에는 바로 넣고(바로 보내도 빠지지 않게), 카드가 떨어지는 연출만 시간차로
  const gen = boxGen;
  fresh.forEach((f, k) => {
    const role = guessRole(f);
    const item = { ...f, role, id: null };
    into.push(item);
    setTimeout(() => {
      if (gen !== boxGen || (!S.items.includes(item) && !S.follow.includes(item))) return;
      item.id = box.addItem({ ...f, role: item.role });
      loadThumb(item);
      updateLabel();
    }, k * 150);
  });
  renderChips();
  updateLabel();
  const forms = fresh.filter((f) => guessRole(f) === 'form').length;
  const evid = fresh.filter((f) => guessRole(f) === 'evidence').length;
  const msg = fresh.length === 1
    ? `냠! ${short(fresh[0].name, 16)} 받았어요 📥`
    : `냠냠! ${fresh.length}개 받았어요${forms ? ` · 양식 ${forms}` : ''}${evid ? ` · 증빙 ${evid}` : ''}`;
  setTimeout(() => say(msg, 3000), 250);
  setTimeout(() => restPose(), fresh.length * 150 + 700);
}

function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

async function loadThumb(item) {
  if (!item.path) return;
  const t = await api.thumb(item.path).catch(() => null);
  if (!t) return;
  const img = new Image();
  img.src = t.url;
  try { await img.decode(); } catch { return; }
  item.thumb = { img, kind: t.kind };
  box.setItemThumb(item.id, item.thumb);
}

function removeItem(item) {
  for (const list of [S.items, S.follow]) {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }
  box.removeItem(item.id);
  sfx.pop();
  renderChips();
  updateLabel();
  restPose();
}

function cycleRole(item) {
  const order = ['form', 'evidence', 'ref'];
  item.role = order[(order.indexOf(item.role) + 1) % order.length];
  box.setItemRole(item.id, item.role);
  renderChips();
}

function chipHTML(it) {
  return `<i style="background:${EXT_COLORS[it.ext] || '#777'}"></i><button class="role r-${it.role}" title="역할 바꾸기 (양식 → 증빙 → 자료)">${ROLE_TEXT[it.role]}</button><span class="nm" title="${esc(it.name)}">${esc(it.name)}</span><button class="x" title="상자에서 빼기">×</button>`;
}

function renderChipList(container, list, emptyText) {
  container.innerHTML = '';
  if (!list.length) { if (emptyText) container.innerHTML = `<span class="chip-empty">${emptyText}</span>`; return; }
  for (const it of list) {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = chipHTML(it);
    c.querySelector('.role').onclick = () => cycleRole(it);
    c.querySelector('.x').onclick = () => removeItem(it);
    c.onmouseenter = () => box.bump(0.2);
    container.append(c);
  }
}

function renderChips() {
  renderChipList(el.chips, S.items, '파일을 상자에 끌어다 놓거나, 상자를 더블클릭');
  renderChipList(el.fuChips, S.follow, '');
  el.send.classList.toggle('empty', !S.items.length && !el.prompt.value.trim());
}

function jobNoPreview() { return S.job?.jobNo || (cfg.jobCounter || 0) + 1; }

function updateLabel() {
  const all = [...S.items, ...S.follow];
  box.setLabel({ count: all.length, names: all.map((i) => i.name), no: jobNoPreview(), title: S.marker });
  el.wbNo.textContent = `No.${String(jobNoPreview()).padStart(4, '0')}`;
}

function restPose() {
  if (S.phase === 'idle') box.setPose(S.items.length ? 'ajar' : S.overBox ? 'peek' : 'closed', { k: 150, c: 13 });
  else if (S.phase === 'done' || S.phase === 'failed') box.setPose('wide', { k: 150, c: 12 });
}

async function pickFiles() {
  if (!canAccept()) return;
  box.setPose('open');
  const files = await api.pickFiles();
  if (files.length) addFiles(files); else restPose();
}

// ───────────────────────── 프리셋 ─────────────────────────
const PRESETS = [
  { label: '✈️ 출장신청서', marker: '출장신청서', text: '출장신청서 양식을 넣은 공문·일정표·메일을 보고 빈칸을 모두 채워줘. 출장 목적·기간·장소·인원·여비(교통·숙박·일비·식비)를 자료에서 찾아 넣고 여비 합계까지 계산해줘.' },
  { label: '📝 복명서', marker: '출장 복명서', text: '출장 복명서(결과보고서) 양식을 채워줘. 넣은 메모·회의자료·사진을 바탕으로 출장 개요, 주요 내용(개조식), 성과 및 향후 계획을 공문서 말투로 정리해줘.' },
  { label: '🧾 영수증 정리', marker: '영수증 정산', text: '영수증 사진을 모두 읽어서 날짜·가맹점·금액·분류(교통/숙박/식비/기타)를 표로 정리하고 합계를 내줘. 양식(지출결의서·정산서)이 있으면 그 양식에 맞춰 채우고, 영수증 이미지를 모은 증빙 첨부 PDF도 만들어줘.' },
  { label: '✨ 알아서', marker: '서류 상자', text: '넣은 파일들을 보고 양식이 있으면 나머지 자료로 알맞게 채워줘.' },
];
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.onclick = () => {
    el.prompt.value = p.text;
    fitPrompt();
    S.marker = p.marker;
    box.setMarker(p.marker);
    updateLabel();
    renderChips();
    box.bump(0.6);
    sfx.pop();
    el.prompt.focus();
  };
  el.presets.append(b);
}
function fitPrompt() {
  el.prompt.style.height = 'auto';
  el.prompt.style.height = `${Math.min(96, Math.max(54, el.prompt.scrollHeight))}px`;
}
el.prompt.addEventListener('input', () => { fitPrompt(); el.send.classList.toggle('empty', !S.items.length && !el.prompt.value.trim()); });
el.prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
el.fuPrompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); followUp(); } });

function markerFrom(prompt) {
  if (S.marker) return S.marker;
  const m = prompt.match(/(출장\s?신청서|복명서|결과\s?보고서|영수증|정산서|지출결의서|품의서|보고서|신청서)/);
  if (m) return m[1].replace(/\s/g, '');
  return short(prompt.replace(/\s+/g, ' ').trim(), 8) || '서류 상자';
}

// ───────────────────────── 발송 → 작업 ─────────────────────────
el.send.onclick = () => send();

async function send() {
  if (S.phase !== 'idle') return;
  const prompt = el.prompt.value.trim();
  if (!S.items.length && !prompt) {
    el.waybill.classList.remove('shake'); void el.waybill.offsetWidth; el.waybill.classList.add('shake');
    say('상자가 비었어요! 파일이나 요청을 넣어 주세요 📭', 2800);
    box.wobble();
    sfx.thump();
    return;
  }
  S.phase = 'sending';
  hideTip();
  el.send.classList.add('pressing');
  sfx.stamp();
  await sleep(160);
  el.waybill.classList.add('stamped');
  await sleep(420);
  el.waybill.classList.add('fly');
  S.marker = markerFrom(prompt);
  box.setMarker(S.marker);
  sfx.flap();
  await sleep(380);
  el.waybill.classList.remove('show', 'fly', 'stamped', 'enter');
  el.send.classList.remove('pressing');
  await runJob({ prompt, files: S.items, resume: null });
}

async function runJob({ prompt, files, resume }) {
  const payload = { prompt, files: files.map(({ path, name, role }) => ({ path, name, role })), resume };
  if (WEB) S.demo = true;
  let res;
  try {
    res = S.demo ? { ok: true, jobDir: '', jobNo: 42 } : await api.startJob(payload);
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }
  if (!res || !res.ok) {
    box.wobble();
    sfx.sad();
    say(`😵 ${(res && res.error) || '작업을 시작하지 못했어요'}`, 6000);
    if (!resume) { S.phase = 'idle'; restPose(); showWaybill(true); } // 적어 둔 요청은 그대로 둔다
    return false;
  }
  if (!resume && !S.demo) cfg.jobCounter = res.jobNo;
  const prev = S.job;
  S.job = {
    jobDir: res.jobDir,
    jobNo: res.jobNo,
    sessionId: resume ? prev?.sessionId : null,
    startedAt: Date.now(),
    steps: 0, reads: 0, writes: 0, runs: 0,
    phaseIdx: -1,
    result: null,
    outputs: [],
    model: '',
  };
  S.phase = 'working';
  updateLabel();
  openReceipt(!!resume);
  showPostit();
  setPhase('look');
  say('📦 상자 봉인! Claude에게 보내는 중…', 0);
  S.sealP = box.seal();
  await S.sealP;
  if (S.phase !== 'working') return true; // 봉인 도중 이미 끝남(즉시 실패 등)
  box.setWorking(true);
  el.receipt.classList.add('show');
  if (S.demo) playDemoEvents();
  return true;
}

let elapsedTimer = 0;
function openReceipt(isFollow) {
  el.rcLog.innerHTML = '';
  el.receipt.classList.remove('tear', 'show');
  el.rcNo.textContent = `No.${String(S.job.jobNo).padStart(4, '0')}${isFollow ? '-추가' : ''}`;
  const d = new Date();
  el.rcTime.textContent = `${d.getMonth() + 1}/${d.getDate()} ${clock(d)}`;
  el.rcModel.textContent = 'Claude';
  el.rcSteps.textContent = '0';
  el.rcElapsed.textContent = '00:00';
  printLine('📦', isFollow ? '추가 요청 접수' : `접수 · 파일 ${S.items.length}개`);
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => { if (S.job) el.rcElapsed.textContent = mmss(Date.now() - S.job.startedAt); }, 1000);
}

function printLine(icon, text, cls = '') {
  const li = document.createElement('li');
  li.className = `rc-line ${cls}`;
  li.innerHTML = `<span class="t">${clock()}</span><span class="i">${icon}</span><span class="x">${esc(text)}</span>`;
  el.rcLog.append(li);
  while (el.rcLog.children.length > 160) el.rcLog.firstChild.remove();
  el.rcLog.scrollTop = el.rcLog.scrollHeight;
  if (S.phase === 'working') sfx.print();
}

function showPostit() {
  el.postit.classList.remove('peel');
  el.postit.classList.add('show');
  for (const li of el.piList.children) li.className = '';
  el.piCount.textContent = '';
}

const PHASES = ['look', 'fill', 'check', 'pack'];
function setPhase(p) {
  if (!S.job) return;
  const idx = PHASES.indexOf(p);
  if (idx < 0 || idx <= S.job.phaseIdx) return;
  S.job.phaseIdx = idx;
  [...el.piList.children].forEach((li, i) => { li.className = i < idx ? 'done' : i === idx ? 'active' : ''; });
}
function updateCounts() {
  const j = S.job;
  el.rcSteps.textContent = String(j.steps);
  el.piCount.textContent = `읽음 ${j.reads} · 작성 ${j.writes} · 실행 ${j.runs}`;
}

el.cancel.onclick = async () => {
  if (S.phase !== 'working') return;
  printLine('✋', '취소 요청…', 'dim');
  say('알겠어요, 멈출게요 ✋', 0);
  if (S.demo) { demoTimers.forEach(clearTimeout); handleEvent({ kind: 'exit', code: 1, cancelled: true }); }
  else api.cancelJob();
};

// Claude 이벤트
let lastThink = 0;
function handleEvent(ev) {
  if (!S.job) return;
  const j = S.job;
  switch (ev.kind) {
    case 'init':
      j.sessionId = ev.sessionId || j.sessionId;
      j.model = ev.model || '';
      el.rcModel.textContent = (ev.model || 'Claude').replace(/^claude-/, '');
      printLine('🔌', 'Claude 출근 완료');
      say('💡 상자 안에 불 켜는 중…', 0);
      break;
    case 'thinking':
      if (Date.now() - lastThink > 6000) {
        lastThink = Date.now();
        if (Date.now() - S.lastSay > 4000) say(pick(THINK_LINES), 0);
        box.activity('think');
      }
      break;
    case 'tool': {
      const d = describe(ev.name, ev.input);
      j.steps++;
      if (d.fx === 'read') j.reads++;
      else if (d.fx === 'write') j.writes++;
      else if (d.fx === 'run') j.runs++;
      updateCounts();
      printLine(d.icon, d.text, ev.sub ? 'sub' : '');
      if (!ev.sub) say(d.bubble, 0);
      box.activity(d.fx);
      if (d.phase === 'check' && j.writes === 0) setPhase('look');
      else if (d.phase) setPhase(d.phase);
      if (d.fx === 'write') setPhase('fill');
      break;
    }
    case 'tool_result':
      if (ev.isError) printLine('⚠️', '앗, 다른 방법으로 해볼게요', 'dim');
      break;
    case 'text': {
      if (ev.sub) break;
      const line = ev.text.split('\n').map((s) => s.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || '';
      if (!line) break;
      printLine('💬', short(line, 90), 'dim');
      say(`💬 ${short(line, 46)}`, 0);
      break;
    }
    case 'result':
      j.result = ev;
      if (ev.sessionId) j.sessionId = ev.sessionId;
      setPhase('pack');
      break;
    case 'outputs':
      j.outputs = ev.files || [];
      break;
    case 'exit':
      if (ev.sessionId) j.sessionId = ev.sessionId;
      finish(ev);
      break;
  }
}
api.onJobEvent(handleEvent);

async function finish(ev) {
  if (S.phase !== 'working') return;
  if (S.sealP) await S.sealP;
  clearInterval(elapsedTimer);
  box.setWorking(false);
  const r = S.job.result;
  if (ev.cancelled) return fail('작업을 취소했어요', true);
  if (!r) return fail(ev.error || (ev.stderr ? short(ev.stderr, 400) : `Claude가 중간에 멈췄어요 (코드 ${ev.code})`));
  if (!r.ok) return fail(r.text || `작업이 끝나지 못했어요 (${r.subtype || '오류'})`);
  return succeed();
}

async function succeed() {
  S.phase = 'done';
  const j = S.job;
  const stale = () => S.job !== j; // 연출 도중 '새 상자'나 데모가 시작됐으면 그만둔다
  [...el.piList.children].forEach((li) => { li.className = 'done'; });
  printLine('✅', '작업 완료', 'total');
  printLine('🧾', `합계 ${j.steps}단계 · ${human(Date.now() - j.startedAt)}`, 'total');
  await sleep(700);
  if (stale()) return;
  el.receipt.classList.add('tear');
  sfx.rip();
  await sleep(350);
  if (stale()) return;
  await box.unseal();
  if (stale()) return;
  const outs = j.outputs || [];
  box.showOutputs(outs);
  outs.slice(0, 5).forEach(loadOutputThumb);
  box.celebrate();
  sfx.ding();
  say(outs.length ? `짠! ${outs.length}개 완성했어요 🎉` : '다 했어요! (결과 파일은 따로 없어요)', 5000);
  el.receipt.classList.remove('show', 'tear');
  setTimeout(() => el.postit.classList.add('peel'), 1200);
  showResult(false);
}

async function fail(msg, soft = false) {
  S.phase = 'failed';
  const j = S.job;
  const stale = () => S.job !== j;
  printLine(soft ? '✋' : '❌', soft ? '작업 취소됨' : '작업 실패', 'total');
  await sleep(500);
  if (stale()) return;
  el.receipt.classList.add('tear');
  await sleep(300);
  if (stale()) return;
  await box.unseal();
  if (stale()) return;
  box.sad();
  sfx.sad();
  say(soft ? '멈췄어요. 다시 보내도 돼요 🙂' : '앗… 반송됐어요 😢', 5000);
  el.receipt.classList.remove('show', 'tear');
  el.postit.classList.add('peel');
  S.job.failMsg = msg;
  showResult(true, soft);
}

async function loadOutputThumb(o) {
  if (!o.path) return;
  const t = await api.thumb(o.path).catch(() => null);
  if (!t) return;
  const img = new Image();
  img.src = t.url;
  try { await img.decode(); } catch { return; }
  box.setOutputThumb(o.path, { img, kind: t.kind });
}

// ───────────────────────── 결과 카드 ─────────────────────────
function showResult(failed, soft = false) {
  const j = S.job;
  const r = j.result;
  el.result.classList.toggle('failed', failed);
  el.rsStamp.textContent = failed ? (soft ? '보 류' : '반 송') : '완 료';
  el.rsTitle.textContent = failed ? (soft ? '작업을 멈췄어요' : '앗, 배송 실패…') : '배송 완료! 📦';
  const bits = [`⏱ ${human((r && r.durationMs) || Date.now() - j.startedAt)}`, `🔧 ${j.steps}단계`];
  if (r && typeof r.cost === 'number') bits.push(`💰 약 $${r.cost.toFixed(2)}`);
  if (j.model) bits.push(`🤖 ${j.model.replace(/^claude-/, '')}`);
  el.rsStats.textContent = bits.join('  ·  ');

  el.rsFiles.innerHTML = '';
  const outs = j.outputs || [];
  outs.forEach((o, i) => {
    const li = document.createElement('li');
    li.className = 'rs-file';
    li.draggable = true;
    li.style.animationDelay = `${0.3 + i * 0.08}s`;
    li.innerHTML = `<span class="ext" style="background:${EXT_COLORS[o.ext] || '#666'}">${esc((o.ext || 'FILE').toUpperCase().slice(0, 4))}</span><span class="nm" title="${esc(o.name)}">${esc(o.name)}<span class="sz">${esc(o.sizeText || '')}</span></span><button class="op">열기</button><button class="rv" title="폴더에서 보기">📂</button>`;
    li.querySelector('.op').onclick = (e) => { e.stopPropagation(); api.open(o.path); box.bump(0.6); };
    li.querySelector('.rv').onclick = (e) => { e.stopPropagation(); api.reveal(o.path); };
    li.ondblclick = () => api.open(o.path);
    li.ondragstart = (e) => {
      e.preventDefault();
      S.draggingOut = true;
      api.dragOut(o.path);
      setTimeout(() => { S.draggingOut = false; }, 1500);
    };
    el.rsFiles.append(li);
  });
  el.rsDragHint.style.display = outs.length ? '' : 'none';

  const text = failed ? `${j.failMsg || ''}` : (r && r.text) || '';
  el.rsSummary.innerHTML = renderMarkdown(text);
  el.fuPrompt.value = '';
  el.fuPrompt.placeholder = failed ? '다시 시도할 때 덧붙일 말 (선택)' : '고칠 점 (예: 숙박비 7만원으로)';
  el.fuSend.innerHTML = failed ? '다시<br>시도' : '다시<br>보내기';
  renderChips();
  el.result.classList.remove('show');
  void el.result.offsetWidth;
  el.result.classList.add('show');
}

el.fuSend.onclick = () => followUp();
async function followUp() {
  if (S.phase !== 'done' && S.phase !== 'failed') return;
  const prompt = el.fuPrompt.value.trim();
  const failed = S.phase === 'failed';
  const canResume = !!(S.job && S.job.sessionId && S.job.jobDir);
  if (!failed && !prompt && !S.follow.length) {
    el.fuPrompt.focus();
    say('무엇을 고칠지 적어 주세요 ✏️', 2400);
    return;
  }
  if (S.demo && !WEB) {
    say('데모 상자예요 📦 새 상자에서 진짜로 보내 보세요', 3200);
    box.wobble();
    return;
  }
  el.result.classList.remove('show');
  const prevOutputs = S.job?.outputs || [];
  box.clearOutputs();
  const files = [...S.follow];
  S.items.push(...S.follow);
  S.follow = [];
  renderChips();
  if (failed && !canResume) {
    // 처음부터 다시
    S.phase = 'idle';
    box.sinkItems(false);
    restPose();
    showWaybill(true);
    return;
  }
  const before = S.phase;
  S.phase = 'sending';
  sfx.stamp();
  const started = await runJob({
    prompt: prompt || (failed ? '방금 작업이 중간에 멈췄어요. 이어서 끝까지 마무리해 주세요.' : ''),
    files,
    resume: { sessionId: S.job.sessionId, jobDir: S.job.jobDir, jobNo: S.job.jobNo },
  });
  if (!started) {
    // 시작 실패: 결과 화면과 새로 넣은 파일을 되돌린다
    S.items = S.items.filter((i) => !files.includes(i));
    S.follow = files;
    S.phase = before;
    box.showOutputs(prevOutputs);
    prevOutputs.slice(0, 5).forEach(loadOutputThumb);
    el.fuPrompt.value = prompt;
    renderChips();
    restPose();
    el.result.classList.add('show');
  }
}

el.rsPraise.onclick = () => {
  box.happyHop();
  sfx.hello();
  say(pick(['헤헤, 고마워요 😊', '칭찬 감사합니다! 🙇', '다음에도 맡겨 주세요 💪', '뿌듯해요 ✨']), 2600);
};
el.rsFolder.onclick = () => { if (S.job?.jobDir) api.reveal(S.job.outputs?.[0]?.path || S.job.jobDir); };
el.rsNew.onclick = () => newBox();

function showWaybill(keepPrompt = false) {
  if (!keepPrompt) el.prompt.value = '';
  el.waybill.classList.remove('fly', 'stamped', 'shake');
  el.waybill.classList.add('show');
  el.waybill.classList.remove('enter');
  void el.waybill.offsetWidth;
  el.waybill.classList.add('enter');
  renderChips();
}

function newBox() {
  boxGen++;
  S.phase = 'idle';
  S.demo = false;
  demoTimers.forEach(clearTimeout);
  S.job = null;
  S.marker = '';
  for (const it of [...S.items, ...S.follow]) box.removeItem(it.id);
  S.items = [];
  S.follow = [];
  box.clearOutputs();
  box.setMarker('서류 상자');
  el.result.classList.remove('show');
  el.postit.classList.remove('show', 'peel');
  sfx.flap();
  box.setPose('closed', { k: 200, c: 14 });
  box.squash(0.06);
  showWaybill();
  updateLabel();
  say('새 상자 준비 완료! 📦', 2200);
}

// ───────────────────────── 마우스: 클릭 통과 / 호버 / 창 끌기 ─────────────────────────
let ignoring = null;
function setIgnore(v) {
  if (!cfg.clickThrough) v = false;
  if (v === ignoring) return;
  ignoring = v;
  api.setIgnore(v);
}
// 메인이 직접 통과를 풀었을 때(파일을 끌고 상자에 다가올 때) 상태를 맞춘다
api.onIgnoreSync?.((v) => { ignoring = v; });

// 상자 주변 사각형을 메인에 알려 둔다 (파일 드래그 중에는 mousemove 가 오지 않음)
// 메인(드래그 중 통과 해제)과 렌더러(마우스 이동)가 같은 사각형을 쓴다 → 경계에서 깜빡이지 않게
let hotCache = { t: 0, r: { x: 0, y: 0, w: 0, h: 0 } };
function hotRect() {
  const now = performance.now();
  if (now - hotCache.t > 200) hotCache = { t: now, r: box.screenRect(44) };
  return hotCache.r;
}
let lastHot = '';
setInterval(() => {
  if (!api.setHotRect) return;
  const r = hotRect();
  const key = `${r.x},${r.y},${r.w},${r.h}`;
  if (key !== lastHot) { lastHot = key; api.setHotRect(r); }
}, 400);

// 숨기면 멈추고, 한동안 가만히 있으면 프레임을 줄인다
api.onVisible?.((v) => box.setPaused(!v));
let lastInput = performance.now();
['mousemove', 'pointerdown', 'dragenter', 'dragover', 'keydown'].forEach((t) => window.addEventListener(t, () => { lastInput = performance.now(); box.lowPower = false; }, { passive: true, capture: true }));
setInterval(() => {
  const busy = S.phase === 'sending' || S.phase === 'working' || !!S.press;
  box.lowPower = !busy && performance.now() - lastInput > 8000;
}, 1000);

window.addEventListener('mousemove', (e) => {
  if (S.winDrag) return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const ui = target && target.closest('.ui');
  const hit = ui ? null : box.pick(e.clientX, e.clientY);
  // 상자 주변 여유 영역도 '잡히는 곳'으로 둔다 → 파일을 끌고 다가올 때 확실히 상자가 받도록
  const r = hotRect();
  const near = hit || ui || (e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h);
  setIgnore(!near);
  hover(hit, e);
});

function hover(hit, e) {
  el.canvas.style.cursor = !hit ? 'default' : hit.type === 'output' ? 'pointer' : 'grab';
  if (hit && hit.type === 'item') {
    const it = [...S.items, ...S.follow].find((i) => i.id === hit.id);
    if (it) showTip(`${ROLE_TEXT[it.role]} · ${it.name}`, e.clientX, e.clientY);
  } else if (hit && hit.type === 'output') showTip(`클릭해서 열기 · ${base(hit.path)}`, e.clientX, e.clientY);
  else hideTip();

  const over = !!hit;
  if (over !== S.overBox) {
    S.overBox = over;
    if (S.phase === 'idle' && !S.items.length && !S.press) {
      box.setPose(over ? 'peek' : 'closed', { k: 130, c: 12 });
      if (over) { sfx.flap(); if (Date.now() - S.lastSay > 8000) say(pick(IDLE_LINES), 2600); }
    }
  }
}

let clickTimer = 0;
el.canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const hit = box.pick(e.clientX, e.clientY);
  if (!hit) return;
  S.press = { x: e.screenX, y: e.screenY, hit, moved: false };
  el.canvas.setPointerCapture(e.pointerId);
});
el.canvas.addEventListener('pointermove', (e) => {
  const p = S.press;
  if (!p || p.moved) return;
  if (Math.hypot(e.screenX - p.x, e.screenY - p.y) > 4) {
    p.moved = true;
    S.winDrag = true;
    hideTip();
    el.canvas.style.cursor = 'grabbing';
    api.dragStart();
    box.hop.kick(1.2);
  }
});
el.canvas.addEventListener('pointerup', (e) => {
  const p = S.press;
  S.press = null;
  if (!p) return;
  if (p.moved) {
    api.dragEnd();
    S.winDrag = false;
    box.squash(0.07);
    sfx.thump();
    return;
  }
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => onClick(p.hit), 220);
});
// 끄는 도중 메뉴가 뜨거나 다른 창으로 넘어가면 끌기를 끝낸다
const cancelPress = () => {
  const p = S.press;
  S.press = null;
  if (p && p.moved) { api.dragEnd(); S.winDrag = false; el.canvas.style.cursor = 'grab'; }
};
el.canvas.addEventListener('pointercancel', cancelPress);
el.canvas.addEventListener('lostpointercapture', () => { if (S.press && S.press.moved) cancelPress(); });
window.addEventListener('blur', cancelPress);
el.canvas.addEventListener('dblclick', (e) => {
  clearTimeout(clickTimer);
  if (box.pick(e.clientX, e.clientY) && canAccept()) pickFiles();
});
window.addEventListener('contextmenu', (e) => { if (WEB) return; e.preventDefault(); api.menu(); });

function onClick(hit) {
  if (hit.type === 'output') { api.open(hit.path); box.bump(0.6); return; }
  if (S.phase === 'idle') {
    if (hit.type === 'item') {
      const it = S.items.find((i) => i.id === hit.id);
      if (it) { cycleRole(it); say(`${short(it.name, 16)} → ${ROLE_TEXT[it.role]}(으)로 바꿨어요`, 2200); }
      return;
    }
    const open = box.pose === 'open' || box.pose === 'wide';
    if (open) restPose();
    else { box.setPose('open', { k: 200, c: 11 }); sfx.flap(); say(S.items.length ? `${S.items.length}개 들어 있어요 📦` : '텅 비었어요. 파일을 넣어 주세요!', 2200); }
    return;
  }
  if (S.phase === 'working') { box.wobble(); sfx.rumble(); say(pick(['열심히 하는 중이에요! 👀', '쉿, 집중하는 중 🤫', '거의 다 돼 가요… 아마도?', '간지러워요 😆']), 2200); return; }
  if (S.phase === 'done') { box.happyHop(); sfx.hello(); return; }
  box.wobble();
}

// ───────────────────────── 드래그 & 드롭 ─────────────────────────
let dragDepth = 0;
const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || S.draggingOut) return;
  e.preventDefault();
  dragDepth++;
  if (dragDepth === 1) onDragHover(true);
});
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = canAccept() && !S.draggingOut ? 'copy' : 'none';
  setIgnore(false);
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e) || S.draggingOut) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) onDragHover(false);
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (S.draggingOut) return;
  dragDepth = 0;
  onDragHover(false, true);
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
  if (paths.length) addPaths(paths);
});

function onDragHover(on, dropped = false) {
  if (on) {
    setIgnore(false);
    if (!canAccept()) { say('작업 중이에요 🙅 조금만 기다려 주세요', 0); box.wobble(); return; }
    box.dragHover(true);
    sfx.flap();
    say(pick(['여기! 여기에 쏙! 📥', '어서 넣어 주세요! 😋', '아~ 🍽️', '양식이랑 증빙, 다 받아요!']), 0);
  } else {
    box.flutter = false;
    if (!dropped) { hush(); restPose(); }
  }
}

// ───────────────────────── 메뉴 / 설정 ─────────────────────────
api.onMenu((what) => {
  if (what === 'pick') pickFiles();
  if (what === 'demo') playDemo();
});
api.onConfig((c) => { cfg = { ...cfg, ...c }; sfx.setEnabled(cfg.sound); if (!cfg.clickThrough) setIgnore(false); });

cfg = { ...cfg, ...(await api.getConfig()) };
sfx.setEnabled(cfg.sound && !cfg.shot);
updateLabel();
renderChips();
box.setPose('closed');
setTimeout(() => { if (!S.items.length && S.phase === 'idle') { box.happyHop(); say('안녕하세요! 서류 상자예요 📦', 3200); } }, 700);

// ───────────────────────── 데모 (Claude 호출 없음) ─────────────────────────
const DEMO_FILES = [
  { path: '', name: '출장신청서_양식.hwpx', ext: 'hwpx', size: 41234 },
  { path: '', name: '출장_공문_제2026-311호.pdf', ext: 'pdf', size: 228000 },
  { path: '', name: 'KTX_승차권_영수증.jpg', ext: 'jpg', size: 1200000 },
  { path: '', name: '호텔_영수증.png', ext: 'png', size: 880000 },
];
const DEMO_SUMMARY = `## 결과
- 출장신청서_홍길동.hwpx — 양식 서식 그대로 빈칸 채움
- 증빙첨부_영수증2장.pdf — KTX·호텔 영수증 한 장에 정리
- 여비_정산표.xlsx — 항목별 금액과 합계
## 채운 핵심 값
- 출장기간: 2026-11-19 ~ 11-20 (1박 2일)
- 출장지: 부산 벡스코
- 목적: 위성영상 AI 워크숍 발표
- 교통비: 119,600원 / 숙박비: 132,000원
- 여비 합계: **287,400원**
## 확인 필요
- 소속 부서명 (공문에 없음) — 「확인 필요」로 표시
- 일비 지급 기준(1일 25,000원 가정)`;
const DEMO_EVENTS = [
  [500, { kind: 'init', model: 'claude-opus-5-5', sessionId: 'demo' }],
  [700, { kind: 'thinking' }],
  [1100, { kind: 'text', text: '넣어 주신 파일 4개를 먼저 살펴볼게요.' }],
  [900, { kind: 'tool', name: 'Read', input: { file_path: 'inputs/출장신청서_양식.hwpx' } }],
  [900, { kind: 'tool', name: 'Read', input: { file_path: 'inputs/출장_공문_제2026-311호.pdf' } }],
  [900, { kind: 'tool', name: 'Read', input: { file_path: 'inputs/KTX_승차권_영수증.jpg' } }],
  [900, { kind: 'tool', name: 'Read', input: { file_path: 'inputs/호텔_영수증.png' } }],
  [1200, { kind: 'text', text: '영수증 2장에서 금액을 읽었어요. 교통비 119,600원, 숙박비 132,000원이에요.' }],
  [1100, { kind: 'tool', name: 'Bash', input: { command: 'python work/fill_hwpx.py', description: '양식 XML 빈칸 채우기' } }],
  [1300, { kind: 'tool', name: 'Write', input: { file_path: 'outputs/여비_정산표.xlsx' } }],
  [1100, { kind: 'tool', name: 'Bash', input: { command: 'python work/make_pdf.py outputs', description: '영수증 첨부 PDF 만들기' } }],
  [1100, { kind: 'tool', name: 'Read', input: { file_path: 'outputs/출장신청서_홍길동.hwpx' } }],
  [900, { kind: 'text', text: '결과 파일을 다시 열어 값이 잘 들어갔는지 확인했어요.' }],
  [800, { kind: 'result', ok: true, text: DEMO_SUMMARY, durationMs: 14800, turns: 14, cost: 0.31, sessionId: 'demo' }],
  [200, { kind: 'outputs', files: [
    { path: '', name: '출장신청서_홍길동.hwpx', ext: 'hwpx', size: 43120, sizeText: '42 KB' },
    { path: '', name: '증빙첨부_영수증2장.pdf', ext: 'pdf', size: 1250000, sizeText: '1.2 MB' },
    { path: '', name: '여비_정산표.xlsx', ext: 'xlsx', size: 12100, sizeText: '12 KB' },
  ] }],
  [200, { kind: 'exit', code: 0 }],
];
let demoTimers = [];
function playDemoEvents(upto = DEMO_EVENTS.length) {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
  let t = 0;
  DEMO_EVENTS.slice(0, upto).forEach(([dt, ev]) => { t += dt; demoTimers.push(setTimeout(() => handleEvent(ev), t)); });
}

async function playDemo() {
  if (S.phase === 'working' || S.phase === 'sending') return;
  newBox();
  S.demo = true;
  await sleep(900);
  box.dragHover(true);
  say('여기! 여기에 쏙! 📥', 0);
  await sleep(900);
  box.flutter = false;
  addFiles(DEMO_FILES);
  await sleep(1600);
  PRESETS[0] && el.presets.children[0].click();
  await sleep(1200);
  await send();
}

function demoReset() {
  newBox();
  S.demo = true;
  hush();
}

window.__phase = () => S.phase;
// 개발용: 상태별 스크린샷 (main.js --shot)
window.__demo = async (name) => {
  switch (name) {
    case 'idle': demoReset(); return 1500;
    case 'hover': demoReset(); S.overBox = true; box.setPose('peek'); say(IDLE_LINES[0], 0); return 1400;
    case 'drag': demoReset(); onDragHover(true); return 1400;
    case 'loaded':
      demoReset();
      addFiles(DEMO_FILES);
      await sleep(900);
      el.presets.children[0].click();
      return 2200;
    case 'sending':
      el.prompt.value ||= PRESETS[0].text;
      if (!S.items.length) { addFiles(DEMO_FILES); await sleep(1200); }
      send();
      return 1900;
    case 'working':
      if (S.phase !== 'working') { demoReset(); addFiles(DEMO_FILES); await sleep(900); el.prompt.value = PRESETS[0].text; send(); await sleep(3400); }
      demoTimers.forEach(clearTimeout);
      DEMO_EVENTS.slice(0, 11).forEach(([, ev]) => handleEvent(ev));
      return 1600;
    case 'done':
      if (S.phase !== 'working') { await window.__demo('working'); await sleep(1600); }
      DEMO_EVENTS.slice(11).forEach(([, ev]) => handleEvent(ev));
      return 4200;
    case 'failed':
      demoReset(); addFiles(DEMO_FILES.slice(0, 2)); await sleep(700); el.prompt.value = '테스트'; send(); await sleep(3600);
      demoTimers.forEach(clearTimeout);
      handleEvent({ kind: 'init', model: 'claude-opus-5-5' });
      handleEvent({ kind: 'tool', name: 'Read', input: { file_path: 'inputs/출장신청서_양식.hwpx' } });
      handleEvent({ kind: 'exit', code: 1, stderr: 'Error: 네트워크 연결이 끊어졌어요 (예시)' });
      return 3200;
    case 'play': playDemo(); return { waitPhase: true };
    case 'real': {
      // 실제 Claude 호출 테스트: window.__realFiles 경로들을 넣고 발송
      newBox();
      await addPaths(window.__realFiles || []);
      await sleep(1500);
      el.prompt.value = window.__realPrompt || PRESETS[0].text;
      fitPrompt();
      await send();
      return { waitPhase: true };
    }
    case 'icon': {
      demoReset();
      box.setPose('closed');
      await sleep(1500);
      box.setMarker('서류 상자');
      // 아이콘은 빨간 테이프로 봉인된 모습
      box.tape.visible = true;
      box.tape.position.set(0, 0, 0);
      box.tape.rotation.set(0, 0, 0);
      box.tapeL.scale.y = box.tapeTop.scale.x = box.tapeR.scale.y = 1;
      box.tapeMat.opacity = box.tapeSideMat.opacity = 0.94;
      await sleep(300);
      api.savePng(box.snapshot(1024), 'app-icon.png');
      return 500;
    }
  }
  return 1000;
};
