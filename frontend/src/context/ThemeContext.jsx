import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'documind_theme';
const DEFAULT_THEME = 'daylight';
const THEMES = ['daylight', 'slate', 'obsidian'];

const LEGACY_MAP = {
  light: 'daylight',
  dark: 'obsidian',
};

export const THEME_OPTIONS = [
  {
    id: 'daylight',
    label: 'Daylight',
    nombre: 'Linear Daylight',
    descripcion: 'Tema claro corporativo por defecto',
  },
  {
    id: 'slate',
    label: 'Slate',
    nombre: 'Stripe Slate',
    descripcion: 'Superficies neutras con barra lateral oscura',
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    nombre: 'Midnight Obsidian',
    descripcion: 'Tema oscuro de alta densidad visual',
  },
];

export function normalizarTema(valor) {
  if (THEMES.includes(valor)) return valor;
  if (LEGACY_MAP[valor]) return LEGACY_MAP[valor];
  return DEFAULT_THEME;
}

function leerTemaPersistido() {
  try {
    return normalizarTema(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function aplicarTema(tema) {
  if (typeof document === 'undefined') return;
  const raiz = document.documentElement;
  const esquema = tema === 'obsidian' ? 'dark' : 'light';
  raiz.dataset.corpTheme = tema;
  raiz.dataset.theme = esquema;
  raiz.style.colorScheme = esquema;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const tema = leerTemaPersistido();
    aplicarTema(tema);
    return tema;
  });

  useEffect(() => {
    aplicarTema(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // La preferencia es opcional; la aplicación sigue funcionando sin persistencia.
    }
  }, [theme]);

  const setTheme = useCallback((tema) => {
    setThemeState(normalizarTema(tema));
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((actual) => {
      const indice = THEMES.indexOf(actual);
      return THEMES[(indice + 1) % THEMES.length];
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((actual) => (actual === 'obsidian' ? 'daylight' : 'obsidian'));
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themes: THEME_OPTIONS,
        setTheme,
        cycleTheme,
        toggleTheme,
        isDark: theme === 'obsidian',
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  }
  return context;
}

export default ThemeContext;
