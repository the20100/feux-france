'use client';
import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type {Galaxy} from './types';

export type SceneMode = 'galaxy' | 'hemicycle';
type Props = {
  data: Galaxy;
  mode: SceneMode;
  period: number;          // -1 = whole legislature
  selected: number | null;
  compare: number | null;
  ballots: string | null;  // key vote ballots for hemicycle colouring
  highlightGroup: string | null;
  showLinks: boolean;
  autoRotate: boolean;
  onPick: (i: number | null) => void;
  onHover: (i: number | null, x: number, y: number) => void;
};

const BALLOT: Record<string, string> = {p: '#5fd38d', c: '#ef5b5b', a: '#e8c25a', '-': '#3a4540'};

/** Seats of a 3D hemicycle: deputies ordered left→right by group centroid, then by seat number. */
export function hemicycleLayout(data: Galaxy) {
  const order = data.groups.map(g => g.id);
  const idx = data.deputies.map((_, i) => i).sort((a, b) => {
    const A = data.deputies[a], B = data.deputies[b];
    return order.indexOf(A.group) - order.indexOf(B.group) || (A.seat || 999) - (B.seat || 999);
  });
  const rows = 12, n = idx.length, r0 = 95, dr = 17;
  const lens = Array.from({length: rows}, (_, k) => r0 + k * dr);
  const total = lens.reduce((s, x) => s + x, 0);
  const perRow = lens.map(l => Math.round((l / total) * n));
  perRow[rows - 1] += n - perRow.reduce((s, x) => s + x, 0);
  // assign seats by angle across all rows so groups form wedges
  const seats: {a: number; r: number; k: number}[] = [];
  perRow.forEach((c, k) => { for (let s = 0; s < c; s++) seats.push({a: Math.PI * (1 - (s + 0.5) / c), r: lens[k], k}); });
  seats.sort((x, y) => y.a - x.a || x.r - y.r);
  const out: [number, number, number][] = new Array(n);
  idx.forEach((dep, s) => { const t = seats[s]; out[dep] = [Math.cos(t.a) * t.r, t.k * 7 - 30, -Math.sin(t.a) * t.r + 150]; });
  return out;
}

export default function Scene3D(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{update: (p: Props) => void} | null>(null);
  const props = useRef(p); props.current = p;

  useEffect(() => {
    const el = host.current!;
    const {data} = props.current;
    const N = data.deputies.length;
    const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor('#070b0a');
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#070b0a', 0.0011);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
    camera.position.set(0, 120, 560);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06; controls.autoRotateSpeed = 0.45;
    controls.minDistance = 60; controls.maxDistance = 1400;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.12);
    composer.addPass(bloom);

    // starfield backdrop
    {
      const g = new THREE.BufferGeometry(), a = new Float32Array(3000 * 3);
      for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 3200;
      g.setAttribute('position', new THREE.BufferAttribute(a, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({color: '#3d4a44', size: 1.4, sizeAttenuation: false})));
    }
    scene.add(new THREE.AmbientLight('#ffffff', 0.55));
    const key = new THREE.PointLight('#ffffff', 2.2, 0, 0); key.position.set(200, 400, 300); scene.add(key);

    // deputies
    const geo = new THREE.SphereGeometry(1, 18, 14);
    const mat = new THREE.MeshStandardMaterial({roughness: 0.35, metalness: 0.1, emissiveIntensity: 1});
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    const groupColor = new Map(data.groups.map(g => [g.id, new THREE.Color(g.color)]));
    const galaxyPos = (period: number) => data.deputies.map((d, i) => {
      const q = period >= 0 ? data.periods[period]?.positions[i] : null;
      return (q || d.pos || data.groups.find(g => g.id === d.group)!.centroid) as [number, number, number];
    });
    const hemi = hemicycleLayout(data);
    let target = galaxyPos(-1).map(v => new THREE.Vector3(...v));
    const cur = target.map(v => v.clone());
    const scale = new Float32Array(N).fill(4);
    const tgtScale = new Float32Array(N).fill(4);

    // group labels + halos
    const labels: {sprite: THREE.Sprite; id: string}[] = [];
    for (const g of data.groups) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const x = c.getContext('2d')!; x.font = '600 30px Avenir Next, Avenir, sans-serif'; x.fillStyle = g.color; x.textAlign = 'center';
      x.shadowColor = '#000'; x.shadowBlur = 8; x.fillText(g.id, 128, 42);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.85}));
      s.scale.set(64, 16, 1); scene.add(s); labels.push({sprite: s, id: g.id});
    }

    // links: nearest neighbours (+ cross-group bridges)
    const links: [number, number, boolean][] = [];
    data.deputies.forEach((d, i) => {
      d.near.slice(0, 3).forEach(([j]) => { if (i < j || !data.deputies[j].near.some(([k]) => k === i)) links.push([i, j, false]); });
      if (d.bridge && d.bridge[1] > 0.88 && data.deputies[d.bridge[0]].group !== d.group) links.push([i, d.bridge[0], true]);
    });
    const lgeo = new THREE.BufferGeometry();
    const lpos = new Float32Array(links.length * 6), lcol = new Float32Array(links.length * 6);
    lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
    lgeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3));
    const lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false}));
    scene.add(lines);
    const gold = new THREE.Color('#ffd27a');
    links.forEach(([i, j, bridge], k) => {
      const a = bridge ? gold : groupColor.get(data.deputies[i].group)!, b = bridge ? gold : groupColor.get(data.deputies[j].group)!;
      lcol.set([a.r, a.g, a.b, b.r, b.g, b.b], k * 6);
    });

    // selection ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.7, 8, 48), new THREE.MeshBasicMaterial({color: '#ffffff'}));
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(9, 0.7, 8, 48), new THREE.MeshBasicMaterial({color: '#ffd27a'}));
    scene.add(ring, ring2);
    const tie = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({color: '#ffd27a', dashSize: 6, gapSize: 4}));
    scene.add(tie);

    let camGoal: THREE.Vector3 | null = null, lookGoal: THREE.Vector3 | null = null;
    let lastMode: SceneMode | null = null, lastPeriod = -1;
    const color = new THREE.Color();

    function update(q: Props) {
      const modeChanged = q.mode !== lastMode;
      if (q.mode === 'hemicycle') target = hemi.map(v => new THREE.Vector3(...v));
      else if (modeChanged || q.period !== lastPeriod) target = galaxyPos(q.period).map(v => new THREE.Vector3(...v));
      if (modeChanged) {
        // fit the whole arc (~600 wide) whatever the stage aspect ratio
        const fit = Math.max(560, 760 / Math.max(camera.aspect, 0.3));
        camGoal = q.mode === 'hemicycle' ? new THREE.Vector3(0, fit * 0.8, fit * 0.58) : new THREE.Vector3(0, 120, Math.max(560, 900 / Math.max(camera.aspect, 0.3)));
        lookGoal = new THREE.Vector3(0, q.mode === 'hemicycle' ? -10 : 0, 0);
      }
      lastMode = q.mode; lastPeriod = q.period;
      const sel = q.selected, cmp = q.compare;
      const nearSet = new Set(sel != null ? data.deputies[sel].near.map(([j]) => j) : []);
      data.deputies.forEach((d, i) => {
        let c: THREE.Color = groupColor.get(d.group)!;
        if (q.mode === 'hemicycle' && q.ballots) c = color.set(BALLOT[q.ballots[i]] || BALLOT['-']).clone();
        let dim = false;
        if (q.highlightGroup && d.group !== q.highlightGroup) dim = true;
        if (q.mode === 'galaxy' && sel != null && i !== sel && i !== cmp && !nearSet.has(i)) dim = true;
        const out = dim ? c.clone().multiplyScalar(0.18) : c;
        mesh.setColorAt(i, out);
        const base = q.mode === 'hemicycle' ? 4.6 : 2.6 + (d.participation || 0) * 9;
        tgtScale[i] = i === sel || i === cmp ? base * 1.8 : base;
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mat.emissive.set('#000');
      lines.visible = q.mode === 'galaxy' && q.showLinks;
      labels.forEach(l => (l.sprite.visible = q.mode === 'galaxy'));
      ring.visible = sel != null; ring2.visible = cmp != null; tie.visible = sel != null && cmp != null;
      controls.autoRotate = q.autoRotate && q.mode === 'galaxy';
      if (sel != null && q.mode === 'galaxy') {
        const t = target[sel];
        lookGoal = t.clone();
        camGoal = t.clone().add(camera.position.clone().sub(controls.target).setLength(260));
      }
    }
    api.current = {update};
    camera.aspect = Math.max(el.clientWidth, 1) / Math.max(el.clientHeight, 1);
    update(props.current);

    // interaction
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let down = {x: 0, y: 0};
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObject(mesh)[0];
      return hit?.instanceId ?? null;
    };
    const onMove = (e: PointerEvent) => { const i = pick(e); renderer.domElement.style.cursor = i != null ? 'pointer' : 'grab'; props.current.onHover(i, e.clientX, e.clientY); };
    const onDown = (e: PointerEvent) => { down = {x: e.clientX, y: e.clientY}; };
    const onUp = (e: PointerEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) props.current.onPick(pick(e)); };
    const onLeave = () => props.current.onHover(null, 0, 0);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    controls.addEventListener('start', () => { camGoal = null; lookGoal = null; });

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sv = new THREE.Vector3();
    let raf = 0, t0 = performance.now(), last = t0;
    const ease = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 60);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.5); last = now;
      const t = (now - t0) / 1000;
      const q = props.current;
      for (let i = 0; i < N; i++) {
        cur[i].lerp(target[i], ease(q.mode === 'hemicycle' ? 0.05 + (i % 17) * 0.002 : 0.05, dt));
        scale[i] += (tgtScale[i] - scale[i]) * ease(0.15, dt);
        const pulse = i === q.selected ? 1 + Math.sin(t * 4) * 0.12 : 1;
        m4.compose(cur[i], qt, sv.setScalar(scale[i] * pulse));
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (lines.visible) {
        links.forEach(([i, j], k) => { const a = cur[i], b = cur[j]; lpos.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6); });
        lgeo.attributes.position.needsUpdate = true;
      }
      // labels float above live group centroids
      for (const l of labels) {
        let x = 0, y = 0, z = 0, n = 0;
        data.deputies.forEach((d, i) => { if (d.group === l.id) { x += cur[i].x; y += cur[i].y; z += cur[i].z; n++; } });
        if (n) l.sprite.position.set(x / n, y / n + 26, z / n);
        (l.sprite.material as THREE.SpriteMaterial).opacity = q.highlightGroup && q.highlightGroup !== l.id ? 0.2 : 0.9;
      }
      for (const [r, i] of [[ring, q.selected], [ring2, q.compare]] as const) if (i != null) { r.position.copy(cur[i]); r.lookAt(camera.position); r.scale.setScalar(scale[i] / 3.2 + Math.sin(t * 3) * 0.08); }
      if (q.selected != null && q.compare != null) { tie.geometry.setFromPoints([cur[q.selected], cur[q.compare]]); tie.computeLineDistances(); }
      if (camGoal) { camera.position.lerp(camGoal, ease(0.05, dt)); if (camera.position.distanceTo(camGoal) < 1) camGoal = null; }
      if (lookGoal) { controls.target.lerp(lookGoal, ease(0.08, dt)); if (controls.target.distanceTo(lookGoal) < 0.5) lookGoal = null; }
      controls.update();
      composer.render();
    };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); composer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [p.data]);

  useEffect(() => { api.current?.update(p); }, [p.mode, p.period, p.selected, p.compare, p.ballots, p.highlightGroup, p.showLinks, p.autoRotate]);

  return <div ref={host} className="parl-scene" />;
}
