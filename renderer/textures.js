// 골판지·종이·테이프 텍스처를 캔버스로 직접 그린다 (외부 이미지 없음).
export const FONT_SANS = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif';
export const FONT_PEN = '"Nanum Pen Script","Malgun Gothic",cursive';
export const FONT_MONO = '"Nanum Gothic Coding","Consolas",monospace';

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ───────────── 크라프트 골판지 표면 ─────────────
export function kraft(w, h, { seed = 1, base = [176, 129, 80], flutes = 46, dirt = 1, inner = false } = {}) {
  const r = rng(seed);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, w, h);

  // 얼룩(섬유 밀도 차이)
  g.save();
  g.filter = 'blur(26px)';
  for (let i = 0; i < 70; i++) {
    const light = r() < 0.5;
    const a = 0.05 + r() * 0.09;
    g.fillStyle = light ? `rgba(236,196,140,${a})` : `rgba(92,58,26,${a})`;
    g.beginPath();
    const rad = 30 + r() * 170;
    g.ellipse(r() * w, r() * h, rad, rad * (0.4 + r() * 0.8), r() * 3.14, 0, 6.29);
    g.fill();
  }
  g.restore();

  // 골(플루트)이 겉지 너머로 은은하게 비치는 세로 줄무늬
  const pitch = w / flutes;
  for (let i = 0; i < flutes; i++) {
    const x = i * pitch;
    const gr = g.createLinearGradient(x, 0, x + pitch, 0);
    gr.addColorStop(0, 'rgba(60,35,10,0.022)');
    gr.addColorStop(0.5, 'rgba(255,235,200,0.028)');
    gr.addColorStop(1, 'rgba(60,35,10,0.022)');
    g.fillStyle = gr;
    g.fillRect(x, 0, pitch + 1, h);
  }

  // 섬유
  const nFib = (w * h) / 70;
  for (let i = 0; i < nFib; i++) {
    const x = r() * w, y = r() * h, len = 2 + r() * 10, a = r() * Math.PI;
    const light = r() < 0.55;
    g.strokeStyle = light ? `rgba(240,206,155,${0.08 + r() * 0.16})` : `rgba(70,42,16,${0.05 + r() * 0.1})`;
    g.lineWidth = 0.5 + r() * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 3, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 3, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // 티끌
  for (let i = 0; i < (w * h) / 1500; i++) {
    g.fillStyle = `rgba(45,28,10,${0.12 + r() * 0.35})`;
    g.fillRect(r() * w, r() * h, 0.8 + r() * 1.8, 0.8 + r() * 1.6);
  }

  // 손때·긁힘
  if (dirt > 0) {
    for (let i = 0; i < 6 * dirt; i++) {
      g.strokeStyle = `rgba(250,225,190,${0.06 + r() * 0.08})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      const x = r() * w, y = r() * h;
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 160, y + (r() - 0.5) * 40);
      g.stroke();
    }
    // 가장자리가 살짝 어둡게 (모서리 손때)
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, inner ? 'rgba(40,22,8,0.28)' : 'rgba(60,35,12,0.16)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  // 미세 입자
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 16;
    d[i] += n; d[i + 1] += n * 0.95; d[i + 2] += n * 0.8;
  }
  g.putImageData(id, 0, 0);
  return c;
}

// 골 방향 노멀맵 (타일링) — 표면이 빛에 따라 미세하게 울퉁불퉁
export function fluteNormal(size = 256, flutes = 8, seed = 7) {
  const r = rng(seed);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = Math.sin((x / size) * Math.PI * 2 * flutes);
      hgt[y * size + x] = f * 0.55 + (r() - 0.5) * 0.35;
    }
  }
  // 가벼운 블러
  const blur = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) s += hgt[((y + k + size) % size) * size + ((x + j + size) % size)];
    blur[y * size + x] = s / 9;
  }
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const id = g.createImageData(size, size);
  const s = 2.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hL = blur[y * size + ((x - 1 + size) % size)], hR = blur[y * size + ((x + 1) % size)];
    const hU = blur[((y - 1 + size) % size) * size + x], hD = blur[((y + 1) % size) * size + x];
    let nx = (hL - hR) * s, ny = (hD - hU) * s, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    id.data[i] = (nx * 0.5 + 0.5) * 255;
    id.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    id.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  return c;
}

// ───────────── 인쇄(잉크) 레이어 ─────────────
function wear(c, seed, amount = 0.4) {
  const r = rng(seed);
  const g = c.getContext('2d');
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const n = (c.width * c.height * amount) / 55;
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.75})`;
    g.beginPath();
    g.ellipse(r() * c.width, r() * c.height, 0.4 + r() * 2.2, 0.3 + r() * 1.5, r() * 3, 0, 6.3);
    g.fill();
  }
  g.restore();
  return c;
}

function stampOnto(base, layer, alpha = 0.85) {
  const g = base.getContext('2d');
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = 'multiply';
  g.drawImage(layer, 0, 0);
  g.restore();
}

function inkLayer(w, h, seed, draw, amount) {
  const c = canvas(w, h);
  draw(c.getContext('2d'));
  return wear(c, seed, amount);
}

function arrowUp(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + s * 0.5, y + s * 0.55);
  g.lineTo(x + s * 0.2, y + s * 0.55);
  g.lineTo(x + s * 0.2, y + s * 1.1);
  g.lineTo(x - s * 0.2, y + s * 1.1);
  g.lineTo(x - s * 0.2, y + s * 0.55);
  g.lineTo(x - s * 0.5, y + s * 0.55);
  g.closePath();
  g.fill();
}

function glassIcon(g, x, y, s) {
  g.lineWidth = s * 0.07;
  g.beginPath();
  g.moveTo(x - s * 0.32, y);
  g.quadraticCurveTo(x - s * 0.34, y + s * 0.5, x, y + s * 0.55);
  g.quadraticCurveTo(x + s * 0.34, y + s * 0.5, x + s * 0.32, y);
  g.closePath();
  g.stroke();
  g.beginPath();
  g.moveTo(x, y + s * 0.55); g.lineTo(x, y + s * 0.95);
  g.moveTo(x - s * 0.22, y + s * 0.97); g.lineTo(x + s * 0.22, y + s * 0.97);
  g.stroke();
  // 금 간 표시
  g.lineWidth = s * 0.04;
  g.beginPath();
  g.moveTo(x - s * 0.05, y + s * 0.02); g.lineTo(x + s * 0.06, y + s * 0.16); g.lineTo(x - s * 0.04, y + s * 0.26); g.lineTo(x + s * 0.05, y + s * 0.38);
  g.stroke();
}

function umbrellaIcon(g, x, y, s) {
  g.lineWidth = s * 0.07;
  g.beginPath();
  g.arc(x, y + s * 0.45, s * 0.45, Math.PI, 0);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(x, y + s * 0.45); g.lineTo(x, y + s * 0.95);
  g.arc(x - s * 0.1, y + s * 0.95, s * 0.1, 0, Math.PI);
  g.stroke();
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(x - s * 0.5 + i * s * 0.32, y - s * 0.2);
    g.lineTo(x - s * 0.56 + i * s * 0.32, y - s * 0.02);
    g.stroke();
  }
}

function certificate(g, x, y, rad, lines) {
  g.lineWidth = rad * 0.04;
  g.beginPath(); g.arc(x, y, rad, 0, 6.3); g.stroke();
  g.beginPath(); g.arc(x, y, rad * 0.86, 0, 6.3); g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${rad * 0.2}px ${FONT_SANS}`;
  lines.forEach((t, i) => g.fillText(t, x, y + (i - (lines.length - 1) / 2) * rad * 0.26));
}

function recycle(g, x, y, s) {
  g.lineWidth = s * 0.09;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    const a2 = a + Math.PI * 2 / 3 - 0.5;
    g.beginPath();
    g.arc(x, y, s * 0.42, a + 0.25, a2);
    g.stroke();
    const hx = x + Math.cos(a2) * s * 0.42, hy = y + Math.sin(a2) * s * 0.42;
    g.beginPath();
    g.moveTo(hx + Math.cos(a2 + 1.57) * s * 0.14, hy + Math.sin(a2 + 1.57) * s * 0.14);
    g.lineTo(hx + Math.cos(a2) * s * 0.14, hy + Math.sin(a2) * s * 0.14);
    g.lineTo(hx - Math.cos(a2) * s * 0.14, hy - Math.sin(a2) * s * 0.14);
    g.closePath();
    g.fill();
  }
}

// 오래된 테이프 자국
function oldTape(g, r, x, y, w, h, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = 'rgba(255,236,200,0.09)';
  g.beginPath();
  g.moveTo(0, 0);
  for (let i = 0; i <= 8; i++) g.lineTo(w + (r() - 0.5) * 8, (h / 8) * i);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(90,60,25,0.12)';
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

// 면별 인쇄물
export function facePrint(face, w, h, seed) {
  const base = kraft(w, h, { seed });
  const r = rng(seed + 99);
  const g = base.getContext('2d');

  if (face === 'front') {
    stampOnto(base, inkLayer(w, h, seed + 1, (k) => {
      k.fillStyle = '#b3261e'; k.strokeStyle = '#b3261e';
      glassIcon(k, w * 0.12, h * 0.66, h * 0.2);
      k.font = `900 ${h * 0.085}px ${FONT_SANS}`;
      k.textBaseline = 'top';
      k.fillText('취급주의', w * 0.2, h * 0.68);
      k.font = `800 ${h * 0.05}px ${FONT_SANS}`;
      k.fillText('FRAGILE · 서류 재중', w * 0.2, h * 0.78);
    }, 0.55), 0.8);
    oldTape(g, r, w * 0.02, -4, w * 0.12, h * 0.12, 0.05);
  } else if (face === 'right') {
    stampOnto(base, inkLayer(w, h, seed + 2, (k) => {
      k.fillStyle = '#231a12'; k.strokeStyle = '#231a12';
      arrowUp(k, w * 0.38, h * 0.12, h * 0.2);
      arrowUp(k, w * 0.62, h * 0.12, h * 0.2);
      k.fillRect(w * 0.26, h * 0.37, w * 0.48, h * 0.012);
      k.font = `800 ${h * 0.06}px ${FONT_SANS}`;
      k.textAlign = 'center';
      k.textBaseline = 'top';
      k.fillText('THIS SIDE UP', w * 0.5, h * 0.41);
      umbrellaIcon(k, w * 0.3, h * 0.62, h * 0.16);
      k.font = `700 ${h * 0.045}px ${FONT_SANS}`;
      k.fillText('젖지 않게', w * 0.3, h * 0.82);
      k.strokeStyle = '#1d3f73'; k.fillStyle = '#1d3f73';
      certificate(k, w * 0.72, h * 0.72, h * 0.15, ['RED TAPE', '서류용 B골', '32 ECT']);
    }, 0.5), 0.82);
    oldTape(g, r, w * 0.82, h * 0.0, w * 0.12, h * 0.2, -0.04);
  } else if (face === 'left') {
    stampOnto(base, inkLayer(w, h, seed + 3, (k) => {
      k.fillStyle = '#231a12'; k.strokeStyle = '#231a12';
      recycle(k, w * 0.3, h * 0.68, h * 0.2);
      k.font = `700 ${h * 0.05}px ${FONT_SANS}`;
      k.textAlign = 'center';
      k.fillText('재활용', w * 0.3, h * 0.9);
      arrowUp(k, w * 0.7, h * 0.12, h * 0.16);
    }, 0.55), 0.75);
  } else if (face === 'back') {
    stampOnto(base, inkLayer(w, h, seed + 4, (k) => {
      k.fillStyle = '#231a12';
      k.font = `900 ${h * 0.12}px ${FONT_SANS}`;
      k.textAlign = 'center';
      k.fillText('RED TAPE CO.', w * 0.5, h * 0.42);
      k.font = `700 ${h * 0.05}px ${FONT_SANS}`;
      k.fillText('DOCUMENT GRADE · 이중 골판지', w * 0.5, h * 0.55);
    }, 0.6), 0.7);
  } else if (face === 'flap') {
    // 플랩 위의 스크래치와 손때 정도만
    if (r() < 0.5) oldTape(g, r, r() * w * 0.7, r() * h * 0.5, w * 0.08, h * 0.22, r() - 0.5);
  }
  return base;
}

// 안쪽 면 (조금 더 밝은 속지 + 아래쪽 그늘)
export function innerKraft(w, h, seed) {
  const c = kraft(w, h, { seed, base: [190, 148, 98], flutes: 40, dirt: 1, inner: true });
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(30,15,5,0.35)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  return c;
}

// 잘린 단면 색
export function edgeKraft() {
  const c = kraft(128, 128, { seed: 77, base: [205, 168, 120], flutes: 16, dirt: 0 });
  return c;
}

// 구김 완충지 (상자 속 채움재)
export function crinkle(w = 512, h = 400, seed = 5) {
  const r = rng(seed);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#7a5530';
  g.fillRect(0, 0, w, h);
  const cols = [[214, 176, 122], [196, 154, 100], [228, 200, 150], [176, 132, 82], [240, 226, 196]];
  for (let i = 0; i < 520; i++) {
    const col = cols[(r() * cols.length) | 0];
    const x = r() * w, y = r() * h, len = 40 + r() * 120, a = r() * Math.PI;
    g.lineWidth = 5 + r() * 6;
    g.lineCap = 'round';
    g.strokeStyle = `rgba(${col.join(',')},1)`;
    g.beginPath();
    g.moveTo(x, y);
    const segs = 6;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      g.lineTo(x + Math.cos(a) * len * t + (s % 2 ? 1 : -1) * (3 + r() * 4), y + Math.sin(a) * len * t + (r() - 0.5) * 6);
    }
    g.stroke();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(70,40,15,0.35)';
    g.stroke();
  }
  const vg = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(25,12,3,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  return c;
}

// 박스 테이프
export function tape(w = 1024, h = 160, { printed = true } = {}) {
  const r = rng(11);
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(206,38,36)';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(255,200,190,${0.04 + r() * 0.07})` : `rgba(90,0,0,${0.04 + r() * 0.07})`;
    g.fillRect(0, r() * h, w, 0.8 + r() * 2);
  }
  if (printed) {
    // 포장 테이프에 반복 인쇄된 글씨 (살짝 바랜 흰 잉크)
    g.fillStyle = 'rgba(255,246,238,0.88)';
    g.textBaseline = 'middle';
    g.font = `900 ${h * 0.34}px ${FONT_SANS}`;
    const unit = 'RED TAPE  ✦  서류 재중  ✦  ';
    const uw = g.measureText(unit).width;
    for (let x = -uw * 0.3; x < w; x += uw) g.fillText(unit, x, h * 0.53);
    for (let i = 0; i < 260; i++) { g.clearRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = 'rgb(206,38,36)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  // 가장자리 살짝 진하게
  g.fillStyle = 'rgba(70,0,0,0.3)';
  g.fillRect(0, 0, w, 4);
  g.fillRect(0, h - 4, w, 4);
  return c;
}

// 둥근 그림자
export function blob(size = 256) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0.3)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

export function glow(size = 128, rgb = '255,170,70') {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(0.3, `rgba(${rgb},0.45)`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

// ───────────── 상자 정면 운송장 라벨 ─────────────
export function label({ count = 0, names = [], no = 0, title = '' } = {}) {
  const w = 600, h = 400;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = rng(no + 3);
  g.fillStyle = '#f7f3ea';
  g.fillRect(0, 0, w, h);
  // 종이결
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(120,100,70,${r() * 0.05})`;
    g.fillRect(r() * w, r() * h, 1, 1);
  }
  g.fillStyle = '#d23b2f';
  g.fillRect(0, 0, w, 64);
  g.fillStyle = '#fff';
  g.font = `900 34px ${FONT_SANS}`;
  g.textBaseline = 'middle';
  g.fillText('RED TAPE 택배', 22, 33);
  g.font = `700 20px ${FONT_MONO}`;
  g.textAlign = 'right';
  g.fillText(`No.${String(no).padStart(4, '0')}`, w - 20, 34);
  g.textAlign = 'left';

  // 바코드
  let x = 22;
  const br = rng(no * 7 + 1);
  g.fillStyle = '#1b1b1b';
  while (x < 330) { const bw = 1 + ((br() * 4) | 0); g.fillRect(x, 82, bw, 70); x += bw + 1 + ((br() * 3) | 0); }
  g.font = `400 16px ${FONT_MONO}`;
  g.fillText(`${String(no).padStart(4, '0')}-${(br() * 1e6) | 0}-KR`, 22, 168);

  // 내용물 수
  g.textAlign = 'center';
  g.fillStyle = '#1b1b1b';
  g.font = `700 22px ${FONT_SANS}`;
  g.fillText('내용물', 470, 96);
  g.font = `900 78px ${FONT_SANS}`;
  g.fillText(String(count), 470, 150);
  g.textAlign = 'left';

  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(16, 190); g.lineTo(w - 16, 190); g.stroke();
  g.font = `700 20px ${FONT_SANS}`;
  g.fillText('받는 분  Claude (내 PC)', 22, 214);
  g.fillText(`보내는 분  나${title ? ' · ' + title.slice(0, 14) : ''}`, 22, 244);
  g.beginPath(); g.moveTo(16, 266); g.lineTo(w - 16, 266); g.stroke();

  g.font = `400 18px ${FONT_SANS}`;
  const shown = names.slice(0, 4);
  shown.forEach((n, i) => {
    const t = n.length > 26 ? n.slice(0, 25) + '…' : n;
    g.fillText(`▪ ${t}`, 22, 292 + i * 26);
  });
  if (names.length > 4) g.fillText(`  외 ${names.length - 4}개`, 22, 292 + 4 * 26);
  if (!names.length) {
    g.fillStyle = '#8a8170';
    g.fillText('(비어 있음 — 파일을 끌어다 넣어 주세요)', 22, 300);
  }
  return c;
}

// 매직으로 쓴 손글씨
export function marker(text, { w = 512, h = 150, color = 'rgba(25,22,20,0.9)' } = {}) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.textBaseline = 'middle';
  let size = 104;
  g.font = `400 ${size}px ${FONT_PEN}`;
  while (g.measureText(text).width > w - 20 && size > 40) { size -= 4; g.font = `400 ${size}px ${FONT_PEN}`; }
  g.save();
  g.translate(10, h / 2);
  g.rotate(-0.04);
  g.fillText(text, 0, 0);
  g.globalAlpha = 0.5;
  g.fillText(text, 1.2, 0.8);
  g.restore();
  return wear(c, text.length + 5, 0.12);
}

// ───────────── 파일 카드 ─────────────
export const EXT_COLORS = {
  pdf: '#d64035', hwp: '#1f8bd6', hwpx: '#1f8bd6', doc: '#2e5fc0', docx: '#2e5fc0',
  xls: '#1d8a4c', xlsx: '#1d8a4c', csv: '#1d8a4c', ppt: '#d46a2a', pptx: '#d46a2a',
  jpg: '#8a4fd0', jpeg: '#8a4fd0', png: '#8a4fd0', heic: '#8a4fd0', gif: '#8a4fd0', webp: '#8a4fd0', bmp: '#8a4fd0',
  txt: '#5f6672', md: '#5f6672', json: '#5f6672', zip: '#b07a1c', eml: '#0f8a8a', msg: '#0f8a8a',
};
export const ROLE_TEXT = { form: '양식', evidence: '증빙', ref: '자료', output: '완성' };
const ROLE_COLOR = { form: '#1f6feb', evidence: '#c27c0e', ref: '#6b7280', output: '#1a7f37' };

export function card(info, thumb) {
  const w = 300, h = 420;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const r = rng((info.name || 'x').length * 31 + (info.size || 0) % 997);
  const ext = (info.ext || '').toLowerCase();
  const col = EXT_COLORS[ext] || '#545b66';
  const isPhoto = thumb && thumb.kind === 'thumb' && /^(jpe?g|png|heic|gif|webp|bmp)$/.test(ext);

  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(110,95,70,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 1, 1); }

  // 머리띠: 확장자 색
  g.fillStyle = col;
  g.fillRect(0, 0, w, 66);
  g.fillStyle = '#fff';
  g.font = `900 34px ${FONT_SANS}`;
  g.textBaseline = 'middle';
  g.fillText((ext || 'FILE').toUpperCase().slice(0, 4), 16, 34);
  // 역할 배지
  const role = info.role || 'ref';
  g.font = `800 22px ${FONT_SANS}`;
  const rt = ROLE_TEXT[role] || '자료';
  const tw = g.measureText(rt).width + 20;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.roundRect(w - tw - 12, 17, tw, 34, 17); g.fill();
  g.fillStyle = ROLE_COLOR[role] || '#555';
  g.textAlign = 'center';
  g.fillText(rt, w - tw / 2 - 12, 35);
  g.textAlign = 'left';

  // 파일명 (2줄)
  g.fillStyle = '#1d1d1f';
  g.font = `800 25px ${FONT_SANS}`;
  const name = (info.name || '').replace(/\.[^.]+$/, '');
  const lines = [];
  let cur = '';
  for (const ch of name) {
    if (g.measureText(cur + ch).width > w - 30) { lines.push(cur); cur = ch; if (lines.length === 2) break; } else cur += ch;
  }
  if (lines.length < 2 && cur) lines.push(cur);
  if (lines.length === 2 && name.length > lines.join('').length) lines[1] = lines[1].slice(0, -1) + '…';
  lines.forEach((l, i) => g.fillText(l, 15, 92 + i * 30));

  const top = 140;
  if (thumb && thumb.img) {
    const box = { x: 14, y: top, w: w - 28, h: h - top - 16 };
    const iw = thumb.img.width, ih = thumb.img.height;
    const s = isPhoto ? Math.max(box.w / iw, box.h / ih) : Math.min(box.w / iw, box.h / ih);
    const dw = iw * s, dh = ih * s;
    g.save();
    g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
    if (!isPhoto) { g.fillStyle = '#ffffff'; g.fillRect(box.x, box.y, box.w, box.h); }
    g.drawImage(thumb.img, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  } else {
    // 가짜 본문 줄
    g.fillStyle = 'rgba(40,40,45,0.16)';
    for (let y = top + 6; y < h - 30; y += 20) {
      const lw = (0.45 + r() * 0.5) * (w - 30);
      g.fillRect(15, y, lw, 8);
    }
    if (/^(xlsx?|csv)$/.test(ext)) {
      g.strokeStyle = 'rgba(29,138,76,0.35)';
      for (let x = 15; x < w - 10; x += 54) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, h - 20); g.stroke(); }
    }
  }
  if (role === 'output') {
    g.save();
    g.translate(w - 80, h - 90);
    g.rotate(-0.25);
    g.strokeStyle = 'rgba(200,30,30,0.85)';
    g.fillStyle = 'rgba(200,30,30,0.85)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(0, 0, 50, 0, 6.3); g.stroke();
    g.font = `900 30px ${FONT_SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('완성', 0, 2);
    g.restore();
  }
  // 접힌 모서리
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.beginPath(); g.moveTo(w, h - 34); g.lineTo(w - 34, h); g.lineTo(w, h); g.closePath(); g.fill();
  return c;
}
