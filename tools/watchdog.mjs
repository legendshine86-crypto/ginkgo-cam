// 1시간마다 실행(작업 스케줄러): 최근 화면이 절반 넘게 실패했으면 카메라 주소를 새로 받는다.
// 언제 주소가 만료됐는지 tools/watchdog.log에 남겨서, 주소 유지 시간을 재는 데도 써요.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const log = msg => appendFileSync(new URL("./watchdog.log", import.meta.url), `${new Date().toISOString()} ${msg}\n`);
try {
  const feed = await (await fetch(`https://legendshine86-crypto.github.io/ginkgo-cam/spots.json?t=${Date.now()}`)).json();
  const total = feed.spots.length, ok = feed.spots.filter(s => s.status === "ok").length;
  const ageMin = Math.round((Date.now() - Date.parse(feed.updatedAt)) / 60000);
  const camsAgeH = feed.camsFetchedAt ? ((Date.now() - Date.parse(feed.camsFetchedAt)) / 36e5).toFixed(1) : "?";
  log(`찍힘 ${ok}/${total}, 마지막 갱신 ${ageMin}분 전, 주소 받은 지 ${camsAgeH}시간`);
  if (ok < total / 2) {
    log(`주소가 만료된 것 같아요 (주소 받은 지 ${camsAgeH}시간). 새로 받아요`);
    const out = execFileSync(process.execPath, [new URL("./refresh-cams.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], { encoding: "utf8" });
    log(out.trim().replace(/\n/g, " / "));
  }
} catch (e) {
  log(`확인 실패: ${e.message}`);
}
