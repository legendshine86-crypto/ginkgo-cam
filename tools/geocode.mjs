// 명소 좌표를 OpenStreetMap에서 찾아 capture/spots.json에 채운다 (처음 한 번만 실행)
import { readFileSync, writeFileSync } from "node:fs";
const file = new URL("../capture/spots.json", import.meta.url);
const spots = JSON.parse(readFileSync(file, "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const s of spots) {
  if (s.lat) continue;
  for (const q of s.geo) {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=kr&accept-language=ko&q=" + encodeURIComponent(q);
    const arr = await (await fetch(url, { headers: { "User-Agent": "ginkgo-cam/0.1 (personal project)" } })).json().catch(() => []);
    await sleep(1100);
    const hit = arr.find(a => a.display_name.includes(s.city));
    if (hit) { s.lat = +(+hit.lat).toFixed(5); s.lng = +(+hit.lon).toFixed(5); s.geoFound = hit.display_name; break; }
  }
  console.log(s.name, s.lat ? `${s.lat}, ${s.lng} | ${s.geoFound.slice(0, 50)}` : "못 찾음");
}
writeFileSync(file, JSON.stringify(spots, null, 2) + "\n", "utf8");
