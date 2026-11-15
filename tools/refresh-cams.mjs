// 이 PC(국내)에서 ITS API로 카메라 주소를 새로 받아 S3의 비공개 경로 state/cams.json에 넣는다.
// ITS API는 해외와 클라우드(AWS 포함) IP에서 막혀 있어서 이 단계만 PC가 맡아요. 화면 찍기는 AWS Lambda가 5분마다 해요.
// 명소 목록(capture/spots.json)도 같이 넣어서, 명소를 더할 때 Lambda를 다시 배포하지 않아도 돼요.
// 실행: node tools/refresh-cams.mjs   (ITS 키는 tools/.its-key, AWS 키는 프로필 ntr-refresh)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const here = p => new URL(p, import.meta.url);
const BUCKET = JSON.parse(readFileSync(here("../lambda/deploy-config.json"), "utf8").replace(/^\uFEFF/, "")).bucket;
const AWS = existsSync("C:/Program Files/Amazon/AWSCLIV2/aws.exe") ? "C:/Program Files/Amazon/AWSCLIV2/aws.exe" : "aws";
const AWS_ARGS = ["--profile", "ntr-refresh", "--region", "ap-northeast-2"];
const key = (process.env.ITS_KEY || (existsSync(here("./.its-key")) ? readFileSync(here("./.its-key"), "utf8") : "")).trim();
if (!key) { console.error("tools/.its-key 파일에 ITS 키를 넣어 주세요"); process.exit(1); }

// 개발용 키는 월 100회라 하루 3회, 31일에 90회까지만 불러요
const logFile = here("./.its-calls.json");
const now = Date.now(), DAY = 864e5;
let calls = existsSync(logFile) ? JSON.parse(readFileSync(logFile, "utf8")) : [];
calls = calls.filter(t => now - t < 31 * DAY);
if (calls.filter(t => now - t < DAY).length >= 3 || calls.length >= 90) {
  console.log(`호출 한도에 걸려 이번에는 건너뛰어요 (최근 31일 ${calls.length}회)`); process.exit(0);
}

const spots = JSON.parse(readFileSync(here("../capture/spots.json"), "utf8")).filter(s => s.lat && s.lng);
const q = new URLSearchParams({ apiKey: key, type: "its", cctvType: "1", minX: "124.5", maxX: "132.0", minY: "33.0", maxY: "38.7", getType: "json" });
calls.push(now); writeFileSync(logFile, JSON.stringify(calls));
const buf = await (await fetch(`https://openapi.its.go.kr:9443/cctvInfo?${q}`)).arrayBuffer();
let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("euc-kr").decode(buf); }
const data = JSON.parse(text)?.response?.data;
if (!Array.isArray(data)) { console.error("API 응답이 이상해요:", text.slice(0, 200)); process.exit(1); }

// 명소마다 10km 안 카메라 가까운 순으로 최대 6대 후보를 넘겨요. 어떤 화면을 보여줄지는 Lambda가 골라요.
const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
const RADIUS_KM = 10, MAX_CANDIDATES = 6;
const usable = data.filter(c => !/터널/.test(c.cctvname || "") && c.cctvurl);
const cams = {}, missing = [];
for (const s of spots) {
  const all = usable.map(c => ({ name: c.cctvname, lat: +c.coordy, lng: +c.coordx, url: c.cctvurl, d: km(s.lat, s.lng, +c.coordy, +c.coordx) }));
  const list = all.filter(c => c.d <= RADIUS_KM).sort((a, b) => a.d - b.d).slice(0, MAX_CANDIDATES);
  // 처음 고른 카메라(spots.json의 camera)는 10km 밖이어도 후보에 꼭 넣어요
  const pinned = s.camera ? all.filter(c => c.name.includes(s.camera)).sort((a, b) => a.d - b.d)[0] : null;
  if (pinned && !list.some(c => c.name === pinned.name)) list.push(pinned);
  if (!list.length) { missing.push(s.name); continue; }
  cams[s.id] = list.map(({ d, ...c }) => c);
}
const meta = spots.filter(s => cams[s.id]).map(({ id, name, kind, area, region, lat, lng, approx, camera }) => ({ id, name, kind, area, region, lat, lng, approx, camera }));
const payload = JSON.stringify({ fetchedAt: new Date(now).toISOString(), spots: meta, cams });
execFileSync(AWS, ["s3", "cp", "-", `s3://${BUCKET}/state/cams.json`, "--content-type", "application/json", ...AWS_ARGS], { input: payload });
const n = Object.values(cams).reduce((a, l) => a + l.length, 0);
console.log(`명소 ${meta.length}/${spots.length}곳, 후보 카메라 ${n}대 주소를 S3에 넣었어요 (최근 31일 호출 ${calls.length}회)`);
const byArea = {}; for (const s of meta) byArea[s.area] = (byArea[s.area] || 0) + 1;
console.log("지역별:", JSON.stringify(byArea));
if (missing.length) console.log(`근처 카메라 없음 ${missing.length}곳: ${missing.join(", ")}`);
// 분석용: 카메라 위치만 (주소·키 없이) 남겨요
writeFileSync(here("./.its-cam-points.json"), JSON.stringify(usable.map(c => [c.cctvname, +c.coordy, +c.coordx])));
try {
  execFileSync(AWS, ["lambda", "invoke", "--function-name", "now-that-road-capture", "--invocation-type", "Event", "NUL", ...AWS_ARGS]);
  console.log("화면 찍기를 바로 한 번 시작했어요");
} catch { /* 5분 안에 저절로 돌아요 */ }
