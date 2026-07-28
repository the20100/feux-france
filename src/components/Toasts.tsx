"use client";

export type Toast = { id: string; title: string; msg: string; clusterId?: string };

export default function Toasts({ toasts, onClick, onClose }:
  { toasts: Toast[]; onClick: (t: Toast) => void; onClose: (id: string) => void }) {
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => { onClick(t); onClose(t.id); }}>
          <div className="tt">{t.title}</div>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
