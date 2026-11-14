// 명소 근처 카메라 화면을 찍어 out/ 에 저장한다 (GitHub Actions가 몇 분마다 실행)
// 카메라 주소는 비밀값 CAMS로 받아요 (명소마다 근처 후보 여러 대). ITS API가 해외에서 막혀 있어서
// 주소는 국내 PC가 tools/refresh-cams.mjs로 넣어 줘요. 주소에는 API 키가 들어 있어 공개 파일에 쓰지 않아요.
//
// 어떤 카메라를 보여줄지: 낮(오전 10시~오후 4시)에 하루 한 번 후보를 모두 찍고,
// 은행잎 색(노란색)이 많이 보이는 화면을 골라요. 멀수록 조금씩 감점해요. 고른 카메라는 다음 날까지 유지해요.
// 앱은 물들었는지 판단하지 않아요. 어떤 화면을 보여줄지 고를 때만 색을 써요.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawn } from "node:child_process";

const OUT = process.env.OUT_DIR || "out", WORK = "work";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
let feed;
try { feed = JSON.parse(process.env.CAMS || ""); } catch { console.error("비밀값 CAMS가 없어요. PC에서 node tools/refresh-cams.mjs를 실행해 주세요"); process.exit(1); }
for (const d of [OUT, `${OUT}/snap`, `${OUT}/thumb`, WORK]) mkdirSync(d, { recursive: true });

const spots = JSON.parse(readFileSync(new URL("./spots.json", import.meta.url), "utf8"));
const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
const kst = new Date(Date.now() + 9 * 36e5);
const today = kst.toISOString().slice(0, 10), hour = kst.getUTCHours();
const TRIAL = process.env.FORCE_DAY === "1"; // 점검용: 밤에도 고르기를 돌려 보되 결과는 저장하지 않아요
const DAYTIME = TRIAL || (hour >= 10 && hour < 16);

// ---------- 찍기 ----------
const W = 96, H = 64;
function analyze(buf) {
  let y = 0, sum = 0, n = 0;
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const r = buf[i] / 255, g = buf[i + 1] / 255, b = buf[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    n++; sum += (r + g + b) / 3;
    if (max < 0.4 || d === 0 || d / max < 0.45) continue;
    let h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h >= 38 && h <= 62) y++;
  }
  return { yellow: y / n, brightness: sum / n };
}
function grab(url, key) {
  return new Promise(resolve => {
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-rw_timeout", "10000000", "-i", url,
      "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", "-update", "1", "-y", `${WORK}/${key}.jpg`,
      "-frames:v", "1", "-vf", "scale=400:-2", "-q:v", "6", "-update", "1", "-y", `${WORK}/${key}.t.jpg`,
      "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    const chunks = []; p.stdout.on("data", d => chunks.push(d));
    const t = setTimeout(() => p.kill("SIGKILL"), 25000);
    p.on("close", () => { clearTimeout(t); const b = Buffer.concat(chunks); resolve(b.length >= W * H * 3 ? analyze(b) : null); });
    p.on("error", () => { clearTimeout(t); resolve(null); });
  });
}
async function pool(jobs, size = 8) {
  const out = new Array(jobs.length); let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); } }));
  return out;
}

// ---------- 이전 상태 ----------
const prev = existsSync(`${OUT}/spots.json`) ? JSON.parse(readFileSync(`${OUT}/spots.json`, "utf8")) : { spots: [] };
const prevById = Object.fromEntries((prev.spots || []).map(s => [s.id, s]));
const picks = existsSync(`${OUT}/pick.json`) ? JSON.parse(readFileSync(`${OUT}/pick.json`, "utf8")) : {};

// 오늘 낮에 아직 안 골랐거나, 고른 카메라가 후보에서 빠졌으면 후보를 모두 찍어요
const plan = spots.map(s => {
  const raw = feed.cams[s.id];
  const cands = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c, i) => ({ ...c, i, km: km(s.lat, s.lng, c.lat, c.lng) }));
  const pick = picks[s.id];
  const current = cands.find(c => c.name === pick?.name) || cands.find(c => c.name.includes(s.camera)) || cands[0];
  const scanAll = DAYTIME && (!pick || pick.day !== today || !cands.some(c => c.name === pick.name));
  return { s, cands, current, scanAll };
});

// 1차: 전체 후보를 찍어야 하는 명소는 전부, 나머지는 지금 카메라만
const first = plan.flatMap(p => (p.scanAll ? p.cands : p.current ? [p.current] : []).map(c => ({ p, c })));
const res1 = await pool(first.map(({ p, c }) => () => grab(c.url, `${p.s.id}-${c.i}`)));
const shot = new Map(); first.forEach(({ p, c }, k) => shot.set(`${p.s.id}-${c.i}`, res1[k]));
// 2차: 지금 카메라가 실패한 명소는 나머지 후보를 찍어 대신 보여줘요
const second = plan.filter(p => !p.scanAll && p.current && !shot.get(`${p.s.id}-${p.current.i}`))
  .flatMap(p => p.cands.filter(c => c.i !== p.current.i).map(c => ({ p, c })));
const res2 = await pool(second.map(({ p, c }) => () => grab(c.url, `${p.s.id}-${c.i}`)));
second.forEach(({ p, c }, k) => shot.set(`${p.s.id}-${c.i}`, res2[k]));

// ---------- 고르기 ----------
const score = c => c.r.yellow * 100 - 0.5 * c.km; // 노란색 1%p ≈ 2km
const now = new Date().toISOString(), v = Date.parse(now);
const out = plan.map(({ s, cands, current, scanAll }) => {
  const base = { id: s.id, name: s.name, kind: s.kind, area: s.area, region: s.region, lat: s.lat, lng: s.lng, approx: !!s.approx, candidates: cands.length };
  if (!cands.length) return { ...base, status: "nocam" };
  const ok = cands.map(c => ({ ...c, r: shot.get(`${s.id}-${c.i}`) })).filter(c => c.r);
  let chosen, pickedBy = picks[s.id]?.by || "nearest";
  if (scanAll && ok.length) {
    chosen = [...ok].sort((a, b) => score(b) - score(a))[0];
    pickedBy = chosen.r.yellow >= 0.02 ? "color" : "nearest";
    if (pickedBy === "nearest") chosen = [...ok].sort((a, b) => a.km - b.km)[0]; // 노란 화면이 없으면 가장 가까운 화면
    picks[s.id] = { name: chosen.name, day: today, by: pickedBy };
  } else {
    chosen = ok.find(c => c.i === current?.i) || [...ok].sort((a, b) => a.km - b.km)[0];
    if (chosen && chosen.name !== picks[s.id]?.name) pickedBy = "nearest"; // 고른 카메라가 끊겨 대신 보여주는 중
  }
  const old = prevById[s.id];
  if (!chosen) {
    if (old?.capturedAt) return { ...base, camera: old.camera, pickedBy: old.pickedBy, status: "stale", capturedAt: old.capturedAt, snap: old.snap, thumb: old.thumb };
    return { ...base, status: "off" };
  }
  copyFileSync(`${WORK}/${s.id}-${chosen.i}.jpg`, `${OUT}/snap/${s.id}.jpg`);
  copyFileSync(`${WORK}/${s.id}-${chosen.i}.t.jpg`, `${OUT}/thumb/${s.id}.jpg`);
  const camera = { name: chosen.name.replace(/^\[[^\]]+\]\s*/, ""), road: (chosen.name.match(/^\[([^\]]+)\]/) || [])[1] || "", lat: chosen.lat, lng: chosen.lng, km: Math.round(chosen.km * 10) / 10 };
  return { ...base, camera, pickedBy, status: "ok", capturedAt: now, dark: chosen.r.brightness < 0.12, snap: `snap/${s.id}.jpg?v=${v}`, thumb: `thumb/${s.id}.jpg?v=${v}` };
});

if (!TRIAL) writeFileSync(`${OUT}/pick.json`, JSON.stringify(picks), "utf8");
writeFileSync(`${OUT}/spots.json`, JSON.stringify({ updatedAt: now, camsFetchedAt: feed.fetchedAt, source: "국가교통정보센터(ITS) 교통 CCTV", spots: out }), "utf8");
writeFileSync(`${OUT}/.nojekyll`, "", "utf8");
const okCount = out.filter(s => s.status === "ok").length;
console.log(`찍은 카메라 ${shot.size}대 (${DAYTIME ? "낮, 고르기 가능" : "밤, 고른 카메라 유지"}) / 명소 ${okCount}곳 새 화면 / 이전 화면 유지 ${out.filter(s => s.status === "stale").length} / 실패 ${out.filter(s => s.status === "off" || s.status === "nocam").length}`);
for (const o of out) if (o.camera) console.log(`  ${o.name} ← ${o.camera.name} ${o.camera.km}km (${o.pickedBy === "color" ? "색으로 고름" : "가까운 화면"})`);
if (okCount === 0) console.log("::warning::한 곳도 찍지 못했어요. 카메라 주소가 만료됐을 수 있어요. PC에서 node tools/refresh-cams.mjs를 실행해 주세요");
