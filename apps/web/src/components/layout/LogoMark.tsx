// The W from the supplied Wincentive logo, zoomed into a black square. The artwork is never
// recreated or recolored. Decorative: the wordmark always sits beside it.
// The file is public/wincentive-logo.png (the same 1536x1024 artwork Zahin's branch carried as
// "brand/wincentive-logo.png.png"); this is the only place the layout components reference it.
export const LOGO_SRC = "/wincentive-logo.png";

export function LogoMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`relative block shrink-0 overflow-hidden bg-black ${className}`}>
      <img
        src={LOGO_SRC}
        alt=""
        width={1536}
        height={1024}
        decoding="async"
        className="absolute left-1/2 top-1/2 h-auto w-[135%] max-w-none -translate-x-[52.7%] -translate-y-[46.1%]"
      />
    </span>
  );
}
