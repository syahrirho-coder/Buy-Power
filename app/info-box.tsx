"use client";

import { useState, type ReactNode } from "react";

/**
 * Ganti readme-box teks-panjang jadi: baris chip ringkasan yang selalu
 * kelihatan (biar orang langsung nangkep intinya dalam 2 detik) + detail
 * lengkap yang collapsible di bawahnya (default tertutup, klik buat buka).
 */
export function InfoBox({
  chips,
  children,
  defaultOpen = false,
}: {
  chips: string[];
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="info-box">
      <button
        type="button"
        className="info-box-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="info-chips">
          {chips.map((chip, i) => (
            <span className="info-chip" key={i}>
              {chip}
            </span>
          ))}
        </div>
        <span className={`info-caret ${open ? "open" : ""}`}>
          {open ? "Tutup ▲" : "Detail ▾"}
        </span>
      </button>
      {open && <div className="info-box-body">{children}</div>}
    </div>
  );
}
