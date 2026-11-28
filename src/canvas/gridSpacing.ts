export const GRID_SUBDIVISIONS = 5;

export function getGridStep(zoom: number): { step: number; subStep: number } {
	const rawStep = 80 / zoom;
	const power = 10 ** Math.floor(Math.log10(rawStep));
	const fraction = rawStep / power;

	let step: number;
	if (fraction < 1.7) {
		step = power;
	} else if (fraction < 3.8) {
		step = 2.5 * power;
	} else if (fraction < 7.5) {
		step = 5 * power;
	} else {
		step = 10 * power;
	}

	return { step, subStep: step / GRID_SUBDIVISIONS };
}
