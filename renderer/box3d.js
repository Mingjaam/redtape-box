// 3D 택배상자 — 플랩(덮개) 스프링 애니메이션, 파일 카드, 테이프 봉인, 빛 새어나옴, 파티클
import * as THREE from './vendor/three.module.js';
import * as TX from './textures.js';

const W = 1.6, D = 1.2, H = 1.0, T = 0.028;
const FL = D / 2 - 0.004;           // 플랩 길이 (긴 플랩끼리 가운데서 만남)
const DEG = Math.PI / 180;
const FILL_Y = 0.56;                // 완충지 높이
const CARD_W = 0.5, CARD_H = 0.7;

// [앞, 뒤, 왼, 오른] 플랩이 '닫힘'에서 몇 도 열렸나
const POSES = {
  closed: [0, 0, -2.5, -2.5],
  peek: [24, 15, 12, 9],
  ajar: [116, 128, 102, 114],
  open: [178, 196, 182, 188],
  wide: [190, 212, 198, 204],
  slump: [150, 160, 140, 146],
};

const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

class Spring {
  constructor(x = 0, k = 170, c = 14) { this.x = x; this.v = 0; this.t = x; this.k = k; this.c = c; }
  step(dt) { const a = this.k * (this.t - this.x) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
  kick(v) { this.v += v; }
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Box3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.timers = [];
    this.tweens = [];
    this.parts = [];
    this.items = new Map();
    this.outputs = [];
    this.nextId = 1;
    this.working = false;
    this.flutter = false;
    this.pulse = 0;
    this.listeners = {};

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.aniso = Math.min(8, r.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(25, 1, 0.1, 60);
    this.camTarget = new THREE.Vector3(0, 0.98, 0);
    this.setView(33, 26, 8.3);
    this.raycaster = new THREE.Raycaster();

    this._lights();
    this._build();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // lowPower: 한동안 아무 일도 없으면 약 20fps 로 그린다 / paused: 창이 숨겨지면 멈춘다
    this.lowPower = false;
    this.paused = false;
    this.last = performance.now();
    const loop = (now) => {
      this.raf = 0;
      if (this.paused) return;
      const gap = (now - this.last) / 1000;
      if (this.lowPower && gap < 0.048) { this.raf = requestAnimationFrame(loop); return; }
      const dt = Math.min(this.lowPower ? 0.07 : 0.033, gap);
      this.last = now;
      this._update(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this._loop = loop;
    this.raf = requestAnimationFrame(loop);
  }

  setPaused(v) {
    v = !!v;
    if (v === this.paused) return;
    this.paused = v;
    if (!v && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this._loop); }
  }

  // 상자(여유 영역 포함)가 화면에서 차지하는 사각형 — 메인이 클릭 통과를 풀 때 쓴다
  screenRect(pad = 40) {
    const rect = this.canvas.getBoundingClientRect();
    const bb = new THREE.Box3().setFromObject(this.proxy);
    const v = new THREE.Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).project(this.camera);
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x: Math.round(x0 - pad), y: Math.round(y0 - pad), w: Math.round(x1 - x0 + 2 * pad), h: Math.round(y1 - y0 + 2 * pad) };
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, ...a) { (this.listeners[name] || []).forEach((f) => f(...a)); }

  setView(azDeg, elDeg, dist) {
    const az = azDeg * DEG, el = elDeg * DEG;
    this.camera.position.set(
      this.camTarget.x + dist * Math.cos(el) * Math.sin(az),
      this.camTarget.y + dist * Math.sin(el),
      this.camTarget.z + dist * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(this.camTarget);
  }

  resize() {
    const w = this.canvas.clientWidth || 420, h = this.canvas.clientHeight || 330;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ───────────────────────── 장면 구성 ─────────────────────────
  _lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xfff3e2, 0x4a3725, 1.35));
    const key = (this.key = new THREE.DirectionalLight(0xfff0da, 2.7));
    key.position.set(-2.6, 6.2, 4.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.6, bottom: -1.2, near: 1, far: 16 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.025;
    s.add(key);
    const fill = new THREE.DirectionalLight(0xdbe6ff, 0.75);
    fill.position.set(4.5, 2.2, -0.5);
    s.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(0.5, 3, -5);
    s.add(rim);
    this.innerLight = new THREE.PointLight(0xffa24a, 0, 3.2, 1.6);
  }

  _tex(c, { srgb = true, repeat = null } = {}) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }

  _normal(w, h) {
    if (!this._normalSrc) this._normalSrc = TX.fluteNormal(256, 8, 7);
    const pitch = 0.42; // 한 타일이 덮는 실제 길이
    return this._tex(this._normalSrc, { srgb: false, repeat: [w / pitch, h / pitch] });
  }

  _mat(c, w, h, extra = {}) {
    return new THREE.MeshStandardMaterial({
      map: this._tex(c),
      normalMap: this._normal(w, h),
      normalScale: new THREE.Vector2(0.2, 0.2),
      roughness: 0.92,
      metalness: 0,
      ...extra,
    });
  }

  _build() {
    const root = (this.root = new THREE.Group());
    const body = (this.body = new THREE.Group());
    root.add(body);
    this.scene.add(root);
    root.position.y = 0.2;

    // 바닥 그림자 (투명 배경 위에서 부드럽게)
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 2.7),
      new THREE.MeshBasicMaterial({ map: this._tex(TX.blob(256), { srgb: false }), transparent: true, depthWrite: false, opacity: 0.6 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0.18, -0.02, 0.12);
    this.scene.add(this.shadow);

    // 재질
    const inner = this._mat(TX.innerKraft(512, 512, 21), 1.2, 1.0);
    const edgeMat = new THREE.MeshStandardMaterial({ map: this._tex(TX.edgeKraft()), roughness: 0.96 });
    const front = this._mat(TX.facePrint('front', 1024, 640, 11), W, H);
    const back = this._mat(TX.facePrint('back', 512, 320, 12), W, H);
    const left = this._mat(TX.facePrint('left', 576, 480, 13), D, H);
    const right = this._mat(TX.facePrint('right', 768, 640, 14), D, H);
    const bottom = this._mat(TX.kraft(256, 192, { seed: 15 }), W, D);
    this.mats = { inner, edgeMat };

    const slab = (w, h, d, mats) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
      m.castShadow = true;
      m.receiveShadow = true;
      body.add(m);
      return m;
    };
    const e = edgeMat;
    // 재질 순서: +x, -x, +y, -y, +z, -z
    slab(W, H, T, [e, e, e, e, front, inner]).position.set(0, H / 2, D / 2 - T / 2);
    slab(W, H, T, [e, e, e, e, inner, back]).position.set(0, H / 2, -D / 2 + T / 2);
    slab(T, H, D - 2 * T, [inner, left, e, e, e, e]).position.set(-W / 2 + T / 2, H / 2, 0);
    slab(T, H, D - 2 * T, [right, inner, e, e, e, e]).position.set(W / 2 - T / 2, H / 2, 0);
    slab(W, T, D, [e, e, inner, bottom, e, e]).position.set(0, T / 2, 0);

    // 플랩
    this.flaps = [];
    const mkFlap = (kind, seed) => {
      const pivot = new THREE.Group();
      let geo, mats, pos;
      const long = kind === 'front' || kind === 'back';
      const outer = this._mat(TX.facePrint('flap', long ? 768 : 576, 288, seed), long ? W : D, FL);
      if (long) {
        geo = new THREE.BoxGeometry(W, FL + T, T);
        mats = kind === 'front' ? [e, e, e, e, outer, inner] : [e, e, e, e, inner, outer];
        pos = [0, (FL + T) / 2 - T, kind === 'front' ? -T / 2 : T / 2];
        pivot.position.set(0, H + T, kind === 'front' ? D / 2 : -D / 2);
      } else {
        geo = new THREE.BoxGeometry(T, FL, D - 2 * T - 0.008);
        mats = kind === 'left' ? [inner, outer, e, e, e, e] : [outer, inner, e, e, e, e];
        pos = [kind === 'left' ? T / 2 : -T / 2, FL / 2, 0];
        pivot.position.set(kind === 'left' ? -W / 2 : W / 2, H, 0);
      }
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.set(...pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pivot.add(mesh);
      body.add(pivot);
      const f = { kind, pivot, mesh, spring: new Spring(0, 170, 13), base: 0, phase: Math.random() * 6 };
      this.flaps.push(f);
      return f;
    };
    mkFlap('front', 31); mkFlap('back', 32); mkFlap('left', 33); mkFlap('right', 34);
    this.flaps.forEach((f) => this._applyFlap(f, 0));

    // 완충지
    const fg = new THREE.PlaneGeometry(W - 2 * T, D - 2 * T, 28, 20);
    const pos = fg.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, (Math.random() - 0.5) * 0.05 + Math.sin(pos.getX(i) * 7) * 0.012);
    fg.computeVertexNormals();
    this.fill = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: this._tex(TX.crinkle()), roughness: 1 }));
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.position.y = FILL_Y;
    this.fill.receiveShadow = true;
    body.add(this.fill);
    this.innerLight.position.set(0, 0.85, 0);
    body.add(this.innerLight);

    // 파일 카드들
    this.itemGroup = new THREE.Group();
    body.add(this.itemGroup);
    this.cardGeo = new THREE.BoxGeometry(CARD_W, CARD_H, 0.008);
    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.85 });

    // 정면 운송장 라벨 + 매직 글씨
    this.labelMat = new THREE.MeshStandardMaterial({ map: this._tex(TX.label({})), roughness: 0.72, polygonOffset: true, polygonOffsetFactor: -2 });
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.44), this.labelMat);
    lab.position.set(0.37, 0.43, D / 2 + 0.003);
    lab.rotation.z = -0.035;
    lab.receiveShadow = true;
    body.add(lab);
    this.markerMat = new THREE.MeshStandardMaterial({ map: this._tex(TX.marker('서류 상자')), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.24), this.markerMat);
    mk.position.set(-0.36, 0.8, D / 2 + 0.004);
    body.add(mk);

    // 테이프
    const tapeTex = this._tex(TX.tape());
    this.tapeMat = new THREE.MeshPhysicalMaterial({ map: tapeTex, transparent: true, opacity: 0.9, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const TW = 0.27;
    this.tape = new THREE.Group();
    const topG = new THREE.PlaneGeometry(W + 0.012, TW);
    topG.translate((W + 0.012) / 2, 0, 0);
    topG.rotateX(-Math.PI / 2);
    this.tapeTop = new THREE.Mesh(topG, this.tapeMat);
    this.tapeTop.position.set(-W / 2 - 0.006, H + T + 0.004, 0);
    const sideG = (dir) => { const g = new THREE.PlaneGeometry(TW, 0.36); g.translate(0, -0.18, 0); g.rotateY(dir * Math.PI / 2); return g; };
    this.tapeL = new THREE.Mesh(sideG(-1), this.tapeMat);
    this.tapeL.position.set(-W / 2 - 0.004, H + T, 0);
    this.tapeR = new THREE.Mesh(sideG(1), this.tapeMat);
    this.tapeR.position.set(W / 2 + 0.004, H + T, 0);
    this.tape.add(this.tapeTop, this.tapeL, this.tapeR);
    this.tape.visible = false;
    body.add(this.tape);

    // 새어나오는 빛
    const glowTex = this._tex(TX.glow(128));
    this.seam = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.04, 0.05).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.seam.position.set(0, H + T + 0.002, 0);
    body.add(this.seam);
    const mkSprite = (scale, color = 0xffad55) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.scale.setScalar(scale);
      body.add(sp);
      return sp;
    };
    this.glowL = mkSprite(0.5); this.glowL.position.set(-W / 2, H + T, 0);
    this.glowR = mkSprite(0.5); this.glowR.position.set(W / 2, H + T, 0);
    this.halo = mkSprite(2.6, 0xffc070); this.halo.position.set(0, H + 0.25, 0);
    this.glowTex = glowTex;

    // 히트 판정용 투명 상자
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, H + 0.8, D + 0.24), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.y = (H + 0.8) / 2 - 0.05;
    body.add(this.proxy);

    // 몸체 스프링
    this.sq = new Spring(1, 260, 10);
    this.tiltX = new Spring(0, 170, 9);
    this.tiltZ = new Spring(0, 170, 9);
    this.hop = new Spring(0, 190, 13);
    this.yaw = new Spring(0, 60, 10);
  }

  _applyFlap(f, a) {
    switch (f.kind) {
      case 'front': f.pivot.rotation.x = -Math.PI / 2 + a; break;
      case 'back': f.pivot.rotation.x = Math.PI / 2 - a; break;
      case 'left': f.pivot.rotation.z = -Math.PI / 2 + a; break;
      case 'right': f.pivot.rotation.z = Math.PI / 2 - a; break;
    }
  }

  // ───────────────────────── 시간 도우미 ─────────────────────────
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  wait(sec) { return new Promise((res) => this.after(sec, res)); }
  tween(dur, update, easeFn = ease.outCubic) {
    return new Promise((res) => this.tweens.push({ t: 0, dur, update, ease: easeFn, done: res }));
  }

  // ───────────────────────── 덮개 포즈 ─────────────────────────
  setPose(name, { k = 170, c = 13, stagger = true } = {}) {
    const a = POSES[name] || POSES.closed;
    this.pose = name;
    const closing = name === 'closed';
    this.flaps.forEach((f, i) => {
      const long = i < 2;
      const delay = !stagger ? 0 : closing ? (long ? 0.2 : 0) : long ? 0 : 0.07;
      this.after(delay + (stagger ? i * 0.02 : 0), () => {
        f.base = a[i] * DEG + (name === 'closed' ? 0 : (Math.random() - 0.5) * 4 * DEG);
        f.spring.k = k;
        f.spring.c = c;
      });
    });
  }

  dragHover(on) {
    this.flutter = on;
    if (on) { this.setPose('wide', { k: 240, c: 11 }); this.tiltX.kick(-0.4); }
  }

  // ───────────────────────── 몸체 리액션 ─────────────────────────
  squash(amount = 0.08) { this.sq.kick(-amount * 14); }
  bump(power = 1) { this.hop.kick(0.9 * power); this.tiltZ.kick((Math.random() - 0.5) * 0.9 * power); this.tiltX.kick((Math.random() - 0.5) * 0.5 * power); }
  wobble() { this.tiltZ.kick(0.9); this.after(0.12, () => this.tiltZ.kick(-1.4)); this.after(0.26, () => this.tiltZ.kick(0.8)); }
  happyHop() { this.hop.kick(3.4); this.sq.kick(-0.9); this.after(0.18, () => this.yaw.kick(9)); this.hearts(); }

  // ───────────────────────── 파일 카드 ─────────────────────────
  _cardMats(info, thumb) {
    const tex = this._tex(TX.card(info, thumb));
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78 });
    return [this.paperMat, this.paperMat, this.paperMat, this.paperMat, face, this.paperMat];
  }

  addItem(info, { drop = true } = {}) {
    const id = this.nextId++;
    const mesh = new THREE.Mesh(this.cardGeo, this._cardMats(info, null));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.itemId = id;
    this.itemGroup.add(mesh);
    const it = { id, info, mesh, thumb: null, target: null, anim: null, sunk: 0 };
    this.items.set(id, it);
    this._layout();
    const tg = it.target;
    if (drop) {
      const from = { x: tg.x * 0.6 + (Math.random() - 0.5) * 0.3, y: 3.4 + Math.random() * 0.4, z: tg.z, rx: (Math.random() - 0.5) * 2, ry: (Math.random() - 0.5) * 2, rz: (Math.random() - 0.5) * 2 };
      mesh.position.set(from.x, from.y, from.z);
      mesh.rotation.set(from.rx, from.ry, from.rz);
      it.anim = { t: 0, dur: 0.62, from };
    } else {
      mesh.position.set(tg.x, tg.y, tg.z);
      mesh.rotation.set(tg.rx, tg.ry, tg.rz);
    }
    return id;
  }

  setItemThumb(id, thumb) {
    const it = this.items.get(id);
    if (!it) return;
    it.thumb = thumb;
    this._redrawItem(it);
  }

  setItemRole(id, role) {
    const it = this.items.get(id);
    if (!it) return;
    it.info = { ...it.info, role };
    this._redrawItem(it);
  }

  _redrawItem(it) {
    const old = it.mesh.material[4];
    it.mesh.material = this._cardMats(it.info, it.thumb);
    old.map.dispose(); old.dispose();
  }

  removeItem(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id);
    const m = it.mesh;
    const y0 = m.position.y;
    this._layout();
    this.tween(0.42, (t) => {
      m.position.y = y0 + t * 1.6;
      m.rotation.z += 0.08;
      m.scale.setScalar(1 - t * 0.9);
    }, ease.inQuad).then(() => this._disposeCard(m));
  }


  _disposeCard(m) {
    this.itemGroup.remove(m);
    this.scene.remove(m);
    const face = m.material[4];
    if (face) { face.map && face.map.dispose(); face.dispose(); }
  }

  sinkItems(on) { for (const it of this.items.values()) it.sunk = on ? 1 : 0; this._layout(); }

  _layout() {
    const list = [...this.items.values()];
    const n = list.length;
    if (!n) return;
    const rows = Math.ceil(n / 4);
    const perRow = Math.ceil(n / rows);
    list.forEach((it, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const cols = Math.min(perRow, n - row * perRow);
      const span = Math.min(1.0, 0.33 * (cols - 1));
      const j = (it.jit ||= [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
      const x = (cols === 1 ? 0 : -span / 2 + (span * col) / (cols - 1)) + j[0] * 0.06;
      const z = rows === 1 ? -0.04 : -0.34 + (0.62 * row) / (rows - 1);
      const rise = (rows - 1 - row) * 0.07;
      it.target = {
        x,
        y: FILL_Y + CARD_H / 2 + 0.02 + rise - it.sunk * 0.44,
        z: z + j[1] * 0.05,
        rx: -0.1 + j[2] * 0.08,
        ry: 0.28 + j[3] * 0.3,
        rz: j[0] * 0.22,
      };
    });
  }

  // ───────────────────────── 봉인 / 개봉 ─────────────────────────
  async seal() {
    this.flutter = false;
    this.sinkItems(true);
    await this.wait(0.15);
    this.setPose('closed', { k: 210, c: 15 });
    this.after(0.12, () => this.emit('sound', 'flap'));
    this.after(0.34, () => { this.emit('sound', 'flap'); this.squash(0.05); });
    await this.wait(0.75);
    // 테이프: 왼쪽 옆면 → 윗면 → 오른쪽 옆면
    this.tape.visible = true;
    this.tape.position.set(0, 0, 0);
    this.tape.rotation.set(0, 0, 0);
    this.tapeMat.opacity = 0.9;
    this.tapeL.scale.y = 0.001; this.tapeTop.scale.x = 0.001; this.tapeR.scale.y = 0.001;
    this.emit('sound', 'tape');
    await this.tween(0.16, (t) => { this.tapeL.scale.y = Math.max(0.001, t); }, ease.linear);
    await this.tween(0.48, (t) => { this.tapeTop.scale.x = Math.max(0.001, t); }, ease.inOutCubic);
    await this.tween(0.16, (t) => { this.tapeR.scale.y = Math.max(0.001, t); }, ease.linear);
    this.squash(0.06);
    this.emit('sound', 'thump');
    await this.wait(0.2);
  }

  async unseal() {
    // 칼집 → 테이프가 찢겨 날아감 → 덮개가 펑 열림
    this.emit('sound', 'rip');
    this.spawn('paper', 10, new THREE.Vector3(0, H + 0.1, 0), { spread: 0.8, up: 2.2 });
    const p0 = this.tape.position.clone();
    this.tween(0.5, (t) => {
      this.tape.position.set(p0.x + t * 0.4, p0.y + t * 1.2, p0.z + t * 0.5);
      this.tape.rotation.set(-t * 0.9, 0, t * 0.6);
      this.tapeMat.opacity = 0.9 * (1 - t);
    }, ease.outCubic).then(() => { this.tape.visible = false; });
    await this.wait(0.18);
    this.setPose('wide', { k: 230, c: 9 });
    this.squash(0.1);
    this.hop.kick(2.2);
    this.innerLight.intensity = 9;
    this.halo.material.opacity = 0.9;
    this.emit('sound', 'pop');
    await this.wait(0.4);
  }

  // ───────────────────────── 작업 중 ─────────────────────────
  setWorking(on) {
    this.working = on;
    this.nextRumble = 0.8;
  }

  activity(kind = 'read') {
    this.pulse = Math.min(1.4, this.pulse + 0.7);
    const top = new THREE.Vector3((Math.random() - 0.5) * 0.8, H + T + 0.05, (Math.random() - 0.5) * 0.1);
    if (kind === 'write') { this.spawn('spark', 9, top, { up: 1.6, spread: 0.6 }); this.bump(0.7); }
    else if (kind === 'run') { this.spawn('dust', 6, top, { up: 1.0, spread: 0.7 }); this.bump(1.1); }
    else if (kind === 'think') { this.spawn('spark', 3, top, { up: 0.9, spread: 0.3 }); }
    else { this.spawn('paper', 4, top, { up: 1.5, spread: 0.6 }); this.bump(0.5); }
  }

  // ───────────────────────── 결과 카드 ─────────────────────────
  showOutputs(files) {
    this.clearOutputs();
    const shown = files.slice(0, 5);
    const n = shown.length;
    shown.forEach((f, i) => {
      const info = { name: f.name, ext: f.ext, size: f.size, role: 'output' };
      const mesh = new THREE.Mesh(this.cardGeo, this._cardMats(info, f.thumb || null));
      mesh.castShadow = true;
      mesh.userData.outPath = f.path;
      mesh.scale.setScalar(0.5);
      mesh.position.set(0, 0.6, 0);
      this.body.add(mesh);
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5);
      const o = { mesh, f, i, target: { x: spread * Math.min(1.5, 0.48 * (n - 1)), y: H + 0.62 + Math.abs(spread) * -0.12, z: 0.25 - Math.abs(spread) * 0.1, rz: -spread * 0.35, ry: 0.42 }, born: this.time + i * 0.14 };
      this.outputs.push(o);
      this.after(i * 0.14, () => this.emit('sound', 'pop'));
    });
  }

  setOutputThumb(path, thumb) {
    const o = this.outputs.find((x) => x.f.path === path);
    if (!o) return;
    o.f.thumb = thumb;
    const old = o.mesh.material[4];
    o.mesh.material = this._cardMats({ name: o.f.name, ext: o.f.ext, size: o.f.size, role: 'output' }, thumb);
    old.map.dispose(); old.dispose();
  }

  clearOutputs() {
    for (const o of this.outputs) {
      this.body.remove(o.mesh);
      const face = o.mesh.material[4];
      face.map.dispose(); face.dispose();
    }
    this.outputs = [];
  }

  // ───────────────────────── 라벨 / 글씨 ─────────────────────────
  setLabel(opts) {
    const old = this.labelMat.map;
    this.labelMat.map = this._tex(TX.label(opts));
    this.labelMat.needsUpdate = true;
    old.dispose();
  }

  setMarker(text) {
    const old = this.markerMat.map;
    this.markerMat.map = this._tex(TX.marker(text));
    this.markerMat.needsUpdate = true;
    old.dispose();
  }

  // ───────────────────────── 파티클 ─────────────────────────
  _heartTex() {
    if (this._heart) return this._heart;
    const c = TX.canvas(64, 64);
    const g = c.getContext('2d');
    g.font = '52px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('❤️', 32, 36);
    return (this._heart = this._tex(c));
  }

  spawn(kind, n, origin, { up = 1.5, spread = 0.6 } = {}) {
    const confetti = [0xff6b6b, 0xffd93d, 0x6bcB77, 0x4d96ff, 0xc77dff, 0xff9f45];
    for (let i = 0; i < n; i++) {
      let obj;
      if (kind === 'spark' || kind === 'heart') {
        obj = new THREE.Sprite(new THREE.SpriteMaterial({
          map: kind === 'heart' ? this._heartTex() : this.glowTex,
          color: kind === 'heart' ? 0xffffff : 0xffc066,
          transparent: true,
          blending: kind === 'heart' ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
        }));
        obj.scale.setScalar(kind === 'heart' ? 0.22 : 0.09 + Math.random() * 0.08);
      } else {
        const color = kind === 'confetti' ? confetti[(Math.random() * confetti.length) | 0] : kind === 'dust' ? 0xc49a68 : 0xfbf8f0;
        obj = new THREE.Mesh(new THREE.PlaneGeometry(kind === 'dust' ? 0.035 : 0.06, kind === 'dust' ? 0.035 : 0.04), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, transparent: true }));
        obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      }
      obj.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * spread * 0.5, 0, (Math.random() - 0.5) * spread * 0.3));
      this.body.add(obj);
      const grav = kind === 'spark' ? -0.6 : kind === 'heart' ? -0.2 : kind === 'dust' ? 1.2 : 3.2;
      this.parts.push({
        obj,
        kind,
        v: new THREE.Vector3((Math.random() - 0.5) * spread * 2, up * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * spread * 1.2),
        w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        life: 0,
        max: kind === 'heart' ? 1.6 : kind === 'confetti' ? 2.2 : 1.1 + Math.random() * 0.5,
        grav,
      });
    }
  }

  celebrate() {
    this.spawn('confetti', 40, new THREE.Vector3(0, H + 0.2, 0), { up: 3.2, spread: 1.4 });
    this.spawn('spark', 14, new THREE.Vector3(0, H + 0.2, 0), { up: 2.0, spread: 1.0 });
  }

  hearts() { this.spawn('heart', 5, new THREE.Vector3(0, H + 0.3, 0.2), { up: 1.3, spread: 0.9 }); }

  sad() {
    this.setPose('slump', { k: 90, c: 12 });
    this.sq.kick(-0.6);
    this.tiltZ.t = 0.08;
    this.after(1.6, () => { this.tiltZ.t = 0; });
  }

  // ───────────────────────── 히트 판정 ─────────────────────────
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const outHit = this.raycaster.intersectObjects(this.outputs.map((o) => o.mesh), false)[0];
    if (outHit) return { type: 'output', path: outHit.object.userData.outPath };
    const itemHit = this.raycaster.intersectObjects([...this.items.values()].map((i) => i.mesh), false)[0];
    if (itemHit) return { type: 'item', id: itemHit.object.userData.itemId };
    if (this.raycaster.intersectObject(this.proxy, false)[0]) return { type: 'box' };
    return null;
  }

  // 아이콘용 정사각 스냅샷
  snapshot(size = 512) {
    const r = this.renderer;
    const prev = new THREE.Vector2();
    r.getSize(prev);
    const pr = r.getPixelRatio();
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    const cam = this.camera.clone();
    cam.aspect = 1;
    cam.fov = 30;
    cam.updateProjectionMatrix();
    this.shadow.visible = false;
    this.parts.forEach((p) => { p.obj.visible = false; });
    r.render(this.scene, cam);
    const url = this.canvas.toDataURL('image/png');
    this.parts.forEach((p) => { p.obj.visible = true; });
    this.shadow.visible = true;
    r.setPixelRatio(pr);
    r.setSize(prev.x, prev.y, false);
    return url;
  }

  // ───────────────────────── 매 프레임 ─────────────────────────
  _update(dt) {
    this.time += dt;
    const t = this.time;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t = Math.min(tw.dur, tw.t + dt);
      tw.update(tw.ease(tw.t / tw.dur));
      if (tw.t >= tw.dur) { this.tweens.splice(i, 1); tw.done(); }
    }

    // 플랩
    for (const f of this.flaps) {
      let target = f.base;
      if (this.flutter) target += Math.sin(t * 9 + f.phase) * 0.1;
      f.spring.t = target;
      // 안정성을 위해 2번 나눠 적분
      f.spring.step(dt / 2); f.spring.step(dt / 2);
      this._applyFlap(f, f.spring.x);
    }

    // 몸체
    for (const s of [this.sq, this.tiltX, this.tiltZ, this.hop, this.yaw]) { s.step(dt / 2); s.step(dt / 2); }
    if (this.working) {
      this.nextRumble -= dt;
      if (this.nextRumble <= 0) {
        this.nextRumble = 0.7 + Math.random() * 1.6;
        this.bump(0.6 + Math.random() * 0.6);
        if (Math.random() < 0.4) this.emit('sound', 'rumble');
      }
    }
    const sq = Math.max(0.6, this.sq.x);
    this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    const bob = this.working ? Math.sin(t * 31) * 0.004 : Math.sin(t * 1.4) * 0.04;
    this.root.position.y = 0.22 + bob + Math.max(-0.1, this.hop.x * 0.1);
    this.body.position.x = this.working ? Math.sin(t * 43) * 0.006 : 0;
    this.body.rotation.x = this.tiltX.x * 0.1;
    this.body.rotation.z = this.tiltZ.x * 0.1;
    this.root.rotation.y = Math.sin(t * 0.45) * 0.035 + this.yaw.x * 0.1;
    const lift = this.root.position.y;
    this.shadow.scale.setScalar(1 - (lift - 0.22) * 0.6);
    this.shadow.material.opacity = 0.62 - (lift - 0.22) * 0.8;

    // 카드
    const k = 1 - Math.exp(-dt * 9);
    for (const it of this.items.values()) {
      const m = it.mesh, tg = it.target;
      if (!tg) continue;
      if (it.anim) {
        const a = it.anim;
        a.t += dt;
        const p = Math.min(1, a.t / a.dur);
        m.position.set(lerp(a.from.x, tg.x, ease.outCubic(p)), lerp(a.from.y, tg.y, ease.inQuad(p)), lerp(a.from.z, tg.z, ease.outCubic(p)));
        m.rotation.set(lerp(a.from.rx, tg.rx, ease.outCubic(p)), lerp(a.from.ry, tg.ry, ease.outCubic(p)), lerp(a.from.rz, tg.rz, ease.outCubic(p)));
        if (p >= 1) {
          it.anim = null;
          this.squash(0.07);
          this.spawn('dust', 5, new THREE.Vector3(tg.x, FILL_Y + 0.05, tg.z), { up: 0.8, spread: 0.5 });
          this.emit('land', it.id);
        }
      } else {
        m.position.x += (tg.x - m.position.x) * k;
        m.position.y += (tg.y - m.position.y) * k;
        m.position.z += (tg.z - m.position.z) * k;
        m.rotation.x += (tg.rx - m.rotation.x) * k;
        m.rotation.y += (tg.ry - m.rotation.y) * k;
        m.rotation.z += (tg.rz - m.rotation.z) * k;
      }
    }

    // 결과 카드 (떠오르며 둥실)
    for (const o of this.outputs) {
      const age = t - o.born;
      if (age < 0) continue;
      const p = Math.min(1, age / 0.7);
      const e2 = ease.outBack(p);
      const tg = o.target;
      o.mesh.position.set(lerp(0, tg.x, e2), lerp(0.6, tg.y, e2) + Math.sin(t * 1.6 + o.i) * 0.03 * p, lerp(0, tg.z, e2));
      o.mesh.rotation.set(-0.08, tg.ry + Math.sin(t * 0.9 + o.i) * 0.06, tg.rz * e2);
      o.mesh.scale.setScalar(lerp(0.4, 0.82, e2));
    }

    // 빛
    this.pulse = Math.max(0, this.pulse - dt * 1.2);
    const glowOn = this.working ? 1 : 0;
    const flick = 0.75 + Math.sin(t * 3.1) * 0.12 + Math.sin(t * 7.7) * 0.08;
    const g = glowOn * (0.45 * flick + this.pulse * 0.5);
    this.seam.material.opacity += (g - this.seam.material.opacity) * 0.2;
    this.glowL.material.opacity = this.glowR.material.opacity = this.seam.material.opacity * 0.9;
    const haloT = this.working ? 0.12 + this.pulse * 0.25 : 0;
    this.halo.material.opacity += (haloT - this.halo.material.opacity) * (this.halo.material.opacity > haloT ? 0.04 : 0.15);
    const ilT = (this.pose === 'wide' || this.pose === 'open') && this.outputs.length ? 1.4 : 0;
    this.innerLight.intensity += (ilT - this.innerLight.intensity) * Math.min(1, dt * 2.5);

    // 파티클
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      p.v.y -= p.grav * dt;
      if (p.kind === 'paper' || p.kind === 'confetti') { p.v.x *= 0.985; p.v.z *= 0.985; if (p.v.y < -0.6) p.v.y = -0.6; }
      p.obj.position.addScaledVector(p.v, dt);
      if (p.obj.isMesh) { p.obj.rotation.x += p.w.x * dt; p.obj.rotation.y += p.w.y * dt; }
      const fade = 1 - Math.max(0, (p.life - p.max * 0.6) / (p.max * 0.4));
      p.obj.material.opacity = Math.max(0, fade);
      if (p.life >= p.max) {
        this.body.remove(p.obj);
        p.obj.material.dispose();
        if (p.obj.geometry && p.obj.isMesh) p.obj.geometry.dispose();
        this.parts.splice(i, 1);
      }
    }
  }
}
