// 명소 근처 카메라 화면을 한 장씩 찍어 out/ 에 저장한다 (GitHub Actions가 몇 분마다 실행)
// 카메라 주소는 비밀값 CAMS로 받아요. ITS API가 해외에서 막혀 있어서, 주소는 국내 PC가
// tools/refresh-cams.mjs로 받아 넣어 줘요. 주소에는 API 키가 들어 있어서 공개 파일에는 절대 쓰지 않아요.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const OUT = process.env.OUT_DIR || "out";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
let feed;
try { feed = JSON.parse(process.env.CAMS || ""); } catch { console.error("비밀값 CAMS가 없어요. PC에서 node tools/refresh-cams.mjs를 실행해 주세요"); process.exit(1); }
for (const d of [OUT, `${OUT}/snap`, `${OUT}/thumb`]) mkdirSync(d, { recursive: true });

const spots = JSON.parse(readFileSync(new URL("./spots.json", import.meta.url), "utf8"));
const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };

function grab(url, id) {
  return new Promise(resolve => {
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-rw_timeout", "10000000", "-i", url,
      "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", "-update", "1", "-y", `${OUT}/snap/${id}.jpg`,
      "-frames:v", "1", "-vf", "scale=400:-2", "-q:v", "6", "-update", "1", "-y", `${OUT}/thumb/${id}.jpg`,
      "-frames:v", "1", "-vf", "scale=48:32", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
    const chunks = []; p.stdout.on("data", d => chunks.push(d));
    const t = setTimeout(() => p.kill("SIGKILL"), 25000);
    p.on("close", () => {
      clearTimeout(t);
      const b = Buffer.concat(chunks);
      if (b.length < 48 * 32) return resolve(null);
      let sum = 0; for (const v of b) sum += v;
      resolve({ brightness: sum / b.length / 255 });
    });
    p.on("error", () => { clearTimeout(t); resolve(null); });
  });
}

const prev = existsSync(`${OUT}/spots.json`) ? JSON.parse(readFileSync(`${OUT}/spots.json`, "utf8")) : { spots: [] };
const prevById = Object.fromEntries((prev.spots || []).map(s => [s.id, s]));

const shots = {};
await Promise.all(spots.map(async s => {
  const c = feed.cams[s.id];
  if (!c) return;
  shots[s.id] = await grab(c.url, s.id);
  if (!shots[s.id]) { await new Promise(r => setTimeout(r, 1500)); shots[s.id] = await grab(c.url, s.id); }
}));

const now = new Date().toISOString(), v = Date.parse(now);
const out = spots.map(s => {
  const c = feed.cams[s.id], shot = shots[s.id], old = prevById[s.id];
  const base = { id: s.id, name: s.name, kind: s.kind, area: s.area, region: s.region, lat: s.lat, lng: s.lng, approx: !!s.approx };
  if (!c) return { ...base, status: "nocam" };
  const camera = { name: c.name.replace(/^\[[^\]]+\]\s*/, ""), road: (c.name.match(/^\[([^\]]+)\]/) || [])[1] || "", lat: c.lat, lng: c.lng, km: Math.round(km(s.lat, s.lng, c.lat, c.lng) * 10) / 10 };
  if (shot) return { ...base, camera, status: "ok", capturedAt: now, dark: shot.brightness < 0.18, snap: `snap/${s.id}.jpg?v=${v}`, thumb: `thumb/${s.id}.jpg?v=${v}` };
  if (old?.capturedAt) return { ...base, camera, status: "stale", capturedAt: old.capturedAt, dark: old.dark, snap: old.snap, thumb: old.thumb };
  return { ...base, camera, status: "off" };
});

const okCount = out.filter(s => s.status === "ok").length;
writeFileSync(`${OUT}/spots.json`, JSON.stringify({ updatedAt: now, camsFetchedAt: feed.fetchedAt, source: "국가교통정보센터(ITS) 교통 CCTV", spots: out }), "utf8");
writeFileSync(`${OUT}/.nojekyll`, "", "utf8");
console.log(`찍음 ${okCount} / 이전 화면 유지 ${out.filter(s => s.status === "stale").length} / 실패 ${out.filter(s => s.status === "off" || s.status === "nocam").length} (주소 받은 시각 ${feed.fetchedAt})`);
if (okCount === 0) console.log("::warning::한 곳도 찍지 못했어요. 카메라 주소가 만료됐을 수 있어요. PC에서 node tools/refresh-cams.mjs를 실행해 주세요");
