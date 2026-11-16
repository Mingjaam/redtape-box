// Claude Box 소개 페이지 — 등장 움직임, 질문 카드, 미리보기 상자 제어
document.documentElement.classList.add('js');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// WebGL 이 없으면 실제 앱 대신 녹화 영상을 보여 준다
const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
if (!gl) document.documentElement.classList.add('no-webgl');

// 섹션마다 제목 → 글 → 그림 순으로 60~90ms 씩 늦게 올라온다
const groups = [
  ['.hero', ['h1', '.hero-lead', '.hero-actions']],
  ['.stair', ['.stair-line', '.stair-text p', '.stair-pic']],
  ['.proof', ['.slip', '.proof-film']],
  ['.field', ['.field-note', '.field-phrase']],
  ['.get', ['.get-word']],
  ['.faq', ['h2', '.card']],
];
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.querySelectorAll('.will').forEach((n) => n.classList.add('in'));
    e.target.querySelectorAll('.shutter').forEach((n) => n.classList.add('open'));
    io.unobserve(e.target);
  }
}, { threshold: 0.18 });
if (!reduce) {
  for (const [sel, parts] of groups) {
    document.querySelectorAll(sel).forEach((sec) => {
      let k = 0;
      for (const p of parts) sec.querySelectorAll(p).forEach((n) => { n.classList.add('will'); n.style.setProperty('--d', `${k++ * 80}ms`); });
      io.observe(sec);
    });
  }
  // 실제 작업 카드 속 사진은 위에서 아래로 셔터처럼 열린다
  const pic = document.querySelector('.slip-pic');
  if (pic) {
    const wrap = document.createElement('div');
    wrap.className = 'shutter';
    pic.replaceWith(wrap);
    wrap.appendChild(pic);
  }
}

// 질문 카드: 하나만 펼친다
const cards = [...document.querySelectorAll('.card')];
for (const card of cards) {
  const head = card.querySelector('.card-head');
  head.addEventListener('click', () => {
    const opening = !card.classList.contains('open');
    for (const c of cards) {
      const on = c === card && opening;
      c.classList.toggle('open', on);
      c.querySelector('.card-head').setAttribute('aria-expanded', String(on));
      c.querySelector('.card-body').hidden = !on;
    }
  });
}

// "전체 과정 재생" → 미리보기 상자에 데모를 돌린다
const frame = document.getElementById('liveApp');
document.getElementById('playDemo')?.addEventListener('click', () => {
  const w = frame?.contentWindow;
  if (gl && w && typeof w.__demo === 'function') {
    frame.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    w.__demo('play');
  } else {
    document.querySelector('.proof-film')?.scrollIntoView({ behavior: 'smooth' });
  }
});

// 화면 밖의 영상은 멈춰 둔다
const vids = document.querySelectorAll('video');
const vio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.play().catch(() => {}); else e.target.pause(); }));
vids.forEach((v) => { if (reduce) { v.removeAttribute('autoplay'); v.pause(); v.controls = true; } else vio.observe(v); });
