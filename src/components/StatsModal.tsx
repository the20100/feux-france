"use client";

import { useEffect, useRef, useState } from "react";
import { fmtInt, VIG_COLORS, DANGER_LABELS } from "./format";

export default function StatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/stats").then((r) => r.json()).then(setData).catch(() => {});
  }, [open]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !data?.daily?.length) return;
    const ctx = cv.getContext("2d")!;
    const W = (cv.width = cv.clientWidth * 2);
    const H = (cv.height = 220);
    ctx.clearRect(0, 0, W, H);
    const days = data.daily;
    const max = Math.max(...days.map((x: any) => x.n), 1);
    const bw = W / days.length;
    days.forEach((x: any, i: number) => {
      const h = Math.max(2, (x.n / max) * (H - 40));
      ctx.fillStyle = i === days.length - 1 ? "#ffb03a" : "#ff6a2b";
      ctx.fillRect(i * bw + 2, H - 22 - h, bw - 4, h);
      ctx.fillStyle = "#77848f";
      ctx.font = "16px ui-monospace";
      ctx.textAlign = "center";
      if (i % Math.ceil(days.length / 8) === 0) ctx.fillText(x.d.slice(5), i * bw + bw / 2, H - 4);
      if (x.n === max) {
        ctx.fillStyle = "#d7dde3";
        ctx.fillText(fmtInt(x.n), i * bw + bw / 2, H - 30 - h);
      }
    });
  }, [data]);

  if (!open) return null;
  const maxFrp = Math.max(...(data?.depts || []).map((x: any) => x.frp), 1);
  const hot = data?.forets?.season
    ? Object.entries(data.forets.j1 as Record<string, number>)
        .filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div id="statsmodal" className="open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-card">
        <h2>NATIONAL STATISTICS</h2>
        <div className="sub">
          {data ? `Archive: ${data.season.fires ?? 0} tracked fire clusters · ${data.season.area_km2 ?? 0} km² total footprint · ${data.season.history_days ?? 0} days of history` : "Loading…"}
        </div>
        <div className="sect">Daily detections (30 days)</div>
        <canvas id="dailychart" ref={canvasRef} />
        <div className="sect">Department ranking (7 days)</div>
        <table className="dept-table">
          <tbody>
            <tr><th>Department</th><th style={{ textAlign: "right" }}>FRP (MW)</th>
              <th style={{ textAlign: "right" }}>Fire clusters</th>
              <th style={{ textAlign: "right" }}>Footprint</th><th style={{ width: "30%" }} /></tr>
            {(data?.depts || []).slice(0, 12).map((x: any) => (
              <tr key={x.dept}>
                <td>{x.dept_name || x.dept} <span style={{ color: "var(--dim)" }}>({x.dept})</span></td>
                <td className="num">{fmtInt(Math.round(x.frp))}</td>
                <td className="num">{x.fires}</td>
                <td className="num">{x.area_km2} km²</td>
                <td className="bar-td"><i style={{ width: `${Math.max(2, Math.round((100 * x.frp) / maxFrp))}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sect">Official fire danger tomorrow (Météo-France)</div>
        <div style={{ fontSize: 12 }}>
          {data?.forets?.season === false && <span style={{ color: "var(--muted)" }}>Out of season (June–September).</span>}
          {data?.forets?.season && !hot.length && <span style={{ color: "var(--muted)" }}>No department above Moderate risk.</span>}
          {hot.map(([dep, v]) => (
            <span key={dep} className="vig-chip" style={{ margin: "2px 4px 2px 0", display: "inline-flex" }}>
              <span className="vd" style={{ background: VIG_COLORS[v as number] }} />
              {dep} — {DANGER_LABELS[v as number]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
