type NoriaLogoProps = { className?: string };

// A turning pair of scoops frames an open range. Paths keep the wordmark independent of fonts.
export function NoriaLogo({ className }: NoriaLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 228 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#D3F78B"
        d="M31 6H46L39 17H31A14 14 0 0 0 17 31V39L6 46V31A25 25 0 0 1 31 6Z"
      />
      <path
        fill="#78D9C1"
        d="M33 58H18L25 47H33A14 14 0 0 0 47 33V25L58 18V33A25 25 0 0 1 33 58Z"
      />
      <g
        fill="none"
        stroke="#EEF3EC"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M82 50V27M82 36C82 29.4 86.6 25 93.5 25S105 29.4 105 36V50" />
        <circle cx="127" cy="37.5" r="12.5" />
        <path d="M151 50V27M151 35C151 28.8 157 24.1 164 26" />
        <path d="M178 28V50" />
        <circle cx="204" cy="37.5" r="12.5" />
        <path d="M216.5 25V50" />
      </g>
      <circle cx="178" cy="16" r="3.2" fill="#EEF3EC" />
    </svg>
  );
}
