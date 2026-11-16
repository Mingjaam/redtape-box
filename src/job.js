// 작업 상자(폴더) 만들기, 입력 파일 복사, Claude 에게 줄 지시문 작성, 결과물 수집.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROLE_LABEL = { form: '양식(채울 서식)', evidence: '증빙자료', ref: '참고자료' };

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 폴더 이름용. Windows 는 끝의 점·공백을 허용하지 않으므로 지운다 (예: "...채워줘." → "...채워줘")
function slug(text) {
  const s = String(text || '').normalize('NFC')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .trim().split(/\s+/).slice(0, 4).join('_')
    .slice(0, 24)
    .replace(/^[.\s_]+|[.\s_]+$/g, '');
  return s || '작업';
}

function human(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${stem} (${i})${ext}`);
  return p;
}

async function createJobDir(jobsDir, jobNo, prompt) {
  const dir = path.join(jobsDir, `${stamp()}_${pad(jobNo, 4)}_${slug(prompt)}`);
  for (const sub of ['inputs', 'outputs', 'work']) await fsp.mkdir(path.join(dir, sub), { recursive: true });
  return dir;
}

async function copyInputs(jobDir, files) {
  const copied = [];
  for (const f of files) {
    const dst = await uniquePath(path.join(jobDir, 'inputs'), path.basename(f.path));
    await fsp.copyFile(f.path, dst);
    const st = await fsp.stat(dst);
    copied.push({ ...f, rel: `inputs/${path.basename(dst)}`, size: st.size });
  }
  return copied;
}

function today() {
  const d = new Date();
  const wd = '일월화수목금토'[d.getDay()];
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${wd})`;
}

function buildPrompt({ jobDir, files, userPrompt, followUp }) {
  const list = files.length
    ? files.map((f, i) => `${i + 1}. ${f.rel}  — ${ROLE_LABEL[f.role] || '자료'}, ${human(f.size)}`).join('\n')
    : '(이번에는 파일 없음)';

  if (followUp) {
    return [
      '# Red Tape — 추가 요청',
      '같은 작업 상자에서 이어서 진행합니다. 결과물은 계속 ./outputs/ 에 두고, 고친 파일은 같은 이름으로 덮어쓰세요(이전 버전이 필요하면 ./work/ 에 백업).',
      files.length ? `\n## 새로 넣은 파일\n${list}` : '',
      `\n## 사용자 요청\n"""\n${userPrompt || '(요청 없음 — 새 파일을 반영해 결과물을 갱신해 주세요)'}\n"""`,
      '\n마지막 답변은 이전과 같은 형식(## 결과 / ## 채운 핵심 값 / ## 확인 필요)으로 짧게 정리하세요.',
    ].join('\n');
  }

  return `# Red Tape 작업 지시
당신은 사용자의 바탕화면에 떠 있는 'Red Tape'(빨간 테이프로 봉인하는 택배상자 모양 앱) 안에서 일하는 행정 서류 작업자입니다.
사용자가 상자에 넣은 파일과 요청을 보고, 완성된 결과물을 상자에 다시 담아 돌려주세요.
오늘 날짜: ${today()}

## 작업 상자(폴더)
- 현재 폴더(cwd)가 이번 작업 상자입니다: ${jobDir}
- 사용자가 넣은 파일: ./inputs/  (원본의 사본입니다. 수정하거나 지우지 마세요)
- 최종 결과물: 반드시 ./outputs/ 에 저장 (사용자에게 보여줄 파일만, 파일명은 한국어로 알아보기 쉽게)
- 중간 작업 파일·스크립트: ./work/

## 넣은 파일 (역할은 사용자가 고르거나 앱이 추정한 것 — 틀릴 수 있으니 열어 보고 판단)
${list}

## 사용자 요청
"""
${userPrompt || '(요청 없음 — 파일들을 보고 양식이 있으면 증빙자료로 채워 주세요)'}
"""

## 일하는 방식
1. 먼저 모든 파일을 열어 보고 무엇이 양식(채울 서식)이고 무엇이 증빙(영수증·공문·일정표·메일·탑승권 등)인지 판단하세요. 이미지와 PDF는 Read 도구로 직접 볼 수 있습니다.
2. 양식이 있으면 원래 서식(표, 칸 배치, 글꼴, 머리글)을 최대한 그대로 유지한 채 빈칸을 채우고, 원칙적으로 양식과 같은 형식으로 저장하세요.
   - .docx → python-docx / .xlsx → openpyxl (수식·서식 유지)
   - .hwpx → zip 안 Contents/section*.xml 의 텍스트를 고친 뒤 다시 압축 (mimetype 항목은 맨 앞, 무압축)
   - .hwp(바이너리) → Windows에 한컴오피스가 있으면 pywin32 COM(HWPFrame.HwpObject)으로 열어 채우고 저장. 안 되면 같은 내용의 .docx 와 .pdf 를 만들고 이유를 알려주세요.
   - .pdf 양식 → 입력 필드가 있으면 채우고, 없으면 원본 위에 글자를 얹은 새 PDF 를 만드세요.
   - 필요한 파이썬 패키지가 없으면 pip install --user 로 설치해도 됩니다.
3. 증빙에서 날짜·시간·장소·금액·인원·결제수단·승인번호 등을 정확히 옮기세요. 금액은 합계를 계산한 뒤 한 번 더 검산하세요.
4. 자료에 없거나 확실하지 않은 값은 지어내지 말고 「확인 필요」라고 적으세요. 서명·도장 칸은 비워 두세요.
5. 영수증 첨부가 필요한 서류라면, 영수증 이미지를 보기 좋게 모은 '증빙 첨부' 문서(PDF 등)도 함께 만드세요.
6. 일하는 동안 단계가 바뀔 때마다 지금 하는 일을 한 문장으로 짧게 말해 주세요 (예: "영수증 3장에서 금액을 읽고 있어요"). 이 문장은 앱 화면의 말풍선에 그대로 보입니다.
7. 끝내기 전에 ./outputs 의 결과 파일을 다시 열어 값이 제대로 들어갔는지 확인하세요.

## 마지막 답변 형식 (앱의 결과 카드에 그대로 보입니다. 한국어, 짧게)
## 결과
- 만든 파일명 — 한 줄 설명
## 채운 핵심 값
- 항목: 값  (최대 8줄)
## 확인 필요
- 사용자가 직접 확인해야 할 항목 (없으면 "없음")
`;
}

const SKIP = new Set(['job.json', 'prompt.md', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
const skipName = (n) => SKIP.has(n) || n.startsWith('.') || n.startsWith('~$') || /^prompt(_followup_\d+)?\.md$/.test(n);

async function fileInfo(p, name) {
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) return null;
    return { path: p, name: name.normalize('NFC'), size: st.size, ext: path.extname(name).slice(1).toLowerCase(), mtime: st.mtimeMs };
  } catch { return null; } // 그 사이 지워졌거나 깨진 링크
}

async function walk(dir, depth = 0, acc = []) {
  if (depth > 3) return acc;
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (skipName(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, depth + 1, acc);
    else {
      const f = await fileInfo(p, e.name);
      if (f) acc.push(f);
    }
  }
  return acc;
}

async function collectOutputs(jobDir) {
  let files = await walk(path.join(jobDir, 'outputs'));
  if (!files.length) {
    // outputs 를 안 쓰고 상자 루트에 저장했을 때 대비
    const root = await fsp.readdir(jobDir, { withFileTypes: true }).catch(() => []);
    for (const e of root) {
      if (!e.isFile() || skipName(e.name)) continue;
      const f = await fileInfo(path.join(jobDir, e.name), e.name);
      if (f) files.push(f);
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

// 드롭된 경로들 → 파일 목록 (폴더는 펼침)
async function statPaths(paths, limit = 200) {
  const out = [];
  if (!Array.isArray(paths)) return out;
  for (const p of paths) {
    if (typeof p !== 'string' || !p) continue;
    let st;
    try { st = await fsp.stat(p); } catch { continue; }
    if (st.isDirectory()) {
      const inner = await walk(p, 1);
      for (const f of inner) if (out.length < limit) out.push({ path: f.path, name: f.name, size: f.size, ext: f.ext });
    } else if (st.isFile() && out.length < limit) {
      // macOS 는 한글 파일명을 자모 분리(NFD)로 줄 때가 있어 NFC 로 맞춘다 (역할 추정용)
      out.push({ path: p, name: path.basename(p).normalize('NFC'), size: st.size, ext: path.extname(p).slice(1).toLowerCase() });
    }
  }
  return out;
}

async function writeJson(file, data) {
  try { await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8'); } catch { /* ignore */ }
}

module.exports = { createJobDir, copyInputs, buildPrompt, collectOutputs, statPaths, writeJson, human };
