// PC에 로그인된 Claude Code CLI 를 헤드리스(-p)로 실행하고 stream-json 이벤트를 단순화해 내보낸다.
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';

function exists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function execText(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, ...opts }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

// macOS 에서 Finder 로 실행한 앱은 PATH 가 /usr/bin:/bin 뿐이다 → 로그인 셸의 PATH 를 가져온다.
async function adoptLoginShellPath() {
  if (isWin) return;
  const shell = process.env.SHELL || '/bin/zsh';
  const out = await execText(shell, ['-ilc', 'printf "__P__%s__P__" "$PATH"']);
  const m = out.match(/__P__(.*)__P__/);
  if (m && m[1]) process.env.PATH = m[1];
}

// PATH 의 폴더들을 직접 훑는다 (where / command -v 출력은 인코딩·셸 설정에 따라 깨지기 쉬움)
function scanPath(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const d of dirs) {
      const p = path.join(d.replace(/^"(.*)"$/, '$1'), name);
      if (exists(p)) return p;
    }
  }
  return null;
}

function globDirs(base, sub) {
  try { return fs.readdirSync(base).map((v) => path.join(base, v, sub)); } catch { return []; }
}

async function resolveClaude(configured) {
  if (configured && typeof configured === 'string' && exists(configured)) return configured;
  const home = os.homedir();
  if (isWin) {
    // 네이티브 설치(.exe) → PATH 의 .exe → npm 전역 설치(.cmd) 순
    const native = path.join(home, '.local', 'bin', 'claude.exe');
    if (exists(native)) return native;
    const npmCmd = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd');
    return scanPath(['claude.exe']) || scanPath(['claude.cmd']) || (exists(npmCmd) ? npmCmd : null);
  }
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.volta', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
    ...globDirs(path.join(home, '.nvm', 'versions', 'node'), path.join('bin', 'claude')),
  ];
  for (const c of candidates) if (exists(c)) return c;
  const fromPath = scanPath(['claude']);
  if (fromPath) return fromPath;
  // 마지막 수단: 로그인 셸에 물어본다 (셸 시작 스크립트가 찍는 줄은 걸러냄)
  const found = await execText(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v claude']);
  const pick = found.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.startsWith('/')).find(exists);
  return pick || null;
}

class ClaudeJob extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.result = null;
    this.sessionId = null;
    this.stderr = '';
    this.cancelled = false;
    this.exited = false;
    this.spawnError = '';
    this.done = new Promise((r) => { this._resolveDone = r; });
  }

  // 'error' 와 'close' 가 모두 와도 exit 는 한 번만 내보낸다
  _exit(code) {
    if (this.exited) return;
    this.exited = true;
    clearTimeout(this._killTimer);
    clearTimeout(this._errTimer);
    this.emit('event', {
      kind: 'exit',
      code,
      cancelled: this.cancelled,
      error: this.spawnError || undefined,
      stderr: this.stderr.trim().slice(-1200),
    });
    this._resolveDone();
  }

  start({ claudePath, cwd, prompt, resume, model, effort, permissionMode }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (permissionMode) args.push('--permission-mode', permissionMode);
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (resume) args.push('--resume', resume);

    const env = { ...process.env };
    // 이 앱을 Claude Code 터미널에서 띄웠을 때 '중첩 실행' 으로 막히지 않도록
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';

    const useShell = isWin && /\.(cmd|bat)$/i.test(claudePath);
    // .cmd 는 cmd.exe 를 거치므로 인자에 셸 특수문자가 섞이면 안 된다 (값은 main 에서 검증됨)
    if (useShell && args.some((a) => /[^\w.:\-]/.test(a))) throw new Error('claude 실행 인자에 허용되지 않는 문자가 있어요');
    this.child = spawn(useShell ? `"${claudePath}"` : claudePath, args, {
      cwd,
      env,
      shell: useShell,
      windowsHide: true,
      detached: !isWin, // mac/linux: 프로세스 그룹째 종료하기 위해
    });

    this.child.stdin.on('error', () => {});
    this.child.stdin.end(prompt, 'utf8');

    // 줄 단위 파싱. 새로 들어온 조각에서만 줄바꿈을 찾는다 (이미지·PDF 를 읽으면 한 줄이 수 MB)
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      let start = 0;
      let i;
      while ((i = chunk.indexOf('\n', start)) >= 0) {
        const line = (buf + chunk.slice(start, i)).trim();
        buf = '';
        start = i + 1;
        if (line) this._line(line);
      }
      buf += chunk.slice(start);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-4000);
    });
    this.child.on('error', (err) => {
      this.spawnError = String((err && err.message) || err);
      // 실행 자체가 실패하면 보통 'close' 가 뒤따르지만, 안 올 때를 대비
      this._errTimer = setTimeout(() => this._exit(-1), 1500);
    });
    this.child.on('close', (code) => {
      if (buf.trim()) this._line(buf.trim());
      buf = '';
      this._exit(code);
    });
  }

  _line(line) {
    let o;
    try { o = JSON.parse(line); } catch { return; }
    if (o.session_id) this.sessionId = o.session_id;
    const emit = (ev) => this.emit('event', ev);

    if (o.type === 'system') {
      if (o.subtype === 'init') emit({ kind: 'init', model: o.model, sessionId: o.session_id, cwd: o.cwd });
      else if (o.subtype === 'thinking_tokens') emit({ kind: 'thinking', tokens: o.estimated_tokens });
      return;
    }
    if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
      // 서브에이전트 내부 메시지는 parent_tool_use_id 가 붙어 온다 → 표시만 살짝 다르게
      const sub = !!o.parent_tool_use_id;
      for (const c of o.message.content) {
        if (c.type === 'tool_use') emit({ kind: 'tool', id: c.id, name: c.name, input: c.input || {}, sub });
        else if (c.type === 'text' && c.text && c.text.trim()) emit({ kind: 'text', text: c.text, sub });
        else if (c.type === 'thinking') emit({ kind: 'thinking' });
      }
      return;
    }
    if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c.type === 'tool_result') {
          let preview = '';
          if (typeof c.content === 'string') preview = c.content;
          else if (Array.isArray(c.content)) preview = c.content.map((x) => x.text || '').join(' ');
          emit({ kind: 'tool_result', id: c.tool_use_id, isError: !!c.is_error, preview: preview.slice(0, 300) });
        }
      }
      return;
    }
    if (o.type === 'result') {
      this.result = o;
      emit({
        kind: 'result',
        ok: o.subtype === 'success' && !o.is_error,
        text: o.result || '',
        durationMs: o.duration_ms,
        turns: o.num_turns,
        cost: o.total_cost_usd,
        sessionId: o.session_id,
        subtype: o.subtype,
      });
    }
  }

  cancel() {
    if (!this.child || this.exited || this.child.exitCode !== null) return;
    this.cancelled = true;
    const pid = this.child.pid;
    if (!pid) return;
    if (isWin) {
      // 자식(python 등)까지 트리째 종료
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      const kill = (sig) => { try { process.kill(-pid, sig); } catch { try { this.child.kill(sig); } catch {} } };
      kill('SIGTERM');
      // 5초 안에 안 끝나면 강제 종료
      clearTimeout(this._killTimer);
      this._killTimer = setTimeout(() => { if (!this.exited) kill('SIGKILL'); }, 5000);
    }
  }
}

async function claudeVersion(claudePath) {
  if (!claudePath) return '';
  if (isWin && /\.(cmd|bat)$/i.test(claudePath)) {
    return (await execText(`"${claudePath}"`, ['--version'], { shell: true })).trim();
  }
  return (await execText(claudePath, ['--version'])).trim();
}

module.exports = { ClaudeJob, resolveClaude, adoptLoginShellPath, claudeVersion };
