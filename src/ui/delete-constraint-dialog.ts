import type { IConstraint } from '../solver/types';
import {
	CircularPatternConstraint,
	OffsetConstraint,
	RectangularPatternConstraint,
	SymmetryConstraint,
} from '../solver/constraints';

export type ConstraintDeleteChoice = 'delete-geometry' | 'keep-geometry' | 'cancel';
export type ConfirmConstraintDelete = (constraints: IConstraint[]) => Promise<ConstraintDeleteChoice>;

function describeConstraint(constraint: IConstraint): { title: string; noun: string } {
	if (constraint instanceof OffsetConstraint) {
		return { title: 'Delete Offset Constraint?', noun: 'offset constraint' };
	}
	if (constraint instanceof CircularPatternConstraint) {
		return { title: 'Delete Circular Pattern?', noun: 'circular pattern' };
	}
	if (constraint instanceof RectangularPatternConstraint) {
		return { title: 'Delete Rectangular Pattern?', noun: 'rectangular pattern' };
	}
	if (constraint instanceof SymmetryConstraint && constraint.isMirrorCopy) {
		return { title: 'Delete Mirror Constraint?', noun: 'mirror constraint' };
	}
	return { title: 'Delete Constraint?', noun: 'constraint' };
}

export class DeleteConstraintDialog {
	private dialog: HTMLDialogElement;
	private titleEl: HTMLHeadingElement;
	private messageEl: HTMLParagraphElement;
	private cancelBtn: HTMLButtonElement;
	private keepBtn: HTMLButtonElement;
	private deleteBtn: HTMLButtonElement;
	private pendingResolve: ((choice: ConstraintDeleteChoice) => void) | null = null;

	constructor() {
		this.dialog = document.createElement('dialog');
		this.dialog.className = 'confirm-delete-dialog';
		this.dialog.setAttribute('aria-labelledby', 'confirm-delete-constraint-title');
		this.dialog.setAttribute('aria-describedby', 'confirm-delete-constraint-desc');
		this.dialog.innerHTML = `
			<div class="confirm-delete-content">
				<h2 id="confirm-delete-constraint-title"></h2>
				<p id="confirm-delete-constraint-desc"></p>
				<div class="confirm-delete-actions">
					<button type="button" class="btn-header" data-choice="cancel">Cancel</button>
					<button type="button" class="btn-header" data-choice="keep-geometry">Keep Geometry</button>
					<button type="button" class="btn-header danger" data-choice="delete-geometry">Delete Geometry</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.dialog);

		this.titleEl = this.dialog.querySelector<HTMLHeadingElement>('#confirm-delete-constraint-title')!;
		this.messageEl = this.dialog.querySelector<HTMLParagraphElement>('#confirm-delete-constraint-desc')!;
		this.cancelBtn = this.dialog.querySelector<HTMLButtonElement>('[data-choice="cancel"]')!;
		this.keepBtn = this.dialog.querySelector<HTMLButtonElement>('[data-choice="keep-geometry"]')!;
		this.deleteBtn = this.dialog.querySelector<HTMLButtonElement>('[data-choice="delete-geometry"]')!;

		this.cancelBtn.addEventListener('click', () => this.finish('cancel'));
		this.keepBtn.addEventListener('click', () => this.finish('keep-geometry'));
		this.deleteBtn.addEventListener('click', () => this.finish('delete-geometry'));

		this.dialog.addEventListener('keydown', e => e.stopPropagation());
		this.dialog.addEventListener('cancel', e => {
			e.preventDefault();
			this.finish('cancel');
		});
		this.dialog.addEventListener('click', e => {
			if (e.target === this.dialog) {
				this.finish('cancel');
			}
		});
	}

	open(constraints: IConstraint[]): Promise<ConstraintDeleteChoice> {
		if (this.pendingResolve) {
			this.finish('cancel');
		}

		if (constraints.length === 1) {
			const { title, noun } = describeConstraint(constraints[0]);
			this.titleEl.textContent = title;
			this.messageEl.textContent = `Do you also want to delete the geometry created by this ${noun}, or keep it as independent geometry?`;
		} else {
			this.titleEl.textContent = 'Delete Constraints?';
			this.messageEl.textContent =
				'Do you also want to delete the geometry created by these constraints, or keep it as independent geometry?';
		}

		return new Promise<ConstraintDeleteChoice>(resolve => {
			this.pendingResolve = resolve;
			this.dialog.showModal();
			this.keepBtn.focus();
		});
	}

	private finish(choice: ConstraintDeleteChoice): void {
		const resolve = this.pendingResolve;
		this.pendingResolve = null;
		if (this.dialog.open) {
			this.dialog.close(choice);
		}
		resolve?.(choice);
	}

	destroy(): void {
		if (this.pendingResolve) {
			this.finish('cancel');
		}
		this.dialog.remove();
	}
}
