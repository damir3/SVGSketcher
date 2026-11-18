import assert from 'node:assert/strict';
import type { TextCommand } from '../../src/kernel/textTypes';

/** Parse the entire explicit M/L/Q/C/Z stream, rejecting missing or merged coordinates. */
export function parseTextSvg(data: string): TextCommand[] {
	const number = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/y;
	const fields = {
		M: ['x', 'y'],
		L: ['x', 'y'],
		Q: ['x1', 'y1', 'x', 'y'],
		C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'],
		Z: [],
	};
	let at = 0;
	const commands: TextCommand[] = [];
	const skipSpace = () => {
		while (/[\s,]/.test(data[at] ?? '') && at < data.length) at++;
	};
	while (at < data.length) {
		skipSpace();
		if (at === data.length) break;
		const tag = data[at++] as keyof typeof fields;
		assert.ok(Object.hasOwn(fields, tag), `expected SVG command at ${at - 1}`);
		const command: any = { type: tag };
		for (const field of fields[tag]) {
			skipSpace();
			number.lastIndex = at;
			const match = number.exec(data);
			assert.ok(match, `missing ${field} for ${tag} at ${at}`);
			command[field] = Number(match[0]);
			at = number.lastIndex;
		}
		commands.push(command);
	}
	return commands;
}
