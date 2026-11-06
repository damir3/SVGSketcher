import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager, type SketchSnapshot } from '../src/model/history';

function snapshot(x: number, idCounter = 0): SketchSnapshot {
	return {
		points: [{ id: 'Point-1', x, y: 0, fixed: false } as any],
		lines: [],
		circles: [],
		arcs: [],
		ellipses: [],
		ellipticalArcs: [],
		constraints: [],
		parameters: [],
		idCounter,
	};
}

describe('HistoryManager', () => {
	it('does not create history for an unchanged state', () => {
		const history = new HistoryManager();
		const same = snapshot(0);
		history.pushState(same);
		assert.equal(history.undo(same), null);
		assert.equal(history.canUndo(), false);
		assert.equal(history.canRedo(), false);
	});

	it('stores only a change and supports undo and redo', () => {
		const history = new HistoryManager();
		const before = snapshot(0);
		const after = snapshot(4);
		history.pushState(before);
		assert.deepEqual(history.undo(after), before);
		assert.deepEqual(history.redo(before), after);
	});

	it('coalesces repeated changes to the same entity into one undo step', () => {
		const history = new HistoryManager();
		const before = snapshot(0);
		const middle = snapshot(3);
		const after = snapshot(8);
		history.pushState(before);
		history.pushState(middle);
		history.pushState(after);
		assert.deepEqual(history.undo(after), before);
		assert.equal(history.canUndo(), false);
		assert.deepEqual(history.redo(before), after);
	});
});
