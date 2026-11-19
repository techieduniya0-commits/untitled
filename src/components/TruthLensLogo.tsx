interface TruthLensLogoProps {
  compact?: boolean;
}

export function TruthLensLogo({ compact = false }: TruthLensLogoProps) {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        width="26"
        height="26"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="#172554" />
        <circle cx="13.5" cy="13.5" r="5.5" stroke="#FFFFFF" strokeWidth="2.1" />
        <path
          d="M17.6 17.6L21.2 21.2"
          stroke="#60A5FA"
          strokeWidth="2.3"
          strokeLinecap="round"
        />
        <circle cx="13.5" cy="13.5" r="1.8" fill="#2563EB" />
      </svg>
      {!compact && (
        <span className="font-[var(--font-display)] text-[17px] font-bold tracking-[-0.02em] text-[#172554]">
          TruthLens
        </span>
      )}
    </span>
  );
}
