'use strict';
/* Rafid 360 — spherical photo spots captured with camera + rotation sensor,
   pinned on a floor plan, revisited over time and compared side by side. */
{
const $ = s => document.querySelector(s);
const NATIVE = typeof window.Android !== 'undefined';
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ================= orientation ================= */
// three.js world: x = East, y = Up, z = South (north is -z). Camera looks down -z.
const qDev = new THREE.Quaternion();
const qFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const qCam = new THREE.Quaternion();
let haveRot = false;
window.onRot = (x, y, z, w) => { qDev.set(x, y, z, w); qCam.copy(qFix).multiply(qDev); haveRot = true; };
if (!NATIVE) {
  const e = new THREE.Euler(), q1 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
  window.addEventListener('deviceorientation', ev => {
    if (ev.alpha == null || ev.beta == null || ev.gamma == null) return;
    e.set(ev.beta * D2R, ev.alpha * D2R, -ev.gamma * D2R, 'YXZ');
    qCam.setFromEuler(e).multiply(q1); haveRot = true;
  });
}
const FWD = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0);
const camDir = (q, out = new THREE.Vector3()) => out.copy(FWD).applyQuaternion(q);
const yawOf = d => Math.atan2(-d.x, -d.z);
const dirOf = (yaw, pitch) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const norm360 = a => ((a % 360) + 360) % 360;
/** compass heading (deg, clockwise from north) the phone points to: camera direction, or top edge when lying flat */
function deviceHeading() {
  let v = camDir(qCam);
  if (Math.abs(v.y) > 0.75) v = UP.clone().applyQuaternion(qCam);
  return norm360(-yawOf(v) / D2R);
}

/* ================= storage ================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('rafid360', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('tours', { keyPath: 'id' });
        d.createObjectStore('spots', { keyPath: 'id' }).createIndex('tour', 'tourId');
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); let out;
      const r = fn(t.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    });
  },
  all(store) { return this.run(store, 'readonly', s => s.getAll()); },
  put(store, v) { return this.run(store, 'readwrite', s => s.put(v)); },
  del(store, id) { return this.run(store, 'readwrite', s => s.delete(id)); },
  spotsOf(tourId) { return this.run('spots', 'readonly', s => s.index('tour').getAll(tourId)); }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
/* spot = {id, tourId, order, x, y (0..1 on plan or null), arrive, caps:[{id, date, k, yawOff, photos, thumb}]} */
function normSpot(s) {
  if (!s.caps) {
    s.caps = [{ id: uid(), date: s.created || Date.now(), k: s.k || 1, yawOff: 0, photos: s.photos || [], thumb: s.thumb }];
    delete s.photos; delete s.thumb; delete s.k;
  }
  if (s.x === undefined) { s.x = null; s.y = null; }
  return s;
}
const lastCap = s => s.caps[s.caps.length - 1];
let fmtD, fmtDT;
try {
  fmtD = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
  fmtDT = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
} catch (_) { fmtD = fmtDT = { format: d => new Date(d).toLocaleString() }; }
const dShort = t => fmtD.format(new Date(t)), dLong = t => fmtDT.format(new Date(t));

/* ================= UI helpers ================= */
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2800); }
function busy(on, t) { $('#busy').classList.toggle('on', on); if (t) $('#busyT').textContent = t; }
let dlgClose = null;
function dialog({ msg, input, value = '', ok = 'موافق', cancel = 'إلغاء', list, live }) {
  return new Promise(res => {
    const box = $('#dbox'); box.textContent = '';
    const p = document.createElement('p'); p.textContent = msg; box.appendChild(p);
    let inp = null, liveT = 0;
    const done = v => { clearInterval(liveT); $('#dlg').classList.remove('on'); dlgClose = null; res(v); };
    dlgClose = () => done(null);
    if (live) { const l = document.createElement('div'); l.className = 'live'; box.appendChild(l); const up = () => { l.textContent = live(); }; up(); liveT = setInterval(up, 150); }
    if (list) {
      const l = document.createElement('div'); l.className = 'dlist';
      list.forEach((it, i) => { const b = document.createElement('button'); b.className = 'btn' + (it.danger ? ' danger' : ''); b.textContent = it.label; b.onclick = () => done(i); l.appendChild(b); });
      box.appendChild(l);
    }
    if (input) { inp = document.createElement('input'); inp.value = value; inp.placeholder = input; box.appendChild(inp); }
    const row = document.createElement('div'); row.className = 'drow';
    const no = document.createElement('button'); no.className = 'btn'; no.textContent = cancel; no.onclick = () => done(null); row.appendChild(no);
    if (!list) { const y = document.createElement('button'); y.className = 'btn rec'; y.textContent = ok; y.onclick = () => done(inp ? inp.value.trim() : true); row.appendChild(y); }
    box.appendChild(row);
    $('#dlg').classList.add('on');
    if (inp) setTimeout(() => inp.focus(), 50);
  });
}
$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg' && dlgClose) dlgClose(); });

let screen = 'home';
function show(name) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === name)); screen = name; }

/* ================= home ================= */
const homeUrls = [];
async function renderHome() {
  while (homeUrls.length) URL.revokeObjectURL(homeUrls.pop());
  const tours = (await DB.all('tours')).sort((a, b) => b.created - a.created);
  const list = $('#tourList'); list.textContent = '';
  if (!tours.length) {
    list.innerHTML = '<div class="empty"><svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="#9aa0a6" stroke-width="3"><circle cx="48" cy="48" r="34"/><ellipse cx="48" cy="48" rx="34" ry="12"/><circle cx="48" cy="48" r="7" fill="#ff3b30" stroke="none"/></svg>ما عندك جولات للحين.<br>أنشئ جولة لكل مشروع أو دور، وارفع مخططه، وصوّر النقاط وارجع لها كل فترة.</div>';
    return;
  }
  for (const t of tours) {
    const spots = (await DB.spotsOf(t.id)).map(normSpot).sort((a, b) => a.order - b.order);
    const visits = spots.reduce((n, s) => n + s.caps.length, 0);
    const last = spots.reduce((m, s) => Math.max(m, lastCap(s).date || 0), 0);
    const b = document.createElement('button'); b.className = 'tcard';
    const th = spots[0] && lastCap(spots[0]).thumb;
    if (th) { const im = document.createElement('img'); const u = URL.createObjectURL(th); homeUrls.push(u); im.src = u; b.appendChild(im); }
    else { const ph = document.createElement('div'); ph.className = 'ph'; b.appendChild(ph); }
    const tx = document.createElement('div'); const nm = document.createElement('b'); nm.textContent = t.name;
    const sub = document.createElement('span'); sub.textContent = spots.length + ' نقطة · ' + visits + ' زيارة' + (last ? ' · آخر تصوير ' + dShort(last) : '');
    tx.append(nm, sub); b.appendChild(tx);
    b.onclick = () => openTour(t);
    list.appendChild(b);
  }
}
$('#newTour').onclick = async () => {
  const name = await dialog({ msg: 'اسم الجولة', input: 'مثلاً: فلل الزهراء — الدور الأرضي', ok: 'إنشاء' });
  if (!name) return;
  const t = { id: uid(), name, created: Date.now(), plan: null, north: null };
  await DB.put('tours', t); openTour(t);
};

/* ================= shared 3D helpers ================= */
const R = 10;
function patchGeo(hf, vf, k) {
  const w = 2 * k * Math.tan(hf / 2), h = 2 * k * Math.tan(vf / 2);
  const g = new THREE.PlaneGeometry(w, h, 24, 24), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), -1).normalize().multiplyScalar(R); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true; return g;
}
const VS = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const FS = 'uniform sampler2D map;uniform float op;varying vec2 vUv;void main(){float e=.09;float a=smoothstep(0.,e,vUv.x)*smoothstep(0.,e,1.-vUv.x)*smoothstep(0.,e,vUv.y)*smoothstep(0.,e,1.-vUv.y);gl_FragColor=vec4(texture2D(map,vUv).rgb,a*op);}';
function patchMat(tex, op = 1) { return new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, op: { value: op } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }); }
async function blobTex(blob, max) {
  const bm = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bm.width * s)); c.height = Math.max(1, Math.round(bm.height * s));
  c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); if (bm.close) bm.close();
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t;
}
function clearGroup(g) {
  while (g.children.length) {
    const m = g.children.pop();
    m.traverse(o => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) { if (o.material.uniforms && o.material.uniforms.map) o.material.uniforms.map.value.dispose(); o.material.dispose(); }
    });
  }
}
async function fillGroup(g, cap, max, op, isLive) {
  clearGroup(g); g.rotation.y = (cap.yawOff || 0) * D2R;
  for (const ph of cap.photos) {
    const tex = await blobTex(ph.blob, max);
    if (isLive && !isLive()) { tex.dispose(); return false; }
    const m = new THREE.Mesh(patchGeo(ph.hf, ph.vf, cap.k || 1), patchMat(tex, op));
    m.quaternion.fromArray(ph.q); m.userData.ph = ph; g.add(m);
  }
  return true;
}

/* ================= floor plan ================= */
const P = { W: 0, H: 0, s: 1, tx: 0, ty: 0, placing: null, url: null, fitted: false, minS: .1 };
const planView = $('#planView'), planImg = $('#planImg'), planInner = $('#planInner');
function setPlanImage(blob) {
  if (P.url) URL.revokeObjectURL(P.url);
  P.url = null; P.W = P.H = 0; P.fitted = false;
  if (!blob) { planImg.removeAttribute('src'); return Promise.resolve(); }
  P.url = URL.createObjectURL(blob);
  return new Promise(r => {
    planImg.onload = () => {
      P.W = planImg.naturalWidth; P.H = planImg.naturalHeight;
      planImg.style.width = P.W + 'px'; planImg.style.height = P.H + 'px';
      planInner.style.width = P.W + 'px'; planInner.style.height = P.H + 'px'; r();
    };
    planImg.onerror = () => r();
    planImg.src = P.url;
  });
}
function planFit() {
  const w = planView.clientWidth, h = planView.clientHeight; if (!w || !P.W) return;
  P.s = Math.min(w / P.W, h / P.H) * .94; P.minS = P.s * .5;
  P.tx = (w - P.W * P.s) / 2; P.ty = (h - P.H * P.s) / 2; P.fitted = true; planApply();
}
function planApply() { planInner.style.transform = 'translate(' + P.tx + 'px,' + P.ty + 'px) scale(' + P.s + ')'; planInner.style.setProperty('--is', String(1 / P.s)); }
const CONE = '<svg class="cone" viewBox="0 0 80 80"><path d="M40 40 L22 3 A40 40 0 0 1 58 3 Z" fill="rgba(58,160,255,.5)"/></svg>';
function renderPins() {
  const box = $('#pins'); box.textContent = '';
  T.spots.forEach((s, i) => {
    if (s.x == null) return;
    const d = document.createElement('div'); d.className = 'pin' + (i === T.idx ? ' cur' : '');
    d.style.left = (s.x * P.W) + 'px'; d.style.top = (s.y * P.H) + 'px';
    if (i === T.idx && T.tour.north != null) d.insertAdjacentHTML('beforeend', CONE);
    const b = document.createElement('b'); b.textContent = String(i + 1); d.appendChild(b);
    box.appendChild(d);
  });
}
const pp = new Map(); let pDown = null, pz = null;
function relXY(e) { const r = planView.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
planView.addEventListener('pointerdown', e => {
  planView.setPointerCapture(e.pointerId); pp.set(e.pointerId, relXY(e));
  if (pp.size === 1) pDown = { ...relXY(e), t: performance.now() };
  if (pp.size === 2) { const [a, b] = [...pp.values()]; pz = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s: P.s, tx: P.tx, ty: P.ty }; pDown = null; }
});
planView.addEventListener('pointermove', e => {
  if (!pp.has(e.pointerId)) return;
  const o = pp.get(e.pointerId), n = relXY(e); pp.set(e.pointerId, n);
  if (pp.size === 1) { P.tx += n.x - o.x; P.ty += n.y - o.y; planApply(); }
  else if (pp.size === 2 && pz) {
    const [a, b] = [...pp.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ns = clamp(pz.s * d / pz.d, P.minS, P.minS * 24);
    const wx = (pz.m.x - pz.tx) / pz.s, wy = (pz.m.y - pz.ty) / pz.s;
    P.s = ns; P.tx = m.x - wx * ns; P.ty = m.y - wy * ns; planApply();
  }
});
function pUp(e) {
  if (pDown && pp.size === 1) {
    const n = relXY(e);
    if (Math.hypot(n.x - pDown.x, n.y - pDown.y) < 10 && performance.now() - pDown.t < 500) planTap(n.x, n.y);
  }
  pp.delete(e.pointerId); if (pp.size < 2) pz = null; if (!pp.size) pDown = null;
}
planView.addEventListener('pointerup', pUp);
planView.addEventListener('pointercancel', e => { pp.delete(e.pointerId); pz = null; pDown = null; });
planView.addEventListener('wheel', e => {
  e.preventDefault(); const m = relXY(e), ns = clamp(P.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), P.minS, P.minS * 24);
  const wx = (m.x - P.tx) / P.s, wy = (m.y - P.ty) / P.s; P.s = ns; P.tx = m.x - wx * ns; P.ty = m.y - wy * ns; planApply();
}, { passive: false });
function planTap(x, y) {
  if (!P.W) return;
  const px = (x - P.tx) / P.s, py = (y - P.ty) / P.s;
  if (P.placing) {
    if (px < 0 || py < 0 || px > P.W || py > P.H) return;
    const cb = P.placing; P.placing = null; $('#placeHint').classList.remove('on');
    cb(px / P.W, py / P.H); return;
  }
  let best = -1, bd = 1e9;
  T.spots.forEach((s, i) => { if (s.x == null) return; const d = Math.hypot((s.x * P.W - px) * P.s, (s.y * P.H - py) * P.s); if (d < bd) { bd = d; best = i; } });
  if (best >= 0 && bd < 34) openSpot(best);
}
function startPlacing(cb, hint) {
  setPane('plan'); P.placing = cb;
  $('#placeHint').textContent = hint || 'اضغط على مكانك في المخطط'; $('#placeHint').classList.add('on');
}
async function fileToPlanBlob(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (!window.pdfjsLib) {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'pdf.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
    }
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let pn = 1;
    if (doc.numPages > 1) {
      busy(false);
      const a = await dialog({ msg: 'الملف فيه ' + doc.numPages + ' صفحات. رقم صفحة المخطط؟', input: '1', value: '1', ok: 'تمام' });
      pn = clamp(parseInt(a, 10) || 1, 1, doc.numPages); busy(true, 'تجهيز المخطط…');
    }
    const page = await doc.getPage(pn);
    const v0 = page.getViewport({ scale: 1 }), sc = Math.min(5, 3200 / Math.max(v0.width, v0.height));
    const vp = page.getViewport({ scale: sc });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  }
  const bm = await createImageBitmap(file), s = Math.min(1, 4000 / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bm, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .9));
}
$('#planUp1').onclick = () => $('#planFile').click();
$('#planFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  busy(true, 'تجهيز المخطط…');
  try {
    const blob = await fileToPlanBlob(f);
    T.tour.plan = blob; T.tour.north = null; await DB.put('tours', T.tour);
    await setPlanImage(blob); busy(false); setPane('plan');
    if (await dialog({ msg: 'المخطط جاهز. تضبط اتجاهه الحين؟ (عشان يبين وين تطالع على المخطط، وتطلع أسهم المشي صح)', ok: 'اضبط', cancel: 'بعدين' })) await calibrateNorth();
  } catch (err) { busy(false); toast('ما قدرت أفتح الملف'); }
});
async function calibrateNorth() {
  const ok = await dialog({
    msg: 'وأنت داخل المبنى: وجّه كاميرا الجوال باتجاه «أعلى المخطط» في الواقع (مثلاً الواجهة المرسومة فوق)، وثبّت، بعدين اضغط حفظ.',
    live: () => haveRot ? Math.round(deviceHeading()) + '°' : 'لا يوجد حساس', ok: 'حفظ'
  });
  if (!ok || !haveRot) return;
  T.tour.north = deviceHeading(); await DB.put('tours', T.tour);
  renderPins(); V.miniKey = ''; toast('انضبط اتجاه المخطط');
}

/* ================= viewer ================= */
const V = { yaw: 0, pitch: 0, fov: 75, fovT: 75, gyro: false, mode: 'single', split: .5, spot: null, capA: null, capB: null, token: 0, miniKey: '' };
V.r = new THREE.WebGLRenderer({ canvas: $('#vgl'), antialias: true });
V.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
V.scene = new THREE.Scene(); V.scene.background = new THREE.Color(0x101113);
V.cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100); V.cam.rotation.order = 'YXZ';
V.A = new THREE.Group(); V.B = new THREE.Group(); V.arrows = new THREE.Group(); V.scene.add(V.A, V.B, V.arrows);
const vc = $('#vgl');
new ResizeObserver(() => { if (!vc.clientWidth) return; V.r.setSize(vc.clientWidth, vc.clientHeight, false); V.cam.aspect = vc.clientWidth / vc.clientHeight; V.cam.updateProjectionMatrix(); }).observe(vc);
const TEXMAX = () => Math.min(1600, V.r.capabilities.maxTextureSize);

const arrowShape = new THREE.Shape();
arrowShape.moveTo(0, .55); arrowShape.lineTo(.5, -.05); arrowShape.lineTo(.28, -.05); arrowShape.lineTo(0, .25); arrowShape.lineTo(-.28, -.05); arrowShape.lineTo(-.5, -.05); arrowShape.closePath();
const arrowGeo = new THREE.ShapeGeometry(arrowShape), hitGeo = new THREE.CircleGeometry(.9, 24);
arrowGeo.userData.shared = hitGeo.userData.shared = true;
function addArrow(yaw, target) {
  const g = new THREE.Group(); g.rotation.y = yaw;
  const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .92, depthTest: false, side: THREE.DoubleSide }));
  const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide }));
  [m, hit].forEach(o => { o.rotation.x = -Math.PI / 2; o.position.set(0, -1.7, -3.2); o.renderOrder = 10; o.userData.target = target; g.add(o); });
  m.scale.setScalar(1.4); V.arrows.add(g);
}
function buildArrows(i) {
  clearGroup(V.arrows);
  const s = T.spots[i], cand = new Set([i - 1, i + 1]);
  const usePlan = T.tour.plan && T.tour.north != null && s.x != null && P.W;
  if (usePlan) {
    T.spots.map((o, j) => ({ j, d: o.x == null || j === i ? 1e9 : Math.hypot((o.x - s.x) * P.W, (o.y - s.y) * P.H) }))
      .sort((a, b) => a.d - b.d).slice(0, 3).forEach(o => { if (o.d < 1e9) cand.add(o.j); });
  }
  const used = [];
  for (const j of cand) {
    const o = T.spots[j]; if (!o) continue;
    let yaw = null;
    if (usePlan && o.x != null) {
      const bearing = Math.atan2((o.x - s.x) * P.W, -(o.y - s.y) * P.H) / D2R;
      yaw = -(bearing + T.tour.north) * D2R;
    } else if (j === i + 1 && o.arrive != null) yaw = o.arrive;
    else if (j === i - 1 && s.arrive != null) yaw = s.arrive + Math.PI;
    if (yaw == null || used.some(u => Math.abs(Math.atan2(Math.sin(u - yaw), Math.cos(u - yaw))) < 0.35)) continue;
    used.push(yaw); addArrow(yaw, j);
  }
}

async function openSpot(i, opt = {}) {
  const s = T.spots[i]; if (!s) return;
  if (V.mode === 'compare') setCompare(false, true);
  setPane('pano', true);
  $('#vFade').classList.add('on');
  await new Promise(r => setTimeout(r, opt.instant ? 0 : 200));
  T.idx = i; V.spot = s; const tok = ++V.token;
  $('#vMsg').classList.remove('on');
  const cap = s.caps[opt.cap != null ? opt.cap : s.caps.length - 1];
  V.capA = cap;
  buildArrows(i); renderPins(); renderStrip(); renderCapRow(); renderActions();
  $('#vTag').textContent = 'نقطة ' + (i + 1) + ' · ' + dShort(cap.date);
  $('#fitR').value = Math.round((cap.k || 1) * 100);
  V.miniKey = '';
  const ok = await fillGroup(V.A, cap, TEXMAX(), 1, () => tok === V.token);
  if (ok && tok === V.token) $('#vFade').classList.remove('on');
}
async function showCap(ci) {
  if (!V.spot) return; const cap = V.spot.caps[ci]; if (!cap || cap === V.capA) return;
  const tok = ++V.token; V.capA = cap; renderCapRow();
  $('#vTag').textContent = 'نقطة ' + (T.idx + 1) + ' · ' + dShort(cap.date);
  $('#fitR').value = Math.round((cap.k || 1) * 100);
  $('#vFade').classList.add('on');
  if (await fillGroup(V.A, cap, TEXMAX(), 1, () => tok === V.token)) $('#vFade').classList.remove('on');
}

/* compare */
async function setCompare(on, quiet) {
  if (on && (!V.spot || V.spot.caps.length < 2)) { toast('تحتاج زيارتين على الأقل لهذي النقطة — صوّر «زيارة جديدة» بعد فترة'); return; }
  V.mode = on ? 'compare' : 'single';
  $('#cmpBtn').classList.toggle('on', on);
  ['#split', '#labA', '#labB'].forEach(id => $(id).classList.toggle('on', on));
  $('#cmpBox').classList.toggle('on', on); $('#capRow').style.display = on ? 'none' : '';
  $('#fitBtn').style.display = on ? 'none' : ''; $('#fitBox').classList.remove('on'); $('#fitBtn').classList.remove('on');
  V.arrows.visible = !on;
  if (!on) { clearGroup(V.B); V.capB = null; if (!quiet) renderStrip(); return; }
  $('#spotStrip').style.display = 'none';
  const caps = V.spot.caps, opts = caps.map((c, i) => '<option value="' + i + '">' + dLong(c.date) + '</option>').join('');
  $('#selA').innerHTML = opts; $('#selB').innerHTML = opts;
  $('#selA').value = String(caps.length - 2); $('#selB').value = String(caps.length - 1);
  V.split = .5; placeSplit();
  await loadCompare();
}
async function loadCompare() {
  const caps = V.spot.caps, a = caps[+$('#selA').value], b = caps[+$('#selB').value];
  const tok = ++V.token; V.capA = a; V.capB = b;
  $('#labA').textContent = dShort(a.date); $('#labB').textContent = dShort(b.date);
  $('#alignR').value = Math.round((b.yawOff || 0) * 10);
  $('#vFade').classList.add('on');
  const max = Math.min(1280, TEXMAX());
  if (!await fillGroup(V.A, a, max, 1, () => tok === V.token)) return;
  if (!await fillGroup(V.B, b, max, 1, () => tok === V.token)) return;
  $('#vFade').classList.remove('on');
}
$('#cmpBtn').onclick = () => setCompare(V.mode !== 'compare');
$('#selA').onchange = loadCompare; $('#selB').onchange = loadCompare;
$('#alignR').addEventListener('input', e => { V.B.rotation.y = (e.target.value / 10) * D2R; });
$('#alignR').addEventListener('change', async e => { if (!V.capB) return; V.capB.yawOff = e.target.value / 10; await DB.put('spots', V.spot); });
function placeSplit() { $('#split').style.left = (V.split * 100) + '%'; }
const knob = $('#split i');
knob.addEventListener('pointerdown', e => { e.stopPropagation(); knob.setPointerCapture(e.pointerId); });
knob.addEventListener('pointermove', e => {
  if (!knob.hasPointerCapture(e.pointerId)) return;
  const r = $('#viewer').getBoundingClientRect(); V.split = clamp((e.clientX - r.left) / r.width, .04, .96); placeSplit();
});

/* viewer input */
const vp = new Map(); let vDown = null, pinch0 = 0, fov0 = 75, vVel = [0, 0];
vc.addEventListener('pointerdown', e => {
  vc.setPointerCapture(e.pointerId); vp.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (vp.size === 1) vDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (vp.size === 2) { const [a, b] = [...vp.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); fov0 = V.fovT; vDown = null; }
  vVel = [0, 0];
});
vc.addEventListener('pointermove', e => {
  if (!vp.has(e.pointerId)) return;
  const o = vp.get(e.pointerId), n = { x: e.clientX, y: e.clientY }; vp.set(e.pointerId, n);
  if (vp.size === 1 && !V.gyro) {
    const k = V.cam.fov * D2R / vc.clientHeight;
    vVel = [(n.x - o.x) * k, (n.y - o.y) * k]; V.yaw += vVel[0]; V.pitch += vVel[1];
  } else if (vp.size === 2 && pinch0) {
    const [a, b] = [...vp.values()]; V.fovT = clamp(fov0 * pinch0 / Math.hypot(a.x - b.x, a.y - b.y), 25, 100); V.fov = V.fovT;
  }
});
vc.addEventListener('pointerup', e => {
  if (vDown && vp.size === 1 && Math.hypot(e.clientX - vDown.x, e.clientY - vDown.y) < 10 && performance.now() - vDown.t < 450) tapViewer(e);
  vp.delete(e.pointerId); if (!vp.size) { pinch0 = 0; vDown = null; }
});
vc.addEventListener('pointercancel', e => { vp.delete(e.pointerId); });
const ray = new THREE.Raycaster();
function tapViewer(e) {
  if (V.mode === 'compare') return;
  const rc = vc.getBoundingClientRect();
  ray.setFromCamera({ x: (e.clientX - rc.left) / rc.width * 2 - 1, y: -(e.clientY - rc.top) / rc.height * 2 + 1 }, V.cam);
  const hit = ray.intersectObjects(V.arrows.children, true)[0];
  if (hit && hit.object.userData.target != null) openSpot(hit.object.userData.target);
}
$('#gyroBtn').onclick = () => {
  V.gyro = !V.gyro; $('#gyroBtn').classList.toggle('on', V.gyro);
  if (!V.gyro) { const d = camDir(V.cam.quaternion); V.yaw = yawOf(d); V.pitch = Math.asin(clamp(d.y, -1, 1)); }
  else if (!haveRot) toast('حساس الدوران غير متاح');
};
$('#fitBtn').onclick = () => { const on = !$('#fitBox').classList.contains('on'); $('#fitBox').classList.toggle('on', on); $('#fitBtn').classList.toggle('on', on); };
$('#fitR').addEventListener('input', e => {
  const k = e.target.value / 100;
  for (const m of V.A.children) { const ph = m.userData.ph; m.geometry.dispose(); m.geometry = patchGeo(ph.hf, ph.vf, k); }
});
$('#fitR').addEventListener('change', async e => {
  if (!V.capA) return; V.capA.k = e.target.value / 100; await DB.put('spots', V.spot);
  try { localStorage.setItem('lensK', String(V.capA.k)); } catch (_) {}
});
$('#mini').onclick = () => setPane('plan');

function viewHeading() { return norm360(-(yawOf(camDir(V.cam.quaternion)) / D2R - ((V.capA && V.capA.yawOff) || 0))); }
function drawMini() {
  const c = $('#mini'), s = V.spot;
  const on = !!(T.tour && T.tour.plan && s && s.x != null && P.W);
  c.classList.toggle('on', on); if (!on) return;
  const h = viewHeading(), key = s.id + '|' + Math.round(h) + '|' + T.tour.north;
  if (key === V.miniKey) return; V.miniKey = key;
  const g = c.getContext('2d'), S = c.width, span = Math.max(P.W, P.H) * .24, sc = S / span;
  g.fillStyle = '#e9e9e6'; g.fillRect(0, 0, S, S);
  g.save(); g.translate(S / 2, S / 2); g.scale(sc, sc); g.translate(-s.x * P.W, -s.y * P.H); g.drawImage(planImg, 0, 0); g.restore();
  if (T.tour.north != null) {
    g.save(); g.translate(S / 2, S / 2); g.rotate((h - T.tour.north) * D2R);
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, S * .34, -Math.PI / 2 - .5, -Math.PI / 2 + .5); g.closePath();
    g.fillStyle = 'rgba(58,160,255,.55)'; g.fill(); g.restore();
  }
  g.beginPath(); g.arc(S / 2, S / 2, 10, 0, 7); g.fillStyle = '#ff3b30'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
}

function renderViewer() {
  if (V.gyro && haveRot) V.cam.quaternion.copy(qCam);
  else {
    if (!vp.size && (Math.abs(vVel[0]) > 1e-5 || Math.abs(vVel[1]) > 1e-5)) { V.yaw += vVel[0]; V.pitch += vVel[1]; vVel[0] *= .92; vVel[1] *= .92; }
    V.pitch = clamp(V.pitch, -1.5, 1.5); V.cam.rotation.set(V.pitch, V.yaw, 0);
  }
  V.fov += (V.fovT - V.fov) * .15;
  if (Math.abs(V.cam.fov - V.fov) > .01) { V.cam.fov = V.fov; V.cam.updateProjectionMatrix(); }
  if (V.mode === 'compare') {
    const w = vc.clientWidth, h = vc.clientHeight, sx = Math.round(w * V.split);
    V.r.setScissorTest(true);
    V.A.visible = true; V.B.visible = false; V.r.setScissor(0, 0, sx, h); V.r.render(V.scene, V.cam);
    V.A.visible = false; V.B.visible = true; V.r.setScissor(sx, 0, w - sx, h); V.r.render(V.scene, V.cam);
    V.r.setScissorTest(false); V.A.visible = true;
  } else { V.B.visible = false; V.r.render(V.scene, V.cam); }
  drawMini();
}

/* ================= tour screen ================= */
const T = { tour: null, spots: [], idx: 0, pane: 'pano' };
const stripUrls = [];
async function openTour(t) {
  T.tour = t; if (t.north === undefined) t.north = null;
  T.spots = (await DB.spotsOf(t.id)).map(normSpot).sort((a, b) => a.order - b.order);
  T.idx = 0; V.spot = null; V.capA = null; V.mode = 'single'; setCompare(false, true);
  clearGroup(V.A); clearGroup(V.B); clearGroup(V.arrows);
  V.yaw = 0; V.pitch = 0; V.gyro = false; $('#gyroBtn').classList.remove('on');
  $('#tName').textContent = t.name; show('tour');
  await setPlanImage(t.plan || null);
  renderPins(); renderStrip(); renderCapRow();
  setPane(t.plan ? 'plan' : 'pano');
}
function setPane(v, noLoad) {
  T.pane = v;
  $('#planView').classList.toggle('on', v === 'plan'); $('#viewer').classList.toggle('on', v === 'pano');
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'plan') {
    $('#planMsg').classList.toggle('on', !T.tour.plan);
    if (T.tour.plan && !P.fitted) requestAnimationFrame(planFit);
    renderPins();
  } else {
    if (v !== 'plan' && P.placing) { P.placing = null; $('#placeHint').classList.remove('on'); }
    if (!T.spots.length) { $('#vMsg').textContent = 'اضغط «نقطة جديدة»، وقف في المكان ولف حول نفسك ببطء. التطبيق يصوّر تلقائياً لما تطابق الدائرة النقطة.'; $('#vMsg').classList.add('on'); $('#vTag').textContent = ''; }
    else if (!V.spot && !noLoad) openSpot(T.idx || 0, { instant: true });
  }
  $('#capRow').style.display = v === 'pano' && V.mode !== 'compare' ? '' : 'none';
  $('#cmpBox').classList.toggle('on', v === 'pano' && V.mode === 'compare');
  renderStrip(); renderActions();
}
document.querySelectorAll('#seg button').forEach(b => { b.onclick = () => setPane(b.dataset.v); });
function renderStrip() {
  while (stripUrls.length) URL.revokeObjectURL(stripUrls.pop());
  const st = $('#spotStrip'); st.textContent = '';
  const showIt = T.pane === 'pano' && V.mode !== 'compare' && T.spots.length > 1;
  st.style.display = showIt ? 'flex' : 'none'; if (!showIt) return;
  T.spots.forEach((s, i) => {
    const b = document.createElement('button'); b.className = 'spot' + (i === T.idx ? ' cur' : '');
    const im = document.createElement('img'); const th = lastCap(s).thumb;
    if (th) { const u = URL.createObjectURL(th); stripUrls.push(u); im.src = u; }
    const sp = document.createElement('span'); sp.textContent = 'نقطة ' + (i + 1);
    b.append(im, sp); b.onclick = () => { if (i !== T.idx) openSpot(i); };
    st.appendChild(b);
  });
  const cur = st.children[T.idx]; if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function renderCapRow() {
  const row = $('#capRow'); row.textContent = '';
  if (!V.spot) return;
  V.spot.caps.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'cchip' + (c === V.capA ? ' on' : '');
    b.textContent = dShort(c.date); b.onclick = () => showCap(i); row.appendChild(b);
  });
  const on = row.querySelector('.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function renderActions() {
  const a = $('#actions'); a.textContent = '';
  const mk = (txt, cls, fn, dis) => { const b = document.createElement('button'); b.className = 'btn' + (cls ? ' ' + cls : ''); b.textContent = txt; b.onclick = fn; b.disabled = !!dis; a.appendChild(b); };
  if (T.pane === 'plan') {
    mk('● نقطة جديدة', 'rec', newSpot);
    if (T.spots.length) mk('عرض 360', '', () => setPane('pano'));
  } else {
    mk('● نقطة جديدة', T.spots.length ? '' : 'rec', newSpot);
    if (V.spot) mk('● زيارة جديدة', 'rec', () => startCapture({ spot: V.spot }));
    if (V.spot) mk('حفظ 360', '', exportPano);
  }
}
function newSpot() {
  if (T.tour.plan) startPlacing((x, y) => startCapture({ pos: { x, y } }), 'اضغط على مكان النقطة الجديدة في المخطط');
  else startCapture({});
}
$('#tBack').onclick = () => { show('home'); renderHome(); };
$('#tMenu').onclick = async () => {
  const opts = [{ k: 'ren', label: 'إعادة تسمية الجولة' }, { k: 'plan', label: T.tour.plan ? 'تغيير المخطط' : 'رفع مخطط (صورة أو PDF)' }];
  if (T.tour.plan) opts.push({ k: 'north', label: 'ضبط اتجاه المخطط' });
  if (T.tour.plan && V.spot) opts.push({ k: 'move', label: 'تحديد / نقل مكان النقطة ' + (T.idx + 1) + ' على المخطط' });
  if (V.spot && V.spot.caps.length > 1 && V.mode === 'single') opts.push({ k: 'delcap', label: 'حذف زيارة ' + dShort(V.capA.date), danger: true });
  if (V.spot) opts.push({ k: 'delspot', label: 'حذف النقطة ' + (T.idx + 1) + ' بكل زياراتها', danger: true });
  opts.push({ k: 'deltour', label: 'حذف الجولة كاملة', danger: true });
  const i = await dialog({ msg: T.tour.name, list: opts, cancel: 'إغلاق' });
  if (i == null) return;
  const k = opts[i].k;
  if (k === 'ren') {
    const n = await dialog({ msg: 'اسم الجولة', input: 'الاسم', value: T.tour.name, ok: 'حفظ' });
    if (n) { T.tour.name = n; await DB.put('tours', T.tour); $('#tName').textContent = n; }
  } else if (k === 'plan') $('#planFile').click();
  else if (k === 'north') await calibrateNorth();
  else if (k === 'move') {
    const s = V.spot;
    startPlacing(async (x, y) => { s.x = x; s.y = y; await DB.put('spots', s); renderPins(); toast('انحفظ مكان النقطة'); }, 'اضغط على مكان النقطة ' + (T.idx + 1) + ' في المخطط');
  } else if (k === 'delcap') {
    if (!await dialog({ msg: 'تحذف زيارة ' + dLong(V.capA.date) + '؟', ok: 'حذف' })) return;
    const s = V.spot; s.caps.splice(s.caps.indexOf(V.capA), 1); await DB.put('spots', s);
    V.spot = null; openSpot(T.idx, { instant: true });
  } else if (k === 'delspot') {
    if (!await dialog({ msg: 'تحذف نقطة ' + (T.idx + 1) + ' وكل زياراتها؟', ok: 'حذف' })) return;
    await DB.del('spots', V.spot.id); T.spots.splice(T.idx, 1);
    for (let j = 0; j < T.spots.length; j++) { T.spots[j].order = j; await DB.put('spots', T.spots[j]); }
    clearGroup(V.A); clearGroup(V.arrows); V.spot = null; V.capA = null;
    T.idx = Math.min(T.idx, Math.max(0, T.spots.length - 1)); renderPins(); setPane(T.pane);
  } else if (k === 'deltour') {
    if (!await dialog({ msg: 'تحذف جولة «' + T.tour.name + '» وكل نقاطها؟', ok: 'حذف' })) return;
    for (const s of T.spots) await DB.del('spots', s.id);
    await DB.del('tours', T.tour.id); show('home'); renderHome();
  }
};

/* ---------- export equirectangular JPEG (360 photo) ---------- */
function xmpSegment(W, H) {
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:FullPanoWidthPixels="' + W + '" GPano:FullPanoHeightPixels="' + H + '" GPano:CroppedAreaImageWidthPixels="' + W + '" GPano:CroppedAreaImageHeightPixels="' + H + '" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta>';
  const body = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0' + xml);
  const seg = new Uint8Array(4 + body.length), len = body.length + 2;
  seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = len >> 8; seg[3] = len & 255; seg.set(body, 4); return seg;
}
function withXmp(jpg, W, H) {
  let at = 2; if (jpg[2] === 0xFF && jpg[3] === 0xE0) at = 4 + ((jpg[4] << 8) | jpg[5]);
  const seg = xmpSegment(W, H), out = new Uint8Array(jpg.length + seg.length);
  out.set(jpg.subarray(0, at), 0); out.set(seg, at); out.set(jpg.subarray(at), at + seg.length); return out;
}
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function exportPano() {
  if (!V.spot || !V.capA) return;
  busy(true, 'تجهيز صورة 360…'); await new Promise(r => setTimeout(r, 50));
  try {
    const maxT = V.r.capabilities.maxTextureSize, W = Math.min(4096, maxT), H = W / 2;
    const crt = new THREE.WebGLCubeRenderTarget(Math.min(2048, maxT), { generateMipmaps: false, minFilter: THREE.LinearFilter });
    const cc = new THREE.CubeCamera(0.1, 100, crt);
    V.arrows.visible = false; V.B.visible = false; V.A.visible = true;
    V.scene.add(cc); cc.update(V.r, V.scene); V.scene.remove(cc); V.arrows.visible = V.mode !== 'compare';
    const mat = new THREE.ShaderMaterial({
      uniforms: { cube: { value: crt.texture } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'uniform samplerCube cube;varying vec2 vUv;void main(){float lon=(vUv.x-.5)*6.2831853;float lat=(vUv.y-.5)*3.1415927;vec3 d=vec3(sin(lon)*cos(lat),sin(lat),-cos(lon)*cos(lat));gl_FragColor=textureCube(cube,d);}',
      depthTest: false, depthWrite: false
    });
    const sc = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); sc.add(quad);
    const rt = new THREE.WebGLRenderTarget(W, H);
    V.r.setRenderTarget(rt); V.r.render(sc, new THREE.Camera());
    const px = new Uint8Array(W * H * 4); V.r.readRenderTargetPixels(rt, 0, 0, W, H, px); V.r.setRenderTarget(null);
    rt.dispose(); crt.dispose(); mat.dispose(); quad.geometry.dispose();
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const img = g.createImageData(W, H), row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    g.putImageData(img, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
    const bytes = withXmp(new Uint8Array(await blob.arrayBuffer()), W, H);
    const d = new Date(V.capA.date), ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const name = (T.tour.name + '-نقطة' + (T.idx + 1) + '-' + ds + '-' + Date.now().toString(36)).replace(/[\\/:*?"<>|]/g, '_') + '.jpg';
    if (NATIVE) toast(Android.saveImage(b64(bytes), name) ? 'انحفظت في المعرض (Pictures/Rafid360) — تنفتح 360 في صور Google' : 'ما قدرت أحفظ الصورة');
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); a.download = name; a.click(); }
  } catch (e) { toast('صار خطأ أثناء التصدير'); }
  busy(false);
}

/* ================= capture ================= */
const C = { photos: [], targets: [], stream: null, hf: 0, vf: 0, startYaw: 0, arrive: null, phase: 'aim', hold: 0, last: null, speed: 0, spot: null, pos: null };
C.r = new THREE.WebGLRenderer({ canvas: $('#cgl'), alpha: true, antialias: true });
C.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); C.r.setClearColor(0x000000, 0);
C.scene = new THREE.Scene(); C.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
C.prev = new THREE.Group(); C.ghost = new THREE.Group(); C.dots = new THREE.Group();
C.prev.scale.setScalar(.5); C.scene.add(C.prev, C.ghost, C.dots);
function dotTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.beginPath(); g.arc(32, 32, 22, 0, 7); g.fillStyle = 'rgba(255,255,255,.95)'; g.fill(); g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke(); return new THREE.CanvasTexture(c); }
const DOT = dotTex();
const video = $('#cv');

function lensFov(vw, vh) {
  let lens = {}; try { lens = NATIVE ? JSON.parse(Android.lens()) : {}; } catch (_) {}
  const ar = Math.max(vw, vh) / Math.min(vw, vh);
  let longF, shortF;
  if (lens.f && lens.sw && lens.sh) {
    const sw = Math.max(lens.sw, lens.sh), sh = Math.min(lens.sw, lens.sh), f = lens.f, sr = sw / sh;
    if (ar >= sr) { longF = 2 * Math.atan(sw / (2 * f)); shortF = 2 * Math.atan(sw / ar / (2 * f)); }
    else { shortF = 2 * Math.atan(sh / (2 * f)); longF = 2 * Math.atan(sh * ar / (2 * f)); }
  } else { longF = 66 * D2R; shortF = 2 * Math.atan(Math.tan(longF / 2) / ar); }
  return vh >= vw ? { hf: shortF, vf: longF } : { hf: longF, vf: shortF };
}
function sizeOverlay() {
  const c = $('#cgl'); if (!c.clientWidth || !video.videoWidth) return;
  C.r.setSize(c.clientWidth, c.clientHeight, false);
  const sa = c.clientWidth / c.clientHeight, va = video.videoWidth / video.videoHeight;
  const vf = va > sa ? C.vf : 2 * Math.atan(Math.tan(C.hf / 2) / sa);
  C.cam.fov = vf / D2R; C.cam.aspect = sa; C.cam.updateProjectionMatrix();
}
new ResizeObserver(sizeOverlay).observe($('#cgl'));

function buildTargets() {
  clearGroup(C.dots); C.targets = [];
  const rows = [[0, 12], [42, 8], [-42, 8], [90, 1], [-90, 1]];
  for (const [p, n] of rows) for (let i = 0; i < n; i++) {
    const d = dirOf(C.startYaw + i * 2 * Math.PI / n, p * D2R);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, depthTest: false, transparent: true }));
    sp.position.copy(d).multiplyScalar(5); sp.scale.setScalar(.32); C.dots.add(sp);
    C.targets.push({ d, sp, taken: false });
  }
}
function setGhostOpacity(v) { for (const m of C.prev.children) m.material.uniforms.op.value = v; }
$('#ghostR').addEventListener('input', e => setGhostOpacity(e.target.value / 100));

async function startCapture({ spot = null, pos = null }) {
  C.photos = []; C.spot = spot; C.pos = pos; C.arrive = null; C.hold = 0; C.last = null; C.targets = [];
  clearGroup(C.ghost); clearGroup(C.dots); clearGroup(C.prev);
  const needAim = !!spot || (!pos && T.spots.length > 0);
  C.phase = needAim ? 'aim' : 'shoot';
  $('#aimText').textContent = spot
    ? 'قف في نفس مكان النقطة ' + (T.spots.indexOf(spot) + 1) + '. الصورة الباهتة هي الزيارة السابقة: لما تتطابق مع الواقع حواليك يعني إنك في نفس المكان. بعدين اضغط ابدأ.'
    : 'وجّه الجوال للاتجاه اللي مشيت فيه من النقطة السابقة، بعدين اضغط ابدأ.';
  show('capture'); updateCount();
  $('#aimBox').classList.toggle('on', needAim); $('#cBot').style.display = needAim ? 'none' : 'flex';
  $('#ghostBar').classList.toggle('on', !!spot); $('#ghostR').value = 45;
  try {
    try { C.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }); }
    catch (_) { C.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1920 } } }); }
  } catch (e) { toast('ما قدرت أفتح الكاميرا — تأكد من صلاحية الكاميرا'); show('tour'); return; }
  video.srcObject = C.stream; await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  const f = lensFov(video.videoWidth, video.videoHeight); C.hf = f.hf; C.vf = f.vf; sizeOverlay();
  if (spot) fillGroup(C.prev, lastCap(spot), 512, .45, () => screen === 'capture');
  if (C.phase === 'shoot') beginShoot();
  setTimeout(() => { if (screen === 'capture' && !haveRot) toast('الجوال ما أرسل بيانات حساس الدوران'); }, 2000);
}
function beginShoot() {
  C.startYaw = yawOf(camDir(qCam));
  if (!C.spot && !C.pos && T.spots.length) C.arrive = C.startYaw;
  C.phase = 'shoot'; buildTargets(); updateCount();
  $('#aimBox').classList.remove('on'); $('#cBot').style.display = 'flex';
}
$('#aimGo').onclick = beginShoot;
function stopCamera() { if (C.stream) C.stream.getTracks().forEach(t => t.stop()); C.stream = null; video.srcObject = null; clearGroup(C.ghost); clearGroup(C.dots); clearGroup(C.prev); }
function updateCount() {
  const left = C.targets.filter(t => !t.taken).length;
  $('#cCount').textContent = C.photos.length + ' صورة' + (C.targets.length ? ' · باقي ' + left : '');
}
async function snap() {
  const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(1, 1600 / Math.max(vw, vh));
  const c = document.createElement('canvas'); c.width = Math.round(vw * s); c.height = Math.round(vh * s);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const q = qCam.toArray();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  const ph = { q, hf: C.hf, vf: C.vf, blob };
  const d = camDir(qCam), hit = [];
  for (const t of C.targets) if (!t.taken && t.d.angleTo(d) < 12 * D2R) { t.taken = true; t.sp.visible = false; hit.push(t); }
  ph._t = hit; C.photos.push(ph);
  const sm = document.createElement('canvas'); sm.width = Math.round(c.width / 5); sm.height = Math.round(c.height / 5); sm.getContext('2d').drawImage(c, 0, 0, sm.width, sm.height);
  const tex = new THREE.CanvasTexture(sm); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const m = new THREE.Mesh(patchGeo(C.hf, C.vf, 1), patchMat(tex, .55)); m.scale.setScalar(.5); m.quaternion.fromArray(q); C.ghost.add(m); ph._m = m;
  $('#flash').classList.add('on'); setTimeout(() => $('#flash').classList.remove('on'), 60);
  if (NATIVE) Android.vibrate(30);
  updateCount();
  if (C.targets.every(t => t.taken)) { toast('اكتملت الكرة 360 ✓'); setTimeout(finishCapture, 500); }
}
$('#cUndo').onclick = () => {
  const ph = C.photos.pop(); if (!ph) return;
  ph._t.forEach(t => { t.taken = false; t.sp.visible = true; });
  C.ghost.remove(ph._m); ph._m.geometry.dispose(); ph._m.material.uniforms.map.value.dispose(); ph._m.material.dispose();
  updateCount();
};
$('#cCancel').onclick = () => cancelCapture();
async function cancelCapture() {
  if (C.photos.length && !await dialog({ msg: 'تلغي التصوير وتحذف ' + C.photos.length + ' صورة؟', ok: 'إلغاء التصوير', cancel: 'كمّل التصوير' })) return;
  stopCamera(); show('tour');
}
$('#cDone').onclick = () => finishCapture();
let finishing = false;
async function finishCapture() {
  if (finishing) return;
  if (!C.photos.length) { stopCamera(); show('tour'); return; }
  finishing = true; busy(true, 'حفظ…');
  try {
    const bm = await createImageBitmap(C.photos[0].blob); const s = 240 / bm.width;
    const tc = document.createElement('canvas'); tc.width = 240; tc.height = Math.round(bm.height * s);
    tc.getContext('2d').drawImage(bm, 0, 0, tc.width, tc.height);
    const thumb = await new Promise(r => tc.toBlob(r, 'image/jpeg', .8));
    let k = 1; try { k = parseFloat(localStorage.getItem('lensK')) || 1; } catch (_) {}
    const cap = { id: uid(), date: Date.now(), k, yawOff: 0, photos: C.photos.map(p => ({ q: p.q, hf: p.hf, vf: p.vf, blob: p.blob })), thumb };
    let idx, msg;
    if (C.spot) {
      C.spot.caps.push(cap); await DB.put('spots', C.spot); idx = T.spots.indexOf(C.spot);
      msg = 'انحفظت الزيارة — اضغط «مقارنة» تشوف الفرق';
    } else {
      const spot = { id: uid(), tourId: T.tour.id, order: T.spots.length, x: C.pos ? C.pos.x : null, y: C.pos ? C.pos.y : null, arrive: C.arrive, caps: [cap] };
      await DB.put('spots', spot); T.spots.push(spot); idx = T.spots.length - 1;
      msg = 'انحفظت النقطة ' + T.spots.length;
    }
    stopCamera(); show('tour');
    if (C.arrive != null) { V.gyro = false; $('#gyroBtn').classList.remove('on'); V.yaw = C.arrive; V.pitch = 0; }
    V.spot = null; await openSpot(idx, { instant: true });
    toast(msg);
  } catch (e) { toast('ما قدرت أحفظ'); }
  busy(false); finishing = false;
}

const tmpV = new THREE.Vector3(), inv = new THREE.Quaternion();
let snapping = false;
function renderCapture(dt) {
  C.cam.quaternion.copy(qCam);
  const d = camDir(qCam);
  if (C.last) { const sp = d.angleTo(C.last) / Math.max(dt, .001); if (isFinite(sp)) C.speed = C.speed * .7 + sp * .3; }
  C.last = (C.last || new THREE.Vector3()).copy(d);
  const ring = $('#rFill'), arrow = $('#dirArrow'), hint = $('#cHint');
  if (C.phase !== 'shoot') { ring.style.strokeDashoffset = 213.6; arrow.style.display = 'none'; hint.textContent = C.spot ? 'طابق الصورة الباهتة مع الواقع' : ''; C.r.render(C.scene, C.cam); return; }
  let best = null, ba = 9;
  for (const t of C.targets) { if (t.taken) continue; const a = t.d.angleTo(d); if (a < ba) { ba = a; best = t; } t.sp.material.color.set(0xffffff); t.sp.scale.setScalar(.32); }
  if (best) {
    best.sp.material.color.set(0xff3b30); best.sp.scale.setScalar(.48);
    const aligned = ba < 3.2 * D2R, still = C.speed < .35;
    if (aligned && still && !snapping) C.hold += dt; else C.hold = Math.max(0, C.hold - dt * 2);
    const p = Math.min(1, C.hold / .45);
    ring.style.strokeDashoffset = 213.6 * (1 - p);
    if (p >= 1 && !snapping) { C.hold = 0; snapping = true; snap().finally(() => { snapping = false; }); }
    inv.copy(qCam).invert(); tmpV.copy(best.d).applyQuaternion(inv);
    if (ba > 9 * D2R) { arrow.style.display = 'block'; arrow.style.transform = 'rotate(' + Math.atan2(tmpV.x, tmpV.y) + 'rad)'; }
    else arrow.style.display = 'none';
    hint.textContent = aligned ? (still ? 'ثبّت…' : 'أبطأ شوي') : (C.speed > 1.6 ? 'لف أبطأ' : 'وجّه الدائرة على النقطة الحمراء');
  } else { arrow.style.display = 'none'; ring.style.strokeDashoffset = 213.6; }
  C.r.render(C.scene, C.cam);
}

/* ================= main loop / back ================= */
let lastT = performance.now(), coneT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  if (screen === 'tour') {
    if (T.pane === 'pano') renderViewer();
    else if (haveRot && T.tour && T.tour.north != null && now - coneT > 120) {
      coneT = now; const cone = document.querySelector('.pin.cur .cone');
      if (cone) cone.style.setProperty('--rot', (deviceHeading() - T.tour.north) + 'deg');
    }
  } else if (screen === 'capture') renderCapture(dt);
}
requestAnimationFrame(loop);

window.onBack = () => {
  if (dlgClose) { dlgClose(); return true; }
  if (screen === 'capture') { cancelCapture(); return true; }
  if (screen === 'tour') {
    if (P.placing) { P.placing = null; $('#placeHint').classList.remove('on'); return true; }
    if (V.mode === 'compare') { setCompare(false); return true; }
    show('home'); renderHome(); return true;
  }
  return false;
};

DB.open().then(renderHome).catch(() => toast('ما قدرت أفتح التخزين'));
}
