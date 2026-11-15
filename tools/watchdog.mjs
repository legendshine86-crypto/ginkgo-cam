// 1시간마다 실행(작업 스케줄러): 카메라 주소가 오래됐거나 화면이 절반 넘게 실패하면 주소를 새로 받는다.
// 기록은 tools/watchdog.log 에 남겨서 주소가 얼마나 유지되는지 재는 데도 써요.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const REFRESH_AFTER_H = 18; // 주소는 최소 19시간 유지되는 걸 확인했어요. 넉넉하게 18시간마다 새로 받아요
const log = msg => appendFileSync(new URL("./watchdog.log", import.meta.url), `${new Date().toISOString()} ${msg}\n`);
const bucket = JSON.parse(readFileSync(new URL("../lambda/deploy-config.json", import.meta.url), "utf8").replace(/^﻿/, "")).bucket;
const refresh = reason => {
  log(`주소를 새로 받아요: ${reason}`);
  const out = execFileSync(process.execPath, [new URL("./refresh-cams.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], { encoding: "utf8" });
  log(out.trim().replace(/\n/g, " / "));
};
try {
  const res = await fetch(`https://${bucket}.s3.ap-northeast-2.amazonaws.com/spots.json?t=${Date.now()}`);
  if (!res.ok) { refresh(`spots.json 없음 (HTTP ${res.status})`); process.exit(0); }
  const feed = await res.json();
  const total = feed.spots.length, ok = feed.spots.filter(s => s.status === "ok").length;
  const ageMin = Math.round((Date.now() - Date.parse(feed.updatedAt)) / 60000);
  const camsAgeH = feed.camsFetchedAt ? (Date.now() - Date.parse(feed.camsFetchedAt)) / 36e5 : 99;
  log(`찍힘 ${ok}/${total}, 마지막 갱신 ${ageMin}분 전, 주소 받은 지 ${camsAgeH.toFixed(1)}시간`);
  if (ok < total / 2) refresh(`화면 ${total - ok}곳 실패, 주소 만료 의심 (받은 지 ${camsAgeH.toFixed(1)}시간)`);
  else if (camsAgeH > REFRESH_AFTER_H) refresh(`받은 지 ${camsAgeH.toFixed(1)}시간이 지남`);
} catch (e) {
  log(`확인 실패: ${e.message}`);
}
