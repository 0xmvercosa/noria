import s from "./NoriaApp.module.css";

export function TokenPair({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`${s.tokenPair} ${small ? s.tokenPairSmall : ""}`}
      aria-hidden="true"
    >
      <span className={s.bitcoin}>₿</span>
      <span className={s.ethereum}>◆</span>
    </span>
  );
}

export function PoolTokens({
  token0,
  token1,
}: {
  token0: string;
  token1: string;
}) {
  return (
    <span className={`${s.tokenPair} ${s.dynamicTokens}`} aria-hidden="true">
      <span>{token0.slice(0, 2).toUpperCase()}</span>
      <span>{token1.slice(0, 2).toUpperCase()}</span>
    </span>
  );
}

export function GraphMark() {
  return (
    <svg
      viewBox="0 0 28 28"
      width="22"
      height="22"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="11.5"
        cy="11"
        r="6.5"
        stroke="currentColor"
        strokeWidth="2.6"
      />
      <path d="m16.5 18.5-7 7" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="23" cy="4.5" r="2" fill="currentColor" />
    </svg>
  );
}
