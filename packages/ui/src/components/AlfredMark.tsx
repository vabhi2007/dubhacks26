// The Alfred mark: a tuxedo (circle with a shirt-front V) under a bow tie. Single color (currentColor); the V and the gap
// around the bow are cut out, so whatever is behind shows through. Master file: packages/ui/assets/alfred-mark.svg.
import { useId } from "react";

const WING = "M817 203C780 155 560 85 435 63C395 57 363 90 363 130V450C363 492 400 525 440 517C580 490 780 430 817 372Z";

function Bow(props: React.SVGProps<SVGGElement>) {
  return (
    <g {...props}>
      <path d={WING} />
      <path d={WING} transform="matrix(-1 0 0 1 1932 0)" />
      <rect x="817" y="107" width="298" height="375" rx="48" />
    </g>
  );
}

/** `title=""` marks it decorative (next to the "Alfred" wordmark). */
export function AlfredMark({ size = 24, title = "Alfred", className }: { size?: number; title?: string; className?: string }) {
  const mask = `alfred-cut-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 1932 1932"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      <mask id={mask}>
        <rect width="1932" height="1932" fill="#fff" />
        <polygon points="460,300 1472,300 966,1665" fill="#000" />
        <rect x="324" y="-10" width="1284" height="310" fill="#000" />
        <Bow fill="#000" stroke="#000" strokeWidth={78} strokeLinejoin="round" />
      </mask>
      <circle cx="966" cy="966" r="966" mask={`url(#${mask})`} />
      <Bow />
    </svg>
  );
}
