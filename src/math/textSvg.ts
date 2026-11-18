import type * as opentype from 'opentype.js';

/** Round a copy before opentype packs numbers and chooses SVG separators. */
export function serializeTextPath(path: opentype.Path): string {
	const safe: opentype.Path = Object.create(path);
	safe.commands = path.commands.map(
		command =>
			Object.fromEntries(
				Object.entries(command).map(([key, value]) => [
					key,
					typeof value === 'number' ? Number(value.toFixed(2)) : value,
				])
			) as opentype.PathCommand
	);
	// This also avoids opentype's decimal rounding producing NaN near exact integers.
	return safe.toPathData(2);
}
