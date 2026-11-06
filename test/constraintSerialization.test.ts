import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircularPatternConstraint, FixedConstraint } from '../src/solver/constraints';
import { ConstraintPanel } from '../src/ui/panels/constraints/constraintPanel';
import { deserializeConstraint, serializeConstraint } from '../src/solver/constraints/serialization';

describe('Constraint snapshot serialization', () => {
	it('round-trips a simple constraint without runtime UI state', () => {
		const fixed = new FixedConstraint('c_fix_1', 'Point-1', 12.5, -3, 0.75);

		const snapshot = serializeConstraint(fixed);
		assert.equal('sidebarPanel' in snapshot, false);

		const restored = deserializeConstraint(snapshot);
		assert.ok(restored instanceof FixedConstraint);
		assert.ok(restored.sidebarPanel instanceof ConstraintPanel);
		assert.equal(restored.id, fixed.id);
		assert.equal(restored.pointId, fixed.pointId);
		assert.equal(restored.targetX, fixed.targetX);
		assert.equal(restored.targetY, fixed.targetY);
		assert.equal(restored.weight, fixed.weight);
	});

	it('deep-copies nested constraint data and restores the correct class', () => {
		const pattern = new CircularPatternConstraint(
			'c_pattern_1',
			'Point-center',
			['Line-source'],
			'partial',
			135,
			3,
			true,
			[2],
			[
				{
					copyIndex: 1,
					pointPairs: [{ sourcePtId: 'Point-source', patternPtId: 'Point-copy' }],
					radiusPairs: [{ sourceCircleId: 'Circle-source', patternCircleId: 'Circle-copy' }],
					createdEntityIds: [{ id: 'Point-copy', type: 'point' }],
				},
			],
			0.8,
			true,
			'angle * 3'
		);

		const snapshot = serializeConstraint(pattern);
		pattern.copies[0].pointPairs[0].sourcePtId = 'Point-mutated';
		assert.equal(snapshot.copies[0].pointPairs[0].sourcePtId, 'Point-source');

		const restored = deserializeConstraint(snapshot);
		assert.ok(restored instanceof CircularPatternConstraint);
		assert.equal(restored.isReadOnly, true);
		assert.equal(restored.totalAngleExpression, 'angle * 3');
		assert.deepEqual(restored.copies, snapshot.copies);

		snapshot.copies[0].pointPairs[0].patternPtId = 'Point-snapshot-mutated';
		assert.equal(restored.copies[0].pointPairs[0].patternPtId, 'Point-copy');
	});
});
