import qrcode from "qrcode-generator";

/** A crisp SVG QR code in the ink color (quiet zone included). */
export function QrCode({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const pad = 3;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n + pad * 2} ${n + pad * 2}`}
      shapeRendering="crispEdges"
      className={`block bg-white ${className}`}
    >
      <path d={d} fill="var(--color-ink)" />
    </svg>
  );
}
