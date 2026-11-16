// AWS Lambda(서울 리전)에서 5분마다 실행: 화면 찍기 + 고르기 + S3에 올리기
// - ITS API는 클라우드 IP에서 막혀 있어서, 카메라 주소는 국내 PC(tools/refresh-cams.mjs)가 state/cams.json에 넣어 줘요
// - 카메라 주소에는 API 키가 들어 있어서 S3의 비공개 경로(state/)에만 둬요
// - 어떤 카메라를 보여줄지: 낮(10~16시)에 하루 한 번 후보를 모두 찍고 노란 잎이 많이 보이는 화면을 골라요
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, accessSync, constants } from "node:fs";

const { BUCKET } = process.env;
const s3 = new S3Client({});
const WORK = "/tmp/work";
const SPOTS = JSON.parse(readFileSync(new URL("./spots.json", import.meta.url), "utf8"));
const HOUR = 36e5, DAY = 24 * HOUR;
const SCAN_PER_RUN = 12;

// zip에 실행 권한이 빠질 수 있어 /tmp로 복사해 권한을 줘요
function ffmpegPath() {
  const src = new URL("./bin/ffmpeg", import.meta.url).pathname;
  try { accessSync(src, constants.X_OK); return src; } catch { /* 아래에서 복사 */ }
  const dst = "/tmp/ffmpeg";
  if (!existsSync(dst)) { copyFileSync(src, dst); chmodSync(dst, 0o755); }
  return dst;
}

// ---------- S3 ----------
async function getJson(key, fallback) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return JSON.parse(await r.Body.transformToString());
  } catch { return fallback; }
}
const putJson = (key, obj, cache = "no-cache, max-age=0") =>
  s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(obj), ContentType: "application/json; charset=utf-8", CacheControl: cache }));
const putJpg = (key, file) =>
  s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(file), ContentType: "image/jpeg", CacheControl: "public, max-age=60" }));

const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };

// ---------- 화면 찍기 ----------
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
function grab(ff, url, key) {
  return new Promise(resolve => {
    const p = spawn(ff, ["-hide_banner", "-loglevel", "error", "-rw_timeout", "10000000", "-i", url,
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

// 점검용: { "diag": true }로 실행하면 어디까지 접속되는지 확인해요
async function diag() {
  const { connect } = await import("node:net");
  const tcp = (host, port) => new Promise(res => {
    const s = connect({ host, port, timeout: 8000 }, () => { s.destroy(); res("연결됨"); });
    s.on("timeout", () => { s.destroy(); res("시간 초과"); });
    s.on("error", e => res(`오류 ${e.code}`));
  });
  const ip = await fetch("https://checkip.amazonaws.com", { signal: AbortSignal.timeout(5000) }).then(r => r.text()).catch(e => e.message);
  const out = { lambdaIp: ip.trim() };
  for (const [h, p] of [["openapi.its.go.kr", 9443], ["openapi.its.go.kr", 443], ["www.its.go.kr", 443], ["cctvsec.ktict.co.kr", 80], ["cctvsec.ktict.co.kr", 8081]]) out[`${h}:${p}`] = await tcp(h, p);
  console.log(JSON.stringify(out));
  return out;
}

export async function handler(event = {}) {
  if (event.diag) return diag();
  mkdirSync(WORK, { recursive: true });
  const ff = ffmpegPath();
  const kst = new Date(Date.now() + 9 * HOUR);
  const today = kst.toISOString().slice(0, 10), hour = kst.getUTCHours();
  const TRIAL = event.forceDay === true; // 점검용: 밤에도 고르기를 돌려 보되 결과는 저장하지 않아요
  const DAYTIME = TRIAL || (hour >= 10 && hour < 16);

  const state = await getJson("state/cams.json", { cams: {}, calls: [] });
  const picks = await getJson("state/pick.json", {});
  const prev = await getJson("spots.json", { spots: [] });
  const prevById = Object.fromEntries((prev.spots || []).map(s => [s.id, s]));

  // ITS는 클라우드(AWS 포함) IP에서 접속이 막혀 있어서, 주소는 국내 PC가 state/cams.json에 넣어 줘요
  if (!state.fetchedAt) { console.log("state/cams.json이 없어요. PC에서 node tools/refresh-cams.mjs를 실행해 주세요"); return "no cams"; }

  // 명소 목록은 PC가 cams.json에 같이 넣어 줘요 (없으면 함께 묶인 spots.json)
  const LIST = Array.isArray(state.spots) && state.spots.length ? state.spots : SPOTS;
  const makePlan = () => LIST.map(s => {
    const cands = (state.cams[s.id] || []).map((c, i) => ({ ...c, i, km: km(s.lat, s.lng, c.lat, c.lng) }));
    const pick = picks[s.id];
    const current = cands.find(c => c.name === pick?.name) || (s.camera && cands.find(c => c.name.includes(s.camera))) || cands[0];
    const scanAll = DAYTIME && (!pick || pick.day !== today || !cands.some(c => c.name === pick.name));
    return { s, cands, current, scanAll };
  });
  const shoot = async plan => {
    const shot = new Map();
    const first = plan.flatMap(p => (p.scanAll ? p.cands : p.current ? [p.current] : []).map(c => ({ p, c })));
    (await pool(first.map(({ p, c }) => () => grab(ff, c.url, `${p.s.id}-${c.i}`)))).forEach((r, k) => shot.set(`${first[k].p.s.id}-${first[k].c.i}`, r));
    const second = plan.filter(p => !p.scanAll && p.current && !shot.get(`${p.s.id}-${p.current.i}`))
      .flatMap(p => p.cands.filter(c => c.i !== p.current.i).map(c => ({ p, c })));
    (await pool(second.map(({ p, c }) => () => grab(ff, c.url, `${p.s.id}-${c.i}`)))).forEach((r, k) => shot.set(`${second[k].p.s.id}-${second[k].c.i}`, r));
    return shot;
  };

  // 명소가 많아져서 한 번에 후보를 다 훑으면 시간이 모자라요. 한 번에 SCAN_PER_RUN곳씩, 나머지는 다음 차례(5분 뒤)에 훑어요
  const plan = makePlan();
  let budget = SCAN_PER_RUN;
  for (const p of [...plan].sort((a, b) => !!picks[a.s.id] - !!picks[b.s.id])) if (p.scanAll && budget-- <= 0) p.scanAll = false;
  const shot = await shoot(plan);

  // ---------- 고르기 ----------
  const score = c => c.r.yellow * 100 - 0.5 * c.km; // 노란색 1%p ≈ 2km
  const now = new Date().toISOString(), v = Date.parse(now);
  const uploads = [];
  const out = plan.map(({ s, cands, current, scanAll }) => {
    const base = { id: s.id, name: s.name, kind: s.kind, area: s.area, region: s.region, lat: s.lat, lng: s.lng, approx: !!s.approx, candidates: cands.length };
    if (!cands.length) return { ...base, status: "nocam" };
    const ok = cands.map(c => ({ ...c, r: shot.get(`${s.id}-${c.i}`) })).filter(c => c.r);
    let chosen, pickedBy = picks[s.id]?.by || "nearest";
    if (scanAll && ok.length) {
      chosen = [...ok].sort((a, b) => score(b) - score(a))[0];
      pickedBy = chosen.r.yellow >= 0.02 ? "color" : "nearest";
      if (pickedBy === "nearest") chosen = [...ok].sort((a, b) => a.km - b.km)[0];
      if (!TRIAL) picks[s.id] = { name: chosen.name, day: today, by: pickedBy };
    } else {
      chosen = ok.find(c => c.i === current?.i) || [...ok].sort((a, b) => a.km - b.km)[0];
      if (chosen && chosen.name !== picks[s.id]?.name) pickedBy = "nearest";
    }
    const old = prevById[s.id];
    if (!chosen) {
      if (old?.capturedAt) return { ...base, camera: old.camera, pickedBy: old.pickedBy, status: "stale", capturedAt: old.capturedAt, snap: old.snap, thumb: old.thumb };
      return { ...base, status: "off" };
    }
    uploads.push(putJpg(`snap/${s.id}.jpg`, `${WORK}/${s.id}-${chosen.i}.jpg`), putJpg(`thumb/${s.id}.jpg`, `${WORK}/${s.id}-${chosen.i}.t.jpg`));
    const camera = { name: chosen.name.replace(/^\[[^\]]+\]\s*/, ""), road: (chosen.name.match(/^\[([^\]]+)\]/) || [])[1] || "", lat: chosen.lat, lng: chosen.lng, km: Math.round(chosen.km * 10) / 10, src: chosen.src || "its" };
    return { ...base, camera, pickedBy, status: "ok", capturedAt: now, dark: chosen.r.brightness < 0.12, snap: `snap/${s.id}.jpg?v=${v}`, thumb: `thumb/${s.id}.jpg?v=${v}` };
  });

  await Promise.all(uploads); // 사진을 먼저 올리고 목록을 바꿔요
  await putJson("spots.json", { updatedAt: now, camsFetchedAt: state.fetchedAt, source: "국가교통정보센터(ITS)·경찰청 도시교통정보센터(UTIC) 교통 CCTV", spots: out });
  if (!TRIAL) await putJson("state/pick.json", picks);

  const summary = `찍은 카메라 ${shot.size}대 (${DAYTIME ? "낮" : "밤"}) / 새 화면 ${out.filter(s => s.status === "ok").length} / 이전 화면 ${out.filter(s => s.status === "stale").length} / 실패 ${out.filter(s => s.status === "off" || s.status === "nocam").length}`;
  console.log(summary);
  return summary;
}
