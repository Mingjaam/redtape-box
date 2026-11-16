// 아주 작은 마크다운 → HTML (먼저 이스케이프하므로 안전)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(「확인 필요」|\[확인 ?필요\]|확인 ?필요)/g, '<mark>$1</mark>');
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let html = '';
  let list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { close(); continue; }
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) { close(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-')) continue; // |---|:--:| 구분 줄
      close();
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => `<span>${inline(c.trim())}</span>`).join('');
      html += `<div class="tr">${cells}</div>`;
      continue;
    }
    close();
    html += `<p>${inline(line)}</p>`;
  }
  close();
  return html;
}
