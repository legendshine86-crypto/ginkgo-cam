// 명소 근처 카메라 화면을 한 장씩 찍어 out/ 에 저장한다 (GitHub Actions가 몇 분마다 실행)
// 필요한 환경 변수: ITS_KEY(국가교통정보센터 API 키), ENC_KEY(카메라 주소 암호화용 아무 긴 문자열)
// 카메라 주소에는 API 키가 들어 있어서, 공개 폴더에는 암호화한 파일(cams.enc)로만 둔다.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const OUT = process.env.OUT_DIR || "out";
const { ITS_KEY, ENC_KEY } = process.env;
const FFMPEG = process.env.FFMPEG || "ffmpeg";
if (!ITS_KEY || !ENC_KEY) { console.error("ITS_KEY, ENC_KEY 환경 변수가 필요해요"); process.exit(1); }
for (const d of [OUT, `${OUT}/snap`, `${OUT}/thumb`]) mkdirSync(d, { recursive: true });

const spots = JSON.parse(readFileSync(new URL("./spots.json", import.meta.url), "utf8"));
const HOUR = 3600e3;

// ---------- 암호화한 카메라 목록 ----------
const key = createHash("sha256").update(ENC_KEY).digest();
const seal = obj => { const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv); const b = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return Buffer.concat([iv, c.getAuthTag(), b]).toString("base64"); };
const open = txt => { const raw = Buffer.from(txt, "base64"), d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString()); };
let state = { fetchedAt: 0, calls: [], cams: {} };
try { if (existsSync(`${OUT}/cams.enc`)) state = open(readFileSync(`${OUT}/cams.enc`, "utf8")); } catch { console.log("cams.enc를 읽지 못해 새로 받아요"); }

const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };

// 하루 3번, 한 달 90번을 넘지 않게 (개발용 키 월 100번)
function canCall() {
  const now = Date.now();
  state.calls = state.calls.filter(t => now - t < 31 * 24 * HOUR);
  return state.calls.filter(t => now - t < 24 * HOUR).length < 3 && state.calls.length < 90;
}

async function refreshList(reason) {
  if (!canCall()) { console.log(`API 호출 한도 때문에 목록을 새로 받지 않아요 (${reason})`); return false; }
  console.log(`카메라 목록을 새로 받아요: ${reason}`);
  const q = new URLSearchParams({ apiKey: ITS_KEY, type: "its", cctvType: "1", minX: "124.5", maxX: "132.0", minY: "33.0", maxY: "38.7", getType: "json" });
  state.calls.push(Date.now());
  const res = await fetch(`https://openapi.its.go.kr:9443/cctvInfo?${q}`);
  const buf = await res.arrayBuffer();
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("euc-kr").decode(buf); }
  const data = JSON.parse(text)?.response?.data;
  if (!Array.isArray(data)) { console.log("API 응답이 이상해요:", text.slice(0, 200)); return false; }
  const cams = {};
  for (const s of spots) {
    const hits = data.filter(c => (c.cctvname || "").includes(s.camera));
    if (!hits.length) { console.log(`카메라를 못 찾음: ${s.name} ← ${s.camera}`); continue; }
    const c = hits.map(h => ({ h, d: km(s.lat, s.lng, +h.coordy, +h.coordx) })).sort((a, b) => a.d - b.d)[0].h;
    cams[s.id] = { name: c.cctvname, lat: +c.coordy, lng: +c.coordx, url: c.cctvurl };
  }
  state.cams = cams; state.fetchedAt = Date.now();
  return true;
}

// ---------- 화면 찍기 ----------
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

if (!Object.keys(state.cams).length || Date.now() - state.fetchedAt > 12 * HOUR) await refreshList("목록이 없거나 12시간이 지남");

async function captureAll() {
  const results = {};
  await Promise.all(spots.map(async s => { const c = state.cams[s.id]; results[s.id] = c ? await grab(c.url, s.id) : null; }));
  return results;
}
let shots = await captureAll();
const failed = spots.filter(s => state.cams[s.id] && !shots[s.id]);
if (failed.length >= Math.ceil(spots.length / 2) && Date.now() - state.fetchedAt > HOUR) {
  if (await refreshList(`${failed.length}곳 실패, 주소가 만료됐을 수 있음`)) shots = await captureAll();
}

const now = new Date().toISOString();
const out = spots.map(s => {
  const c = state.cams[s.id], shot = shots[s.id], old = prevById[s.id];
  const base = { id: s.id, name: s.name, kind: s.kind, area: s.area, region: s.region, lat: s.lat, lng: s.lng, approx: !!s.approx };
  if (!c) return { ...base, status: "nocam" };
  const camera = { name: c.name.replace(/^\[[^\]]+\]\s*/, ""), road: (c.name.match(/^\[([^\]]+)\]/) || [])[1] || "", lat: c.lat, lng: c.lng, km: Math.round(km(s.lat, s.lng, c.lat, c.lng) * 10) / 10 };
  if (shot) return { ...base, camera, status: "ok", capturedAt: now, dark: shot.brightness < 0.18, snap: `snap/${s.id}.jpg?v=${Date.parse(now)}`, thumb: `thumb/${s.id}.jpg?v=${Date.parse(now)}` };
  if (old?.capturedAt) return { ...base, camera, status: "stale", capturedAt: old.capturedAt, dark: old.dark, snap: old.snap, thumb: old.thumb };
  return { ...base, camera, status: "off" };
});

writeFileSync(`${OUT}/spots.json`, JSON.stringify({ updatedAt: now, source: "국가교통정보센터(ITS) 교통 CCTV", spots: out }), "utf8");
writeFileSync(`${OUT}/cams.enc`, seal(state), "utf8");
writeFileSync(`${OUT}/.nojekyll`, "", "utf8");
console.log(`찍음 ${out.filter(s => s.status === "ok").length} / 이전 화면 유지 ${out.filter(s => s.status === "stale").length} / 실패 ${out.filter(s => s.status === "off" || s.status === "nocam").length}`);
