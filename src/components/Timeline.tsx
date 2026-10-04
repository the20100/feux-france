"use client";

import { useEffect, useRef } from "react";

export type TlState = { min: number; max: number; cursor: number | null; playing: boolean };

type Props = { tl: TlState; onChange: (tl: TlState) => void };

export default function Timeline({ tl, onChange }: Props) {
  const tlRef = useRef(tl);
  tlRef.current = tl;

  // lecture heure par heure : saute au créneau suivant, y reste ~650 ms
  useEffect(() => {
    if (!tl.playing) return;
    const iv = setInterval(() => {
      const cur = tlRef.current;
      const from = cur.cursor ?? cur.min;
      const next = (Math.floor(from / 3600) + 1) * 3600;
      if (next >= cur.max) onChange({ ...cur, cursor: null, playing: false });
      else onChange({ ...cur, cursor: next });
    }, 650);
    return () => clearInterval(iv);
  }, [tl.playing]);

  const value = tl.cursor === null || tl.max === tl.min
    ? 1000
    : Math.round((1000 * (tl.cursor - tl.min)) / (tl.max - tl.min));

  return (
    <div id="timeline">
      <button onClick={() => {
        if (tl.playing) onChange({ ...tl, playing: false });
        else onChange({ ...tl, playing: true, cursor: tl.cursor === null ? tl.min : tl.cursor });
      }}>
        {tl.playing ? "⏸" : "▶"}
      </button>
      <input type="range" min={0} max={1000} value={value}
        onChange={(e) => {
          const f = +e.target.value / 1000;
          onChange({ ...tl, playing: false,
            cursor: +e.target.value === 1000 ? null : tl.min + f * (tl.max - tl.min) });
        }} />
      <span id="tl-label">
        {tl.cursor === null ? "LIVE" :
          new Date(tl.cursor * 1000).toLocaleString("en-GB",
            { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </span>
      <span id="tl-live" title="Return to live"
        onClick={() => onChange({ ...tl, cursor: null, playing: false })}>● LIVE</span>
    </div>
  );
}
