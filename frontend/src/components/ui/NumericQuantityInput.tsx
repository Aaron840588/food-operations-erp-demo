import { Minus, Plus } from "lucide-react";
import { useState } from "react";

type NumericQuantityInputProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  inputClassName?: string;
};

function clamp(value: number, min: number, max?: number) {
  return Math.min(Math.max(value, min), max ?? Number.POSITIVE_INFINITY);
}

export function NumericQuantityInput({
  value,
  onChange,
  label,
  min = 0,
  max,
  step = 1,
  disabled = false,
  size = "md",
  className = "",
  inputClassName = "",
}: NumericQuantityInputProps) {
  const [draft, setDraft] = useState(() => ({
    sourceValue: value,
    text: String(value),
  }));
  const inputValue = draft.sourceValue === value ? draft.text : String(value);

  const commit = (rawValue = inputValue) => {
    const parsed = Number(rawValue);
    const normalized = clamp(Number.isFinite(parsed) ? parsed : min, min, max);
    setDraft({ sourceValue: normalized, text: String(normalized) });
    if (normalized !== value) onChange(normalized);
  };

  const stepBy = (delta: number) => {
    const parsed = inputValue.trim() === "" ? value : Number(inputValue);
    const current = Number.isFinite(parsed) ? parsed : value;
    const nextValue = clamp(current + delta, min, max);
    setDraft({ sourceValue: nextValue, text: String(nextValue) });
    onChange(nextValue);
  };

  const isSm = size === "sm";

  return (
    <div className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => stepBy(-step)}
        disabled={disabled || Number(inputValue || value) <= min}
        aria-label={`Decrease ${label}`}
        className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-45"
      >
        <Minus size={isSm ? 14 : 16} strokeWidth={2.5} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={inputValue}
        disabled={disabled}
        onFocus={(event) => {
          setDraft({ sourceValue: value, text: String(value) });
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const nextText = event.target.value;
          if (nextText === "" || /^\d*\.?\d*$/.test(nextText)) {
            setDraft({ sourceValue: value, text: nextText });
          }
        }}
        onBlur={() => commit()}
        className={`quantity-input border border-[#dfd5c6] bg-[#fbf8f2] px-1 text-center font-mono font-black tabular-nums text-slate-900 ${
          isSm ? "h-[44px] w-16 min-w-16 rounded-xl text-sm" : "h-[44px] w-24 min-w-24 rounded-xl text-base"
        } ${inputClassName}`}
      />
      <button
        type="button"
        onClick={() => stepBy(step)}
        disabled={disabled || (max !== undefined && Number(inputValue || value) >= max)}
        aria-label={`Increase ${label}`}
        className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-45"
      >
        <Plus size={isSm ? 14 : 16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
