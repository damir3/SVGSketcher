import type { SketchDocument } from '../../../model/sketch';
import type { ToolContext } from '../types';

/** Keep a new dimension in the same transaction as its first value confirmation. */
export function withDimensionCreation<T>(
	sketch: SketchDocument,
	onEditDimension: ToolContext['onEditDimension'],
	apply: (edit: ToolContext['onEditDimension']) => T
): T {
	if (!onEditDimension || sketch.isInTransaction()) return apply(onEditDimension);
	const existing = new Set(sketch.constraints.keys());
	let awaitingConfirmation = false;
	sketch.beginTransaction();
	try {
		return apply((constraint, screenPos) => {
			const isNew = !existing.has(constraint.id);
			const handled = onEditDimension(constraint, screenPos, isNew);
			awaitingConfirmation = isNew && handled === true;
			return handled;
		});
	} finally {
		if (!awaitingConfirmation) sketch.commitTransaction();
	}
}
