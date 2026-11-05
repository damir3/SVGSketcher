import * as opentype from 'opentype.js';

export interface FontInfo {
	id: string;
	name: string;
	family: string;
}

export const AVAILABLE_FONTS: FontInfo[] = [
	{ id: 'Arial', name: 'Arial (Sans-Serif)', family: 'Arial, sans-serif' },
	{ id: 'Times New Roman', name: 'Times New Roman (Serif)', family: '"Times New Roman", serif' },
	{ id: 'Courier New', name: 'Courier New (Monospace)', family: '"Courier New", monospace' },
];

const fontCache = new Map<string, opentype.Font>();

function getFontFileName(family: string, bold: boolean, italic: boolean): string {
	const fam = family.toLowerCase();
	if (fam.includes('times')) {
		if (bold && italic) return 'TimesNewRoman-BoldItalic.ttf';
		if (bold) return 'TimesNewRoman-Bold.ttf';
		if (italic) return 'TimesNewRoman-Italic.ttf';
		return 'TimesNewRoman.ttf';
	}
	if (fam.includes('courier')) {
		if (bold && italic) return 'CourierNew-BoldItalic.ttf';
		if (bold) return 'CourierNew-Bold.ttf';
		if (italic) return 'CourierNew-Italic.ttf';
		return 'CourierNew.ttf';
	}
	if (bold && italic) return 'Arial-BoldItalic.ttf';
	if (bold) return 'Arial-Bold.ttf';
	if (italic) return 'Arial-Italic.ttf';
	return 'Arial.ttf';
}

function getCacheKey(family: string, bold: boolean, italic: boolean): string {
	return `${family}_${bold ? '1' : '0'}_${italic ? '1' : '0'}`;
}

function parseFontBuffer(buffer: any): opentype.Font {
	const parseFn = (opentype as any).parse ?? (opentype as any).default?.parse;
	return parseFn(buffer);
}

/**
 * Synchronously retrieves a font.
 * In Node.js (tests), reads from public/fonts/.
 * In browser, returns cached font if already loaded.
 */
export function getFontSync(family = 'Arial', bold = false, italic = false): opentype.Font | null {
	const key = getCacheKey(family, bold, italic);
	if (fontCache.has(key)) {
		return fontCache.get(key)!;
	}

	// If in Node.js environment
	const proc = (globalThis as any).process;
	const isNode = typeof proc !== 'undefined' && Boolean(proc?.versions?.node);
	if (isNode) {
		try {
			const fs = proc?.getBuiltinModule?.('fs') ?? proc?.mainModule?.require?.('fs');
			const path = proc?.getBuiltinModule?.('path') ?? proc?.mainModule?.require?.('path');
			if (fs && path) {
				const filename = getFontFileName(family, bold, italic);
				const fullPath = path.join(proc?.cwd?.() || '.', 'public/fonts', filename);
				if (fs.existsSync(fullPath)) {
					const buf = fs.readFileSync(fullPath);
					const font = parseFontBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
					fontCache.set(key, font);
					return font;
				}
			}
		} catch {
			// ignore
		}
	}

	// Fallback to any already loaded font if exact key isn't loaded yet
	for (const font of fontCache.values()) {
		return font;
	}

	return null;
}

let onFontLoadedCallback: (() => void) | null = null;

export function setOnFontLoaded(callback: (() => void) | null): void {
	onFontLoadedCallback = callback;
}

/**
 * Asynchronously loads a font.
 * Works in both browser (via fetch) and Node.js.
 */
export async function loadFontAsync(family = 'Arial', bold = false, italic = false): Promise<opentype.Font | null> {
	const key = getCacheKey(family, bold, italic);
	if (fontCache.has(key)) {
		return fontCache.get(key)!;
	}

	const syncResult = getFontSync(family, bold, italic);
	if (syncResult) return syncResult;

	const proc = (globalThis as any).process;
	const isNode = typeof proc !== 'undefined' && Boolean(proc?.versions?.node);

	const filename = getFontFileName(family, bold, italic);

	if (!isNode && typeof window !== 'undefined' && typeof fetch === 'function') {
		try {
			const res = await fetch(`/fonts/${filename}`);
			if (res.ok) {
				const buffer = await res.arrayBuffer();
				const font = parseFontBuffer(buffer);
				fontCache.set(key, font);
				onFontLoadedCallback?.();
				return font;
			}
		} catch (err) {
			console.warn(`Failed to fetch font /fonts/${filename}:`, err);
		}
	}

	if (isLocalFontAccessSupported()) {
		const sysFont = await loadSystemFontBlob(family, bold, italic);
		if (sysFont) return sysFont;
	}

	return null;
}

/**
 * Loads a custom font from a File or Blob (e.g. user selected from disk).
 */
export async function loadFontFromFile(file: File | Blob, nameHint?: string): Promise<FontInfo> {
	const buffer = await file.arrayBuffer();
	const font = parseFontBuffer(buffer);
	const familyName =
		(font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) ||
		nameHint ||
		(typeof File !== 'undefined' && file instanceof File ? file.name.replace(/\.[^/.]+$/, '') : 'Custom Font');

	const id = familyName;
	fontCache.set(getCacheKey(id, false, false), font);
	fontCache.set(getCacheKey(id, true, false), font);
	fontCache.set(getCacheKey(id, false, true), font);
	fontCache.set(getCacheKey(id, true, true), font);

	let info = AVAILABLE_FONTS.find(f => f.id === id);
	if (!info) {
		info = { id, name: `${familyName} (Custom)`, family: `"${familyName}", sans-serif` };
		AVAILABLE_FONTS.push(info);
	}

	onFontLoadedCallback?.();
	return info;
}

/**
 * Checks if the Local Font Access API (window.queryLocalFonts) is supported in this browser.
 */
export function isLocalFontAccessSupported(): boolean {
	return typeof window !== 'undefined' && 'queryLocalFonts' in window;
}

/**
 * Queries available system fonts using the Local Font Access API (Chrome/Edge).
 */
export async function querySystemFonts(): Promise<FontInfo[]> {
	if (!isLocalFontAccessSupported()) {
		throw new Error('Local Font Access API is not supported in this browser.');
	}
	const fonts: any[] = await (window as any).queryLocalFonts();
	const added: FontInfo[] = [];
	const seen = new Set<string>();

	for (const f of fonts) {
		const family = f.family;
		if (!family || seen.has(family)) continue;
		seen.add(family);

		if (!AVAILABLE_FONTS.some(af => af.id === family)) {
			const info: FontInfo = {
				id: family,
				name: family,
				family: `"${family}", sans-serif`,
			};
			AVAILABLE_FONTS.push(info);
			added.push(info);
		}
	}

	if (added.length > 0) {
		const standard = ['Arial', 'Times New Roman', 'Courier New'];
		AVAILABLE_FONTS.sort((a, b) => {
			const aStd = standard.indexOf(a.id);
			const bStd = standard.indexOf(b.id);
			if (aStd !== -1 && bStd !== -1) return aStd - bStd;
			if (aStd !== -1) return -1;
			if (bStd !== -1) return 1;
			return a.name.localeCompare(b.name);
		});
	}

	return added;
}

/**
 * Loads the binary font data for a system font discovered via queryLocalFonts.
 */
export async function loadSystemFontBlob(family: string, bold = false, italic = false): Promise<opentype.Font | null> {
	if (!isLocalFontAccessSupported()) return null;
	const key = getCacheKey(family, bold, italic);
	if (fontCache.has(key)) return fontCache.get(key)!;

	try {
		const fonts: any[] = await (window as any).queryLocalFonts({ families: [family] });
		if (!fonts || fonts.length === 0) return null;
		let chosen = fonts[0];
		for (const f of fonts) {
			const style = (f.style || '').toLowerCase();
			if (bold && italic && (style.includes('bold italic') || style.includes('italic bold'))) {
				chosen = f;
				break;
			}
			if (bold && !italic && style.includes('bold') && !style.includes('italic')) {
				chosen = f;
				break;
			}
			if (italic && !bold && style.includes('italic') && !style.includes('bold')) {
				chosen = f;
				break;
			}
		}

		const blob = await chosen.blob();
		const buffer = await blob.arrayBuffer();
		const font = parseFontBuffer(buffer);
		fontCache.set(key, font);
		fontCache.set(getCacheKey(family, false, false), font);
		onFontLoadedCallback?.();
		return font;
	} catch (err) {
		console.warn(`Failed to load system font ${family}:`, err);
		return null;
	}
}

/**
 * Preload standard fonts on app startup.
 */
export async function preloadFonts(): Promise<void> {
	await Promise.all([
		loadFontAsync('Arial', false, false),
		loadFontAsync('Arial', true, false),
		loadFontAsync('Arial', false, true),
		loadFontAsync('Arial', true, true),
		loadFontAsync('Times New Roman', false, false),
		loadFontAsync('Times New Roman', true, false),
		loadFontAsync('Times New Roman', false, true),
		loadFontAsync('Times New Roman', true, true),
		loadFontAsync('Courier New', false, false),
		loadFontAsync('Courier New', true, false),
		loadFontAsync('Courier New', false, true),
		loadFontAsync('Courier New', true, true),
	]);
}
