// 화면 데이터: GitHub Pages에 몇 분마다 올라오는 spots.json과 사진
export const BASE = "https://legendshine86-crypto.github.io/ginkgo-cam/";

export type Area = "capital" | "chungcheong" | "gyeongsang" | "jeolla" | "gangwon" | "jeju";
export type Status = "ok" | "stale" | "off" | "nocam";

export interface Camera { name: string; road: string; lat: number; lng: number; km: number }
export interface Spot {
  id: string; name: string; kind: "ginkgo" | "cherry"; area: Area; region: string;
  lat: number; lng: number; approx: boolean; status: Status;
  camera?: Camera; capturedAt?: string; dark?: boolean; snap?: string; thumb?: string;
  candidates?: number; pickedBy?: "color" | "nearest";
}
export interface Feed { updatedAt: string; source: string; spots: Spot[] }

export const AREAS: { key: Area | "all"; label: string }[] = [
  { key: "all", label: "전체 지역" },
  { key: "capital", label: "수도권" },
  { key: "chungcheong", label: "충청" },
  { key: "gyeongsang", label: "경상" },
  { key: "jeolla", label: "전라" },
  { key: "gangwon", label: "강원" },
  { key: "jeju", label: "제주" },
];

export async function loadFeed(): Promise<Feed> {
  const res = await fetch(`${BASE}spots.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const img = (path?: string) => (path ? BASE + path : "");

// 30분이 넘은 화면은 '끊긴 화면'으로 봐요
export const STALE_MIN = 30;
export function minutesAgo(iso: string | undefined, now: number) {
  if (!iso) return Infinity;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
}
export function agoText(min: number) {
  if (!isFinite(min)) return "화면 없음";
  if (min < 1) return "방금 찍은 화면";
  if (min < 60) return `${min}분 전 화면`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전 화면`;
  return `${Math.floor(h / 24)}일 전 화면`;
}
export function clockText(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${m} 촬영`;
}

// 카메라가 밤에도 흐릿하게 찍혀서 밝기보다 한국 시각으로 판단해요 (오후 6시~오전 7시)
export function isNight(s: Spot) {
  if (s.dark) return true;
  if (!s.capturedAt) return false;
  const h = (new Date(s.capturedAt).getUTCHours() + 9) % 24;
  return h >= 18 || h < 7;
}

export function isLive(s: Spot, now: number) {
  return (s.status === "ok" || s.status === "stale") && minutesAgo(s.capturedAt, now) <= STALE_MIN;
}

export function km(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// 추천순: 지금 볼 수 있는 화면 → 끊긴 화면, 그 안에서는 가나다순 (가까운 순이면 거리순)
export function sortSpots(list: Spot[], now: number, me: { lat: number; lng: number } | null) {
  const rank = (s: Spot) => (isLive(s, now) ? 0 : 1);
  return [...list].sort((a, b) =>
    rank(a) - rank(b) ||
    (me ? km(me.lat, me.lng, a.lat, a.lng) - km(me.lat, me.lng, b.lat, b.lng) : a.name.localeCompare(b.name, "ko")),
  );
}

export function nearbyLine(s: Spot) {
  if (!s.camera) return "";
  return `명소에서 ${s.camera.km.toFixed(1)}km 떨어진 ${s.camera.name} 화면이에요`;
}
export function reasonLine(s: Spot) {
  const color = s.kind === "ginkgo" ? "노란 잎이" : "꽃이";
  const season = s.kind === "ginkgo" ? "단풍 드는" : "꽃 피는";
  if (s.pickedBy === "color" && (s.candidates ?? 0) > 1) {
    return `명소 안쪽엔 공개 카메라가 없어요. 주변 카메라 ${s.candidates}대 중 ${color} 가장 많이 보이는 화면을 매일 낮에 골라 보여드려요`;
  }
  return `명소 안쪽엔 공개 카메라가 없어서 가장 가까운 화면을 보여드려요. 같은 지역이라 ${season} 시기가 비슷해요`;
}
