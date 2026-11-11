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

function binarySearch(arr: number[], start: number, target: number): number {
	let low = start;
	let high = arr.length - 1;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const val = arr[mid];
		if (val < target) {
			low = mid + 1;
		} else if (val > target) {
			high = mid - 1;
		} else {
			return mid;
		}
	}
	return -1;
}

function mergeSubRow(
	tCols: number[],
	tVals: number[],
	tStart: number,
	pCols: number[],
	pVals: number[],
	pStart: number,
	factor: number,
	outCols: number[],
	outVals: number[]
): void {
	outCols.length = 0;
	outVals.length = 0;
	let tIdx = tStart;
	let pIdx = pStart;
	const tLen = tCols.length;
	const pLen = pCols.length;
	while (tIdx < tLen && pIdx < pLen) {
		const tCol = tCols[tIdx];
		const pCol = pCols[pIdx];
		if (tCol < pCol) {
			outCols.push(tCol);
			outVals.push(tVals[tIdx]);
			tIdx++;
		} else if (pCol < tCol) {
			const val = -factor * pVals[pIdx];
			if (val !== 0) {
				outCols.push(pCol);
				outVals.push(val);
			}
			pIdx++;
		} else {
			const val = tVals[tIdx] - factor * pVals[pIdx];
			if (val !== 0) {
				outCols.push(tCol);
				outVals.push(val);
			}
			tIdx++;
			pIdx++;
		}
	}
	while (tIdx < tLen) {
		outCols.push(tCols[tIdx]);
		outVals.push(tVals[tIdx]);
		tIdx++;
	}
	while (pIdx < pLen) {
		const val = -factor * pVals[pIdx];
		if (val !== 0) {
			outCols.push(pCols[pIdx]);
			outVals.push(val);
		}
		pIdx++;
	}
}

export function finalizeSparseRows(rowCols: number[][], rowVals: number[][]): void {
	for (let r = 0; r < rowCols.length; r++) {
		const cols = rowCols[r];
		const vals = rowVals[r];
		const len = cols.length;
		if (len === 0) continue;
		if (len === 1) {
			if (vals[0] === 0) {
				cols.length = 0;
				vals.length = 0;
			}
			continue;
		}
		for (let i = 1; i < len; i++) {
			const c = cols[i];
			const v = vals[i];
			let j = i - 1;
			while (j >= 0 && cols[j] > c) {
				cols[j + 1] = cols[j];
				vals[j + 1] = vals[j];
				j--;
			}
			cols[j + 1] = c;
			vals[j + 1] = v;
		}
		let write = 0;
		for (let read = 0; read < len; read++) {
			const c = cols[read];
			const v = vals[read];
			if (write > 0 && cols[write - 1] === c) {
				vals[write - 1] += v;
			} else {
				cols[write] = c;
				vals[write] = v;
				write++;
			}
		}
		let finalWrite = 0;
		for (let i = 0; i < write; i++) {
			if (vals[i] !== 0) {
				cols[finalWrite] = cols[i];
				vals[finalWrite] = vals[i];
				finalWrite++;
			}
		}
		cols.length = finalWrite;
		vals.length = finalWrite;
	}
}

export function normalEquationsFromSparseRows(
	jCols: number[][],
	jVals: number[][],
	cols: number,
	f: Float64Array
): { aCols: number[][]; aVals: number[][]; g: Float64Array } {
	const rawCols: number[][] = Array.from({ length: cols }, () => []);
	const rawVals: number[][] = Array.from({ length: cols }, () => []);
	const g = new Float64Array(cols);
	const rows = jCols.length;
	for (let k = 0; k < rows; k++) {
		const rCols = jCols[k];
		const rVals = jVals[k];
		const len = rCols.length;
		const fk = f[k];
		for (let i = 0; i < len; i++) {
			const c = rCols[i];
			const val = rVals[i];
			g[c] += val * fk;
			if (Math.abs(val) < 1e-15) continue;
			const dstCols = rawCols[c];
			const dstVals = rawVals[c];
			for (let j = 0; j < len; j++) {
				dstCols.push(rCols[j]);
				dstVals.push(val * rVals[j]);
			}
		}
	}
	const aCols: number[][] = new Array(cols);
	const aVals: number[][] = new Array(cols);
	const rowAcc = new Float64Array(cols);
	const seen = new Uint8Array(cols);
	const touched: number[] = [];
	for (let r = 0; r < cols; r++) {
		const rCols = rawCols[r];
		const rVals = rawVals[r];
		const len = rCols.length;
		touched.length = 0;
		for (let i = 0; i < len; i++) {
			const c = rCols[i];
			if (seen[c] === 0) {
				seen[c] = 1;
				touched.push(c);
			}
			rowAcc[c] += rVals[i];
		}
		touched.sort((a, b) => a - b);
		const tLen = touched.length;
		const mCols = new Array<number>(tLen);
		const mVals = new Array<number>(tLen);
		for (let i = 0; i < tLen; i++) {
			const c = touched[i];
			seen[c] = 0;
			mCols[i] = c;
			mVals[i] = rowAcc[c];
			rowAcc[c] = 0;
		}
		aCols[r] = mCols;
		aVals[r] = mVals;
	}
	return { aCols, aVals, g };
}

export function solveSparseLinearSystem(
	matrixCols: number[][],
	matrixVals: number[][],
	b: Float64Array
): Float64Array | null {
	const n = b.length;
	const order = Array.from({ length: n }, (_, i) => i);
	const nonzeroCounts = new Int32Array(n);
	for (let row = 0; row < n; row++) {
		const vals = matrixVals[row];
		let count = 0;
		for (let i = 0; i < vals.length; i++) {
			if (vals[i] !== 0) count++;
		}
		nonzeroCounts[row] = count;
	}
	order.sort((a, b) => nonzeroCounts[a] - nonzeroCounts[b]);
	const invOrder = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		invOrder[order[i]] = i;
	}

	const aCols: number[][] = new Array(n);
	const aVals: number[][] = new Array(n);
	const x = new Float64Array(n);
	for (let row = 0; row < n; row++) {
		const origRow = order[row];
		x[row] = b[origRow];
		const srcCols = matrixCols[origRow];
		const srcVals = matrixVals[origRow];
		const rCols: number[] = [];
		const rVals: number[] = [];
		for (let i = 0; i < srcCols.length; i++) {
			const v = srcVals[i];
			if (v !== 0) {
				rCols.push(invOrder[srcCols[i]]);
				rVals.push(v);
			}
		}
		// Insertion/quicksort by new column index
		const len = rCols.length;
		if (len > 1) {
			const indices = Array.from({ length: len }, (_, i) => i);
			indices.sort((i, j) => rCols[i] - rCols[j]);
			const sortedCols = new Array<number>(len);
			const sortedVals = new Array<number>(len);
			for (let i = 0; i < len; i++) {
				const idx = indices[i];
				sortedCols[i] = rCols[idx];
				sortedVals[i] = rVals[idx];
			}
			aCols[row] = sortedCols;
			aVals[row] = sortedVals;
		} else {
			aCols[row] = rCols;
			aVals[row] = rVals;
		}
	}

	const head = new Int32Array(n);
	const firstCol = new Int32Array(n);
	for (let i = 0; i < n; i++) {
		firstCol[i] = aCols[i].length > 0 ? aCols[i][0] : n;
	}
	const activeRows: number[] = [];
	let mergeCols: number[] = [];
	let mergeVals: number[] = [];

	for (let i = 0; i < n; i++) {
		let maxVal = 0;
		let maxRow = i;
		let diagVal = 0;
		activeRows.length = 0;

		for (let k = i; k < n; k++) {
			if (firstCol[k] === i) {
				activeRows.push(k);
				const val = Math.abs(aVals[k][head[k]]);
				if (k === i) diagVal = val;
				if (val > maxVal) {
					maxVal = val;
					maxRow = k;
				}
			}
		}

		if (maxVal < 1e-13) {
			return null;
		}

		if (diagVal >= 1e-6 * maxVal) {
			maxRow = i;
		}

		if (maxRow !== i) {
			const tmpCols = aCols[i];
			aCols[i] = aCols[maxRow];
			aCols[maxRow] = tmpCols;

			const tmpVals = aVals[i];
			aVals[i] = aVals[maxRow];
			aVals[maxRow] = tmpVals;

			const tmpHead = head[i];
			head[i] = head[maxRow];
			head[maxRow] = tmpHead;

			const tmpFirst = firstCol[i];
			firstCol[i] = firstCol[maxRow];
			firstCol[maxRow] = tmpFirst;

			const tmpX = x[i];
			x[i] = x[maxRow];
			x[maxRow] = tmpX;

			for (let r = 0; r < activeRows.length; r++) {
				if (activeRows[r] === i) activeRows[r] = maxRow;
				else if (activeRows[r] === maxRow) activeRows[r] = i;
			}
		}

		const hi = head[i];
		const pCols = aCols[i];
		const pVals = aVals[i];
		const pivot = pVals[hi];
		const xi = x[i];
		const pStart = hi + 1;
		const pTailLen = pCols.length - pStart;

		for (let a = 0; a < activeRows.length; a++) {
			const row = activeRows[a];
			if (row === i) continue;
			const rHead = head[row];
			const rCols = aCols[row];
			const rVals = aVals[row];
			const aRowI = rVals[rHead];
			const nextHead = rHead + 1;
			head[row] = nextHead;
			const factor = aRowI / pivot;

			if (factor !== 0 && pTailLen > 0) {
				const remLen = rCols.length - nextHead;
				let updatedInPlace = false;
				if (remLen > pTailLen * 2) {
					let allFound = true;
					for (let p = pStart; p < pCols.length; p++) {
						const idx = binarySearch(rCols, nextHead, pCols[p]);
						if (idx < 0 || rVals[idx] - factor * pVals[p] === 0) {
							allFound = false;
							break;
						}
					}
					if (allFound) {
						for (let p = pStart; p < pCols.length; p++) {
							const idx = binarySearch(rCols, nextHead, pCols[p]);
							rVals[idx] -= factor * pVals[p];
						}
						updatedInPlace = true;
					}
				}
				if (!updatedInPlace) {
					mergeSubRow(rCols, rVals, nextHead, pCols, pVals, pStart, factor, mergeCols, mergeVals);
					aCols[row] = mergeCols;
					aVals[row] = mergeVals;
					mergeCols = rCols;
					mergeVals = rVals;
					head[row] = 0;
				}
			}
			if (factor !== 0) {
				x[row] -= factor * xi;
			}
			const newHead = head[row];
			const curCols = aCols[row];
			firstCol[row] = newHead < curCols.length ? curCols[newHead] : n;
		}
	}

	for (let i = n - 1; i >= 0; i--) {
		const hi = head[i];
		const rCols = aCols[i];
		const rVals = aVals[i];
		let sum = x[i];
		for (let idx = hi + 1; idx < rCols.length; idx++) {
			sum -= rVals[idx] * x[rCols[idx]];
		}
		x[i] = sum / rVals[hi];
	}

	const solution = new Float64Array(n);
	for (let i = 0; i < n; i++) solution[order[i]] = x[i];
	return solution;
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
	const matrixCols: number[][] = new Array(n);
	const matrixVals: number[][] = new Array(n);
	for (let r = 0; r < n; r++) {
		const cols: number[] = [];
		const vals: number[] = [];
		const offset = r * n;
		for (let c = 0; c < n; c++) {
			const v = A.data[offset + c];
			if (v !== 0) {
				cols.push(c);
				vals.push(v);
			}
		}
		matrixCols[r] = cols;
		matrixVals[r] = vals;
	}
	return solveSparseLinearSystem(matrixCols, matrixVals, b);
}

export function analyzeNullspaceSparse(
	aCols: number[][],
	aVals: number[][],
	n: number,
	tolerance = 1e-7
): { rank: number; fixedColumns: number[] } {
	const m = aCols.length;
	const pivotColumns: number[] = [];
	const isPivot = new Uint8Array(n);
	const firstPos = new Int32Array(m);
	const firstCol = new Int32Array(m);
	for (let r = 0; r < m; r++) {
		firstCol[r] = aCols[r].length > 0 ? aCols[r][0] : n;
	}
	const activeRows: number[] = [];
	let mergeCols: number[] = [];
	let mergeVals: number[] = [];
	let row = 0;

	for (let col = 0; col < n && row < m; col++) {
		let maxRow = row;
		let maxVal = 0;
		activeRows.length = 0;

		for (let r = row; r < m; r++) {
			if (firstCol[r] < col) {
				const rCols = aCols[r];
				let p = firstPos[r] + 1;
				while (p < rCols.length && rCols[p] < col) {
					p++;
				}
				firstPos[r] = p;
				firstCol[r] = p < rCols.length ? rCols[p] : n;
			}
			if (firstCol[r] === col) {
				activeRows.push(r);
				const val = Math.abs(aVals[r][firstPos[r]]);
				if (val > maxVal) {
					maxVal = val;
					maxRow = r;
				}
			}
		}

		if (maxVal < tolerance) {
			continue;
		}

		if (maxRow !== row) {
			const tmpCols = aCols[row];
			aCols[row] = aCols[maxRow];
			aCols[maxRow] = tmpCols;

			const tmpVals = aVals[row];
			aVals[row] = aVals[maxRow];
			aVals[maxRow] = tmpVals;

			const tmpPos = firstPos[row];
			firstPos[row] = firstPos[maxRow];
			firstPos[maxRow] = tmpPos;

			const tmpFirst = firstCol[row];
			firstCol[row] = firstCol[maxRow];
			firstCol[maxRow] = tmpFirst;

			for (let i = 0; i < activeRows.length; i++) {
				if (activeRows[i] === row) activeRows[i] = maxRow;
				else if (activeRows[i] === maxRow) activeRows[i] = row;
			}
		}

		const pivotPos = firstPos[row];
		const pCols = aCols[row];
		const pVals = aVals[row];
		const pivot = pVals[pivotPos];
		const pStart = pivotPos + 1;

		for (let i = 0; i < activeRows.length; i++) {
			const r = activeRows[i];
			if (r === row) continue;
			const pos = firstPos[r];
			const rCols = aCols[r];
			const rVals = aVals[r];
			const factor = rVals[pos] / pivot;
			if (factor === 0) {
				if (pos === 0) {
					firstPos[r] = 1;
				} else {
					rCols.splice(pos, 1);
					rVals.splice(pos, 1);
				}
			} else {
				mergeSubRow(rCols, rVals, pos + 1, pCols, pVals, pStart, factor, mergeCols, mergeVals);
				if (pos === 0) {
					aCols[r] = mergeCols;
					aVals[r] = mergeVals;
					mergeCols = rCols;
					mergeVals = rVals;
				} else {
					rCols.length = pos;
					rVals.length = pos;
					for (let k = 0; k < mergeCols.length; k++) {
						rCols.push(mergeCols[k]);
						rVals.push(mergeVals[k]);
					}
				}
			}
			const newPos = firstPos[r];
			const curCols = aCols[r];
			firstCol[r] = newPos < curCols.length ? curCols[newPos] : n;
		}

		pivotColumns.push(col);
		isPivot[col] = 1;
		row++;
	}

	const rank = pivotColumns.length;
	if (rank === n) return { rank, fixedColumns: pivotColumns };

	const colEntryRows: number[][] = Array.from({ length: n }, () => []);
	const colEntryVals: number[][] = Array.from({ length: n }, () => []);
	for (let r = 0; r < rank; r++) {
		const pCol = pivotColumns[r];
		const rCols = aCols[r];
		const rVals = aVals[r];
		for (let i = 0; i < rCols.length; i++) {
			const c = rCols[i];
			const v = rVals[i];
			if (c !== pCol && v !== 0) {
				colEntryRows[c].push(r);
				colEntryVals[c].push(v);
			}
		}
	}

	const movable = new Uint8Array(n);
	const freeCol = new Float64Array(rank);
	for (let free = 0; free < n; free++) {
		if (isPivot[free]) continue;
		freeCol.fill(0);
		const fRows = colEntryRows[free];
		const fVals = colEntryVals[free];
		for (let i = 0; i < fRows.length; i++) {
			freeCol[fRows[i]] = fVals[i];
		}
		for (let r = rank - 1; r >= 0; r--) {
			const col = pivotColumns[r];
			if (col > free) continue;
			const aRFree = freeCol[r];
			if (aRFree === 0) continue;
			const pivotVal = aVals[r][firstPos[r]];
			const coefficient = aRFree / pivotVal;
			if (Math.abs(coefficient) > tolerance) movable[col] = 1;
			if (coefficient === 0) continue;
			const cRows = colEntryRows[col];
			const cVals = colEntryVals[col];
			for (let i = 0; i < cRows.length; i++) {
				const rowIdx = cRows[i];
				if (rowIdx < r) {
					freeCol[rowIdx] -= cVals[i] * coefficient;
				}
			}
		}
	}

	return { rank, fixedColumns: pivotColumns.filter(col => movable[col] === 0) };
}

/** Finds the rank and the coordinates that are zero in every nullspace direction. */
export function analyzeNullspace(matrix: Matrix, tolerance = 1e-7): { rank: number; fixedColumns: number[] } {
	const m = matrix.rows;
	const n = matrix.cols;
	const aCols: number[][] = new Array(m);
	const aVals: number[][] = new Array(m);
	for (let r = 0; r < m; r++) {
		const cols: number[] = [];
		const vals: number[] = [];
		const offset = r * n;
		for (let c = 0; c < n; c++) {
			const v = matrix.data[offset + c];
			if (v !== 0) {
				cols.push(c);
				vals.push(v);
			}
		}
		aCols[r] = cols;
		aVals[r] = vals;
	}
	return analyzeNullspaceSparse(aCols, aVals, n, tolerance);
}
