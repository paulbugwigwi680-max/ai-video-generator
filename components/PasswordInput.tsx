"use client";

import { useState } from "react";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  placeholder?: string;
};

export default function PasswordInput({ id, value, onChange, autoComplete, minLength, placeholder }: Props) {
  const [show, setShow] = useState(false);

  return (
    <div className="pw">
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        value={value}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="pw-toggle"
        aria-label={show ? "Ficha nenosiri" : "Onyesha nenosiri"}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
      >
        {show ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
