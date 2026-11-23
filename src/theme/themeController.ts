import { DEFAULT_THEME, THEMES, findTheme, themeCssVariables, type Theme } from './themes';

const STORAGE_KEY = 'sketcher.theme';

type ThemeListener = (theme: Theme) => void;

let currentTheme: Theme = DEFAULT_THEME;
const listeners = new Set<ThemeListener>();

function readStoredThemeId(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

function storeThemeId(id: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		// Storage may be unavailable (private mode, sandboxed iframe); the theme still applies.
	}
}

export function getTheme(): Theme {
	return currentTheme;
}

/** Applies a theme to the document root and remembers the choice. */
export function setTheme(theme: Theme, persist = true): void {
	const root = document.documentElement;
	for (const [name, value] of Object.entries(themeCssVariables(theme))) {
		root.style.setProperty(name, value);
	}
	root.style.colorScheme = theme.colorScheme;
	root.dataset.theme = theme.id;
	currentTheme = theme;
	if (persist) storeThemeId(theme.id);
	for (const listener of listeners) listener(theme);
}

/** Switches to the next registered theme. */
export function cycleTheme(): Theme {
	const index = THEMES.indexOf(currentTheme);
	const next = THEMES[(index + 1) % THEMES.length];
	setTheme(next);
	return next;
}

/** Returns the theme `cycleTheme()` would switch to. */
export function getNextTheme(): Theme {
	return THEMES[(THEMES.indexOf(currentTheme) + 1) % THEMES.length];
}

export function onThemeChange(listener: ThemeListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Applies the stored theme (or the default one). Call before rendering the UI. */
export function initTheme(): Theme {
	setTheme(findTheme(readStoredThemeId()) ?? DEFAULT_THEME, false);
	return currentTheme;
}
