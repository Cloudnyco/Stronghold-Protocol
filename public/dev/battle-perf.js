// Battle perf page (dev): one real battle in the browser, run the way the match screen runs it — the client-side battle
// runner (js/battle/runner.js: the shared sim at the battle speed) feeding the field view (js/render/app.js) — from a
// BattleSpec captured off a bot match (tools/capture-specs.mjs → /dev/perf/<name>.json). Players can open it on a
// phone and report the numbers ("测量 10 秒" → copyable text); tools/perfbench.mjs drives it headlessly.
//
// Query: ?spec=<name> (default: the first of /dev/perf/index.json) &quality=high|medium|low &panel=0 (hide the panel)
//        &board=2d|3d (render/app.js reads it)
// Puppeteer hook: window.__perf = { ready, error, view, runner, sample(ms) → figures over `ms` of animation frames }

import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { createBattleRunner } from '../js/battle/runner.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const perf = { ready: false, error: null };
window.__perf = perf;

const longTasks = [];
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
} catch { /* not supported */ }

const round = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/**
 * Frame figures over `ms` of animation frames: average fps, frame-time percentiles, the share of frames over 33.4 ms
 * (below 30 fps), long tasks, the sim's ticks and their cost (runner.stats), and the view's own CPU / render times.
 */
perf.sample = (ms = 10000) => new Promise((resolve) => {
  const deltas = [];
  let last = performance.now();
  const t0 = last;
  const r0 = { ...perf.runner.stats() };
  const lt0 = longTasks.length;
  const step = (t) => {
    deltas.push(t - last);
    last = t;
    if (t - t0 < ms) { requestAnimationFrame(step); return; }
    deltas.shift();
    deltas.sort((a, b) => a - b);
    const pick = (p) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))];
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const r1 = perf.runner.stats();
    const v = perf.view.stats();
    const lt = longTasks.slice(lt0);
    const ticks = r1.ticks - r0.ticks;
    resolve({
      fps: round(1000 / avg), p50: round(pick(0.5)), p95: round(pick(0.95)), p99: round(pick(0.99)),
      over33: round((deltas.filter((x) => x > 33.4).length / deltas.length) * 100),
      longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)),
      ticks, simMs: round(r1.stepMs - r0.stepMs), simMsPerTick: ticks > 0 ? round((r1.stepMs - r0.stepMs) / ticks, 3) : null,
      viewCpuMs: v.cpuMs, renderMs: v.renderMs, units: v.units, lod: v.lod, particles: v.particles,
      board: v.board3d?.on ? '3d' : '2d', done: !!perf.runner.state()?.done,
    });
  };
  requestAnimationFrame(step);
});

/** The device line of a report: renderer, screen, cores (what a phone report needs to be comparable). */
function deviceInfo() {
  let gpu = '?';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no WebGL');
  } catch { /* ignore */ }
  return {
    ua: navigator.userAgent, gpu, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
    viewport: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio,
  };
}

function report(spec, quality, s) {
  const d = deviceInfo();
  return [
    `battle-perf · ${spec} · ${quality} · ${s.board} board`,
    `fps ${s.fps} · frame p50 ${s.p50} ms · p95 ${s.p95} ms · p99 ${s.p99} ms · over 33 ms ${s.over33}%`,
    `sim ${s.simMsPerTick} ms/tick (${s.ticks} ticks) · view CPU ${s.viewCpuMs} ms · render ${s.renderMs} ms · units ${s.units} · load level ${s.lod}`,
    `long tasks ${s.longTasks} (${s.longTaskMs} ms)${s.done ? ' · the battle ended during the sample' : ''}`,
    `GPU ${d.gpu} · ${d.cores ?? '?'} cores${d.memoryGB ? ` · ${d.memoryGB} GB` : ''} · viewport ${d.viewport} @${d.dpr}x`,
    d.ua,
  ].join('\n');
}

async function main() {
  const panel = $('panel');
  if (q.get('panel') === '0') panel.classList.add('is-hidden');
  const index = await fetch('/dev/perf/index.json').then((r) => (r.ok ? r.json() : []), () => []);
  const specName = q.get('spec') || index[0]?.name;
  if (!specName) throw new Error('no spec: run node tools/capture-specs.mjs');
  const quality = ['high', 'medium', 'low'].includes(q.get('quality')) ? q.get('quality') : 'high';
  for (const s of index) $('spec').append(new Option(s.title || s.name, s.name));
  $('spec').value = specName;
  $('quality').value = quality;
  const reload = () => {
    const p = new URLSearchParams(location.search);
    p.set('spec', $('spec').value);
    p.set('quality', $('quality').value);
    location.search = p.toString();
  };
  $('restart').onclick = reload;
  $('spec').onchange = reload;
  $('quality').onchange = reload;

  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
  await assets.ready();
  const msg = await fetch(`/dev/perf/${encodeURIComponent(specName)}.json`).then((r) => {
    if (!r.ok) throw new Error(`spec ${specName}: HTTP ${r.status}`);
    return r.json();
  });
  const view = await createFieldView($('field'), { data, assets, settings: { quality, damageNumbers: true } });
  view.setStage(data.lookup('stages', msg.spec.stageId));
  // the runner needs no server here: reports go nowhere, the battle runs from its start
  const net = { on: () => () => {}, send() {}, request: async () => ({ ok: true }) };
  const runner = createBattleRunner({ net, store: null });
  const camKind = msg.kind === 'hidden' ? 'boss' : msg.kind;
  runner.on('field', (field) => { view.enterBattle(field); view.setCamera(camKind, { rect: field.rect, side: 'L', instant: true }); });
  runner.on('snap', (snap) => view.pushSnapshot(snap));
  runner.on('ev', (ev) => view.pushEvents(ev));
  perf.view = view;
  perf.runner = runner;
  await runner.onStart({ ...msg, elapsed: 0, authoritative: true, watch: false, done: false });
  perf.ready = true;

  let prev = { ...runner.stats() };
  setInterval(() => {
    const v = view.stats();
    const r = runner.stats();
    const ticks = r.ticks - prev.ticks;
    const simMs = ticks > 0 ? (r.stepMs - prev.stepMs) / ticks : 0;
    prev = { ...r };
    const st = runner.state();
    $('live').textContent = `fps ${v.fps.toFixed(0)}  frame ${v.frameMs.toFixed(1)} ms  view CPU ${v.cpuMs.toFixed(1)} ms\n`
      + `sim ${simMs.toFixed(2)} ms/tick  units ${v.units}  load level ${v.lod}  ${v.board3d?.on ? '3D' : '2D'} board${st?.done ? '  (battle over)' : ''}`;
  }, 500);

  const btn = $('measure');
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = '测量中…';
    const s = await perf.sample(10000);
    const text = report(specName, quality, s);
    $('out').textContent = text;
    $('out').hidden = false;
    $('copy').hidden = false;
    $('copy').onclick = () => {
      navigator.clipboard?.writeText(text).then(() => { $('copy').textContent = '已复制'; }, () => {
        const range = document.createRange(); range.selectNodeContents($('out'));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      });
    };
    btn.textContent = '再测 10 秒';
    btn.disabled = false;
  };
}

main().catch((err) => {
  perf.error = String(err?.stack || err);
  console.error(err);
  const live = document.getElementById('live');
  if (live) live.textContent = `出错了：${err?.message || err}`;
});
