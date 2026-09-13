"use client";
import { useEffect, useState } from "react";
import s from "./OperationProgress.module.css";

/** Shows observed work only; elapsed time never implies financial completion. */
export function OperationProgress({ label }: { label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    setSeconds(0);
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [label]);
  return (
    <div className={s.progress}>
      <span className={s.spinner} aria-hidden="true" />
      <div>
        <p role="status">{label}</p>
        <small aria-hidden="true">{seconds}s elapsed</small>
      </div>
    </div>
  );
}
