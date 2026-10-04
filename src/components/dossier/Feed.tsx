"use client";

import { useEffect, useMemo, useState } from "react";
import { host, type Cluster } from "../format";

const TYPE_LABEL: Record<string, string> = { press: "PRESS", x: "SOCIAL", gouv: "GOVERNMENT", video: "VIDEO" };
const TABS = [
  { key: "press", label: "Press" }, { key: "x", label: "Social" },
  { key: "gouv", label: "Government" }, { key: "video", label: "Videos" },
];

function videoEmbed(url: string) {
  let m = url.match(/youtube\.com\/(?:watch\?v=|shorts\/|embed\/)([\w-]{6,})/) ||
    url.match(/youtu\.be\/([\w-]{6,})/);
  if (m) return { thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`,
    src: `https://www.youtube.com/embed/${m[1]}?autoplay=1` };
  m = url.match(/dailymotion\.com\/video\/([a-z0-9]+)/i);
  if (m) return { thumb: `https://www.dailymotion.com/thumbnail/video/${m[1]}`,
    src: `https://geo.dailymotion.com/player.html?video=${m[1]}&autoplay=1` };
  return null;
}

export default function Feed({ c, exa }: { c: Cluster; exa: boolean }) {
  const [data, setData] = useState<any>(null);
  const [types, setTypes] = useState(new Set(["press", "x", "gouv", "video"]));

  useEffect(() => {
    if (!exa) return;
    setData(null);
    let alive = true;
    const q = c.commune ? `${c.commune} ${c.dept_name || ""}`.trim()
      : c.dept_name || `${c.lat.toFixed(2)} ${c.lon.toFixed(2)}`;
    const url = `/api/feed?q=${encodeURIComponent(q)}` +
      (c.commune ? `&commune=${encodeURIComponent(c.commune)}` : "") +
      (c.dept_name ? `&dept=${encodeURIComponent(c.dept_name)}` : "") +
      (c.dept ? `&dept_code=${encodeURIComponent(c.dept)}` : "");
    fetch(url).then((r) => r.json()).then((d) => alive && setData(d))
      .catch(() => alive && setData({ error: "Search failed." }));
    return () => { alive = false; };
  }, [c.id, exa]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    (data?.results || []).forEach((r: any) => (out[r.type] = (out[r.type] || 0) + 1));
    return out;
  }, [data]);

  if (!exa) return (
    <div className="intel-msg">
      Exa key missing. Set <code>EXA_API_KEY</code> in <code>.env</code> and restart.
    </div>
  );

  const items = (data?.results || []).filter((r: any) => types.has(r.type));

  return (
    <>
      <div id="feedfilters">
        {TABS.map((t) => (
          <span key={t.key} className={`fchip ${types.has(t.key) ? "on" : ""}`} data-type={t.key}
            onClick={() => {
              const next = new Set(types);
              if (next.has(t.key)) next.delete(t.key); else next.add(t.key);
              setTypes(next);
            }}>
            <span className="cdot" />{t.label} <span className="cnt">{counts[t.key] || ""}</span>
          </span>
        ))}
      </div>
      <div id="intel">
        {!data && <div className="loading-bar" />}
        {data?.error && <div className="intel-msg">Error: {data.error}</div>}
        {data && !data.error && !items.length && (
          <div className="intel-msg">
            {data.results.length
              ? "No results match these filters."
              : `No source specifically mentions this fire${data.dropped ? ` (${data.dropped} unrelated results excluded)` : ""}.`}
          </div>
        )}
        {items.map((r: any, i: number) => <FeedItem key={r.url || i} r={r} />)}
      </div>
    </>
  );
}

function FeedItem({ r }: { r: any }) {
  const [playing, setPlaying] = useState(false);
  const emb = videoEmbed(r.url || "");
  const bsky = r.type === "x" ? r.url?.match(/bsky\.app\/profile\/([^/]+)/)?.[1] : null;
  const fav = r.favicon || `https://www.google.com/s2/favicons?domain=${host(r.url)}&sz=32`;
  const meta = `${host(r.url)}${r.date ? " · " + new Date(r.date).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}`;

  return (
    <div className="item">
      <div className="head">
        <img className="fav" src={fav} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
        <span className={`tbadge ${r.type}`}>{TYPE_LABEL[r.type]}</span>
        <span className="m">{meta}</span>
      </div>
      <a className="t" href={r.url} target="_blank" rel="noopener">{r.title || r.url}</a>
      {emb && !playing && (
        <div className="pv playable" onClick={() => setPlaying(true)}>
          <img className="thumb" src={emb.thumb} alt="" loading="lazy"
            onError={(e) => e.currentTarget.parentElement?.remove()} />
          <div className="playbtn"><span>▶</span></div>
        </div>
      )}
      {emb && playing && (
        <div className="pv">
          <iframe src={emb.src} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      )}
      {!emb && bsky && (
        <div className="social-card">
          <div className="sa">@{bsky}</div>
          {r.text && <div className="st">{r.text}</div>}
        </div>
      )}
      {!emb && !bsky && (
        <>
          {r.image && (
            <div className="pv">
              <img className="thumb" src={r.image} alt="" loading="lazy"
                onError={(e) => e.currentTarget.parentElement?.remove()} />
            </div>
          )}
          {r.text && <div className="s">{r.text}</div>}
        </>
      )}
    </div>
  );
}
