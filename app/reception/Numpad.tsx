'use client';

import { NUMBER_MAX_LENGTH, NUMBER_MIN_LENGTH } from '@/lib/domain/access-number';

/**
 * 番号入力のテンキー。
 *
 * 4〜6桁を受け付ける。5・6桁目は「入れてもよい」ことが分かるよう
 * 薄く表示しておき、4桁時点で決定できるようにする。
 * 大半の来店客は4桁なので、6桁分の入力を待たせない。
 */
export function Numpad({
  digits,
  busy,
  submitLabel,
  onDigit,
  onBackspace,
  onSubmit,
}: {
  digits: string;
  busy: boolean;
  submitLabel: string;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = digits.length >= NUMBER_MIN_LENGTH && !busy;

  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <div className="mb-5 flex justify-center gap-1.5">
        {Array.from({ length: NUMBER_MAX_LENGTH }, (_, i) => {
          const filled = i < digits.length;
          // 最低桁を超えた枠は任意入力。薄くして「無くてもよい」を示す
          const optional = i >= NUMBER_MIN_LENGTH;
          return (
            <span
              key={i}
              className={[
                'flex h-14 w-11 items-center justify-center rounded-t-md border-b-4 text-2xl font-bold transition-colors',
                filled
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-slate-50 text-slate-400',
                !filled && optional ? 'opacity-40' : '',
              ].join(' ')}
            >
              {digits[i] ?? ''}
            </span>
          );
        })}
      </div>

      <div className="grid w-full grid-cols-3 gap-2.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => onDigit(d)}>
            {d}
          </Key>
        ))}
        <Key onClick={onBackspace} muted aria-label="1文字消す">
          ←
        </Key>
        <Key onClick={() => onDigit('0')}>0</Key>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="rounded-xl bg-indigo-600 py-5 text-lg font-bold text-white shadow-lg transition-colors disabled:bg-slate-300 disabled:shadow-none"
        >
          {busy ? '送信中' : submitLabel}
        </button>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  muted = false,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  muted?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-xl py-5 text-xl font-semibold shadow-sm ring-1 ring-slate-200 transition active:scale-95',
        muted ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-900',
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
