// 경찰청 도시교통정보센터(UTIC) 개방데이터에서 시내 도로 CCTV 후보를 찾는다 (지금은 서울교통정보센터만)
// - 키와 IP 인증이 걸려 있어 집 PC에서만 불러요. 키는 tools/.utic-key (깃허브에 올리지 않아요)
// - UTIC은 크롤링을 막고 있어서: 좌표 목록은 하루 한 번 엑셀 1회, 영상 주소는 명소 근처 카메라만 1초 간격으로 묻고 결과를 저장해 다시 묻지 않아요
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = p => new URL(p, import.meta.url);
const BASE = "https://www.utic.go.kr";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SUPPORTED = /^L01/; // 서울교통정보센터 (영상: strm2.spatic.go.kr HLS)

export function uticKey() {
  return existsSync(here("./.utic-key")) ? readFileSync(here("./.utic-key"), "utf8").trim() : "";
}

// xlsx(zip)를 풀어 첫 시트를 [[...],...]로 읽어요 (따로 라이브러리 없이)
function readXlsx(file) {
  const dir = join(tmpdir(), `utic-xlsx-${process.pid}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["-xf", file, "-C", dir]);
  const dec = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const ssPath = join(dir, "xl", "sharedStrings.xml");
  const shared = existsSync(ssPath) ? [...readFileSync(ssPath, "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""))) : [];
  const sheetDir = join(dir, "xl", "worksheets");
  const sheetFile = execFileSync("cmd", ["/c", "dir", "/b", sheetDir]).toString().split(/\r?\n/).find(f => /^sheet\d*\.xml$/.test(f));
  const xml = readFileSync(join(sheetDir, sheetFile), "utf8");
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (c[3] || "").match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      row[col] = /t="s"/.test(c[2]) ? shared[+v] : dec(v);
    }
    rows.push(row);
  }
  rmSync(dir, { recursive: true, force: true });
  return rows;
}

async function cctvList(key) {
  const file = join(tmpdir(), "utic-cctv.xlsx");
  const res = await fetch(`${BASE}/excel/download/OpenDataCCTV?key=${encodeURIComponent(key)}`, { headers: { "User-Agent": "now-that-road/1.0" } });
  if (!res.ok) throw new Error(`UTIC 목록 응답 ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const [head, ...rows] = readXlsx(file);
  const at = n => head.indexOf(n);
  return rows.map(r => ({ cctvId: r[at("CCTVID")], name: r[at("CCTVNAME")], center: r[at("CENTERNAME")], lng: +r[at("XCOORD")], lat: +r[at("YCOORD")] }))
    .filter(c => c.cctvId && c.lat && c.lng);
}

// 카메라 하나의 HLS 주소를 알아내요 (저장해 두고 7일 동안 다시 묻지 않아요)
const cacheFile = here("./.utic-info.json");
async function streamUrl(key, cctvId, cache) {
  const hit = cache[cctvId];
  if (hit && Date.now() - hit.at < 7 * 864e5) return hit.url;
  await sleep(1200);
  const H = { "User-Agent": "now-that-road/1.0", Referer: `${BASE}/guide/cctvOpenData.do` };
  const info = await (await fetch(`${BASE}/map/getCctvInfoById.do?cctvId=${cctvId}`, { headers: H })).json().catch(() => null);
  let url = null;
  if (info?.ID) {
    await sleep(1200);
    const q = new URLSearchParams({ key, cctvid: cctvId, cctvName: info.CCTVNAME || "", kind: "Seoul", cctvip: info.CCTVIP, cctvch: info.CH, id: info.ID, cctvpasswd: info.PASSWD, cctvport: info.PORT });
    const html = await (await fetch(`${BASE}/jsp/map/openDataCctvStream.jsp?${q}`, { headers: H })).text().catch(() => "");
    url = (html.match(/https:\/\/[^\s"'<>\\]+\/live\/[^\s"'<>\\]+\.stream\/playlist\.m3u8/) || [])[0] || null;
  }
  cache[cctvId] = { url, at: Date.now() };
  return url;
}

const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(h)); };

// spots마다 radiusKm 안 UTIC 카메라를 가까운 순 max대까지: { spotId: [{ name, lat, lng, url, src }] }
export async function uticCams(spots, { radiusKm = 3, max = 6 } = {}) {
  const key = uticKey();
  if (!key) return {};
  const list = (await cctvList(key)).filter(c => SUPPORTED.test(c.cctvId) && !/터널/.test(c.name));
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const out = {};
  try {
    for (const s of spots) {
      const near = list.map(c => ({ ...c, d: km(s.lat, s.lng, c.lat, c.lng) })).filter(c => c.d <= radiusKm).sort((a, b) => a.d - b.d).slice(0, max);
      const got = [];
      for (const c of near) {
        const url = await streamUrl(key, c.cctvId, cache);
        if (url) got.push({ name: c.name, lat: c.lat, lng: c.lng, url, src: "utic" });
      }
      if (got.length) out[s.id] = got;
    }
  } finally {
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return out;
}
