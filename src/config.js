// 사용자 설정 (userData/config.json). 메인 프로세스 전용.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'config.json');

const defaults = () => ({
  alwaysOnTop: true,          // 다른 창 위에 띄우기 (드래그&드롭이 편함)
  clickThrough: true,         // 상자 바깥 투명 영역은 클릭이 바탕화면으로 통과
  sound: true,
  // Claude Code 실행 옵션
  claudePath: '',             // 비우면 자동 탐색 (PATH, ~/.local/bin 등)
  permissionMode: 'bypassPermissions', // 상자 폴더 안에서 파이썬 실행/파일 작성까지 묻지 않고 진행
  bypassConsent: false,       // 첫 작업 전에 위 권한 모드의 위험을 안내하고 동의를 받았는지
  model: '',                  // 비우면 Claude Code 기본 모델
  effort: '',                 // low|medium|high|xhigh|max, 비우면 기본값
  jobsDir: path.join(app.getPath('documents'), 'RedTape'),
  x: null,
  y: null,
  jobCounter: 0,
});

let cache = null;

function load() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {
    // 첫 실행: 예전 이름(Claude Box) 시절 설정이 있으면 그대로 이어받는다 (작업 폴더·번호·위치 유지)
    try { saved = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'Claude Box', 'config.json'), 'utf8')); } catch { /* 없음 */ }
  }
  cache = { ...defaults(), ...sanitize(saved) };
  return cache;
}

// 손으로 고친 설정 파일에 이상한 값이 있어도 앱이 죽거나 엉뚱한 인자가 넘어가지 않게
const CHOICES = {
  permissionMode: ['bypassPermissions', 'acceptEdits'],
  model: ['', 'opus', 'sonnet', 'haiku', 'fable'],
  effort: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
};
function sanitize(saved) {
  const out = saved && typeof saved === 'object' ? { ...saved } : {};
  for (const [k, allowed] of Object.entries(CHOICES)) {
    if (k in out && !allowed.includes(out[k])) {
      // 모델은 전체 ID(claude-...)도 허용
      if (k === 'model' && typeof out[k] === 'string' && /^[a-z0-9][a-z0-9.\-\[\]]{1,60}$/i.test(out[k])) continue;
      delete out[k];
    }
  }
  for (const k of ['claudePath', 'jobsDir']) if (k in out && typeof out[k] !== 'string') delete out[k];
  if (out.jobsDir === '') delete out.jobsDir;
  for (const k of ['x', 'y']) if (k in out && out[k] !== null && !Number.isFinite(out[k])) out[k] = null;
  if (!Number.isInteger(out.jobCounter) || out.jobCounter < 0) delete out.jobCounter;
  return out;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (e) { console.error('config save failed', e); }
}

module.exports = {
  get: load,
  set(patch) { Object.assign(load(), patch); save(); return cache; },
  nextJobNo() { const c = load(); c.jobCounter = (c.jobCounter || 0) + 1; save(); return c.jobCounter; },
  path: file,
  ensureFile() { load(); save(); return file(); },
};
