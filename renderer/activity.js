// Claude 의 도구 호출 → 사람이 보기 재밌는 한 줄 설명
const base = (p) => String(p || '').split(/[\\/]/).pop();
const IMG = /\.(jpe?g|png|heic|gif|webp|bmp|tiff?)$/i;
const short = (s, n = 34) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const inOutputs = (p) => /[\\/]outputs[\\/]|^outputs[\\/]/i.test(String(p || ''));

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// 반환: { icon, text(영수증 한 줄), bubble(말풍선), fx(read|write|run|think), phase }
export function describe(name, input = {}) {
  const f = base(input.file_path || input.path || input.notebook_path);
  switch (name) {
    case 'Read': {
      if (IMG.test(f)) return { icon: '🔍', text: `${f} 들여다봄`, bubble: `🔍 ${short(f, 22)} 꼼꼼히 들여다보는 중…`, fx: 'read', phase: inOutputs(input.file_path) ? 'check' : 'look' };
      if (/\.pdf$/i.test(f)) return { icon: '📑', text: `${f} 넘겨봄`, bubble: `📑 ${short(f, 22)} 한 장씩 넘겨보는 중…`, fx: 'read', phase: inOutputs(input.file_path) ? 'check' : 'look' };
      return { icon: '📖', text: `${f} 읽음`, bubble: `📖 ${short(f, 24)} 읽는 중…`, fx: 'read', phase: inOutputs(input.file_path) ? 'check' : 'look' };
    }
    case 'Write':
      return { icon: '✍️', text: `${f} 작성`, bubble: `✍️ ${short(f, 22)} 쓰는 중…`, fx: 'write', phase: 'fill' };
    case 'Edit':
    case 'MultiEdit':
      return { icon: '🩹', text: `${f} 수정`, bubble: `🩹 ${short(f, 22)} 다듬는 중…`, fx: 'write', phase: 'fill' };
    case 'NotebookEdit':
      return { icon: '📓', text: `${f} 노트 수정`, bubble: '📓 노트 정리 중…', fx: 'write', phase: 'fill' };
    case 'Bash':
    case 'PowerShell': {
      const cmd = String(input.command || '');
      const desc = input.description ? short(input.description, 40) : '';
      if (/pip(3)? install|python -m pip|Install-Module/i.test(cmd)) return { icon: '📦', text: desc || '도구 설치', bubble: '📦 필요한 도구를 챙기는 중…', fx: 'run', phase: 'look' };
      if (/soffice|libreoffice|pandoc|docx2pdf|ExportAsFixedFormat/i.test(cmd)) return { icon: '🖨️', text: desc || '문서 변환', bubble: '🖨️ 문서를 변환하는 중…', fx: 'run', phase: 'fill' };
      if (/HWPFrame|hwp/i.test(cmd) && /python|py /i.test(cmd)) return { icon: '📝', text: desc || '한글 문서 작업', bubble: '📝 한글(HWP) 문서를 만지는 중…', fx: 'write', phase: 'fill' };
      if (/python|py\s|\.py\b/i.test(cmd)) return { icon: '🐍', text: desc || '파이썬 실행', bubble: desc ? `🐍 ${desc}` : pick(['🐍 파이썬으로 뚝딱뚝딱…', '🧮 계산기 두드리는 중…', '🐍 스크립트 돌리는 중…']), fx: 'run', phase: /outputs/i.test(cmd) ? 'fill' : 'look' };
      if (/^\s*(ls|dir|Get-ChildItem|find|tree)\b/i.test(cmd)) return { icon: '👀', text: desc || '상자 안 둘러봄', bubble: '👀 상자 안을 둘러보는 중…', fx: 'read', phase: 'look' };
      if (/unzip|Expand-Archive|zipfile/i.test(cmd)) return { icon: '🗜️', text: desc || '압축 풀기', bubble: '🗜️ 문서 속을 열어보는 중…', fx: 'run', phase: 'look' };
      return { icon: '⌨️', text: desc || short(cmd, 40), bubble: desc ? `⌨️ ${desc}` : '⌨️ 명령 실행 중…', fx: 'run', phase: null };
    }
    case 'Glob':
    case 'Grep':
      return { icon: '🔎', text: `찾기: ${short(input.pattern, 28)}`, bubble: '🔎 뒤적뒤적 찾는 중…', fx: 'read', phase: 'look' };
    case 'WebSearch':
      return { icon: '🌐', text: `검색: ${short(input.query, 28)}`, bubble: `🌐 "${short(input.query, 18)}" 찾아보는 중…`, fx: 'read', phase: 'look' };
    case 'WebFetch':
      return { icon: '🌐', text: '웹 페이지 확인', bubble: '🌐 웹 페이지 확인 중…', fx: 'read', phase: 'look' };
    case 'Task':
    case 'Agent':
      return { icon: '👥', text: `조수 호출: ${short(input.description, 26)}`, bubble: '👥 조수를 불러 나눠 하는 중…', fx: 'run', phase: null };
    case 'Skill':
      return { icon: '🧰', text: `비법서: ${short(input.skill || input.name, 26)}`, bubble: `🧰 ${short(input.skill || input.name, 18)} 비법서 펼치는 중…`, fx: 'think', phase: null };
    case 'ToolSearch':
      return { icon: '🧰', text: '도구함 뒤짐', bubble: '🧰 도구함 뒤지는 중…', fx: 'think', phase: null };
    case 'TodoWrite':
      return { icon: '📝', text: '할 일 정리', bubble: '📝 할 일을 정리하는 중…', fx: 'think', phase: null };
    default:
      return { icon: '🔧', text: short(name.replace(/^mcp__\w+__/, ''), 30), bubble: `🔧 ${short(name.replace(/^mcp__\w+__/, ''), 20)} 사용 중…`, fx: 'run', phase: null };
  }
}

export const IDLE_LINES = [
  '파일을 끌어다 넣어 주세요 📄',
  '양식이랑 영수증, 다 받아요!',
  '출장 서류? 맡겨만 주세요 ✈️',
  '오늘도 서류 정리하기 좋은 날 ☀️',
];

export const THINK_LINES = ['🤔 곰곰이 생각 중…', '🤔 어떻게 채울지 궁리 중…', '💭 머리 굴리는 중…'];
