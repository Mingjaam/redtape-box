// Red Tape — 메인 프로세스
const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./src/config');
const { ClaudeJob, resolveClaude, adoptLoginShellPath, claudeVersion } = require('./src/claude-runner');
const job = require('./src/job');

const isMac = process.platform === 'darwin';
const WIN_W = 420;
const WIN_H = 720;
const SHOT = process.argv.includes('--shot');
const DEV = !app.isPackaged;
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const SHOT_DIR = arg('shot-dir') || path.join(__dirname, 'shots');

let win = null;
let tray = null;
let dragTimer = null;
let current = null; // 실행 중인 작업 { job: ClaudeJob, jobDir, jobNo }
const finished = new Map(); // jobNo → { jobDir, sessionId } : 이어서 작업(수정 요청)할 때 렌더러 값 대신 이걸 쓴다
let quitting = false;
const ICON = path.join(__dirname, 'assets', 'icon.png');

// 두 번째로 실행하면 새 창을 띄우지 않고 기존 상자를 앞으로
const gotLock = SHOT || app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

function iconImage(size) {
  const img = fs.existsSync(ICON) ? nativeImage.createFromPath(ICON) : nativeImage.createEmpty();
  return size && !img.isEmpty() ? img.resize({ width: size, height: size }) : img;
}

function clampToScreen(x, y) {
  const disp = screen.getDisplayMatching({ x, y, width: WIN_W, height: WIN_H });
  const wa = disp.workArea;
  return {
    x: Math.min(Math.max(x, wa.x - WIN_W + 160), wa.x + wa.width - 160),
    y: Math.min(Math.max(y, wa.y - 40), wa.y + wa.height - 260),
  };
}

function createWindow() {
  const cfg = config.get();
  const wa = screen.getPrimaryDisplay().workArea;
  let pos = { x: wa.x + wa.width - WIN_W - 16, y: wa.y + wa.height - WIN_H + 40 };
  if (cfg.x != null && cfg.y != null) pos = clampToScreen(cfg.x, cfg.y);
  if (SHOT) pos = { x: wa.x + 40, y: wa.y + 20 };

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: !!cfg.alwaysOnTop && !SHOT,
    skipTaskbar: false,
    title: 'Red Tape',
    icon: iconImage(),
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  if (cfg.alwaysOnTop && !SHOT) win.setAlwaysOnTop(true, 'floating');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: SHOT ? { shot: '1' } : {} });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; stopHotPoll(); });

  // 숨기거나 최소화하면 3D 렌더링을 멈춘다 (배터리)
  const vis = (v) => send('win:visible', v);
  win.on('hide', () => vis(false));
  win.on('minimize', () => vis(false));
  win.on('show', () => vis(true));
  win.on('restore', () => vis(true));
  // 창을 끄는 중에 포커스를 잃으면(Alt+Tab, 메뉴) 끌기를 멈춘다
  win.on('blur', () => { if (dragTimer) endWindowDrag(); });

  // 외부 링크/파일 드롭 시 창이 이동해버리는 것 방지
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (SHOT) win.webContents.once('did-finish-load', () => runShots().catch((e) => { console.error(e); app.exit(1); }));
}

function buildTray() {
  const img = iconImage(isMac ? 18 : 16);
  if (img.isEmpty()) return;
  tray = new Tray(img);
  tray.setToolTip('Red Tape');
  tray.on('click', () => { if (!win) return; win.isVisible() ? win.hide() : win.show(); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '상자 보이기/숨기기', click: () => win && (win.isVisible() ? win.hide() : win.show()) },
    { label: '위치 초기화', click: resetPosition },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
}

function resetPosition() {
  if (!win) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const x = wa.x + wa.width - WIN_W - 16;
  const y = wa.y + wa.height - WIN_H + 40;
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
  config.set({ x, y });
}

function popupMenu() {
  if (!win) return;
  const cfg = config.get();
  const m = Menu.buildFromTemplate([
    { label: '📂 작업 상자 폴더 열기', click: () => { fs.mkdirSync(cfg.jobsDir, { recursive: true }); shell.openPath(cfg.jobsDir); } },
    { label: '📄 파일 고르기…', click: () => send('menu', 'pick') },
    { label: '🎬 데모 재생 (Claude 호출 없음)', click: () => send('menu', 'demo') },
    { type: 'separator' },
    { label: '항상 위에 띄우기', type: 'checkbox', checked: !!cfg.alwaysOnTop, click: (i) => { config.set({ alwaysOnTop: i.checked }); win.setAlwaysOnTop(i.checked, 'floating'); } },
    { label: '빈 곳 클릭 통과', type: 'checkbox', checked: !!cfg.clickThrough, click: (i) => { config.set({ clickThrough: i.checked }); if (!i.checked) setIgnore(false); send('config', config.get()); } },
    { label: '효과음', type: 'checkbox', checked: !!cfg.sound, click: (i) => { config.set({ sound: i.checked }); send('config', config.get()); } },
    {
      label: '작업자 설정',
      submenu: [
        { label: '모델', submenu: ['', 'opus', 'sonnet', 'haiku'].map((m) => ({ label: m || '기본값', type: 'radio', checked: (cfg.model || '') === m, click: () => config.set({ model: m }) })) },
        { label: '노력 수준(effort)', submenu: ['', 'low', 'medium', 'high', 'xhigh', 'max'].map((m) => ({ label: m || '기본값', type: 'radio', checked: (cfg.effort || '') === m, click: () => config.set({ effort: m }) })) },
        {
          label: '권한',
          submenu: [
            { label: '묻지 않고 진행 (bypassPermissions)', type: 'radio', checked: cfg.permissionMode === 'bypassPermissions', click: () => config.set({ permissionMode: 'bypassPermissions' }) },
            { label: '파일 편집만 허용 (acceptEdits)', type: 'radio', checked: cfg.permissionMode === 'acceptEdits', click: () => config.set({ permissionMode: 'acceptEdits' }) },
          ],
        },
        { label: 'Claude 연결 확인', click: checkClaude },
        { label: '설정 파일 열기', click: () => shell.openPath(config.ensureFile()) },
      ],
    },
    { label: '위치 초기화', click: resetPosition },
    { type: 'separator' },
    ...(DEV ? [{ label: '개발자 도구', click: () => win.webContents.openDevTools({ mode: 'detach' }) }] : []),
    { label: '종료', click: () => app.quit() },
  ]);
  m.popup({ window: win });
}

async function checkClaude() {
  const p = await resolveClaude(config.get().claudePath);
  const v = p ? await claudeVersion(p) : '';
  dialog.showMessageBox(win, {
    type: p ? 'info' : 'warning',
    title: 'Claude 연결 확인',
    message: p ? `Claude Code 를 찾았어요 ✅\n${v || '(버전 확인 실패 — 실행 파일은 있어요)'}` : 'claude 명령을 찾지 못했어요',
    detail: p ? p : 'Claude Code 를 설치하고 터미널에서 `claude` 로 한 번 로그인해 주세요.\n설치 위치가 특이하면 설정 파일의 claudePath 에 경로를 적어 주세요.',
  });
}

// ───────────────────────── 클릭 통과 ─────────────────────────
// 렌더러가 마우스 위치를 보고 켜고 끈다. 단, 파일을 끌고 오는 동안에는 mousemove 가 오지 않으므로
// (특히 macOS) 커서가 상자 근처(렌더러가 알려 준 사각형)에 들어오면 메인이 직접 통과를 끈다.
let ignoring = false;
let hotRect = null; // 창 기준 좌표 { x, y, w, h }
let hotTimer = null;

function setIgnore(on) {
  if (!win) return;
  on = !!on && !!config.get().clickThrough && !dragTimer;
  if (on === ignoring) return;
  ignoring = on;
  win.setIgnoreMouseEvents(on, { forward: true });
  send('win:ignore-sync', on);
  if (on) startHotPoll(); else stopHotPoll();
}

function startHotPoll() {
  if (hotTimer) return;
  hotTimer = setInterval(() => {
    if (!win || !ignoring || !hotRect) return;
    const c = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const x = c.x - b.x;
    const y = c.y - b.y;
    if (x >= hotRect.x && x <= hotRect.x + hotRect.w && y >= hotRect.y && y <= hotRect.y + hotRect.h) setIgnore(false);
  }, 60);
}
function stopHotPoll() { clearInterval(hotTimer); hotTimer = null; }

// ───────────────────────── IPC: 창 ─────────────────────────
ipcMain.on('win:ignore', (_e, v) => setIgnore(v));
ipcMain.on('win:hot-rect', (_e, r) => {
  if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) hotRect = { x: r.x, y: r.y, w: r.w, h: r.h };
});

function endWindowDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
  if (!win) return;
  const b = win.getBounds();
  config.set({ x: b.x, y: b.y });
}

ipcMain.on('win:drag-start', () => {
  if (!win) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const off = { x: c.x - b.x, y: c.y - b.y };
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    win.setBounds({ x: p.x - off.x, y: p.y - off.y, width: WIN_W, height: WIN_H });
  }, 8);
});
ipcMain.on('win:drag-end', endWindowDrag);
ipcMain.on('win:menu', popupMenu);
ipcMain.on('win:hide', () => win && win.hide());

// ───────────────────────── IPC: 파일 ─────────────────────────
// 렌더러가 넘긴 경로는 작업 상자 폴더 안의 것만 열거나 꺼낸다
function insideJobs(p) {
  if (typeof p !== 'string' || !p) return false;
  const root = path.resolve(config.get().jobsDir);
  const rel = path.relative(root, path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
const RISKY = /\.(exe|bat|cmd|com|msi|ps1|vbs|vbe|js|jse|wsf|wsh|scr|lnk|reg|hta|cpl|jar|app|command|sh|pkg|dmg|workflow)$/i;

ipcMain.handle('files:stat', (_e, paths) => job.statPaths(paths));

ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '상자에 넣을 파일',
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : job.statPaths(r.filePaths);
});

ipcMain.handle('file:thumb', async (_e, p) => {
  if (typeof p !== 'string' || !p) return null;
  try {
    const img = await nativeImage.createThumbnailFromPath(p, { width: 320, height: 320 });
    if (img && !img.isEmpty()) return { url: img.toDataURL(), kind: 'thumb' };
  } catch { /* 썸네일을 못 만드는 형식 */ }
  try {
    const ic = await app.getFileIcon(p, { size: 'large' });
    if (ic && !ic.isEmpty()) return { url: ic.toDataURL(), kind: 'icon' };
  } catch { /* ignore */ }
  return null;
});

ipcMain.handle('file:open', (_e, p) => {
  if (!insideJobs(p) || !fs.existsSync(p)) return 'not allowed';
  // 실행 파일은 열지 않고 폴더에서 보여 준다
  if (RISKY.test(p)) { shell.showItemInFolder(p); return 'revealed'; }
  return shell.openPath(p);
});
ipcMain.handle('file:reveal', (_e, p) => { if (insideJobs(p) || p === config.get().jobsDir) shell.showItemInFolder(p); });
ipcMain.on('file:drag-out', (e, p) => {
  if (!insideJobs(p) || !fs.existsSync(p)) return;
  const icon = iconImage(48);
  e.sender.startDrag({ file: p, icon: icon.isEmpty() ? nativeImage.createFromPath(p) : icon });
});

ipcMain.handle('config:get', () => ({ ...config.get(), platform: process.platform, shot: SHOT }));

// ───────────────────────── IPC: 작업 ─────────────────────────
// 첫 작업 전에 한 번: 묻지 않고 명령을 실행하는 모드라는 걸 알린다
async function ensureConsent() {
  const cfg = config.get();
  if (SHOT || cfg.permissionMode !== 'bypassPermissions' || cfg.bypassConsent) return true;
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Red Tape — 처음 한 번만 확인해 주세요',
    message: '상자 안의 Claude는 묻지 않고 명령을 실행해요',
    detail: [
      '서식을 채우려면 Claude가 파이썬 스크립트를 실행하고 파일을 만들어야 해서, 기본 설정은 매번 허락을 묻지 않아요.',
      '작업 위치는 문서/RedTape 아래 작업 폴더지만, 운영체제 수준의 격리는 아니에요.',
      '',
      '모르는 사람이 보낸 문서에는 Claude를 속이는 숨은 지시가 들어 있을 수 있어요. 그런 파일을 넣을 땐 "파일 편집만 허용"으로 바꾸세요 (명령 실행이 막혀 일부 서식은 못 채울 수 있어요).',
      '',
      '나중에 상자 우클릭 → 작업자 설정 → 권한에서 바꿀 수 있어요.',
    ].join('\n'),
    buttons: ['이해했어요, 계속', '파일 편집만 허용으로', '취소'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (r.response === 2) return false;
  config.set({ bypassConsent: true, ...(r.response === 1 ? { permissionMode: 'acceptEdits' } : {}) });
  return true;
}

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

ipcMain.handle('job:start', async (_e, payload) => {
  if (current) return { ok: false, error: '이미 상자 안에서 작업 중이에요.' };
  try {
    payload = payload && typeof payload === 'object' ? payload : {};
    if (!(await ensureConsent())) return { ok: false, error: '보내기를 취소했어요.' };
    const cfg = config.get();
    const claudePath = await resolveClaude(cfg.claudePath);
    if (!claudePath) {
      return { ok: false, error: 'claude 명령을 찾지 못했어요. Claude Code 를 설치하고 터미널에서 한 번 로그인해 주세요.' };
    }

    // 이어서 작업: 렌더러가 보낸 폴더·세션 값은 믿지 않고, 메인이 기억하는 값을 쓴다
    let jobDir;
    let jobNo;
    let resumeId = null;
    const want = payload.resume && Number(payload.resume.jobNo);
    if (want) {
      const prev = finished.get(want);
      if (!prev || !fs.existsSync(prev.jobDir)) return { ok: false, error: '이전 작업 폴더를 찾을 수 없어요. 새 상자로 보내 주세요.' };
      jobDir = prev.jobDir;
      jobNo = want;
      resumeId = prev.sessionId && SESSION_RE.test(prev.sessionId) ? prev.sessionId : null;
    } else {
      jobNo = config.nextJobNo();
      jobDir = await job.createJobDir(cfg.jobsDir, jobNo, payload.prompt);
    }
    const followUp = !!want;

    const files = await job.copyInputs(jobDir, (Array.isArray(payload.files) ? payload.files : []).filter((f) => f && typeof f.path === 'string' && f.path));
    const prompt = job.buildPrompt({ jobDir, files, userPrompt: payload.prompt, followUp: followUp && !!resumeId });
    fs.writeFileSync(path.join(jobDir, followUp ? `prompt_followup_${Date.now()}.md` : 'prompt.md'), prompt, 'utf8');

    const metaFile = path.join(jobDir, 'job.json');
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* new */ }
    meta = {
      ...meta,
      jobNo,
      createdAt: meta.createdAt || new Date().toISOString(),
      runs: [...(Array.isArray(meta.runs) ? meta.runs : []), { at: new Date().toISOString(), prompt: String(payload.prompt || ''), files: files.map((f) => f.rel) }],
    };
    await job.writeJson(metaFile, meta);

    const runner = new ClaudeJob();
    runner.on('event', async (ev) => {
      if (ev.kind !== 'exit') { send('job:event', ev); return; }
      let outputs = [];
      try {
        outputs = await job.collectOutputs(jobDir);
        const r = runner.result;
        meta.sessionId = runner.sessionId || meta.sessionId;
        meta.runs[meta.runs.length - 1].result = r
          ? { ok: r.subtype === 'success' && !r.is_error, text: r.result, cost: r.total_cost_usd, durationMs: r.duration_ms }
          : { ok: false, exit: ev.code, cancelled: !!ev.cancelled };
        meta.outputs = outputs.map((o) => path.relative(jobDir, o.path));
        await job.writeJson(metaFile, meta);
      } catch (e) {
        console.error('after-exit failed', e);
      } finally {
        if (meta.sessionId || runner.sessionId) finished.set(jobNo, { jobDir, sessionId: runner.sessionId || meta.sessionId });
        else finished.set(jobNo, { jobDir, sessionId: null });
        if (current && current.job === runner) current = null;
        send('job:event', { kind: 'outputs', files: outputs.map((o) => ({ ...o, sizeText: job.human(o.size) })) });
        send('job:event', { ...ev, sessionId: runner.sessionId });
      }
    });

    runner.start({
      claudePath,
      cwd: jobDir,
      prompt,
      resume: resumeId,
      model: cfg.model,
      effort: cfg.effort,
      permissionMode: cfg.permissionMode,
    });
    current = { job: runner, jobDir, jobNo, startedAt: Date.now() };
    return { ok: true, jobDir, jobNo, inputs: files.length };
  } catch (e) {
    console.error('job:start failed', e);
    return { ok: false, error: `작업을 시작하지 못했어요: ${e.message || e}` };
  }
});

ipcMain.handle('job:cancel', () => { if (current) current.job.cancel(); return true; });

// ───────────────────────── 스크린샷 모드 (개발용) ─────────────────────────
if (SHOT) {
  ipcMain.handle('debug:save-png', (_e, dataUrl, name) => {
    const buf = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
    const out = path.join(SHOT_DIR, path.basename(String(name || 'shot.png')));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    return out;
  });
}

// --record-dir=<폴더>: 스크린샷 모드 동안 렌더링되는 프레임을 약 25fps JPEG 로 저장 (README/사이트용 데모 영상)
// 만든 뒤: ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=30,format=yuv420p" demo.mp4
function startRecorder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  const frames = [];
  let last = -1e9;
  win.webContents.beginFrameSubscription(false, (image) => {
    const t = Date.now() - t0;
    if (t - last < 40 || image.isEmpty()) return;
    last = t;
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, name), image.toJPEG(90));
    frames.push([name, t]);
  });
  return {
    async stop() {
      win.webContents.endFrameSubscription();
      // 화면이 멈춰 있으면 프레임이 안 오므로 각 프레임의 실제 길이를 적어 둔다
      const end = Date.now() - t0;
      let txt = '';
      frames.forEach(([name, at], k) => {
        const next = frames[k + 1] ? frames[k + 1][1] : end;
        txt += `file '${name}'\nduration ${((next - at) / 1000).toFixed(3)}\n`;
      });
      if (frames.length) txt += `file '${frames[frames.length - 1][0]}'\n`;
      fs.writeFileSync(path.join(dir, 'frames.txt'), txt);
    },
  };
}

async function runShots() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const rec = arg('record-dir') ? startRecorder(arg('record-dir')) : null;
  const list = (arg('shots') || 'idle,hover,drag,loaded,sending,working,done,failed').split(',');
  await wait(1500);
  const realFiles = arg('real-files').split('|').filter(Boolean);
  const realPrompt = arg('real-prompt');
  await win.webContents.executeJavaScript(`window.__realFiles = ${JSON.stringify(realFiles)}; window.__realPrompt = ${JSON.stringify(realPrompt)};`);
  // --proof-json=<파일>: 실제 작업의 결과(요약·결과 파일·시간·비용)로 결과 카드를 다시 그릴 때
  if (arg('proof-json')) {
    const proof = JSON.parse(fs.readFileSync(arg('proof-json'), 'utf8'));
    await win.webContents.executeJavaScript(`window.__proof = ${JSON.stringify(proof)};`);
  }
  for (const s of list) {
    const ms = await win.webContents.executeJavaScript(`window.__demo ? window.__demo(${JSON.stringify(s)}) : 0`);
    if (ms && ms.waitPhase) {
      // 실제 작업/전체 데모: 끝날 때까지 기다리며 중간 스냅샷
      const t0 = Date.now();
      let n = 0;
      while (Date.now() - t0 < 15 * 60 * 1000) {
        await wait(5000);
        const ph = await win.webContents.executeJavaScript('window.__phase()');
        if (++n % 6 === 0) {
          try { fs.writeFileSync(path.join(SHOT_DIR, `${s}_t${n * 5}.png`), (await win.webContents.capturePage()).toPNG()); } catch { /* ignore */ }
        }
        console.log('phase', ph, Math.round((Date.now() - t0) / 1000) + 's');
        if (ph === 'done' || ph === 'failed') break;
      }
      await wait(4500);
    } else await wait(typeof ms === 'number' && ms > 0 ? ms : 1600);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, `${s}.png`), img.toPNG());
    console.log('shot', s);
  }
  if (rec) await rec.stop();
  app.exit(0);
}

// ───────────────────────── 앱 수명 ─────────────────────────
if (gotLock) {
  app.whenReady().then(async () => {
    // 렌더러가 카메라·마이크·알림 등 권한을 요청하면 모두 거절
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    if (isMac && app.dock && !SHOT) app.dock.hide();
    createWindow();
    if (!SHOT) buildTray();
    // macOS: Finder 로 실행하면 PATH 가 짧다 → 로그인 셸의 PATH 를 가져온다 (창은 먼저 띄움)
    if (isMac) adoptLoginShellPath().catch(() => {});
  });
}

// 작업 중에 끄면 Claude 프로세스를 정리하고(최대 3초) 기록을 남긴 뒤 종료
app.on('before-quit', (e) => {
  if (!current || quitting) return;
  e.preventDefault();
  quitting = true;
  const runner = current.job;
  runner.cancel();
  Promise.race([runner.done, new Promise((r) => setTimeout(r, 3000))]).then(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
