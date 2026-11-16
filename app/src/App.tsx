import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@toss/tds-mobile";
import { Accuracy, Device } from "@apps-in-toss/web-framework";
import MapView from "./MapView";
import {
  AREAS, type Area, type Feed, type Spot, agoText, clockText, img, isLive, isNight, loadFeed,
  minutesAgo, nearbyLine, reasonLine, sortSpots, km, srcLabel,
} from "./data";

type Route = { name: "intro" } | { name: "list" } | { name: "detail"; id: string; full?: boolean };
const SEEN_KEY = "intro-seen";

function readRoute(): Route {
  const m = location.hash.match(/^#\/spot\/([\w-]+)(\/full)?$/);
  if (m) return { name: "detail", id: m[1], full: !!m[2] };
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* 저장소를 못 쓰면 매번 보여줘요 */ }
  return seen ? { name: "list" } : { name: "intro" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try { setFeed(await loadFeed()); setError(false); } catch { setError(true); }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const a = setInterval(refresh, 60_000);
    const b = setInterval(() => setNow(Date.now()), 30_000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    const onPop = () => setRoute(readRoute());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("popstate", onPop);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("popstate", onPop); };
  }, [refresh]);

  const go = (hash: string) => { history.pushState(null, "", hash || location.pathname); setRoute(readRoute()); window.scrollTo(0, 0); };

  if (route.name === "intro") {
    return <Intro onStart={() => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* 무시 */ } setRoute({ name: "list" }); }} />;
  }
  if (route.name === "detail") {
    const spot = feed?.spots.find(s => s.id === route.id);
    if (!spot) return <div className="center">{feed ? "명소를 찾지 못했어요" : "불러오는 중이에요"}</div>;
    if (route.full) return <Full spot={spot} now={now} onClose={() => history.back()} />;
    return <Detail spot={spot} now={now} onRefresh={refresh} onFull={() => go(`#/spot/${spot.id}/full`)} />;
  }
  return <List feed={feed} error={error} now={now} onRetry={refresh} onOpen={id => go(`#/spot/${id}`)} />;
}

// ---------- 오프닝 ----------
// 오프닝 사진은 시안에서 정한 한국관광공사 은행나무 사진이에요 (public/intro.jpg)
function Intro({ onStart }: { onStart: () => void }) {
  return (
    <main className="intro">
      <div className="intro-photo">
        <img src="./intro.jpg" alt="노랗게 물든 은행나무 길" />
        <span className="cap">사진: 한국관광공사</span>
      </div>
      <h1>그 길, 지금쯤<br />물들었을까요?</h1>
      <p className="lead">작년 사진만 보고 갔다가 아쉬웠던 적 있죠. 이제 떠나기 전에 지금 모습을 먼저 확인해 보세요.</p>
      <ul className="promise">
        <li><b>몇 분마다 새로 찍은 화면</b>을 보여드려요</li>
        <li>물들었는지는 <b>화면을 보고 직접</b> 판단하세요</li>
        <li>명소에 카메라가 없으면 <b>가장 가까운 화면</b>과 거리를 알려드려요</li>
      </ul>
      <div className="bottom"><Button display="full" size="xlarge" onClick={onStart}>지금 명소 보러 가기</Button></div>
    </main>
  );
}

// ---------- 목록 (지도가 기본, 목록으로 바꿔 볼 수 있어요) ----------
// 상세 화면에 다녀와도 고른 탭·지역·보기 방식이 그대로 남도록 밖에 저장해 둬요
const listState: { tab: "ginkgo" | "cherry"; area: Area | "all"; mode: "map" | "list" } = { tab: "ginkgo", area: "all", mode: "map" };

function List({ feed, error, now, onRetry, onOpen }: { feed: Feed | null; error: boolean; now: number; onRetry: () => void; onOpen: (id: string) => void }) {
  const [tab, setTabState] = useState(listState.tab);
  const [area, setAreaState] = useState(listState.area);
  const [mode, setModeState] = useState(listState.mode);
  const setTab = (v: typeof tab) => { listState.tab = v; setTabState(v); };
  const setArea = (v: typeof area) => { listState.area = v; setAreaState(v); };
  const setMode = (v: typeof mode) => { listState.mode = v; setModeState(v); };
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locMsg, setLocMsg] = useState("");

  const askNear = async () => {
    if (me) { setMe(null); setLocMsg(""); return; }
    setLocMsg("위치를 확인하고 있어요");
    try {
      const loc = await Device.getLocation({ accuracy: Accuracy.Balanced });
      setMe({ lat: loc.coords.latitude, lng: loc.coords.longitude }); setLocMsg("");
    } catch {
      setLocMsg("위치 권한이 없어서 추천순으로 보여드려요");
    }
  };

  const spots = useMemo(() => {
    const all = (feed?.spots ?? []).filter(s => s.kind === tab && s.status !== "nocam" && (area === "all" || s.area === area));
    return sortSpots(all, now, me);
  }, [feed, tab, area, now, me]);

  const emptyText = tab === "cherry" ? "벚꽃 명소는 봄에 열려요" : "이 지역은 아직 화면을 볼 수 있는 명소가 없어요";

  return (
    <main className={`list ${mode === "map" ? "mapmode" : ""}`}>
      <header className="top">
        <h1>지금 그 길</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "ginkgo"} onClick={() => setTab("ginkgo")}>은행나무</button>
          <button role="tab" aria-selected={tab === "cherry"} onClick={() => setTab("cherry")}>벚꽃</button>
        </div>
        <div className="chips">
          {AREAS.map(a => <button key={a.key} className="chip" aria-pressed={area === a.key} onClick={() => setArea(a.key)}>{a.label}</button>)}
        </div>
        <div className="sortbar">
          <span>{spots.length}곳</span>
          <div className="sortbar-right">
            {mode === "list" && (
              <button className="sort" onClick={askNear} aria-label={me ? "가까운 순으로 보는 중. 누르면 추천순으로 바뀌어요" : "추천순으로 보는 중. 누르면 가까운 순으로 바뀌어요"}>{me ? "가까운 순" : "추천순"}</button>
            )}
            <div className="seg" role="group" aria-label="보기 방식">
              <button aria-pressed={mode === "map"} onClick={() => setMode("map")}>지도</button>
              <button aria-pressed={mode === "list"} onClick={() => setMode("list")}>목록</button>
            </div>
          </div>
        </div>
        {mode === "list" && locMsg && <p className="locmsg">{locMsg}</p>}
      </header>

      {error && !feed && (
        <div className="empty"><p>화면 목록을 불러오지 못했어요</p><Button variant="weak" onClick={onRetry}>다시 불러오기</Button></div>
      )}
      {!feed && !error && <div className="empty"><p>불러오는 중이에요</p></div>}

      {feed && mode === "map" && <MapView spots={spots} area={area} now={now} onOpen={onOpen} onShowAll={() => setArea("all")} emptyText={emptyText} />}

      {feed && mode === "list" && (
        <>
          {spots.length === 0 && (
            <div className="empty"><p>{emptyText}</p>{tab === "cherry" && <span>꽃이 피기 시작하면 이곳에서 지금 모습을 볼 수 있어요</span>}</div>
          )}
          <ul className="cards">
            {spots.map(s => {
              const min = minutesAgo(s.capturedAt, now), live = isLive(s, now);
              return (
                <li key={s.id}>
                  <button className="card" onClick={() => onOpen(s.id)}>
                    <div className="thumb">
                      {s.thumb ? <img src={img(s.thumb)} alt="" loading="lazy" /> : <div className="ph" />}
                      <span className={`ago ${live ? "" : "off"}`}><i />{live ? agoText(min) : "화면 잠시 끊김"}</span>
                      {live && isNight(s) && <span className="night">밤 화면이에요</span>}
                    </div>
                    <div className="info">
                      <b>{s.name}</b>
                      <span className="region">{s.region}{me ? ` · 내 위치에서 ${Math.round(km(me.lat, me.lng, s.lat, s.lng))}km` : ""}</span>
                      {s.camera && <span className="badge">{s.camera.km.toFixed(1)}km 떨어진 근처 화면</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <footer className="foot">
            <p><b>가고 싶은 명소가 없나요?</b><br />토스 고객센터 문의로 장소를 건의해 주세요.</p>
            <p className="src">화면 출처: {feed?.source ?? "국가교통정보센터(ITS) 교통 CCTV"}</p>
          </footer>
        </>
      )}
    </main>
  );
}

// ---------- 상세 ----------
function Detail({ spot: s, now, onRefresh, onFull }: { spot: Spot; now: number; onRefresh: () => void; onFull: () => void }) {
  const min = minutesAgo(s.capturedAt, now), live = isLive(s, now);
  return (
    <main className="detail">
      <div className="hero">
        {s.snap ? <img src={img(s.snap)} alt={`${s.name} 근처 ${s.camera?.name ?? ""} 화면`} onClick={onFull} /> : <div className="ph" />}
        {s.snap && <button className="fullbtn" onClick={onFull} aria-label="크게 보기">⤢</button>}
      </div>
      <div className="when">
        <span className={`dot ${live ? "" : "off"}`} />
        <b>{live ? agoText(min) : "화면이 잠시 끊겼어요"}</b>
        <span>{clockText(s.capturedAt)}</span>
      </div>
      <p className="band">{live ? "보통 5~15분마다 새 화면으로 바뀌어요" : `${agoText(min)}이 마지막이에요. 카메라가 다시 연결되면 바로 바뀌어요`}</p>
      {live && isNight(s) && <p className="band nightband">밤이라 색이 잘 안 보여요. 해가 뜨면 단풍 색을 확인할 수 있어요</p>}

      <h1>{s.name}</h1>
      <p className="region">{s.region}</p>

      {s.camera && (
        <div className="note">
          <b>{nearbyLine(s)}</b>
          <p>{reasonLine(s)}</p>
          {s.approx && <p className="sub">명소 위치를 마을 기준으로 잡아서 거리는 대략이에요</p>}
        </div>
      )}

      <dl className="facts">
        <div><dt>카메라</dt><dd>{s.camera ? `${s.camera.name}${s.camera.road ? ` (${s.camera.road})` : ""}` : "-"}</dd></div>
        <div><dt>명소와 거리</dt><dd>{s.camera ? `약 ${s.camera.km.toFixed(1)}km` : "-"}</dd></div>
        <div><dt>출처</dt><dd>{srcLabel(s.camera)}</dd></div>
      </dl>

      <div className="bottom"><Button display="full" variant="weak" onClick={onRefresh}>새 화면 확인하기</Button></div>
    </main>
  );
}

// ---------- 전체화면 ----------
function Full({ spot: s, now, onClose }: { spot: Spot; now: number; onClose: () => void }) {
  return (
    <div className="full" onClick={onClose}>
      {s.snap && <img src={img(s.snap)} alt={`${s.name} 근처 화면 크게 보기`} />}
      <div className="fullbar">
        <span>{agoText(minutesAgo(s.capturedAt, now))} · {clockText(s.capturedAt)}<br /><small>{srcLabel(s.camera)}</small></span>
        <button onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
