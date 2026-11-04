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
} from './primitives/serialization';

export interface SketchSnapshot {
	points: PointSnapshot[];
	lines: LineSnapshot[];
	circles: CircleSnapshot[];
	arcs: ArcSnapshot[];
	ellipses: EllipseSnapshot[];
	ellipticalArcs: EllipticalArcSnapshot[];
	splines?: SplineSnapshot[];
	constraints: ConstraintSnapshot[];
	parameters?: SketchParameter[];
	idCounter: number;
}

type Entity = { id: string };
type EntityChange = { before: Entity | null; after: Entity | null };
type SnapshotCollection =
	| 'points'
	| 'lines'
	| 'circles'
	| 'arcs'
	| 'ellipses'
	| 'ellipticalArcs'
	| 'splines'
	| 'constraints';
type HistoryPatch = {
	collections: Partial<Record<SnapshotCollection, Record<string, EntityChange>>>;
	parameters?: Record<string, { before: SketchParameter | null; after: SketchParameter | null }>;
	idCounter?: { before: number; after: number };
	changedKeys: string[];
};

function equalValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function makePatch(before: SketchSnapshot, after: SketchSnapshot): HistoryPatch | null {
	const collections: SnapshotCollection[] = [
		'points',
		'lines',
		'circles',
		'arcs',
		'ellipses',
		'ellipticalArcs',
		'splines',
		'constraints',
	];
	const changes: HistoryPatch['collections'] = {};
	const changedKeys: string[] = [];
	for (const name of collections) {
		const oldList = (before[name] ?? []) as Entity[];
		const newList = (after[name] ?? []) as Entity[];
		const oldMap = new Map(oldList.map(item => [item.id, item]));
		const newMap = new Map(newList.map(item => [item.id, item]));
		const delta: Record<string, EntityChange> = {};
		for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
			const oldItem = oldMap.get(id) ?? null;
			const newItem = newMap.get(id) ?? null;
			if (!equalValue(oldItem, newItem)) {
				delta[id] = { before: oldItem, after: newItem };
				changedKeys.push(`${name}:${id}`);
			}
		}
		if (Object.keys(delta).length) changes[name] = delta;
	}
	const oldParameters = new Map((before.parameters ?? []).map(item => [item.name, item]));
	const newParameters = new Map((after.parameters ?? []).map(item => [item.name, item]));
	const parameterChanges: NonNullable<HistoryPatch['parameters']> = {};
	for (const name of new Set([...oldParameters.keys(), ...newParameters.keys()])) {
		const oldItem = oldParameters.get(name) ?? null;
		const newItem = newParameters.get(name) ?? null;
		if (!equalValue(oldItem, newItem)) {
			parameterChanges[name] = { before: oldItem, after: newItem };
			changedKeys.push(`parameters:${name}`);
		}
	}
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
	if (snapshot.splines || patch.collections.splines) result.splines = [...(snapshot.splines ?? [])];
	if (snapshot.parameters || patch.parameters) result.parameters = [...(snapshot.parameters ?? [])];
	for (const [name, delta] of Object.entries(patch.collections) as [
		SnapshotCollection,
		Record<string, EntityChange>,
	][]) {
		const list = result[name] as Entity[];
		const map = new Map(list.map(item => [item.id, item]));
		for (const [id, change] of Object.entries(delta)) {
			const value = change[direction];
			if (value) map.set(id, value);
			else map.delete(id);
		}
		(result as any)[name] = [...map.values()];
	}
	if (patch.parameters) {
		const map = new Map((result.parameters ?? []).map(item => [item.name, item]));
		for (const [name, change] of Object.entries(patch.parameters)) {
			const value = change[direction];
			if (value) map.set(name, value);
			else map.delete(name);
		}
		result.parameters = [...map.values()];
	}
	if (patch.idCounter) result.idCounter = patch.idCounter[direction];
	return result;
}

function patchHasChanges(patch: HistoryPatch): boolean {
	for (const delta of Object.values(patch.collections)) {
		for (const change of Object.values(delta ?? {})) {
			if (!equalValue(change.before, change.after)) return true;
		}
	}
	for (const change of Object.values(patch.parameters ?? {})) {
		if (!equalValue(change.before, change.after)) return true;
	}
	return !!patch.idCounter && patch.idCounter.before !== patch.idCounter.after;
}

export class HistoryManager {
	private undoStack: HistoryPatch[] = [];
	private redoStack: HistoryPatch[] = [];
	private pending: SketchSnapshot | null = null;
	private maxHistory = 60;

	pushState(snapshot: SketchSnapshot): void {
		if (this.pending) this.finalize(snapshot);
		this.pending = snapshot;
	}

	private finalize(after: SketchSnapshot): void {
		if (!this.pending) return;
		const patch = makePatch(this.pending, after);
		this.pending = null;
		if (!patch) return;
		this.redoStack = [];
		const previous = this.undoStack[this.undoStack.length - 1];
		if (
			previous &&
			previous.changedKeys.length === patch.changedKeys.length &&
			previous.changedKeys.every(key => patch.changedKeys.includes(key))
		) {
			for (const [name, entities] of Object.entries(patch.collections) as [
				SnapshotCollection,
				Record<string, EntityChange>,
			][]) {
				const target = previous.collections[name] ?? (previous.collections[name] = {});
				for (const [id, change] of Object.entries(entities))
					target[id] = {
						before: target[id] ? target[id].before : change.before,
						after: change.after,
					};
			}
			for (const [name, change] of Object.entries(patch.parameters ?? {})) {
				const target = previous.parameters ?? (previous.parameters = {});
				target[name] = {
					before: target[name] ? target[name].before : change.before,
					after: change.after,
				};
			}
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
