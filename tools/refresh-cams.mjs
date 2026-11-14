// 이 PC(국내)에서 ITS API로 카메라 주소를 새로 받아 GitHub 비밀값 CAMS에 넣는다.
// ITS API는 해외(GitHub 서버)에서 막혀 있어서 이 단계만 PC가 맡아요. 화면 찍기는 GitHub가 해요.
// 실행: node tools/refresh-cams.mjs   (키는 tools/.its-key 파일에 한 줄로 저장, 저장소에는 안 올라가요)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REPO = "legendshine86-crypto/ginkgo-cam";
const here = p => new URL(p, import.meta.url);
const key = (process.env.ITS_KEY || (existsSync(here("./.its-key")) ? readFileSync(here("./.its-key"), "utf8") : "")).trim();
if (!key) { console.error("tools/.its-key 파일에 ITS 키를 넣어 주세요"); process.exit(1); }

// 개발용 키는 월 100번이라 하루 3번, 31일에 90번까지만 불러요
const logFile = here("./.its-calls.json");
const now = Date.now(), DAY = 864e5;
let calls = existsSync(logFile) ? JSON.parse(readFileSync(logFile, "utf8")) : [];
calls = calls.filter(t => now - t < 31 * DAY);
if (calls.filter(t => now - t < DAY).length >= 3 || calls.length >= 90) {
  console.log(`호출 한도에 걸려 이번에는 건너뛰어요 (최근 31일 ${calls.length}번)`); process.exit(0);
}

const spots = JSON.parse(readFileSync(here("../capture/spots.json"), "utf8"));
const q = new URLSearchParams({ apiKey: key, type: "its", cctvType: "1", minX: "124.5", maxX: "132.0", minY: "33.0", maxY: "38.7", getType: "json" });
calls.push(now); writeFileSync(logFile, JSON.stringify(calls));
const buf = await (await fetch(`https://openapi.its.go.kr:9443/cctvInfo?${q}`)).arrayBuffer();
let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("euc-kr").decode(buf); }
const data = JSON.parse(text)?.response?.data;
if (!Array.isArray(data)) { console.error("API 응답이 이상해요:", text.slice(0, 200)); process.exit(1); }

const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };
// 명소마다 10km 안 카메라를 가까운 순으로 최대 6대 후보로 넘겨요. 어떤 화면을 보여줄지는 capture.mjs가 골라요.
const RADIUS_KM = 10, MAX_CANDIDATES = 6;
const cams = {};
for (const s of spots) {
  const near = data
    .filter(c => !/터널/.test(c.cctvname || ""))
    .map(c => ({ name: c.cctvname, lat: +c.coordy, lng: +c.coordx, url: c.cctvurl, d: km(s.lat, s.lng, +c.coordy, +c.coordx) }))
    .filter(c => c.d <= RADIUS_KM)
    .sort((a, b) => a.d - b.d);
  // 처음 고른 카메라(spots.json의 camera)는 10km 밖이어도 후보에 꼭 넣어요
  const pinned = data.filter(c => (c.cctvname || "").includes(s.camera))
    .map(c => ({ name: c.cctvname, lat: +c.coordy, lng: +c.coordx, url: c.cctvurl, d: km(s.lat, s.lng, +c.coordy, +c.coordx) }))
    .sort((a, b) => a.d - b.d)[0];
  const list = near.slice(0, MAX_CANDIDATES);
  if (pinned && !list.some(c => c.name === pinned.name)) list.push(pinned);
  if (!list.length) { console.log(`근처 카메라 없음: ${s.name}`); continue; }
  cams[s.id] = list.map(({ d, ...c }) => c);
}
const payload = JSON.stringify({ fetchedAt: new Date(now).toISOString(), cams });
execFileSync("gh", ["secret", "set", "CAMS", "-R", REPO], { input: payload });
const n = Object.values(cams).reduce((a, l) => a + l.length, 0);
console.log(`명소 ${Object.keys(cams).length}/${spots.length}곳, 후보 카메라 ${n}대 주소를 GitHub에 넣었어요 (최근 31일 호출 ${calls.length}번)`);
try { execFileSync("gh", ["workflow", "run", "capture", "-R", REPO]); console.log("화면 찍기를 바로 한 번 실행했어요"); } catch { /* 예약 실행을 기다려요 */ }
