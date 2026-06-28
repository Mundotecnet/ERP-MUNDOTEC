import * as React from 'react';

import { Input, InputProps } from './input';
import { formatMoney, parseMoney } from '@/lib/money';

// PR-36 — Input para moneda estilo CR ("1.000,00").
//
// Comportamiento:
// - En blur (no focused) muestra el valor formateado: formatMoney(value).
// - Al hacer focus el input pasa al "draft mode": muestra el valor canónico
//   editable (sin separadores de miles) y selecciona el texto para escritura
//   fluida.
// - Mientras el usuario tipea, cada keystroke intenta parseMoney(); si el
//   parser devuelve un número válido (tolerante a "1.000,00", "1428,57",
//   "142.86", "1000"), dispara onChange con el canónico (string sin separador
//   de miles, punto decimal). Si no es parseable, el draft se mantiene pero
//   NO se notifica onChange — el padre conserva el último valor canónico
//   válido para no romper el recálculo bidireccional.
// - El estado y los payloads del padre siguen siendo strings canónicos
//   ("142.86"). El formato es estrictamente capa de UI.
export interface MoneyInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  value: string;
  onChange(canonical: string): void;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const display = focused ? draft : formatMoney(value);

  return (
    <Input
      {...rest}
      ref={ref}
      inputMode="decimal"
      value={display}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value ?? '');
        // Selecciona el texto para que el usuario pueda sobreescribir sin
        // tener que borrar manualmente.
        e.target.select();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const parsed = parseMoney(raw);
        if (Number.isFinite(parsed)) {
          onChange(String(parsed));
        }
      }}
    />
  );
});
