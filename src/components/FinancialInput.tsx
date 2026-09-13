"use client";

import {
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { flushSync } from "react-dom";
import {
  amountInputError,
  formatAmountInput,
  normalizeAmountInput,
  normalizeIdentifierInput,
} from "./input-format";
import s from "./FinancialInput.module.css";

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "maxLength" | "onPaste" | "onFocus" | "onBlur"
> & {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
};

/** Group at rest; edit plain decimals so native selection and deletion stay predictable.
 * Invalid edits replace the parent's value too, invalidating any prepared financial action.
 * This is presentation only: callers must retain their protocol and balance validation.
 */
export function AmountInput({
  value,
  onValueChange,
  decimals,
  ...props
}: InputProps & { decimals: number }) {
  const [focused, setFocused] = useState(false);
  const [, renderEdit] = useReducer((revision: number) => revision + 1, 0);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionReplacesAll = useRef(false);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const error = amountInputError(value, decimals);
  const helpId = `${props.id}-format`;
  const display = focused ? value : formatAmountInput(value, decimals);

  useLayoutEffect(() => {
    if (focused && selection.current) {
      input.current?.setSelectionRange(
        selection.current.start,
        selection.current.end,
      );
      selection.current = null;
    }
    input.current?.setCustomValidity(error ?? "");
  });

  function update(raw: string, caret: number, fullReplacement = false) {
    const next = composing.current
      ? raw
      : normalizeAmountInput(raw, fullReplacement);
    if (next !== raw) {
      // Normalization only changes a prefix or separators, never fractional precision.
      const start = Math.max(0, caret + next.length - raw.length);
      selection.current = { start, end: start };
    }
    onValueChange(next);
    // Replacing a selection with identical text still moves the caret. The parent
    // may skip rendering when its value is unchanged, so commit this edit locally.
    renderEdit();
  }

  return (
    <span className={s.field}>
      <input
        {...props}
        ref={input}
        className={`${s.input} ${props.className ?? ""}`}
        type="text"
        inputMode={decimals === 0 ? "numeric" : "decimal"}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={display}
        aria-invalid={Boolean(error) || props["aria-invalid"] || false}
        aria-describedby={[props["aria-describedby"], helpId]
          .filter(Boolean)
          .join(" ")}
        onFocus={(event) => {
          const element = event.currentTarget;
          // Let the native focus/select operation finish before mapping its
          // selection. Changing value inside focus can cancel input.select().
          queueMicrotask(() => {
            if (document.activeElement !== element) return;
            const start = element.selectionStart ?? display.length;
            const end = element.selectionEnd ?? start;
            if (display !== value) {
              selection.current = {
                start: display.slice(0, start).replaceAll(",", "").length,
                end: display.slice(0, end).replaceAll(",", "").length,
              };
            }
            flushSync(() => setFocused(true));
          });
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const element = event.currentTarget;
          let raw = element.value;
          const caret = element.selectionStart ?? raw.length;
          // Locale keyboards may emit a comma. A single typed separator is a decimal;
          // whole pasted strings go through the ambiguity checks instead.
          const native = event.nativeEvent as InputEvent;
          if (
            !composing.current &&
            decimals > 0 &&
            native.data === "," &&
            raw[caret - 1] === ","
          ) {
            raw = `${raw.slice(0, caret - 1)}.${raw.slice(caret)}`;
            selection.current = { start: caret, end: caret };
          }
          update(
            raw,
            caret,
            native.data === element.value && (native.data?.length ?? 0) > 1,
          );
        }}
        onPaste={(event) => {
          event.preventDefault();
          const element = event.currentTarget;
          const start = element.selectionStart ?? value.length;
          const end = element.selectionEnd ?? start;
          // Normalize the complete candidate, not the clipboard fragment: zeros
          // pasted after a decimal point are significant fractional digits.
          const pasted = event.clipboardData.getData("text");
          const raw = `${value.slice(0, start)}${pasted}${value.slice(end)}`;
          selection.current = {
            start: start + pasted.length,
            end: start + pasted.length,
          };
          update(
            raw,
            start + pasted.length,
            start === 0 && end === value.length,
          );
        }}
        onCompositionStart={(event) => {
          composing.current = true;
          compositionReplacesAll.current =
            event.currentTarget.selectionStart === 0 &&
            event.currentTarget.selectionEnd === value.length;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          update(
            event.currentTarget.value,
            event.currentTarget.selectionStart ?? value.length,
            compositionReplacesAll.current,
          );
        }}
      />
      <small
        id={helpId}
        className={error ? s.error : s.help}
        aria-live="polite"
      >
        {error ??
          (decimals === 0
            ? "Whole basis points · for example 250"
            : `Up to ${decimals} decimals · decimal point: 1.25`)}
      </small>
    </span>
  );
}

/** Never mask an address by shortening it, lowercasing it or dropping invalid characters. */
export function IdentifierInput({
  value,
  onValueChange,
  kind,
  valid,
  ...props
}: InputProps & { kind: "address" | "hash"; valid: boolean }) {
  const helpId = `${props.id}-format`;
  const error = Boolean(value) && !valid;
  return (
    <span className={s.field}>
      <input
        {...props}
        className={`${s.input} ${props.className ?? ""}`}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="0x…"
        value={value}
        aria-invalid={error || props["aria-invalid"] || false}
        aria-describedby={[props["aria-describedby"], helpId]
          .filter(Boolean)
          .join(" ")}
        onChange={(event) =>
          onValueChange(normalizeIdentifierInput(event.target.value))
        }
      />
      <small
        id={helpId}
        className={error ? s.error : s.help}
        aria-live="polite"
      >
        {kind === "address"
          ? error
            ? "Enter a nonzero Ethereum address with a valid checksum. No characters have been removed."
            : "Full Ethereum address · 0x followed by 40 hexadecimal characters"
          : error
            ? "Enter a full transaction hash: 0x followed by 64 hexadecimal characters."
            : "Full transaction hash · 0x followed by 64 hexadecimal characters"}
      </small>
    </span>
  );
}
