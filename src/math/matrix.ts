export class Matrix {
	readonly rows: number;
	readonly cols: number;
	readonly data: Float64Array;

	constructor(rows: number, cols: number, initialData?: ArrayLike<number>) {
		this.rows = rows;
		this.cols = cols;
		this.data = new Float64Array(rows * cols);
		if (initialData) {
			this.data.set(initialData);
		}
	}

	static zeros(rows: number, cols: number): Matrix {
		return new Matrix(rows, cols);
	}

	static identity(n: number): Matrix {
		const m = new Matrix(n, n);
		for (let i = 0; i < n; i++) {
			m.set(i, i, 1);
		}
		return m;
	}

	get(row: number, col: number): number {
		return this.data[row * this.cols + col];
	}

	set(row: number, col: number, val: number): void {
		this.data[row * this.cols + col] = val;
	}

	addAt(row: number, col: number, delta: number): void {
		this.data[row * this.cols + col] += delta;
	}

	transpose(): Matrix {
		const res = new Matrix(this.cols, this.rows);
		for (let r = 0; r < this.rows; r++) {
			for (let c = 0; c < this.cols; c++) {
				res.set(c, r, this.get(r, c));
			}
		}
		return res;
	}

	multiplyVector(v: Float64Array): Float64Array {
		if (v.length !== this.cols) {
			throw new Error(`Matrix-vector dimension mismatch: ${this.cols} != ${v.length}`);
		}
		const res = new Float64Array(this.rows);
		for (let r = 0; r < this.rows; r++) {
			let sum = 0;
			const rowOffset = r * this.cols;
			for (let c = 0; c < this.cols; c++) {
				sum += this.data[rowOffset + c] * v[c];
			}
			res[r] = sum;
		}
		return res;
	}

	multiply(b: Matrix): Matrix {
		if (this.cols !== b.rows) {
			throw new Error(`Matrix multiplication dimension mismatch: ${this.cols} != ${b.rows}`);
		}
		const res = new Matrix(this.rows, b.cols);
		for (let r = 0; r < this.rows; r++) {
			for (let k = 0; k < this.cols; k++) {
				const aVal = this.get(r, k);
				if (Math.abs(aVal) < 1e-15) continue;
				for (let c = 0; c < b.cols; c++) {
					res.addAt(r, c, aVal * b.get(k, c));
				}
			}
		}
		return res;
	}

	clone(): Matrix {
		const m = new Matrix(this.rows, this.cols);
		m.data.set(this.data);
		return m;
	}
}

/**
 * Solves A * x = b for square matrix A using LU decomposition with partial pivoting.
 * Returns null if matrix is singular.
 */
export function solveLinearSystem(A: Matrix, b: Float64Array): Float64Array | null {
	const n = A.rows;
	if (A.cols !== n || b.length !== n) {
		throw new Error('solveLinearSystem expects square matrix and matching vector');
	}

	// Process sparse rows and their corresponding columns first to limit fill-in.
	const order = Array.from({ length: n }, (_, i) => i);
	const nonzeroCounts = new Int32Array(n);
	for (let row = 0; row < n; row++) {
		for (let col = 0; col < n; col++) {
			if (A.data[row * n + col] !== 0) nonzeroCounts[row]++;
		}
	}
	order.sort((a, b) => nonzeroCounts[a] - nonzeroCounts[b]);
	const a = new Float64Array(n * n);
	const x = new Float64Array(n);
	for (let row = 0; row < n; row++) {
		const originalRow = order[row];
		x[row] = b[originalRow];
		for (let col = 0; col < n; col++) {
			a[row * n + col] = A.data[originalRow * n + order[col]];
		}
	}

	// LU decomposition with partial pivoting
	for (let i = 0; i < n; i++) {
		let maxVal = Math.abs(a[i * n + i]);
		let maxRow = i;

		for (let k = i + 1; k < n; k++) {
			const val = Math.abs(a[k * n + i]);
			if (val > maxVal) {
				maxVal = val;
				maxRow = k;
			}
		}

		if (maxVal < 1e-13) {
			return null; // Singular matrix
		}

		// Swap rows in A and the right-hand side.
		if (maxRow !== i) {
			for (let c = 0; c < n; c++) {
				const tmp = a[i * n + c];
				a[i * n + c] = a[maxRow * n + c];
				a[maxRow * n + c] = tmp;
			}
			const tmpB = x[i];
			x[i] = x[maxRow];
			x[maxRow] = tmpB;
		}

		// Elimination
		const pivot = a[i * n + i];
		for (let j = i + 1; j < n; j++) {
			const factor = a[j * n + i] / pivot;
			if (factor === 0) continue;
			a[j * n + i] = factor;
			for (let c = i + 1; c < n; c++) {
				a[j * n + c] -= factor * a[i * n + c];
			}
			x[j] -= factor * x[i];
		}
	}

	// Back-substitution
	for (let i = n - 1; i >= 0; i--) {
		let sum = x[i];
		for (let j = i + 1; j < n; j++) {
			sum -= a[i * n + j] * x[j];
		}
		x[i] = sum / a[i * n + i];
	}

	const solution = new Float64Array(n);
	for (let i = 0; i < n; i++) solution[order[i]] = x[i];
	return solution;
}

/** Finds the rank and the coordinates that are zero in every nullspace direction. */
export function analyzeNullspace(matrix: Matrix, tolerance = 1e-7): { rank: number; fixedColumns: number[] } {
	const m = matrix.rows;
	const n = matrix.cols;
	const a = new Float64Array(matrix.data);

	const pivotColumns: number[] = [];
	let row = 0;

	for (let col = 0; col < n && row < m; col++) {
		let maxRow = row;
		let maxVal = Math.abs(a[row * n + col]);

		for (let r = row + 1; r < m; r++) {
			const val = Math.abs(a[r * n + col]);
			if (val > maxVal) {
				maxVal = val;
				maxRow = r;
			}
		}

		if (maxVal < tolerance) {
			continue;
		}

		// Swap row and maxRow
		if (maxRow !== row) {
			for (let c = col; c < n; c++) {
				const tmp = a[row * n + c];
				a[row * n + c] = a[maxRow * n + c];
				a[maxRow * n + c] = tmp;
			}
		}

		// Eliminate below
		const pivot = a[row * n + col];
		for (let r = row + 1; r < m; r++) {
			const factor = a[r * n + col] / pivot;
			if (factor === 0) continue;
			for (let c = col; c < n; c++) {
				a[r * n + c] -= factor * a[row * n + c];
			}
		}

		pivotColumns.push(col);
		row++;
	}

	const rank = pivotColumns.length;
	if (rank === n) return { rank, fixedColumns: pivotColumns };

	const pivots = new Set(pivotColumns);
	const freeColumns = Array.from({ length: n }, (_, col) => col).filter(col => !pivots.has(col));
	const movablePivots = new Set<number>();
	// Substitute each free coordinate back through the pivot rows. A pivot
	// can still move if its value depends on any of the free coordinates.
	for (const free of freeColumns) {
		for (let r = rank - 1; r >= 0; r--) {
			const col = pivotColumns[r];
			if (col > free) continue;
			const coefficient = a[r * n + free] / a[r * n + col];
			if (Math.abs(coefficient) > tolerance) movablePivots.add(col);
			if (coefficient === 0) continue;
			for (let i = 0; i < r; i++) {
				a[i * n + free] -= a[i * n + col] * coefficient;
			}
		}
	}
	return { rank, fixedColumns: pivotColumns.filter(col => !movablePivots.has(col)) };
}
