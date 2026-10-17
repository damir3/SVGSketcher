import type { DistanceConstraint, RadiusConstraint, AngleConstraint } from '../solver/constraints';
import type { SketchDocument } from '../model/sketch';
import type { Vec2 } from '../math/vector';

export class DimensionModal {
  private modalEl: HTMLElement;
  private sketch: SketchDocument;
  private currentConstraint: DistanceConstraint | RadiusConstraint | AngleConstraint | null = null;
  private currentMode: 'radius' | 'diameter' = 'radius';
  private openedTime = 0;

  constructor(sketch: SketchDocument) {
    this.sketch = sketch;

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'dimension-popup hidden';
    document.body.appendChild(this.modalEl);

    this.bindEvents();
  }

  open(constraint: DistanceConstraint | RadiusConstraint | AngleConstraint, screenPos?: Vec2): void {
    this.currentConstraint = constraint;
    this.openedTime = performance.now();

    const isDistance = 'targetDistance' in constraint;
    const isAngle = 'targetAngle' in constraint;
    const isRadius = !isDistance && !isAngle;

    if (isRadius) {
      const radConstraint = constraint as RadiusConstraint;
      const isCircle = this.sketch.circles.has(radConstraint.circleId);
      // Default to diameter for circle, radius for arc if not yet set
      this.currentMode = radConstraint.displayMode ?? (isCircle ? 'diameter' : 'radius');
      radConstraint.displayMode = this.currentMode;
    }

    const curVal = isDistance
      ? constraint.targetDistance
      : isAngle
      ? constraint.targetAngle
      : this.currentMode === 'diameter'
      ? (constraint as RadiusConstraint).targetRadius * 2
      : (constraint as RadiusConstraint).targetRadius;

    const unit = isAngle ? '°' : 'mm';
    const displayVal = Number(curVal.toFixed(2)).toString();

    this.modalEl.innerHTML = `
      ${
        isRadius
          ? `
        <div class="dim-mode-switch-compact" role="group" aria-label="Dimension mode">
          <button type="button" class="btn-dim-mode-compact ${this.currentMode === 'radius' ? 'active' : ''}" id="btn-mode-radius" title="Radius (R)">R</button>
          <button type="button" class="btn-dim-mode-compact ${this.currentMode === 'diameter' ? 'active' : ''}" id="btn-mode-diameter" title="Diameter (Ø)">Ø</button>
        </div>
      `
          : ''
      }
      <div class="dim-input-wrapper">
        <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="dim-input-val" value="${displayVal}" autofocus />
        <span class="dim-unit">${unit}</span>
      </div>
    `;

    this.modalEl.classList.remove('hidden');

    // Position near click or center
    if (screenPos) {
      const left = Math.min(Math.max(screenPos.x, 20), window.innerWidth - 200);
      const top = Math.min(Math.max(screenPos.y, 20), window.innerHeight - 80);
      this.modalEl.style.left = `${left}px`;
      this.modalEl.style.top = `${top}px`;
      this.modalEl.style.transform = 'none';
    } else {
      this.modalEl.style.left = '50%';
      this.modalEl.style.top = '40%';
      this.modalEl.style.transform = 'translate(-50%, -50%)';
    }

    const input = this.modalEl.querySelector<HTMLInputElement>('#dim-input-val');
    if (input) {
      input.addEventListener('focus', () => {
        setTimeout(() => this.focusAndSelect(), 0);
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const stepVal = isAngle ? 0.5 : 0.1;
          const delta = (e.key === 'ArrowUp' ? 1 : -1) * stepVal;
          const cur = parseFloat(input.value.trim().replace(',', '.')) || 0;
          const min = isAngle ? 0.1 : 0.01;
          const max = isAngle ? 179.9 : Infinity;
          const nextVal = Math.min(max, Math.max(min, Number((cur + delta).toFixed(2))));
          input.value = nextVal.toString();
          this.focusAndSelect();
        }
      });
    }

    this.focusAndSelect();
    requestAnimationFrame(() => this.focusAndSelect());
    setTimeout(() => this.focusAndSelect(), 25);
    setTimeout(() => this.focusAndSelect(), 80);

    // If mouse was still pressed down when opening, ensure selection upon mouse release
    const onMouseUp = () => {
      window.removeEventListener('mouseup', onMouseUp);
      if (!this.modalEl.classList.contains('hidden')) {
        this.focusAndSelect();
      }
    };
    window.addEventListener('mouseup', onMouseUp);

    this.bindInnerButtons(isRadius);
  }

  private focusAndSelect(): void {
    if (this.modalEl.classList.contains('hidden')) return;
    const input = this.modalEl.querySelector<HTMLInputElement>('#dim-input-val');
    if (!input) return;

    input.focus();
    input.select();
    try {
      input.setSelectionRange(0, input.value.length);
    } catch {
      // ignore
    }
  }

  private setMode(newMode: 'radius' | 'diameter'): void {
    if (this.currentMode === newMode) return;
    this.currentMode = newMode;

    const btnRad = this.modalEl.querySelector<HTMLElement>('#btn-mode-radius');
    const btnDia = this.modalEl.querySelector<HTMLElement>('#btn-mode-diameter');
    if (btnRad && btnDia) {
      btnRad.classList.toggle('active', newMode === 'radius');
      btnDia.classList.toggle('active', newMode === 'diameter');
    }

    const input = this.modalEl.querySelector<HTMLInputElement>('#dim-input-val');
    if (input) {
      const val = parseFloat(input.value.trim().replace(',', '.'));
      if (!isNaN(val) && val > 0) {
        if (newMode === 'diameter') {
          input.value = Number((val * 2).toFixed(2)).toString();
        } else {
          input.value = Number((val / 2).toFixed(2)).toString();
        }
      }
      this.focusAndSelect();
    }
  }

  close(): void {
    this.modalEl.classList.add('hidden');
    this.currentConstraint = null;
  }

  private apply(): void {
    if (!this.currentConstraint) return;

    const input = this.modalEl.querySelector<HTMLInputElement>('#dim-input-val');
    if (!input) return;

    const newVal = parseFloat(input.value.trim().replace(',', '.'));
    if (!isNaN(newVal) && newVal > 0) {
      this.sketch.pushHistory();
      if ('targetDistance' in this.currentConstraint) {
        this.currentConstraint.targetDistance = newVal;
        this.currentConstraint.value = newVal;
        const prefix =
          this.currentConstraint.orientation === 'horizontal'
            ? 'Horizontal Distance'
            : this.currentConstraint.orientation === 'vertical'
            ? 'Vertical Distance'
            : 'Distance';
        this.currentConstraint.name = `${prefix} (${Number(newVal.toFixed(2))})`;
      } else if ('targetAngle' in this.currentConstraint) {
        const clampedAngle = Math.min(179.9, Math.max(0.1, newVal));
        this.currentConstraint.targetAngle = clampedAngle;
        this.currentConstraint.value = clampedAngle;
        this.currentConstraint.name = `Angle (${Number(clampedAngle.toFixed(2))}°)`;
      } else {
        const radConstraint = this.currentConstraint as RadiusConstraint;
        const targetRad = this.currentMode === 'diameter' ? newVal / 2 : newVal;
        radConstraint.targetRadius = targetRad;
        radConstraint.value = targetRad;
        radConstraint.displayMode = this.currentMode;
        radConstraint.name =
          this.currentMode === 'diameter'
            ? `Diameter (${Number(newVal.toFixed(2))})`
            : `Radius (${Number(targetRad.toFixed(2))})`;
      }
      this.sketch.solve();
    }

    this.close();
  }

  private bindInnerButtons(isRadius: boolean): void {
    if (isRadius) {
      this.modalEl.querySelector('#btn-mode-radius')?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.setMode('radius');
      });
      this.modalEl.querySelector('#btn-mode-diameter')?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.setMode('diameter');
      });
    }
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

    window.addEventListener('mousedown', e => {
      if (this.modalEl.classList.contains('hidden')) return;
      if (!this.modalEl.contains(e.target as Node)) {
        if (performance.now() - this.openedTime > 150) {
          this.apply();
        }
      }
    });
  }
}
