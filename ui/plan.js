/* 2B plan tuvali: Katlar (modül yerleşimi) ve İç plan (bölme, mahal, açıklık, nesne) modları.
 * Dünya birimi mm; ekran = dünya × ölçek + kaydırma. Renkler PluginLabs tokenlarından okunur. */
import { t as L, locale } from "./i18n.js";
import { objectName, roomName } from "./names.js";

const WIDTH = 4000;

export function moduleRect(m, scene) {
  let base = m;
  if (m.floor > 0 && m.on) base = scene.modules.find((g) => g.id === m.on && g.floor === 0) || m;
  const l = base.length * 1000;
  const [w, d] = base.rotated ? [WIDTH, l] : [l, WIDTH];
  const p = base.position;
  return [p[0], p[1], p[0] + w, p[1] + d];
}

function pierMm(len) { return len <= 4 ? 1000 : len <= 6 ? 1500 : 2000; }

export function fmt(v, d = 2) {
  return Number(v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
/* Eğri duvar geometrisi (motordaki `walls::centerline` ile aynı). */
function arcParams(w) {
  const c = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const s = w.arc || 0;
  if (Math.abs(s) < 1 || c < 1) return null;
  const r = (c * c / 4 + s * s) / (2 * Math.abs(s));
  const d = [(w.b[0] - w.a[0]) / c, (w.b[1] - w.a[1]) / c];
  const left = [-d[1], d[0]];
  const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  const sign = Math.sign(s);
  const off = (r - Math.abs(s)) * -sign;
  const center = [mid[0] + left[0] * off, mid[1] + left[1] * off];
  const a0 = Math.atan2(w.a[1] - center[1], w.a[0] - center[0]);
  const a1 = Math.atan2(w.b[1] - center[1], w.b[0] - center[0]);
  let sweep = a1 - a0;
  const tau = Math.PI * 2, large = Math.abs(s) > c / 2;
  if (sign > 0) { while (sweep > 0) sweep -= tau; if (!large && sweep < -Math.PI) sweep += tau; }
  else { while (sweep < 0) sweep += tau; if (!large && sweep > Math.PI) sweep -= tau; }
  return { center, r, a0, sweep };
}
export function centerline(w) {
  const p = arcParams(w);
  if (!p) return [w.a, w.b];
  const n = Math.min(96, Math.max(4, Math.ceil(Math.abs(p.sweep) / ((6 * Math.PI) / 180))));
  const pts = [];
  for (let k = 0; k <= n; k++) { const t = p.a0 + (p.sweep * k) / n; pts.push([p.center[0] + p.r * Math.cos(t), p.center[1] + p.r * Math.sin(t)]); }
  pts[0] = w.a;
  pts[n] = w.b;
  return pts;
}
export function wallLength(w) {
  const p = arcParams(w);
  return p ? p.r * Math.abs(p.sweep) : Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
}
function polyDist(p, pts) {
  let d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, distSeg(p, pts[i], pts[i + 1]));
  return d;
}
const near = (a, b, tol = 1) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  const c = [x / poly.length, y / poly.length];
  if (pointInPoly(c, poly)) return c;
  // iç bükey: kutunun ortasından içeride kalan ilk noktayı ara
  let best = poly[0];
  for (let k = 1; k < poly.length - 1; k++) {
    const m = [(poly[0][0] + poly[k][0] + poly[k + 1][0]) / 3, (poly[0][1] + poly[k][1] + poly[k + 1][1]) / 3];
    if (pointInPoly(m, poly)) { best = m; break; }
  }
  return best;
}

export class PlanCanvas {
  constructor(canvas, opts) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.mode = opts.mode; // "katlar" | "plan"
    this.on = opts.onAction;
    this.catalog = opts.catalog || { furniture: [] };
    this.scene = null;
    this.level = "L0";
    this.tool = { type: "select" };
    this.sel = null;
    this.view = { s: 0.05, ox: 40, oy: 40 };
    this.drag = null;
    this.hover = null;
    this.wallStart = null;
    this.space = false;
    this.fitted = false;
    this.colors = {};
    this.readColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.draw(); });
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("keydown", (e) => this.key(e));
    canvas.addEventListener("keyup", (e) => { if (e.code === "Space") this.space = false; });
  }

  readColors() {
    const cs = getComputedStyle(this.c.closest("[data-pl]"));
    const g = (n) => cs.getPropertyValue(n).trim();
    this.colors = {
      bg0: g("--pl-bg-0"), bg1: g("--pl-bg-1"), bg2: g("--pl-bg-2"), bg3: g("--pl-bg-3"), bg4: g("--pl-bg-4"),
      fg1: g("--pl-fg-1"), fg2: g("--pl-fg-2"), fg3: g("--pl-fg-3"), fg4: g("--pl-fg-4"),
      line: g("--pl-line"), lineStrong: g("--pl-line-strong"), accent: g("--pl-accent"), accentSoft: g("--pl-accent-soft"),
      success: g("--pl-success"), warning: g("--pl-warning"), danger: g("--pl-danger"), info: g("--pl-info"),
      mono: g("--pl-font-mono"), sans: g("--pl-font-sans"),
    };
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.c.width = Math.max(1, Math.round(r.width * dpr));
    this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
    if (!this.fitted && this.scene) this.fit();
    this.draw();
  }

  setScene(scene) { this.scene = scene; if (!this.fitted && this.c.width > 10) this.fit(); this.draw(); }
  setLevel(id) { if (id !== this.level) this.sel = null; this.level = id; this.draw(); }
  setTool(t) { this.tool = t; this.wallStart = null; this.draw(); }

  bounds() {
    const s = this.scene;
    if (!s) return [0, 0, 10000, 8000];
    const xs = [], ys = [];
    for (const m of s.modules || []) { const r = moduleRect(m, s); xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
    for (const l of s.levels) for (const w of l.walls) { xs.push(w.a[0], w.b[0]); ys.push(w.a[1], w.b[1]); }
    if (!xs.length) return [0, 0, 10000, 8000];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  fit() {
    const [x0, y0, x1, y1] = this.bounds();
    const W = this.c.width / (this.dpr || 1), H = this.c.height / (this.dpr || 1);
    if (W < 20 || H < 20) return;
    const pad = 70;
    const s = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
    this.view.s = Math.max(0.005, Math.min(0.5, s));
    this.view.ox = (W - (x1 - x0) * this.view.s) / 2 - x0 * this.view.s;
    this.view.oy = (H - (y1 - y0) * this.view.s) / 2 - y0 * this.view.s;
    this.fitted = true;
    this.draw();
  }

  toWorld(e) {
    const r = this.c.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.ox) / this.view.s, (e.clientY - r.top - this.view.oy) / this.view.s];
  }
  sx(x) { return x * this.view.s + this.view.ox; }
  sy(y) { return y * this.view.s + this.view.oy; }

  levelObj() { return this.scene && this.scene.levels.find((l) => l.id === this.level); }

  snap(p, from) {
    const g = 100;
    const q = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
    if (from) { if (Math.abs(q[0] - from[0]) >= Math.abs(q[1] - from[1])) q[1] = from[1]; else q[0] = from[0]; }
    return q;
  }

  /** Serbest çizim yakalaması: duvar uçları, 15° açı (Shift: serbest), 1 cm ızgara, duvar çizgisi (Alt: yapışma kapalı). */
  freeSnap(p, from, e = {}) {
    const l = this.levelObj();
    const magnet = e.altKey ? 0 : Math.max(150, 12 / this.view.s);
    const walls = l ? l.walls : [];
    if (magnet) {
      let best = null, bd = Infinity;
      for (const w of walls) for (const q of [w.a, w.b]) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= magnet && d < bd && !(from && near(from, q))) { bd = d; best = q; }
      }
      if (best) return { p: [...best], kind: "uc" };
    }
    if (from && !e.shiftKey) {
      const dx = p[0] - from[0], dy = p[1] - from[1];
      const step = Math.PI / 12;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.round(Math.hypot(dx, dy) / 10) * 10;
      return { p: [Math.round((from[0] + len * Math.cos(ang)) * 10) / 10, Math.round((from[1] + len * Math.sin(ang)) * 10) / 10], kind: "aci" };
    }
    const q = [Math.round(p[0] / 10) * 10, Math.round(p[1] / 10) * 10];
    if (magnet) {
      let best = null, bd = Infinity;
      for (const w of walls) {
        if (w.arc) continue;
        const d = distSeg(p, w.a, w.b);
        if (d <= magnet / 2 && d < bd) {
          const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
          const t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (dx * dx + dy * dy || 1)));
          bd = d;
          best = [Math.round((w.a[0] + dx * t) * 10) / 10, Math.round((w.a[1] + dy * t) * 10) / 10];
        }
      }
      if (best) return { p: best, kind: "duvar" };
    }
    return { p: q, kind: from ? "serbest" : "izgara" };
  }
  /** Yazılan uzunluk (cm) varsa başlangıçtan imleç yönünde o uzunlukta nokta. */
  typedPoint(from, toward) {
    const v = parseFloat(String(this.typed || "").replace(",", "."));
    if (!from || !toward || !(v > 0)) return null;
    const dx = toward[0] - from[0], dy = toward[1] - from[1], l = Math.hypot(dx, dy) || 1;
    return [Math.round((from[0] + (dx / l) * v * 10) * 10) / 10, Math.round((from[1] + (dy / l) * v * 10) * 10) / 10];
  }

  snap50(p, from) {
    const q = [Math.round(p[0] / 50) * 50, Math.round(p[1] / 50) * 50];
    if (from) { if (Math.abs(q[0] - from[0]) >= Math.abs(q[1] - from[1])) q[1] = from[1]; else q[0] = from[0]; }
    return q;
  }

  /* ---------- isabet testi ---------- */
  hitObject(p) {
    const s = this.scene;
    for (let i = s.objects.length - 1; i >= 0; i--) {
      const o = s.objects[i];
      if (o.level !== this.level) continue;
      const [w, d] = this.objSize(o);
      const a = (-o.rotation * Math.PI) / 180;
      const dx = p[0] - o.position[0], dy = p[1] - o.position[1];
      const lx = dx * Math.cos(a) - dy * Math.sin(a), lz = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2) return { type: "object", id: o.id };
    }
    return null;
  }
  objSize(o) {
    if (o.mesh.startsWith("cat:")) {
      const it = this.catalog.furniture.find((f) => f.id === o.mesh.slice(4));
      if (it) return [it.size[0] * o.scale[0], it.size[1] * o.scale[2]];
    }
    const m = this.scene.meshes.find((x) => x.id === o.mesh);
    if (m && m.positions.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of m.positions) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
      return [(x1 - x0) * o.scale[0], (z1 - z0) * o.scale[2]];
    }
    return [500, 500];
  }
  /** Nesnenin temel (ölçeksiz) plan ölçüsü. */
  objBase(o) {
    const [w, d] = this.objSize(o);
    return [w / (o.scale[0] || 1), d / (o.scale[2] || 1)];
  }
  objCorners(o) {
    const [w, d] = this.objSize(o);
    const a = (o.rotation * Math.PI) / 180;
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [o.position[0] + x * Math.cos(a) - z * Math.sin(a), o.position[1] + x * Math.sin(a) + z * Math.cos(a)]);
  }
  /** Seçili nesnenin köşe tutamağı (boyutlandırma). */
  hitHandle(p) {
    if (!this.sel || this.sel.type !== "object") return null;
    const o = this.scene.objects.find((x) => x.id === this.sel.id);
    if (!o || o.level !== this.level) return null;
    const r = 9 / this.view.s;
    return this.objCorners(o).some((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r) ? o : null;
  }
  hitDimension(p) {
    for (const d of this.scene.dimensions || []) if (d.level === this.level && distSeg(p, d.a, d.b) < 7 / this.view.s) return { type: "dimension", id: d.id };
    return null;
  }
  hitOpening(p) {
    const l = this.levelObj();
    if (!l) return null;
    for (const o of l.openings) {
      const w = l.walls.find((x) => x.id === o.wall);
      if (!w) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
      const d = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const a = [w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset];
      const b = [a[0] + d[0] * o.width, a[1] + d[1] * o.width];
      if (distSeg(p, a, b) <= w.thickness / 2 + 8 / this.view.s) return { type: "opening", id: o.id };
    }
    return null;
  }
  hitWall(p) {
    const l = this.levelObj();
    if (!l) return null;
    let best = null, bd = Infinity;
    for (const w of l.walls) {
      const d = w.arc ? polyDist(p, centerline(w)) : distSeg(p, w.a, w.b);
      if (d <= w.thickness / 2 + 6 / this.view.s && d < bd) { bd = d; best = { type: "wall", id: w.id }; }
    }
    return best;
  }
  hitRoom(p) {
    const l = this.levelObj();
    if (!l) return null;
    for (const r of l.rooms) if (pointInPoly(p, r.polygon)) return { type: "room", id: r.id };
    return null;
  }
  hitNote(p) {
    for (const n of this.scene.notes || []) if (n.level === this.level && Math.hypot(p[0] - n.position[0], p[1] - n.position[1]) < 14 / this.view.s) return { type: "note", id: n.id };
    return null;
  }
  hitModule(p) {
    const s = this.scene;
    const floor = Number(this.level.slice(1)) || 0;
    for (let i = s.modules.length - 1; i >= 0; i--) {
      const m = s.modules[i];
      if (m.floor !== floor) continue;
      const r = moduleRect(m, s);
      if (p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]) return { type: "module", id: m.id };
    }
    return null;
  }

  /* ---------- olaylar ---------- */
  down(e) {
    if (this.c.focus) this.c.focus();
    const p = e.worldOverride || this.toWorld(e);
    if (e.button === 1 || e.button === 2 || this.space) {
      this.drag = { kind: "pan", x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy };
      this.c.setPointerCapture(e.pointerId);
      return;
    }
    if (!this.scene) return;
    if (this.mode === "katlar") {
      const h = this.hitModule(p);
      this.sel = h;
      this.on("select", h);
      if (h && this.level === "L0") {
        const m = this.scene.modules.find((x) => x.id === h.id);
        this.drag = { kind: "module", id: h.id, start: p, pos: [...m.position], moved: false };
        this.c.setPointerCapture(e.pointerId);
      }
      this.draw();
      return;
    }
    const t = this.tool;
    if (t.type === "select") {
      // seçili serbest duvarın ucu: sürükleyerek uzat/döndür; bu uca bağlı duvarlar birlikte gelir
      if (this.sel && this.sel.type === "wall") {
        const w = this.levelObj().walls.find((x) => x.id === this.sel.id);
        const r = 10 / this.view.s;
        const end = w && !w.generated ? (near(p, w.a, r) ? "a" : near(p, w.b, r) ? "b" : null) : null;
        if (end) {
          const at = w[end];
          const joined = this.levelObj().walls.filter((x) => !x.generated).flatMap((x) => ["a", "b"].filter((k) => near(x[k], at)).map((k) => ({ id: x.id, end: k })));
          this.drag = { kind: "wallend", id: w.id, end, other: [...w[end === "a" ? "b" : "a"]], joined, moved: false };
          this.c.setPointerCapture(e.pointerId);
          return;
        }
      }
      const ho = this.hitHandle(p);
      if (ho) {
        this.drag = { kind: "scale", id: ho.id, base: this.objBase(ho), moved: false };
        this.c.setPointerCapture(e.pointerId);
        return;
      }
      const h = this.hitNote(p) || this.hitDimension(p) || this.hitObject(p) || this.hitOpening(p) || this.hitWall(p) || this.hitRoom(p);
      this.sel = h;
      this.on("select", h);
      if (h && h.type === "object") {
        const o = this.scene.objects.find((x) => x.id === h.id);
        this.drag = { kind: "object", id: h.id, start: p, pos: [...o.position], moved: false };
        this.c.setPointerCapture(e.pointerId);
      } else if (h && h.type === "wall") {
        const w = this.levelObj().walls.find((x) => x.id === h.id);
        if (w && !w.generated) {
          this.drag = { kind: "wall", id: h.id, start: p, a: [...w.a], b: [...w.b], moved: false };
          this.c.setPointerCapture(e.pointerId);
        }
      }
    } else if (t.type === "measure") {
      const q = this.snap50(p, e.shiftKey ? this.wallStart : null);
      if (!this.wallStart) this.wallStart = q;
      else {
        const a = this.wallStart;
        this.wallStart = null;
        if (Math.hypot(q[0] - a[0], q[1] - a[1]) >= 50) this.on("dimension", { a, b: q });
      }
    } else if (t.type === "paint") {
      const h = this.hitObject(p) || this.hitWall(p) || this.hitRoom(p);
      this.on("paint", { hit: h, material: t.value });
    } else if (t.type === "wall") {
      if (!this.wallStart) this.wallStart = this.snap(p);
      else {
        const b = this.snap(p, this.wallStart);
        const a = this.wallStart;
        this.wallStart = e.shiftKey ? null : b;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 200) this.on("wall", { a, b });
        if (!e.shiftKey) this.wallStart = null;
      }
    } else if (t.type === "freewall") {
      const s = this.free || (this.free = { start: null, end: null, first: null });
      const snapped = this.typedPoint(s.start, this.freeSnap(p, s.start, e).p) || this.freeSnap(p, s.start, e).p;
      this.typed = "";
      if (t.value === "arc") {
        if (!s.start) s.start = snapped;
        else if (!s.end) { if (Math.hypot(snapped[0] - s.start[0], snapped[1] - s.start[1]) >= 200) s.end = snapped; }
        else {
          const a = s.start, b = s.end;
          const c = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const left = [-(b[1] - a[1]) / c, (b[0] - a[0]) / c];
          const arc = Math.round((p[0] - (a[0] + b[0]) / 2) * left[0] + (p[1] - (a[1] + b[1]) / 2) * left[1]);
          this.free = null;
          this.on("freewall", { a, b, arc });
        }
      } else if (!s.start) { s.start = snapped; s.first = snapped; }
      else {
        const a = s.start;
        if (Math.hypot(snapped[0] - a[0], snapped[1] - a[1]) >= 200) {
          this.on("freewall", { a, b: snapped, arc: 0 });
          // başlangıç noktasına dönünce zincir kapanır
          if (s.first && near(snapped, s.first, 1)) this.free = null; else s.start = snapped;
        }
      }
    } else if (t.type === "calib") {
      const q = [Math.round(p[0]), Math.round(p[1])];
      if (!this.calibStart) this.calibStart = q;
      else { const a = this.calibStart; this.calibStart = null; if (Math.hypot(q[0] - a[0], q[1] - a[1]) > 1) this.on("calibrate", { a, b: q }); }
    } else if (t.type === "customopen") this.on("customopen", { point: p });
    else if (t.type === "room") this.on("room", { point: p, kind: t.value });
    else if (t.type === "opening") this.on("opening", { point: p, std: t.value });
    else if (t.type === "furniture") this.on("furniture", { point: this.snap(p), cat: t.value });
    else if (t.type === "clad") {
      const h = this.hitWall(p);
      this.on("clad", { wall: h && h.id, material: t.value });
    } else if (t.type === "note") this.on("note", { point: p });
    this.draw();
  }

  move(e) {
    const p = this.toWorld(e);
    this.hover = p;
    this.mods = { shiftKey: e.shiftKey, altKey: e.altKey };
    const d = this.drag;
    if (d && d.kind === "pan") {
      this.view.ox = d.ox + (e.clientX - d.x);
      this.view.oy = d.oy + (e.clientY - d.y);
    } else if (d && d.kind === "module") {
      const m = this.scene.modules.find((x) => x.id === d.id);
      m.position = [Math.round((d.pos[0] + p[0] - d.start[0]) / 100) * 100, Math.round((d.pos[1] + p[1] - d.start[1]) / 100) * 100];
      d.moved = true;
    } else if (d && d.kind === "object") {
      const o = this.scene.objects.find((x) => x.id === d.id);
      o.position = [Math.round((d.pos[0] + p[0] - d.start[0]) / 50) * 50, Math.round((d.pos[1] + p[1] - d.start[1]) / 50) * 50, o.position[2]];
      d.moved = true;
    } else if (d && d.kind === "scale") {
      const o = this.scene.objects.find((x) => x.id === d.id);
      const a = (-o.rotation * Math.PI) / 180;
      const dx = p[0] - o.position[0], dy = p[1] - o.position[1];
      const lx = Math.abs(dx * Math.cos(a) - dy * Math.sin(a)), lz = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
      const cl = (v) => Math.max(0.2, Math.min(5, Math.round(v * 100) / 100));
      let sx = cl((Math.round((lx * 2) / 50) * 50) / d.base[0]), sz = cl((Math.round((lz * 2) / 50) * 50) / d.base[1]);
      if (e.shiftKey) { const k = Math.max(sx, sz); o.scale = [k, k, k]; } else o.scale = [sx, o.scale[1], sz];
      d.moved = true;
    } else if (d && d.kind === "wallend") {
      const q = this.freeSnap(p, d.other, e).p;
      for (const j of d.joined) {
        const w = this.levelObj().walls.find((x) => x.id === j.id);
        if (w) w[j.end] = [...q];
      }
      d.moved = true;
    } else if (d && d.kind === "wall") {
      const w = this.levelObj().walls.find((x) => x.id === d.id);
      const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) || 1;
      const n = [-(d.b[1] - d.a[1]) / len, (d.b[0] - d.a[0]) / len];
      const k = Math.round(((p[0] - d.start[0]) * n[0] + (p[1] - d.start[1]) * n[1]) / 100) * 100;
      if (k !== 0 || d.moved) {
        w.a = [d.a[0] + n[0] * k, d.a[1] + n[1] * k];
        w.b = [d.b[0] + n[0] * k, d.b[1] + n[1] * k];
        d.moved = true;
      }
    }
    this.draw();
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    try { this.c.releasePointerCapture(e.pointerId); } catch { /* yok */ }
    if (!d) return;
    if (d.kind === "module" && d.moved) {
      const m = this.scene.modules.find((x) => x.id === d.id);
      this.on("move_module", { id: d.id, position: m.position });
    } else if ((d.kind === "object" || d.kind === "scale") && d.moved) this.on("object_moved", { id: d.id });
    else if ((d.kind === "wall" || d.kind === "wallend") && d.moved) this.on("wall_moved", { id: d.id });
  }

  wheel(e) {
    e.preventDefault();
    const r = this.c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(0.004, Math.min(1.2, this.view.s * k));
    this.view.ox = mx - ((mx - this.view.ox) * ns) / this.view.s;
    this.view.oy = my - ((my - this.view.oy) * ns) / this.view.s;
    this.view.s = ns;
    this.draw();
  }

  key(e) {
    if (e.code === "Space") { this.space = true; e.preventDefault(); return; }
    if (this.tool.type === "freewall" && this.free && this.free.start) {
      // uzunluğu yazıp Enter: cm cinsinden
      if (/^[0-9.,]$/.test(e.key)) { this.typed = (this.typed || "") + e.key; e.preventDefault(); this.draw(); return; }
      if (e.key === "Backspace" && this.typed) { this.typed = this.typed.slice(0, -1); e.preventDefault(); this.draw(); return; }
      if (e.key === "Enter" && this.typed && this.hover) {
        e.preventDefault();
        this.down({ button: 0, pointerId: 0, clientX: 0, clientY: 0, shiftKey: e.shiftKey, altKey: e.altKey, worldOverride: this.hover });
        return;
      }
      if (e.key === "Escape") { this.free = null; this.typed = ""; this.draw(); return; }
    }
    if (e.key === "Escape") { this.wallStart = null; this.free = null; this.calibStart = null; this.on("escape"); this.draw(); }
    if ((e.key === "r" || e.key === "R") && this.sel) this.on("rotate", this.sel);
    if ((e.key === "Delete" || e.key === "Backspace") && this.sel) this.on("archive", this.sel);
    const step = e.shiftKey ? 500 : 100;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && this.sel && this.sel.type === "object") {
      e.preventDefault();
      const o = this.scene.objects.find((x) => x.id === this.sel.id);
      o.position = [o.position[0] + arrows[e.key][0], o.position[1] + arrows[e.key][1], o.position[2]];
      this.on("object_moved", { id: o.id });
      this.draw();
    }
  }

  /* ---------- çizim ---------- */
  draw() {
    const ctx = this.ctx, C = this.colors, dpr = this.dpr || 1;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = this.c.width / dpr, H = this.c.height / dpr;
    ctx.fillStyle = C.bg0;
    ctx.fillRect(0, 0, W, H);
    this.grid(W, H);
    if (!this.scene) return;
    if (this.mode === "katlar") this.drawModules();
    else this.drawPlan();
  }

  grid(W, H) {
    const ctx = this.ctx, C = this.colors, s = this.view.s;
    const step = s * 1000 < 18 ? 5000 : 1000;
    const x0 = Math.floor(-this.view.ox / s / step) * step, x1 = (W - this.view.ox) / s;
    const y0 = Math.floor(-this.view.oy / s / step) * step, y1 = (H - this.view.oy) / s;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(Math.round(this.sx(x)) + 0.5, 0); ctx.lineTo(Math.round(this.sx(x)) + 0.5, H); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(0, Math.round(this.sy(y)) + 0.5); ctx.lineTo(W, Math.round(this.sy(y)) + 0.5); }
    ctx.stroke();
  }

  wallPoly(w) {
    if (w.arc) {
      const pts = centerline(w), h = w.thickness / 2;
      const L = [], R = [];
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
        const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const n = [-(p1[1] - p0[1]) / l, (p1[0] - p0[0]) / l];
        L.push([pts[i][0] + n[0] * h, pts[i][1] + n[1] * h]);
        R.push([pts[i][0] - n[0] * h, pts[i][1] - n[1] * h]);
      }
      return [...L, ...R.reverse()];
    }
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const d = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
    const n = [-d[1], d[0]];
    const h = w.thickness / 2;
    const ext = w.generated ? 0 : h;
    const a = [w.a[0] - d[0] * ext, w.a[1] - d[1] * ext], b = [w.b[0] + d[0] * ext, w.b[1] + d[1] * ext];
    return [[a[0] + n[0] * h, a[1] + n[1] * h], [b[0] + n[0] * h, b[1] + n[1] * h], [b[0] - n[0] * h, b[1] - n[1] * h], [a[0] - n[0] * h, a[1] - n[1] * h]];
  }

  path(poly) {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(this.sx(p[0]), this.sy(p[1])) : ctx.moveTo(this.sx(p[0]), this.sy(p[1]))));
    ctx.closePath();
  }

  label(text, x, y, opt = {}) {
    const ctx = this.ctx, C = this.colors;
    ctx.font = `${opt.weight || 500} ${opt.size || 11}px ${opt.mono ? C.mono : C.sans}`;
    ctx.textAlign = opt.align || "center";
    ctx.textBaseline = "middle";
    if (opt.bg) {
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = opt.bg;
      const xx = opt.align === "left" ? x - 4 : x - w / 2;
      ctx.fillRect(xx, y - 8, w, 16);
    }
    ctx.fillStyle = opt.color || C.fg2;
    ctx.fillText(text, x, y);
  }

  drawWalls(level, faint) {
    const ctx = this.ctx, C = this.colors;
    for (const w of level.walls) {
      this.path(this.wallPoly(w));
      ctx.fillStyle = faint ? C.bg4 : w.structural ? C.fg2 : w.generated ? C.fg4 : C.fg3;
      ctx.fill();
      const sel = this.sel && this.sel.type === "wall" && this.sel.id === w.id;
      if (sel) {
        ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.stroke();
        if (!w.generated) for (const q of [w.a, w.b]) { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(this.sx(q[0]), this.sy(q[1]), 6, 0, Math.PI * 2); ctx.fill(); }
      }
      if (!faint && w.outside && w.outer) {
        const m = this.scene.materials.find((x) => x.id === w.outer);
        if (m) {
          const p = this.wallPoly(w);
          const side = w.outside > 0 ? [p[2], p[3]] : [p[0], p[1]];
          // dış yüz: a→b'nin sağı = poly'nin 2-3 kenarı (n'nin tersi)
          ctx.strokeStyle = `rgb(${m.color.map((c) => Math.round(c * 255)).join(" ")})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(this.sx(side[0][0]), this.sy(side[0][1]));
          ctx.lineTo(this.sx(side[1][0]), this.sy(side[1][1]));
          ctx.stroke();
        }
      }
    }
  }

  drawOpenings(level) {
    const ctx = this.ctx, C = this.colors;
    for (const o of level.openings) {
      const w = level.walls.find((x) => x.id === o.wall);
      if (!w) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
      const d = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const n = [-d[1], d[0]];
      const h = w.thickness / 2;
      const a = [w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset];
      const b = [a[0] + d[0] * o.width, a[1] + d[1] * o.width];
      const quad = [[a[0] + n[0] * h, a[1] + n[1] * h], [b[0] + n[0] * h, b[1] + n[1] * h], [b[0] - n[0] * h, b[1] - n[1] * h], [a[0] - n[0] * h, a[1] - n[1] * h]];
      this.path(quad);
      ctx.fillStyle = C.bg1;
      ctx.fill();
      const sel = this.sel && this.sel.type === "opening" && this.sel.id === o.id;
      ctx.strokeStyle = sel ? C.accent : o.kind === "window" ? C.info : C.fg2;
      ctx.lineWidth = sel ? 2 : 1.2;
      if (o.kind === "window") {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(this.sx(a[0]), this.sy(a[1]));
        ctx.lineTo(this.sx(b[0]), this.sy(b[1]));
        ctx.stroke();
      } else {
        // kapı kanadı ve açılım yayı (çift kanatta iki yarım kanat; sürgülü/camlı kapıda kanat yayı yok)
        if (o.style === "surgu" || o.style === "cam") {
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(this.sx(a[0]), this.sy(a[1]));
          ctx.lineTo(this.sx(b[0]), this.sy(b[1]));
          ctx.stroke();
          continue;
        }
        if (o.style === "cift") {
          let side = !o.swing.endsWith("disa") ? -1 : 1;
          if (w.outside) side = !o.swing.endsWith("disa") ? -w.outside : w.outside;
          const rn = [d[1] * side, -d[0] * side];
          const half = o.width / 2;
          for (const [hinge, other] of [[a, [a[0] + d[0] * half, a[1] + d[1] * half]], [b, [b[0] - d[0] * half, b[1] - d[1] * half]]]) {
            const leaf = [hinge[0] + rn[0] * half, hinge[1] + rn[1] * half];
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(this.sx(hinge[0]), this.sy(hinge[1]));
            ctx.lineTo(this.sx(leaf[0]), this.sy(leaf[1]));
            ctx.stroke();
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            const a0 = Math.atan2(other[1] - hinge[1], other[0] - hinge[0]);
            const a1 = Math.atan2(leaf[1] - hinge[1], leaf[0] - hinge[0]);
            let diff = a1 - a0;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            ctx.arc(this.sx(hinge[0]), this.sy(hinge[1]), half * this.view.s, a0, a1, diff < 0);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          continue;
        }
        const right = o.swing.startsWith("sag");
        const inward = !o.swing.endsWith("disa");
        const hinge = right ? b : a;
        const other = right ? a : b;
        let side = inward ? -1 : 1;
        if (w.outside) side = inward ? -w.outside : w.outside;
        const rn = [d[1] * side, -d[0] * side];
        const leaf = [hinge[0] + rn[0] * o.width, hinge[1] + rn[1] * o.width];
        ctx.beginPath();
        ctx.moveTo(this.sx(hinge[0]), this.sy(hinge[1]));
        ctx.lineTo(this.sx(leaf[0]), this.sy(leaf[1]));
        ctx.stroke();
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        const r = o.width * this.view.s;
        const a0 = Math.atan2(other[1] - hinge[1], other[0] - hinge[0]);
        const a1 = Math.atan2(leaf[1] - hinge[1], leaf[0] - hinge[0]);
        let diff = a1 - a0;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        ctx.arc(this.sx(hinge[0]), this.sy(hinge[1]), r, a0, a1, diff < 0);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawPlan() {
    const ctx = this.ctx, C = this.colors, s = this.scene;
    const level = this.levelObj();
    if (!level) return;
    // alt kat silüeti
    if (this.level !== "L0") {
      const g = s.levels.find((l) => l.id === "L0");
      if (g) { ctx.globalAlpha = 0.35; this.drawWalls(g, true); ctx.globalAlpha = 1; }
    }
    for (const r of level.rooms) {
      this.path(r.polygon);
      const sel = this.sel && this.sel.type === "room" && this.sel.id === r.id;
      ctx.fillStyle = sel ? C.accentSoft : C.bg2;
      ctx.fill();
    }
    // plan altlığı
    for (const u of s.underlays || []) {
      if (u.level !== this.level || !u.visible || !u.data) continue;
      const key = `${u.mime}:${u.data.length}:${u.data.slice(-24)}`;
      this.imgs = this.imgs || {};
      if (!this.imgs[key]) { const im = new Image(); im.onload = () => this.draw(); im.src = `data:${u.mime};base64,${u.data}`; this.imgs[key] = im; }
      const im = this.imgs[key];
      if (!im.complete) continue;
      ctx.globalAlpha = Math.max(0.05, Math.min(1, u.opacity || 0.5));
      ctx.drawImage(im, this.sx(u.x), this.sy(u.y), u.width_px * u.mm_per_px * this.view.s, u.height_px * u.mm_per_px * this.view.s);
      ctx.globalAlpha = 1;
    }
    this.drawWalls(level, false);
    this.drawOpenings(level);
    // nesneler
    for (const o of s.objects) {
      if (o.level !== this.level) continue;
      const [w, d] = this.objSize(o);
      const a = (o.rotation * Math.PI) / 180;
      const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [o.position[0] + x * Math.cos(a) - z * Math.sin(a), o.position[1] + x * Math.sin(a) + z * Math.cos(a)]);
      this.path(corners);
      const sel = this.sel && this.sel.type === "object" && this.sel.id === o.id;
      const lamp = o.mesh === "cat:sarkit-lamba";
      ctx.fillStyle = sel ? C.accentSoft : lamp ? "transparent" : C.bg3;
      ctx.fill();
      ctx.strokeStyle = sel ? C.accent : C.fg4;
      ctx.lineWidth = sel ? 2 : 1;
      if (lamp) ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      // ön yüz işareti
      const f = [o.position[0] - (d / 2) * -Math.sin(a), o.position[1] + (d / 2) * Math.cos(a)];
      ctx.fillStyle = sel ? C.accent : C.fg4;
      ctx.beginPath();
      ctx.arc(this.sx(f[0]), this.sy(f[1]), 2, 0, Math.PI * 2);
      ctx.fill();
      if (w * this.view.s > 46 && !lamp) this.label(objectName(o, this.catalog.furniture || []), this.sx(o.position[0]), this.sy(o.position[1]), { size: 10, color: C.fg3 });
    }
    // mahal etiketleri
    for (const r of level.rooms) {
      const c = centroid(r.polygon);
      const area = polyArea(r.polygon) / 1e6;
      this.label(roomName(r, this.catalog.roomKinds || []).toLocaleUpperCase(locale()), this.sx(c[0]), this.sy(c[1]) - 8, { size: 11, weight: 700, color: C.fg1 });
      this.label(`${L("plan.net_m2", { p: fmt(area) })}`, this.sx(c[0]), this.sy(c[1]) + 8, { size: 10, mono: true, color: C.accent });
    }
    // duvar ölçüleri
    if (this.view.s > 0.03) {
      for (const w of level.walls) {
        const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        if (len * this.view.s < 60) continue;
        const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        const txt = w.structural ? `${L("plan.perde_m", { p: fmt(len / 1000, 1) })}` : `${fmt(len / 1000, 2)} m`;
        if (w.generated && !w.structural && !w.exterior) continue;
        this.label(txt, this.sx(m[0]), this.sy(m[1]), { size: 9, mono: true, color: w.structural ? C.bg0 : C.fg3, bg: w.structural ? null : C.bg0 });
      }
    }
    // seçili nesne: boyutlandırma tutamakları ve ölçü etiketi
    if (this.sel && this.sel.type === "object") {
      const o = s.objects.find((x) => x.id === this.sel.id);
      if (o && o.level === this.level) {
        const cs = this.objCorners(o);
        for (const c of cs) {
          ctx.fillStyle = C.bg0;
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(this.sx(c[0]) - 5, this.sy(c[1]) - 5, 10, 10);
          ctx.fill();
          ctx.stroke();
        }
        const [w, d] = this.objSize(o);
        const top = Math.min(...cs.map((c) => this.sy(c[1])));
        this.label(`${fmt(w / 10, 0)} × ${fmt(d / 10, 0)} cm`, this.sx(o.position[0]), top - 14, { mono: true, size: 10, color: C.fg1, bg: C.bg2 });
      }
    }
    // ölçü çizgileri
    const dimLine = (a, b, sel) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) return;
      const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
      ctx.strokeStyle = sel ? C.accent : C.warning;
      ctx.lineWidth = sel ? 2 : 1.2;
      ctx.beginPath();
      ctx.moveTo(this.sx(a[0]), this.sy(a[1]));
      ctx.lineTo(this.sx(b[0]), this.sy(b[1]));
      for (const q of [a, b]) { ctx.moveTo(this.sx(q[0]) - n[0] * 6, this.sy(q[1]) - n[1] * 6); ctx.lineTo(this.sx(q[0]) + n[0] * 6, this.sy(q[1]) + n[1] * 6); }
      ctx.stroke();
      this.label(`${fmt(len / 1000, 2)} m`, this.sx((a[0] + b[0]) / 2), this.sy((a[1] + b[1]) / 2), { mono: true, size: 10, color: C.fg1, bg: C.bg2 });
    };
    for (const d of s.dimensions || []) if (d.level === this.level) dimLine(d.a, d.b, this.sel && this.sel.type === "dimension" && this.sel.id === d.id);
    if (this.tool.type === "measure" && this.hover) {
      const q = this.snap50(this.hover);
      if (this.wallStart) dimLine(this.wallStart, q, true);
      else { ctx.fillStyle = C.warning; ctx.beginPath(); ctx.arc(this.sx(q[0]), this.sy(q[1]), 4, 0, Math.PI * 2); ctx.fill(); }
    }
    // notlar
    (s.notes || []).filter((n) => n.level === this.level).forEach((n, i) => {
      const x = this.sx(n.position[0]), y = this.sy(n.position[1]);
      const sel = this.sel && this.sel.type === "note" && this.sel.id === n.id;
      ctx.fillStyle = sel ? C.accent : C.warning;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      this.label(String(i + 1), x, y, { size: 10, weight: 700, color: C.bg0 });
      this.label(n.text, x + 14, y, { size: 11, align: "left", color: C.fg1, bg: C.bg2 });
    });
    // önizlemeler
    if (this.tool.type === "wall" && this.hover) {
      const p = this.snap(this.hover, this.wallStart);
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.arc(this.sx(p[0]), this.sy(p[1]), 4, 0, Math.PI * 2);
      ctx.fill();
      if (this.wallStart) {
        const a = this.wallStart;
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = Math.max(2, (this.tool.thickness || 100) * this.view.s);
        ctx.beginPath();
        ctx.moveTo(this.sx(a[0]), this.sy(a[1]));
        ctx.lineTo(this.sx(p[0]), this.sy(p[1]));
        ctx.stroke();
        const len = Math.hypot(p[0] - a[0], p[1] - a[1]);
        this.label(`${fmt(len / 1000, 2)} m`, this.sx((a[0] + p[0]) / 2), this.sy((a[1] + p[1]) / 2) - 14, { mono: true, color: C.fg1, bg: C.bg2 });
      }
    }
    if (this.tool.type === "freewall" && this.hover) {
      const st = this.free || {};
      const sn = st.end ? { p: this.hover, kind: "serbest" } : this.freeSnap(this.hover, st.start, this.mods || {});
      const p = this.typedPoint(st.start, sn.p) || sn.p;
      ctx.fillStyle = sn.kind === "uc" ? C.success : sn.kind === "duvar" ? C.info : C.accent;
      ctx.beginPath();
      ctx.arc(this.sx(p[0]), this.sy(p[1]), sn.kind === "uc" ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      const thick = Math.max(2, (this.tool.thickness || 100) * this.view.s);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = thick;
      if (st.start && st.end) {
        const a = st.start, b = st.end, c = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const left = [-(b[1] - a[1]) / c, (b[0] - a[0]) / c];
        const arc = (this.hover[0] - (a[0] + b[0]) / 2) * left[0] + (this.hover[1] - (a[1] + b[1]) / 2) * left[1];
        const w = { a, b, arc: Math.max(-c / 2, Math.min(c / 2, arc)) };
        const pts = centerline(w);
        ctx.beginPath();
        pts.forEach((q, i) => (i ? ctx.lineTo(this.sx(q[0]), this.sy(q[1])) : ctx.moveTo(this.sx(q[0]), this.sy(q[1]))));
        ctx.stroke();
        this.label(`${fmt(wallLength(w) / 1000, 2)} m`, this.sx(this.hover[0]), this.sy(this.hover[1]) - 16, { mono: true, color: C.fg1, bg: C.bg2 });
      } else if (st.start) {
        const a = st.start;
        ctx.beginPath();
        ctx.moveTo(this.sx(a[0]), this.sy(a[1]));
        ctx.lineTo(this.sx(p[0]), this.sy(p[1]));
        ctx.stroke();
        const len = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const deg = ((Math.atan2(-(p[1] - a[1]), p[0] - a[0]) * 180) / Math.PI + 360) % 360;
        const txt = this.typed ? `${this.typed} cm ↵` : `${fmt(len / 1000, 2)} m · ${Math.round(deg)}°`;
        this.label(txt, this.sx((a[0] + p[0]) / 2), this.sy((a[1] + p[1]) / 2) - 16, { mono: true, color: C.fg1, bg: C.bg2 });
      }
    }
    if (this.tool.type === "calib" && this.hover && this.calibStart) {
      const a = this.calibStart, p = this.hover;
      ctx.strokeStyle = C.warning;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(this.sx(a[0]), this.sy(a[1]));
      ctx.lineTo(this.sx(p[0]), this.sy(p[1]));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.tool.type === "furniture" && this.hover) {
      const it = this.catalog.furniture.find((f) => f.id === this.tool.value);
      if (it) {
        const p = this.snap(this.hover);
        ctx.strokeStyle = C.accent;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(this.sx(p[0] - it.size[0] / 2), this.sy(p[1] - it.size[1] / 2), it.size[0] * this.view.s, it.size[1] * this.view.s);
        ctx.setLineDash([]);
      }
    }
  }

  drawModules() {
    const ctx = this.ctx, C = this.colors, s = this.scene;
    const floor = Number(this.level.slice(1)) || 0;
    if (floor > 0) {
      for (const m of s.modules.filter((x) => x.floor === 0)) {
        const r = moduleRect(m, s);
        ctx.strokeStyle = C.lineStrong;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(this.sx(r[0]), this.sy(r[1]), (r[2] - r[0]) * this.view.s, (r[3] - r[1]) * this.view.s);
        ctx.setLineDash([]);
      }
    }
    const level = this.levelObj();
    for (const m of s.modules.filter((x) => x.floor === floor)) {
      const r = moduleRect(m, s);
      const sel = this.sel && this.sel.type === "module" && this.sel.id === m.id;
      ctx.fillStyle = sel ? C.accentSoft : C.bg2;
      ctx.fillRect(this.sx(r[0]), this.sy(r[1]), (r[2] - r[0]) * this.view.s, (r[3] - r[1]) * this.view.s);
      const dragging = this.drag && this.drag.kind === "module" && this.drag.id === m.id;
      if (dragging || !level) {
        // sürüklerken perde önizlemesi
        const base = m.floor > 0 ? s.modules.find((g) => g.id === m.on) || m : m;
        const p = pierMm(base.length);
        ctx.fillStyle = C.fg2;
        const t = 125 * this.view.s;
        const horizontal = !base.rotated;
        for (const y of horizontal ? [r[1], r[3] - 125] : [r[0], r[2] - 125]) {
          for (const [s0, s1] of [[0, p], [base.length * 1000 - p, base.length * 1000]]) {
            if (horizontal) ctx.fillRect(this.sx(r[0] + s0), this.sy(y), (s1 - s0) * this.view.s, t);
            else ctx.fillRect(this.sx(y), this.sy(r[1] + s0), t, (s1 - s0) * this.view.s);
          }
        }
      }
      ctx.strokeStyle = sel ? C.accent : C.lineStrong;
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(this.sx(r[0]), this.sy(r[1]), (r[2] - r[0]) * this.view.s, (r[3] - r[1]) * this.view.s);
      // ön cephe (yeşil çizgi): başka modülle birleşmeyen uzun kenar
      const base = m.floor > 0 ? s.modules.find((g) => g.id === m.on) || m : m;
      const joined = s.modules.some((o) => {
        if (o === m || o.floor !== m.floor) return false;
        const q = moduleRect(o, s);
        return base.rotated ? Math.abs(q[2] - r[0]) < 1 && q[1] < r[3] && q[3] > r[1] : Math.abs(q[3] - r[1]) < 1 && q[0] < r[2] && q[2] > r[0];
      });
      ctx.strokeStyle = joined ? "transparent" : C.success;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (!base.rotated) { ctx.moveTo(this.sx(r[0]), this.sy(r[1]) - 4); ctx.lineTo(this.sx(r[2]), this.sy(r[1]) - 4); }
      else { ctx.moveTo(this.sx(r[0]) - 4, this.sy(r[1])); ctx.lineTo(this.sx(r[0]) - 4, this.sy(r[3])); }
      ctx.stroke();
      const cx = this.sx((r[0] + r[2]) / 2), cy = this.sy((r[1] + r[3]) / 2);
      const len = base.length;
      const open = (len * 1000 - 2 * pierMm(len)) / 1000;
      this.label(`${m.id} · 4 × ${len}`, cx, cy - 9, { size: 13, weight: 700, color: C.fg1 });
      this.label(`${L("plan.m2_orta_aciklik_m", { p: len * 4, p2: fmt(open, 1) })}`, cx, cy + 9, { size: 10, mono: true, color: C.fg3 });
    }
    if (level && !(this.drag && this.drag.kind === "module")) this.drawWalls(level, false);
  }

  toPng() { return this.c.toDataURL("image/png").split(",")[1]; }
}
