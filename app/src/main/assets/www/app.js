'use strict';
/* Rafid360 — capture spherical photo spots with camera + rotation sensor,
   view them in 360 and walk between spots. */
{
const $ = s => document.querySelector(s);
const NATIVE = typeof window.Android !== 'undefined';
const D2R = Math.PI / 180;

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
const FWD = new THREE.Vector3(0, 0, -1);
const camDir = (q, out = new THREE.Vector3()) => out.copy(FWD).applyQuaternion(q);
const yawOf = d => Math.atan2(-d.x, -d.z);
const dirOf = (yaw, pitch) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

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

/* ================= UI helpers ================= */
let toastT = 0;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }
function busy(on, t) { $('#busy').classList.toggle('on', on); if (t) $('#busyT').textContent = t; }
let dlgClose = null;
function dialog({ msg, input, value = '', ok = 'موافق', cancel = 'إلغاء', list }) {
  return new Promise(res => {
    const box = $('#dbox'); box.textContent = '';
    const p = document.createElement('p'); p.textContent = msg; box.appendChild(p);
    let inp = null;
    const done = v => { $('#dlg').classList.remove('on'); dlgClose = null; res(v); };
    dlgClose = () => done(null);
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
const urls = [];
function freeUrls() { while (urls.length) URL.revokeObjectURL(urls.pop()); }
async function renderHome() {
  freeUrls();
  const tours = (await DB.all('tours')).sort((a, b) => b.created - a.created);
  const list = $('#tourList'); list.textContent = '';
  if (!tours.length) {
    list.innerHTML = '<div class="empty"><svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="#9aa0a6" stroke-width="3"><circle cx="48" cy="48" r="34"/><ellipse cx="48" cy="48" rx="34" ry="12"/><circle cx="48" cy="48" r="7" fill="#ff3b30" stroke="none"/></svg>ما عندك جولات للحين.<br>أنشئ جولة، وفي كل نقطة لف حول نفسك والتطبيق يصوّر تلقائياً.</div>';
    return;
  }
  for (const t of tours) {
    const spots = await DB.spotsOf(t.id);
    spots.sort((a, b) => a.order - b.order);
    const b = document.createElement('button'); b.className = 'tcard';
    if (spots[0] && spots[0].thumb) { const im = document.createElement('img'); const u = URL.createObjectURL(spots[0].thumb); urls.push(u); im.src = u; b.appendChild(im); }
    else { const ph = document.createElement('div'); ph.className = 'ph'; b.appendChild(ph); }
    const tx = document.createElement('div'); const nm = document.createElement('b'); nm.textContent = t.name;
    const sub = document.createElement('span'); sub.textContent = spots.length + ' نقطة · ' + new Date(t.created).toLocaleDateString('ar-SA');
    tx.append(nm, sub); b.appendChild(tx);
    b.onclick = () => openTour(t);
    list.appendChild(b);
  }
}
$('#newTour').onclick = async () => {
  const name = await dialog({ msg: 'اسم الجولة', input: 'مثلاً: فيلا الزهراء — الدور الأرضي', ok: 'إنشاء' });
  if (!name) return;
  const t = { id: uid(), name, created: Date.now() };
  await DB.put('tours', t); openTour(t);
};

/* ================= viewer ================= */
const V = { yaw: 0, pitch: 0, fov: 75, gyro: false, meshes: [], spot: null };
V.r = new THREE.WebGLRenderer({ canvas: $('#vgl'), antialias: true, preserveDrawingBuffer: false });
V.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
V.scene = new THREE.Scene(); V.scene.background = new THREE.Color(0x101113);
V.cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100); V.cam.rotation.order = 'YXZ';
V.patches = new THREE.Group(); V.arrows = new THREE.Group(); V.scene.add(V.patches, V.arrows);
const vro = new ResizeObserver(() => { const c = $('#vgl'); if (!c.clientWidth) return; V.r.setSize(c.clientWidth, c.clientHeight, false); V.cam.aspect = c.clientWidth / c.clientHeight; V.cam.updateProjectionMatrix(); });
vro.observe($('#vgl'));

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
  const c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
  c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); if (bm.close) bm.close();
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t;
}
function clearGroup(g) { while (g.children.length) { const m = g.children.pop(); m.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.uniforms && o.material.uniforms.map) o.material.uniforms.map.value.dispose(); o.material.dispose(); } }); } }

const arrowShape = new THREE.Shape();
arrowShape.moveTo(0, .55); arrowShape.lineTo(.5, -.05); arrowShape.lineTo(.28, -.05); arrowShape.lineTo(0, .25); arrowShape.lineTo(-.28, -.05); arrowShape.lineTo(-.5, -.05); arrowShape.closePath();
const arrowGeo = new THREE.ShapeGeometry(arrowShape), hitGeo = new THREE.CircleGeometry(.9, 24);
function addArrow(yaw, target) {
  const g = new THREE.Group(); g.rotation.y = yaw;
  const m = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .92, depthTest: false, side: THREE.DoubleSide }));
  const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, side: THREE.DoubleSide }));
  [m, hit].forEach(o => { o.rotation.x = -Math.PI / 2; o.position.set(0, -1.7, -3.2); o.renderOrder = 10; o.userData.target = target; g.add(o); });
  m.scale.setScalar(1.4);
  V.arrows.add(g);
}

async function loadSpot(idx, fade) {
  const s = T.spots[idx]; if (!s) return;
  if (fade) { $('#vFade').classList.add('on'); await new Promise(r => setTimeout(r, 230)); }
  clearGroup(V.patches); clearGroup(V.arrows);
  T.idx = idx; V.spot = s; renderStrip();
  const max = Math.min(1600, V.r.capabilities.maxTextureSize);
  for (const ph of s.photos) {
    const tex = await blobTex(ph.blob, max);
    const m = new THREE.Mesh(patchGeo(ph.hf, ph.vf, s.k || 1), patchMat(tex));
    m.quaternion.fromArray(ph.q); m.userData.ph = ph; V.patches.add(m);
  }
  // navigation arrows: forward to next spot, back to previous
  const next = T.spots[idx + 1], prev = T.spots[idx - 1];
  if (next && next.arrive != null) addArrow(next.arrive, idx + 1);
  if (prev && s.arrive != null) addArrow(s.arrive + Math.PI, idx - 1);
  $('#fitR').value = Math.round((s.k || 1) * 100);
  $('#vTag').textContent = 'نقطة ' + (idx + 1) + ' من ' + T.spots.length;
  if (fade) { V.fov = Math.max(30, V.fov * .8); setTimeout(() => { V.fov = V.fovTarget || 75; }, 60); $('#vFade').classList.remove('on'); }
}
function refit(k) {
  for (const m of V.patches.children) { const ph = m.userData.ph; m.geometry.dispose(); m.geometry = patchGeo(ph.hf, ph.vf, k); }
}

/* viewer input */
const vp = new Map(); let vDown = null, pinch0 = 0, fov0 = 75, vVel = [0, 0];
const vc = $('#vgl');
vc.addEventListener('pointerdown', e => {
  vc.setPointerCapture(e.pointerId); vp.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (vp.size === 1) vDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (vp.size === 2) { const [a, b] = [...vp.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); fov0 = V.fovTarget || V.fov; vDown = null; }
  vVel = [0, 0];
});
vc.addEventListener('pointermove', e => {
  if (!vp.has(e.pointerId)) return;
  const o = vp.get(e.pointerId), n = { x: e.clientX, y: e.clientY }; vp.set(e.pointerId, n);
  if (vp.size === 1 && !V.gyro) {
    const k = V.cam.fov * D2R / vc.clientHeight;
    vVel = [(n.x - o.x) * k, (n.y - o.y) * k]; V.yaw += vVel[0]; V.pitch += vVel[1];
  } else if (vp.size === 2) {
    const [a, b] = [...vp.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0) { V.fovTarget = Math.max(30, Math.min(100, fov0 * pinch0 / d)); V.fov = V.fovTarget; }
  }
});
function vUp(e) {
  if (vDown && vp.size === 1) {
    const moved = Math.hypot(e.clientX - vDown.x, e.clientY - vDown.y);
    if (moved < 10 && performance.now() - vDown.t < 450) tapViewer(e);
  }
  vp.delete(e.pointerId); if (!vp.size) { pinch0 = 0; vDown = null; }
}
vc.addEventListener('pointerup', vUp); vc.addEventListener('pointercancel', e => { vp.delete(e.pointerId); });
const ray = new THREE.Raycaster();
function tapViewer(e) {
  const rc = vc.getBoundingClientRect();
  ray.setFromCamera({ x: (e.clientX - rc.left) / rc.width * 2 - 1, y: -(e.clientY - rc.top) / rc.height * 2 + 1 }, V.cam);
  const hit = ray.intersectObjects(V.arrows.children, true)[0];
  if (hit && hit.object.userData.target != null) loadSpot(hit.object.userData.target, true);
}
$('#gyroBtn').onclick = () => {
  V.gyro = !V.gyro; $('#gyroBtn').classList.toggle('on', V.gyro);
  if (!V.gyro) { const d = camDir(V.cam.quaternion); V.yaw = yawOf(d); V.pitch = Math.asin(Math.max(-1, Math.min(1, d.y))); }
  else if (!haveRot) toast('حساس الدوران غير متاح');
};
$('#fitBtn').onclick = () => { const on = !$('#fitBox').classList.contains('on'); $('#fitBox').classList.toggle('on', on); $('#fitBtn').classList.toggle('on', on); };
$('#fitR').addEventListener('input', e => { if (!V.spot) return; refit(e.target.value / 100); });
$('#fitR').addEventListener('change', async e => {
  if (!V.spot) return; V.spot.k = e.target.value / 100; await DB.put('spots', V.spot);
  try { localStorage.setItem('lensK', String(V.spot.k)); } catch (_) {}
});

function renderViewer() {
  if (V.gyro && haveRot) V.cam.quaternion.copy(qCam);
  else {
    if (!vp.size && (Math.abs(vVel[0]) > 1e-5 || Math.abs(vVel[1]) > 1e-5)) { V.yaw += vVel[0]; V.pitch += vVel[1]; vVel[0] *= .92; vVel[1] *= .92; }
    V.pitch = Math.max(-1.5, Math.min(1.5, V.pitch));
    V.cam.rotation.set(V.pitch, V.yaw, 0);
  }
  const ft = V.fovTarget || 75; V.fov += (ft - V.fov) * .15;
  if (Math.abs(V.cam.fov - V.fov) > .01) { V.cam.fov = V.fov; V.cam.updateProjectionMatrix(); }
  V.r.render(V.scene, V.cam);
}

/* ================= tour screen ================= */
const T = { tour: null, spots: [], idx: 0 };
const stripUrls = [];
async function openTour(t) {
  T.tour = t; T.spots = (await DB.spotsOf(t.id)).sort((a, b) => a.order - b.order);
  $('#tName').textContent = t.name; show('tour');
  clearGroup(V.patches); clearGroup(V.arrows); V.spot = null;
  V.yaw = 0; V.pitch = 0;
  if (T.spots.length) { $('#vMsg').classList.remove('on'); await loadSpot(0, false); }
  else { $('#vMsg').textContent = 'اضغط «إضافة نقطة»، وقف في أول مكان ولف حول نفسك ببطء. التطبيق يصوّر تلقائياً لما تطابق الدائرة النقطة.'; $('#vMsg').classList.add('on'); renderStrip(); $('#vTag').textContent = ''; }
}
function renderStrip() {
  while (stripUrls.length) URL.revokeObjectURL(stripUrls.pop());
  const st = $('#spotStrip'); st.textContent = '';
  T.spots.forEach((s, i) => {
    const b = document.createElement('button'); b.className = 'spot' + (i === T.idx ? ' cur' : '');
    const im = document.createElement('img'); if (s.thumb) { const u = URL.createObjectURL(s.thumb); stripUrls.push(u); im.src = u; }
    const sp = document.createElement('span'); sp.textContent = 'نقطة ' + (i + 1);
    b.append(im, sp); b.onclick = () => { if (i !== T.idx) loadSpot(i, true); };
    st.appendChild(b);
  });
  $('#exportBtn').disabled = !T.spots.length;
  const cur = st.children[T.idx]; if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest' });
}
$('#tBack').onclick = () => { show('home'); renderHome(); };
$('#addSpot').onclick = () => startCapture();
$('#tMenu').onclick = async () => {
  const opts = [{ label: 'إعادة تسمية الجولة' }];
  if (V.spot) opts.push({ label: 'حذف النقطة الحالية', danger: true });
  opts.push({ label: 'حذف الجولة كاملة', danger: true });
  const i = await dialog({ msg: T.tour.name, list: opts, cancel: 'إغلاق' });
  if (i == null) return;
  const lab = opts[i].label;
  if (lab.startsWith('إعادة')) {
    const n = await dialog({ msg: 'اسم الجولة', input: 'الاسم', value: T.tour.name, ok: 'حفظ' });
    if (n) { T.tour.name = n; await DB.put('tours', T.tour); $('#tName').textContent = n; }
  } else if (lab.includes('النقطة')) {
    if (!await dialog({ msg: 'تحذف نقطة ' + (T.idx + 1) + '؟', ok: 'حذف' })) return;
    await DB.del('spots', V.spot.id); T.spots.splice(T.idx, 1);
    for (let j = 0; j < T.spots.length; j++) { T.spots[j].order = j; await DB.put('spots', T.spots[j]); }
    await openTour(T.tour); if (T.spots.length) await loadSpot(Math.min(T.idx, T.spots.length - 1), false);
  } else {
    if (!await dialog({ msg: 'تحذف جولة «' + T.tour.name + '» وكل نقاطها؟', ok: 'حذف' })) return;
    for (const s of T.spots) await DB.del('spots', s.id);
    await DB.del('tours', T.tour.id); show('home'); renderHome();
  }
};

/* ---------- export equirectangular JPEG (360 photo) ---------- */
function xmpSegment(W, H) {
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:FullPanoWidthPixels="' + W + '" GPano:FullPanoHeightPixels="' + H + '" GPano:CroppedAreaImageWidthPixels="' + W + '" GPano:CroppedAreaImageHeightPixels="' + H + '" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta>';
  const head = 'http://ns.adobe.com/xap/1.0/\0';
  const body = new TextEncoder().encode(head + xml);
  const seg = new Uint8Array(4 + body.length); const len = body.length + 2;
  seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = len >> 8; seg[3] = len & 255; seg.set(body, 4); return seg;
}
function withXmp(jpg, W, H) {
  let at = 2; if (jpg[2] === 0xFF && jpg[3] === 0xE0) at = 4 + ((jpg[4] << 8) | jpg[5]);
  const seg = xmpSegment(W, H), out = new Uint8Array(jpg.length + seg.length);
  out.set(jpg.subarray(0, at), 0); out.set(seg, at); out.set(jpg.subarray(at), at + seg.length); return out;
}
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
$('#exportBtn').onclick = async () => {
  if (!V.spot) return;
  busy(true, 'تجهيز صورة 360…'); await new Promise(r => setTimeout(r, 50));
  try {
    const maxT = V.r.capabilities.maxTextureSize, W = Math.min(4096, maxT), H = W / 2;
    const crt = new THREE.WebGLCubeRenderTarget(Math.min(2048, maxT), { generateMipmaps: false, minFilter: THREE.LinearFilter });
    const cc = new THREE.CubeCamera(0.1, 100, crt);
    V.arrows.visible = false; V.scene.add(cc); cc.update(V.r, V.scene); V.scene.remove(cc); V.arrows.visible = true;
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
    const name = (T.tour.name + '-نقطة' + (T.idx + 1) + '-' + Date.now()).replace(/[\\/:*?"<>|]/g, '_') + '.jpg';
    if (NATIVE) { toast(Android.saveImage(b64(bytes), name) ? 'انحفظت في المعرض (Pictures/Rafid360) — تنفتح 360 في صور Google' : 'ما قدرت أحفظ الصورة'); }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); a.download = name; a.click(); }
  } catch (e) { toast('صار خطأ أثناء التصدير'); }
  busy(false);
};

/* ================= capture ================= */
const C = { photos: [], targets: [], stream: null, hf: 0, vf: 0, startYaw: 0, arrive: null, phase: 'aim', hold: 0, last: null, speed: 0 };
C.r = new THREE.WebGLRenderer({ canvas: $('#cgl'), alpha: true, antialias: true });
C.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); C.r.setClearColor(0x000000, 0);
C.scene = new THREE.Scene(); C.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
C.dots = new THREE.Group(); C.ghost = new THREE.Group(); C.scene.add(C.ghost, C.dots);
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
async function startCapture() {
  C.photos = []; C.phase = T.spots.length ? 'aim' : 'shoot'; C.arrive = null; C.hold = 0; C.last = null;
  clearGroup(C.ghost); show('capture'); updateCount();
  $('#aimBox').classList.toggle('on', C.phase === 'aim'); $('#cBot').style.display = C.phase === 'aim' ? 'none' : 'flex';
  try {
    try { C.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }); }
    catch (_) { C.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1920 } } }); }
  } catch (e) { toast('ما قدرت أفتح الكاميرا — تأكد من صلاحية الكاميرا'); show('tour'); return; }
  video.srcObject = C.stream; await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  const f = lensFov(video.videoWidth, video.videoHeight); C.hf = f.hf; C.vf = f.vf; sizeOverlay();
  if (C.phase === 'shoot') beginShoot();
  setTimeout(() => { if (screen === 'capture' && !haveRot) toast('الجوال ما أرسل بيانات حساس الدوران'); }, 2000);
}
function beginShoot() {
  const d = camDir(qCam); C.startYaw = yawOf(d);
  if (T.spots.length) C.arrive = C.startYaw;
  C.phase = 'shoot'; buildTargets(); updateCount();
  $('#aimBox').classList.remove('on'); $('#cBot').style.display = 'flex';
}
$('#aimGo').onclick = beginShoot;
function stopCamera() { if (C.stream) C.stream.getTracks().forEach(t => t.stop()); C.stream = null; video.srcObject = null; clearGroup(C.ghost); clearGroup(C.dots); }
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
  // faint preview of what is already covered
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
  if (C.photos.length && !await dialog({ msg: 'تلغي النقطة وتحذف ' + C.photos.length + ' صورة؟', ok: 'إلغاء النقطة', cancel: 'كمّل التصوير' })) return;
  stopCamera(); show('tour');
}
$('#cDone').onclick = () => finishCapture();
let finishing = false;
async function finishCapture() {
  if (finishing) return;
  if (!C.photos.length) { stopCamera(); show('tour'); return; }
  finishing = true; busy(true, 'حفظ النقطة…');
  try {
    const first = C.photos[0];
    const bm = await createImageBitmap(first.blob); const s = 240 / bm.width;
    const tc = document.createElement('canvas'); tc.width = 240; tc.height = Math.round(bm.height * s);
    tc.getContext('2d').drawImage(bm, 0, 0, tc.width, tc.height);
    const thumb = await new Promise(r => tc.toBlob(r, 'image/jpeg', .8));
    let k = 1; try { k = parseFloat(localStorage.getItem('lensK')) || 1; } catch (_) {}
    const spot = { id: uid(), tourId: T.tour.id, order: T.spots.length, arrive: C.arrive, k, created: Date.now(),
      photos: C.photos.map(p => ({ q: p.q, hf: p.hf, vf: p.vf, blob: p.blob })), thumb };
    await DB.put('spots', spot);
    stopCamera(); T.spots.push(spot); show('tour'); $('#vMsg').classList.remove('on');
    if (spot.arrive != null) { V.gyro = false; $('#gyroBtn').classList.remove('on'); V.yaw = spot.arrive; V.pitch = 0; }
    await loadSpot(T.spots.length - 1, true);
    toast('انحفظت النقطة ' + T.spots.length + ' — امشِ للنقطة التالية وأضفها');
  } catch (e) { toast('ما قدرت أحفظ النقطة'); }
  busy(false); finishing = false;
}

const tmpV = new THREE.Vector3(), inv = new THREE.Quaternion();
function renderCapture(dt) {
  C.cam.quaternion.copy(qCam);
  const d = camDir(qCam);
  if (C.last) { const sp = d.angleTo(C.last) / Math.max(dt, .001); if (isFinite(sp)) C.speed = C.speed * .7 + sp * .3; }
  C.last = (C.last || new THREE.Vector3()).copy(d);
  const ring = $('#rFill'), arrow = $('#dirArrow'), hint = $('#cHint');
  if (C.phase !== 'shoot') { ring.style.strokeDashoffset = 213.6; arrow.style.display = 'none'; hint.textContent = ''; C.r.render(C.scene, C.cam); return; }
  let best = null, ba = 9;
  for (const t of C.targets) { if (t.taken) continue; const a = t.d.angleTo(d); if (a < ba) { ba = a; best = t; } t.sp.material.color.set(0xffffff); t.sp.scale.setScalar(.32); }
  if (best) {
    best.sp.material.color.set(0xff3b30); best.sp.scale.setScalar(.48);
    const aligned = ba < 3.2 * D2R, still = C.speed < .35;
    if (aligned && still && !snapping) { C.hold += dt; } else C.hold = Math.max(0, C.hold - dt * 2);
    const p = Math.min(1, C.hold / .45);
    ring.style.strokeDashoffset = 213.6 * (1 - p);
    if (p >= 1 && !snapping) { C.hold = 0; snapping = true; snap().finally(() => { snapping = false; }); }
    // on-screen arrow pointing to the next target
    inv.copy(qCam).invert(); tmpV.copy(best.d).applyQuaternion(inv);
    if (ba > 9 * D2R) { arrow.style.display = 'block'; arrow.style.transform = 'rotate(' + Math.atan2(tmpV.x, tmpV.y) + 'rad)'; }
    else arrow.style.display = 'none';
    hint.textContent = aligned ? (still ? 'ثبّت…' : 'أبطأ شوي') : (C.speed > 1.6 ? 'لف أبطأ' : 'وجّه الدائرة على النقطة الحمراء');
  } else { arrow.style.display = 'none'; ring.style.strokeDashoffset = 213.6; }
  C.r.render(C.scene, C.cam);
}
let snapping = false;

/* ================= main loop / back ================= */
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  if (screen === 'tour') renderViewer();
  else if (screen === 'capture') renderCapture(dt);
}
requestAnimationFrame(loop);

window.onBack = () => {
  if (dlgClose) { dlgClose(); return true; }
  if (screen === 'capture') { cancelCapture(); return true; }
  if (screen === 'tour') { show('home'); renderHome(); return true; }
  return false;
};

DB.open().then(renderHome).catch(() => toast('ما قدرت أفتح التخزين'));
}
