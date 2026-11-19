import React from 'react';
import { Layers, Moon, Sun } from 'lucide-react';
import { THEME_OPTIONS, useTheme } from '../context/ThemeContext';

const ICONOS = {
  daylight: Sun,
  slate: Layers,
  obsidian: Moon,
};

export default function ThemeToggle({ className = '', mostrarEtiqueta = true }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      data-testid="theme-selector"
      role="group"
      aria-label="Tema corporativo"
      className={`inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-[var(--shadow-card)] ${className}`}
    >
      {THEME_OPTIONS.map(({ id, label, nombre }) => {
        const Icono = ICONOS[id];
        const activo = theme === id;

        return (
          <button
            key={id}
            type="button"
            onClick={() => setTheme(id)}
            aria-pressed={activo}
            aria-label={`Tema ${nombre}`}
            title={`Tema ${nombre}`}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors active:scale-[0.98] ${
              activo
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-main)] hover:text-[var(--color-text)]'
            }`}
          >
            <Icono className="h-3.5 w-3.5" strokeWidth={1.75} />
            {mostrarEtiqueta ? (
              <span className="hidden sm:inline">{label}</span>
            ) : (
              <span className="sr-only">{label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
