import type { DistanceConstraint, RadiusConstraint, AngleConstraint } from '../solver/constraints';
import type { SketchDocument } from '../model/sketch';
import type { Vec2 } from '../math/vector';

export class DimensionModal {
  private modalEl: HTMLElement;
  private sketch: SketchDocument;
  private currentConstraint: DistanceConstraint | RadiusConstraint | AngleConstraint | null = null;

  constructor(sketch: SketchDocument) {
    this.sketch = sketch;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'dimension-popup hidden';
    document.body.appendChild(this.modalEl);

    this.bindEvents();
  }

  open(constraint: DistanceConstraint | RadiusConstraint | AngleConstraint, screenPos?: Vec2): void {
    this.currentConstraint = constraint;
    const isDistance = 'targetDistance' in constraint;
    const isAngle = 'targetAngle' in constraint;
    const curVal = isDistance
      ? constraint.targetDistance
      : isAngle
      ? constraint.targetAngle
      : constraint.targetRadius;
    const title = isDistance ? 'Modify Distance' : isAngle ? 'Modify Angle' : 'Modify Radius';
    const unit = isAngle ? '°' : 'mm';
    const step = isAngle ? '0.5' : '1';
    const minVal = isAngle ? '0.1' : '1';
    const maxAttr = isAngle ? 'max="179.9"' : '';

    this.modalEl.innerHTML = `
      <div class="dim-popup-title">${title}</div>
      <div class="dim-popup-body">
        <div class="dim-input-wrapper">
          <input type="number" step="${step}" min="${minVal}" ${maxAttr} id="dim-input-val" value="${curVal.toFixed(1)}" autofocus />
          <span class="dim-unit">${unit}</span>
        </div>
        <div class="dim-popup-actions">
          <button class="btn-dim-action" id="btn-dim-cancel">Cancel</button>
          <button class="btn-dim-action btn-dim-save" id="btn-dim-save">Apply (Enter)</button>
        </div>
      </div>
    `;

    this.modalEl.classList.remove('hidden');

    // Position near click or center
    if (screenPos) {
      const left = Math.min(Math.max(screenPos.x, 20), window.innerWidth - 240);
      const top = Math.min(Math.max(screenPos.y, 20), window.innerHeight - 140);
      this.modalEl.style.left = `${left}px`;
      this.modalEl.style.top = `${top}px`;
      this.modalEl.style.transform = 'none';
    } else {
      this.modalEl.style.left = '50%';
      this.modalEl.style.top = '40%';
      this.modalEl.style.transform = 'translate(-50%, -50%)';
    }

    const input = this.modalEl.querySelector<HTMLInputElement>('#dim-input-val');
    input?.focus();
    input?.select();

    this.bindInnerButtons();
  }

  close(): void {
    this.modalEl.classList.add('hidden');
    this.currentConstraint = null;
  }

  private apply(): void {
    if (!this.currentConstraint) return;

    const input = this.modalEl.querySelector<HTMLInputElement>('#dim-input-val');
    if (!input) return;

    const newVal = parseFloat(input.value);
    if (!isNaN(newVal) && newVal > 0) {
      this.sketch.pushHistory();
      if ('targetDistance' in this.currentConstraint) {
        this.currentConstraint.targetDistance = newVal;
        this.currentConstraint.value = newVal;
        this.currentConstraint.name = `Distance (${newVal.toFixed(1)})`;
      } else if ('targetAngle' in this.currentConstraint) {
        const clampedAngle = Math.min(179.9, Math.max(0.1, newVal));
        this.currentConstraint.targetAngle = clampedAngle;
        this.currentConstraint.value = clampedAngle;
        this.currentConstraint.name = `Angle (${clampedAngle.toFixed(1)}°)`;
      } else {
        this.currentConstraint.targetRadius = newVal;
        this.currentConstraint.value = newVal;
        this.currentConstraint.name = `Radius (${newVal.toFixed(1)})`;
      }
      this.sketch.solve();
    }

    this.close();
  }

  private bindInnerButtons(): void {
    this.modalEl.querySelector('#btn-dim-save')?.addEventListener('click', () => this.apply());
    this.modalEl.querySelector('#btn-dim-cancel')?.addEventListener('click', () => this.close());
  }

  private bindEvents(): void {
    window.addEventListener('keydown', e => {
      if (this.modalEl.classList.contains('hidden')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        this.apply();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }
}
