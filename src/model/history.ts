import type { SketchImage } from './image';
import type { ConstraintSnapshot } from '../solver/constraints/serialization';
import type { SketchParameter } from '../math/expression';
import type {
	PointSnapshot,
	LineSnapshot,
	CircleSnapshot,
	ArcSnapshot,
	EllipseSnapshot,
	EllipticalArcSnapshot,
	SplineSnapshot,
	TextSnapshot,
} from './primitives';

export interface SketchSnapshot {
	points: PointSnapshot[];
	lines: LineSnapshot[];
	circles: CircleSnapshot[];
	arcs: ArcSnapshot[];
	ellipses: EllipseSnapshot[];
	ellipticalArcs: EllipticalArcSnapshot[];
	splines?: SplineSnapshot[];
	texts?: TextSnapshot[];
	images?: SketchImage[];
	constraints: ConstraintSnapshot[];
	parameters?: SketchParameter[];
	idCounter: number;
}

type Entity = { id: string };
type Change<T = Entity> = { before: T | null; after: T | null };
type DeltaMap<T = Entity> = Record<string, Change<T>>;
type SnapshotCollection =
	| 'points'
	| 'lines'
	| 'circles'
	| 'arcs'
	| 'ellipses'
	| 'ellipticalArcs'
	| 'splines'
	| 'texts'
	| 'images'
	| 'constraints';
type HistoryPatch = {
	collections: Partial<Record<SnapshotCollection, DeltaMap>>;
	parameters?: DeltaMap<SketchParameter>;
	idCounter?: { before: number; after: number };
	changedKeys: string[];
	coalesce?: boolean;
};

const SNAPSHOT_COLLECTIONS: readonly SnapshotCollection[] = [
	'points',
	'lines',
	'circles',
	'arcs',
	'ellipses',
	'ellipticalArcs',
	'splines',
	'texts',
	'images',
	'constraints',
];

function equalValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function diffEntries<T>(
	oldList: T[] | undefined,
	newList: T[] | undefined,
	getKey: (item: T) => string,
	prefix: string,
	changedKeys: string[]
): DeltaMap<T> {
	const oldMap = new Map((oldList ?? []).map(item => [getKey(item), item]));
	const newMap = new Map((newList ?? []).map(item => [getKey(item), item]));
	const delta: DeltaMap<T> = {};
	for (const key of new Set([...oldMap.keys(), ...newMap.keys()])) {
		const before = oldMap.get(key) ?? null;
		const after = newMap.get(key) ?? null;
		if (!equalValue(before, after)) {
			delta[key] = { before, after };
			changedKeys.push(`${prefix}:${key}`);
		}
	}
	return delta;
}

function applyDelta<T>(
	list: T[] | undefined,
	delta: DeltaMap<T>,
	getKey: (item: T) => string,
	direction: 'before' | 'after'
): T[] {
	const map = new Map((list ?? []).map(item => [getKey(item), item]));
	for (const [key, change] of Object.entries(delta)) {
		const value = change[direction];
		if (value) map.set(key, value);
		else map.delete(key);
	}
	return [...map.values()];
}

function mergeDelta<T>(target: DeltaMap<T>, source: DeltaMap<T>): void {
	for (const [key, change] of Object.entries(source)) {
		target[key] = { before: target[key] ? target[key].before : change.before, after: change.after };
	}
}

function makePatch(before: SketchSnapshot, after: SketchSnapshot): HistoryPatch | null {
	const changes: HistoryPatch['collections'] = {};
	const changedKeys: string[] = [];
	for (const name of SNAPSHOT_COLLECTIONS) {
		const delta = diffEntries(
			before[name] as Entity[] | undefined,
			after[name] as Entity[] | undefined,
			item => item.id,
			name,
			changedKeys
		);
		if (Object.keys(delta).length) changes[name] = delta;
	}
	const parameterChanges = diffEntries(before.parameters, after.parameters, p => p.name, 'parameters', changedKeys);
	const patch: HistoryPatch = { collections: changes, changedKeys };
	if (Object.keys(parameterChanges).length) patch.parameters = parameterChanges;
	if (before.idCounter !== after.idCounter) {
		patch.idCounter = { before: before.idCounter, after: after.idCounter };
		changedKeys.push('idCounter');
	}
	return changedKeys.length ? patch : null;
}

function applyPatch(snapshot: SketchSnapshot, patch: HistoryPatch, direction: 'before' | 'after'): SketchSnapshot {
	const result: SketchSnapshot = {
		...snapshot,
		points: [...snapshot.points],
		lines: [...snapshot.lines],
		circles: [...snapshot.circles],
		arcs: [...snapshot.arcs],
		ellipses: [...(snapshot.ellipses ?? [])],
		ellipticalArcs: [...(snapshot.ellipticalArcs ?? [])],
		constraints: [...snapshot.constraints],
	};
	for (const [name, delta] of Object.entries(patch.collections) as [SnapshotCollection, DeltaMap][]) {
		(result as any)[name] = applyDelta(result[name] as Entity[] | undefined, delta, item => item.id, direction);
	}
	if (patch.parameters) result.parameters = applyDelta(result.parameters, patch.parameters, p => p.name, direction);
	if (patch.idCounter) result.idCounter = patch.idCounter[direction];
	return result;
}

function patchHasChanges(patch: HistoryPatch): boolean {
	const hasDeltaChanges = (delta?: DeltaMap<unknown>) =>
		Object.values(delta ?? {}).some(change => !equalValue(change.before, change.after));
	return (
		Object.values(patch.collections).some(hasDeltaChanges) ||
		hasDeltaChanges(patch.parameters) ||
		(!!patch.idCounter && patch.idCounter.before !== patch.idCounter.after)
	);
}

export class HistoryManager {
	private undoStack: HistoryPatch[] = [];
	private redoStack: HistoryPatch[] = [];
	private pending: SketchSnapshot | null = null;
	private coalescePending = true;
	private maxHistory = 60;

	pushState(snapshot: SketchSnapshot, coalesce = true): void {
		if (this.pending) this.finalize(snapshot);
		this.pending = snapshot;
		this.coalescePending = coalesce;
	}

	private finalize(after: SketchSnapshot): void {
		if (!this.pending) return;
		const patch = makePatch(this.pending, after);
		this.pending = null;
		if (!patch) return;
		patch.coalesce = this.coalescePending;
		this.redoStack = [];
		const previous = this.undoStack[this.undoStack.length - 1];
		if (
			patch.coalesce &&
			previous?.coalesce &&
			previous.changedKeys.length === patch.changedKeys.length &&
			previous.changedKeys.every(key => patch.changedKeys.includes(key))
		) {
			for (const [name, entities] of Object.entries(patch.collections) as [SnapshotCollection, DeltaMap][]) {
				mergeDelta(previous.collections[name] ?? (previous.collections[name] = {}), entities);
			}
			if (patch.parameters) mergeDelta(previous.parameters ?? (previous.parameters = {}), patch.parameters);
			if (patch.idCounter)
				previous.idCounter = {
					before: previous.idCounter?.before ?? patch.idCounter.before,
					after: patch.idCounter.after,
				};
			if (!patchHasChanges(previous)) this.undoStack.pop();
			return;
		}
		this.undoStack.push(patch);
		if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
		this.redoStack = [];
	}

	canUndo(currentSnapshot?: SketchSnapshot): boolean {
		if (currentSnapshot) this.finalize(currentSnapshot);
		return this.undoStack.length > 0;
	}
	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(currentSnapshot: SketchSnapshot): SketchSnapshot | null {
		this.finalize(currentSnapshot);
		const patch = this.undoStack.pop();
		if (!patch) return null;
		this.redoStack.push(patch);
		return applyPatch(currentSnapshot, patch, 'before');
	}

	redo(currentSnapshot: SketchSnapshot): SketchSnapshot | null {
		const patch = this.redoStack.pop();
		if (!patch) return null;
		this.undoStack.push(patch);
		return applyPatch(currentSnapshot, patch, 'after');
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.pending = null;
	}
}
