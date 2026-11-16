// 메인 지도: 시·도 경계 그림 위에 명소를 은행잎 기호로 표시해요.
// - 기호를 누르면 그 명소 화면(상세)으로 넘어가요
// - 가까이 붙은 명소는 숫자 동그라미로 묶이고, 누르면 그 부분을 확대해요
// - 기호와 글자는 확대해도 크기가 그대로이도록 지도 위에 따로 얹어요
import { useEffect, useMemo, useRef, useState } from "react";
import { AREA_BOX, KOREA, type MapArea, project } from "./koreaMap";
import { type Spot, isLive } from "./data";

type Box = [number, number, number, number]; // x, y, 너비, 높이 (지도 좌표)
// 처음 보이는 범위: 본토와 제주가 휴대폰 세로 화면을 꽉 채우도록 잡아요. 울릉도·독도는 오른쪽 위 작은 상자로 보여줘요
const FULL: Box = (() => {
  const [x0, y0] = project(38.7, 125.75), [x1, y1] = project(32.95, 129.65);
  return [x0, y0, x1 - x0, y1 - y0];
})();
const LAND: Record<MapArea, string> = {
  capital: "#E7F0E2", chungcheong: "#F3EED6", gyeongsang: "#F6E8D9",
  jeolla: "#E4EFEA", gangwon: "#E7EDF5", jeju: "#F1E6EE",
};
const CLUSTER_PX = 32;   // 화면에서 이보다 가까우면 하나로 묶어요
const MIN_SPAN = 14;     // 가장 크게 확대했을 때 보이는 폭 (약 20km). 4km 떨어진 명소도 따로 보여요

const memory: { view: Box | null; area: MapArea | "all" } = { view: null, area: "all" };

export const shortName = (name: string) => name.replace(/\s*(은행나무숲|은행나무길|은행나무|벚꽃길)$/, "");

function pad(b: Box, ratio = 0.12): Box {
  const w = Math.max(b[2], MIN_SPAN), h = Math.max(b[3], MIN_SPAN);
  const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  return [cx - (w * (1 + ratio)) / 2, cy - (h * (1 + ratio)) / 2, w * (1 + ratio), h * (1 + ratio)];
}

function Leaf({ off }: { off: boolean }) {
  // 은행잎(부채꼴) 모양
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 21.5c-.3 0-.6-.2-.6-.6v-4.4C7.8 16 4 13.3 3 8.6c-.2-.8.3-1.5 1.1-1.6 1.6-.2 3 .3 4 1.1.2-1.6 1-3.3 2.6-4.6.7-.5 1.7-.5 2.4 0 1.6 1.3 2.4 3 2.6 4.6 1-.8 2.4-1.3 4-1.1.8.1 1.3.8 1.1 1.6-1 4.7-4.8 7.4-8.4 7.9v4.4c0 .4-.3.6-.6.6Z"
        fill={off ? "#B0B8C1" : "#F5B400"} stroke={off ? "#8B95A1" : "#C98A00"} strokeWidth="0.8" />
    </svg>
  );
}

interface Props { spots: Spot[]; area: MapArea | "all"; now: number; onOpen: (id: string) => void; onShowAll: () => void; emptyText: string }

export default function MapView({ spots, area, now, onOpen, onShowAll, emptyText }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 480 });
  // 명소 화면에 다녀와도 보던 위치·확대 그대로 돌아오게 기억해 둬요
  const [view, setViewState] = useState<Box>(() => memory.view ?? FULL);
  const setView = (v: Box) => { memory.view = v; setViewState(v); };
  const anim = useRef(0);
  const firstArea = useRef(memory.area === area && memory.view !== null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 부드럽게 확대·이동
  const flyTo = (to: Box) => {
    cancelAnimationFrame(anim.current);
    const from = view, t0 = performance.now(), D = 320;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - p, 3);
      setView(from.map((v, i) => v + (to[i] - v) * e) as Box);
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  // 지역을 고르면 그 지역 명소들이 화면에 꽉 차게 (명소가 없으면 지역 전체)
  const areaView = (a: MapArea): Box => {
    const pts = spots.filter(s => s.area === a).map(s => project(s.lat, s.lng));
    if (!pts.length) return pad(AREA_BOX[a], 0.08);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return pad([x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0], 0.35);
  };
  useEffect(() => {
    memory.area = area;
    if (firstArea.current) { firstArea.current = false; return; } // 돌아왔을 때는 보던 위치 유지
    flyTo(area === "all" ? FULL : areaView(area));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  // 지도 좌표 → 화면 좌표 (viewBox meet 기준)
  const scale = Math.min(size.w / view[2], size.h / view[3]);
  const offX = (size.w - view[2] * scale) / 2, offY = (size.h - view[3] * scale) / 2;
  const toScreen = (x: number, y: number) => [(x - view[0]) * scale + offX, (y - view[1]) * scale + offY];

  // 화면에서 가까운 명소끼리 묶기
  const groups = useMemo(() => {
    const pts = spots.map(s => { const [x, y] = project(s.lat, s.lng); return { s, x, y }; });
    const out: { items: typeof pts; x: number; y: number }[] = [];
    for (const p of pts) {
      const [sx, sy] = [(p.x - view[0]) * scale, (p.y - view[1]) * scale];
      const g = out.find(g => Math.hypot((g.x - view[0]) * scale - sx, (g.y - view[1]) * scale - sy) < CLUSTER_PX);
      if (g) { g.items.push(p); g.x = g.items.reduce((a, i) => a + i.x, 0) / g.items.length; g.y = g.items.reduce((a, i) => a + i.y, 0) / g.items.length; }
      else out.push({ items: [p], x: p.x, y: p.y });
    }
    return out;
  }, [spots, view, scale]);

  // 손가락으로 끌어서 이동 (확대했을 때)
  const drag = useRef<{ x: number; y: number; v: Box; moved: boolean } | null>(null);
  const zoomed = view[2] < FULL[2] * 0.95;
  const onDown = (e: React.PointerEvent) => { if (!zoomed) return; drag.current = { x: e.clientX, y: e.clientY, v: view, moved: false }; };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 2 / scale) d.moved = true;
    setView([d.v[0] - dx, d.v[1] - dy, d.v[2], d.v[3]]);
  };
  const onUp = () => { setTimeout(() => { drag.current = null; }, 0); };
  const tap = (fn: () => void) => () => { if (drag.current?.moved) return; fn(); };

  const [dx, dy] = toScreen(KOREA.dokdo[0], KOREA.dokdo[1]);

  // 이름표끼리 겹치면 뒤에 오는 이름표는 숨겨요 (기호는 그대로 누를 수 있어요)
  const showLabel = useMemo(() => {
    type R = [number, number, number, number];
    const hit = (a: R, b: R) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    const placed: R[] = groups.map(g => { const [x, y] = toScreen(g.x, g.y); return [x - 19, y - 19, 38, 38]; });
    const show = new Map<string, "below" | "right" | "left">();
    for (const g of groups.filter(g => g.items.length === 1).sort((a, b) => Number(isLive(b.items[0].s, now)) - Number(isLive(a.items[0].s, now)))) {
      const s = g.items[0].s, [x, y] = toScreen(g.x, g.y), w = shortName(s.name).length * 12.5 + 6;
      // 아래 → 오른쪽 → 왼쪽 순서로 빈자리를 찾아요
      const tries: ["below" | "right" | "left", R][] = [["below", [x - w / 2, y + 20, w, 16]], ["right", [x + 21, y - 8, w, 16]], ["left", [x - 21 - w, y - 8, w, 16]]];
      for (const [pos, r] of tries) {
        if (r[0] < 2 || r[0] + r[2] > size.w - 2 || placed.some(p => hit(p, r))) continue;
        placed.push(r); show.set(s.id, pos); break;
      }
    }
    return show;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, size, view, now]);

  return (
    <div className="map" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <svg className="map-svg" viewBox={view.join(" ")} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect x={-500} y={-500} width={KOREA.width + 1000} height={KOREA.height + 1000} fill="#DCEBF5" />
        {KOREA.regions.map(r => (
          <path key={r.name} d={r.d} fill={LAND[r.area]} stroke="#fff" strokeWidth={1.2 / Math.max(scale / 0.6, 1)} strokeLinejoin="round"
            opacity={area === "all" || r.area === area ? 1 : 0.55} />
        ))}
        <circle cx={KOREA.dokdo[0]} cy={KOREA.dokdo[1]} r={1.6} fill={LAND.gyeongsang} stroke="#B0B8C1" strokeWidth={0.4} />
      </svg>

      {/* 시·도 이름 */}
      {KOREA.regions.filter(r => r.big).map(r => {
        const [x, y] = toScreen(r.lx, r.ly);
        return <span key={r.name} className="map-region" style={{ left: x, top: y }}>{r.name}</span>;
      })}
      {dx > 0 && dx < size.w && dy > 0 && dy < size.h && <span className="map-region small" style={{ left: dx, top: dy + 10 }}>독도</span>}
      {/* 울릉도·독도는 처음 화면에서 벗어나 있어서 작은 상자로 따로 보여줘요 */}
      {!zoomed && !(dx > 0 && dx < size.w) && (
        <div className="map-inset" aria-hidden="true">
          <svg viewBox="0 0 80 44" width="80" height="44">
            <path d="M14 20c2-5 9-6 12-2 3 3 1 9-4 10-5 1-10-3-8-8Z" fill={LAND.gyeongsang} stroke="#B0B8C1" strokeWidth=".8" />
            <circle cx="60" cy="25" r="2.6" fill={LAND.gyeongsang} stroke="#B0B8C1" strokeWidth=".8" />
            <circle cx="65" cy="23" r="1.8" fill={LAND.gyeongsang} stroke="#B0B8C1" strokeWidth=".8" />
          </svg>
          <span style={{ left: 20 }}>울릉도</span><span style={{ left: 62 }}>독도</span>
        </div>
      )}

      {/* 명소 기호 */}
      {groups.map(g => {
        const [x, y] = toScreen(g.x, g.y);
        if (x < -40 || x > size.w + 40 || y < -40 || y > size.h + 40) return null; // 화면 밖 기호는 그리지 않아요
        if (g.items.length > 1) {
          const xs = g.items.map(i => i.x), ys = g.items.map(i => i.y);
          const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
          return (
            <button key={g.items.map(i => i.s.id).join()} className="map-cluster" style={{ left: x, top: y }}
              onClick={tap(() => flyTo(pad(box, 0.6)))} aria-label={`명소 ${g.items.length}곳. 누르면 확대해요`}>
              {g.items.length}
            </button>
          );
        }
        const s = g.items[0].s, live = isLive(s, now);
        return (
          <button key={s.id} className={`map-pin ${live ? "" : "off"}`} style={{ left: x, top: y }}
            onClick={tap(() => onOpen(s.id))} aria-label={`${s.name}${live ? "" : ", 화면 잠시 끊김"}. 누르면 화면을 봐요`}>
            <span className="map-pin-dot"><Leaf off={!live} /></span>
            {showLabel.has(s.id) && <span className={`map-pin-label ${showLabel.get(s.id)}`}>{shortName(s.name)}</span>}
          </button>
        );
      })}

      {zoomed && <button className="map-reset" onClick={() => (area === "all" ? flyTo(FULL) : onShowAll())}>전국 보기</button>}
      {spots.length === 0 && <p className="map-empty">{emptyText}</p>}
      {!zoomed && spots.length > 0 && <p className="map-hint">은행잎을 누르면<br />지금 화면을 봐요</p>}
    </div>
  );
}
