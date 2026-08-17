"use client";

import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";

export function SignaturePadField({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx?.scale(ratio, ratio);
      padRef.current?.clear();
      onChange(null);
    };

    const pad = new SignaturePad(canvas, {
      backgroundColor: "rgb(255,255,255)",
      penColor: "#1A1F1C",
      minWidth: 0.8,
      maxWidth: 2.2,
    });
    padRef.current = pad;

    pad.addEventListener("endStroke", () => {
      onChange(pad.isEmpty() ? null : pad.toDataURL("image/png"));
    });

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      pad.off();
      padRef.current = null;
    };
  }, [onChange]);

  function clear() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <div>
      <canvas ref={canvasRef} className="sig-canvas" />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={clear}
          className="min-h-10 px-3 py-2 text-sm font-medium text-muted hover:bg-wash hover:text-ink"
        >
          Wis handtekening
        </button>
      </div>
    </div>
  );
}
