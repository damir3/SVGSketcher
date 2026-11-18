import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as opentype from 'opentype.js';
import { serializeTextPath } from '../src/math/textSvg';
import { parseTextSvg } from './helpers/parseTextSvg';

const PathClass = (opentype as any).Path ?? (opentype as any).default?.Path;

test('text SVG keeps negative coordinates that round to zero separate in every command slot', () => {
	for (const tiny of [-0.000001, -0.0049, -0.005, -0.005000000001, -0.009, 0, 0.0049, -13 + 1e-15, 22 + 4e-15]) {
		for (const type of ['M', 'L', 'Q', 'C'] as const) {
			const keys =
				type === 'Q' ? ['x1', 'y1', 'x', 'y'] : type === 'C' ? ['x1', 'y1', 'x2', 'y2', 'x', 'y'] : ['x', 'y'];
			for (const key of keys) {
				const path = new PathClass();
				path.commands = [
					{ type: 'M', x: 10, y: 10 },
					Object.assign({ type, x: -6.55, y: 12.34, x1: 1.25, y1: -3.75, x2: -4.25, y2: 2.5 }, { [key]: tiny }),
					{ type: 'L', x: 100, y: 20 },
				];
				const before = structuredClone(path.commands);
				const parsed = parseTextSvg(serializeTextPath(path));
				assert.equal(parsed.length, 3);
				for (const coordinate of keys) {
					assert.ok(Math.abs((parsed[1] as any)[coordinate] - (path.commands[1] as any)[coordinate]) <= 0.00500000001);
				}
				assert.equal((parsed[2] as any).x, 100, 'commands after the near-zero coordinate survive');
				assert.deepEqual(path.commands, before, 'formatting leaves unrounded outlines intact');
			}
		}
	}
});
