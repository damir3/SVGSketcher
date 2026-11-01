/**
 * Mathematical expression evaluator for 2D CAD parametric constraint solver.
 * Supports:
 * - Arithmetic operators: +, -, *, /, %, ^ (power)
 * - Unary operators: +, -
 * - Functions: sin, cos, tan, asin, acos, atan, atan2, sqrt, abs, round, floor, ceil, sign, min, max, deg, rad
 * - Constants: pi, e
 * - Unit suffixes: mm, cm, m, in, inch, inches, ft, foot, feet, deg, rad
 * - Variables / named parameters
 * - Safe recursive-descent parser (zero eval / zero Function constructor)
 * - Topological dependency sorting and cycle detection
 */

export const UNITS: Record<string, number> = {
	mm: 1,
	cm: 10,
	m: 1000,
	in: 25.4,
	inch: 25.4,
	inches: 25.4,
	ft: 304.8,
	foot: 304.8,
	feet: 304.8,
	deg: 1,
	rad: 180 / Math.PI,
};

export const CONSTANTS: Record<string, number> = {
	pi: Math.PI,
	e: Math.E,
};

export const RESERVED_WORDS = new Set([
	'pi',
	'e',
	'sin',
	'cos',
	'tan',
	'asin',
	'acos',
	'atan',
	'atan2',
	'sqrt',
	'abs',
	'round',
	'floor',
	'ceil',
	'sign',
	'min',
	'max',
	'deg',
	'rad',
	'mm',
	'cm',
	'm',
	'in',
	'inch',
	'inches',
	'ft',
	'foot',
	'feet',
]);

type TokenType =
	| 'NUMBER'
	| 'IDENT'
	| 'PLUS'
	| 'MINUS'
	| 'STAR'
	| 'SLASH'
	| 'PERCENT'
	| 'CARET'
	| 'LPAREN'
	| 'RPAREN'
	| 'COMMA'
	| 'EOF';

interface Token {
	type: TokenType;
	value?: any;
	pos: number;
}

export class Lexer {
	private src: string;
	private pos = 0;

	constructor(src: string) {
		this.src = src;
	}

	tokenize(): Token[] {
		const tokens: Token[] = [];
		while (this.pos < this.src.length) {
			const ch = this.src[this.pos];

			if (/\s/.test(ch)) {
				this.pos++;
				continue;
			}

			// Numbers: digits, optionally with decimal point (period or comma if followed by digit)
			if (
				/\d/.test(ch) ||
				(ch === '.' && this.pos + 1 < this.src.length && /\d/.test(this.src[this.pos + 1])) ||
				(ch === ',' && this.pos + 1 < this.src.length && /\d/.test(this.src[this.pos + 1]))
			) {
				const startPos = this.pos;
				let numStr = '';
				let hasDot = false;

				while (this.pos < this.src.length) {
					const c = this.src[this.pos];
					if (/\d/.test(c)) {
						numStr += c;
						this.pos++;
					} else if (c === '.' && !hasDot) {
						hasDot = true;
						numStr += '.';
						this.pos++;
					} else if (
						c === ',' &&
						!hasDot &&
						this.pos + 1 < this.src.length &&
						/\d/.test(this.src[this.pos + 1])
					) {
						hasDot = true;
						numStr += '.';
						this.pos++;
					} else {
						break;
					}
				}

				// Scientific notation: e+2, e-3, e4
				if (this.pos < this.src.length && (this.src[this.pos] === 'e' || this.src[this.pos] === 'E')) {
					const nextChar = this.pos + 1 < this.src.length ? this.src[this.pos + 1] : '';
					if (/\d/.test(nextChar) || nextChar === '+' || nextChar === '-') {
						numStr += 'e';
						this.pos++;
						if (this.src[this.pos] === '+' || this.src[this.pos] === '-') {
							numStr += this.src[this.pos];
							this.pos++;
						}
						while (this.pos < this.src.length && /\d/.test(this.src[this.pos])) {
							numStr += this.src[this.pos];
							this.pos++;
						}
					}
				}

				let val = parseFloat(numStr);

				// Check if immediately followed by a unit (e.g. 10mm, 2in, 90deg)
				const unitStart = this.pos;
				while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) {
					this.pos++;
				}
				const potentialUnit = this.src.slice(unitStart, this.pos).toLowerCase();
				if (potentialUnit && potentialUnit in UNITS) {
					val *= UNITS[potentialUnit];
				} else {
					// Rewind if not a recognized unit
					this.pos = unitStart;
				}

				tokens.push({ type: 'NUMBER', value: val, pos: startPos });
				continue;
			}

			// Identifiers (variable names, functions, units, constants)
			if (/[a-zA-Z_]/.test(ch)) {
				const startPos = this.pos;
				while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) {
					this.pos++;
				}
				const ident = this.src.slice(startPos, this.pos);
				tokens.push({ type: 'IDENT', value: ident, pos: startPos });
				continue;
			}

			switch (ch) {
				case '+':
					tokens.push({ type: 'PLUS', pos: this.pos++ });
					break;
				case '-':
					tokens.push({ type: 'MINUS', pos: this.pos++ });
					break;
				case '*':
					tokens.push({ type: 'STAR', pos: this.pos++ });
					break;
				case '/':
					tokens.push({ type: 'SLASH', pos: this.pos++ });
					break;
				case '%':
					tokens.push({ type: 'PERCENT', pos: this.pos++ });
					break;
				case '^':
					tokens.push({ type: 'CARET', pos: this.pos++ });
					break;
				case '(':
					tokens.push({ type: 'LPAREN', pos: this.pos++ });
					break;
				case ')':
					tokens.push({ type: 'RPAREN', pos: this.pos++ });
					break;
				case ',':
					tokens.push({ type: 'COMMA', pos: this.pos++ });
					break;
				default:
					throw new Error(`Unexpected character '${ch}' at index ${this.pos}`);
			}
		}

		tokens.push({ type: 'EOF', pos: this.pos });
		return tokens;
	}
}

export type VariableLookup =
	| Map<string, number>
	| Record<string, number>
	| ((name: string) => number | undefined);

export class ExpressionParser {
	private tokens: Token[] = [];
	private idx = 0;
	private lookup?: VariableLookup;
	private referencedVars = new Set<string>();

	constructor(tokens: Token[], lookup?: VariableLookup) {
		this.tokens = tokens;
		this.lookup = lookup;
	}

	getReferencedVariables(): Set<string> {
		return this.referencedVars;
	}

	parse(): number {
		this.idx = 0;
		if (this.current().type === 'EOF') {
			throw new Error('Empty expression');
		}
		const res = this.parseExpression();
		if (this.current().type !== 'EOF') {
			throw new Error(`Unexpected token '${this.tokenToString(this.current())}' at index ${this.current().pos}`);
		}
		if (!Number.isFinite(res)) {
			throw new Error('Expression resulted in non-finite value');
		}
		return res;
	}

	private current(): Token {
		return this.tokens[this.idx] ?? { type: 'EOF', pos: this.tokens.length };
	}

	private peekNext(): Token {
		return this.tokens[this.idx + 1] ?? { type: 'EOF', pos: this.tokens.length };
	}

	private consume(type?: TokenType): Token {
		const tok = this.current();
		if (type && tok.type !== type) {
			throw new Error(`Expected '${type}', found '${this.tokenToString(tok)}' at index ${tok.pos}`);
		}
		this.idx++;
		return tok;
	}

	private tokenToString(tok: Token): string {
		if (tok.value !== undefined) return String(tok.value);
		return tok.type;
	}

	private parseExpression(): number {
		return this.parseAddition();
	}

	private parseAddition(): number {
		let left = this.parseMultiplication();
		while (this.current().type === 'PLUS' || this.current().type === 'MINUS') {
			const op = this.consume().type;
			const right = this.parseMultiplication();
			if (op === 'PLUS') {
				left += right;
			} else {
				left -= right;
			}
		}
		return left;
	}

	private parseMultiplication(): number {
		let left = this.parsePower();
		while (
			this.current().type === 'STAR' ||
			this.current().type === 'SLASH' ||
			this.current().type === 'PERCENT'
		) {
			const op = this.consume().type;
			const right = this.parsePower();
			if (op === 'STAR') {
				left *= right;
			} else if (op === 'SLASH') {
				if (Math.abs(right) < 1e-12) {
					throw new Error('Division by zero');
				}
				left /= right;
			} else {
				if (Math.abs(right) < 1e-12) {
					throw new Error('Modulo by zero');
				}
				left %= right;
			}
		}
		return left;
	}

	private parsePower(): number {
		const left = this.parseUnary();
		if (this.current().type === 'CARET') {
			this.consume();
			const right = this.parsePower(); // Right-associative
			return Math.pow(left, right);
		}
		return left;
	}

	private parseUnary(): number {
		if (this.current().type === 'PLUS') {
			this.consume();
			return this.parseUnary();
		}
		if (this.current().type === 'MINUS') {
			this.consume();
			return -this.parseUnary();
		}
		return this.parsePrimary();
	}

	private parsePrimary(): number {
		const tok = this.current();

		if (tok.type === 'NUMBER') {
			this.consume();
			let numVal = tok.value as number;
			// Check if followed by unit token separated by space: e.g. "10 mm", "45 deg"
			if (this.current().type === 'IDENT') {
				const nextIdent = String(this.current().value).toLowerCase();
				if (nextIdent in UNITS && this.peekNext().type !== 'LPAREN') {
					this.consume();
					numVal *= UNITS[nextIdent];
				}
			}
			return numVal;
		}

		if (tok.type === 'LPAREN') {
			this.consume('LPAREN');
			const val = this.parseExpression();
			this.consume('RPAREN');
			// Check if parenthesized expression is followed by unit: e.g. "(10 + 2) mm"
			if (this.current().type === 'IDENT') {
				const nextIdent = String(this.current().value).toLowerCase();
				if (nextIdent in UNITS && this.peekNext().type !== 'LPAREN') {
					this.consume();
					return val * UNITS[nextIdent];
				}
			}
			return val;
		}

		if (tok.type === 'IDENT') {
			const rawIdent = String(tok.value);
			const lowerIdent = rawIdent.toLowerCase();
			this.consume('IDENT');

			// Function call: func(...)
			if (this.current().type === 'LPAREN') {
				this.consume('LPAREN');
				const args: number[] = [];
				if (this.current().type !== 'RPAREN') {
					args.push(this.parseExpression());
					while (this.current().type === 'COMMA') {
						this.consume('COMMA');
						args.push(this.parseExpression());
					}
				}
				this.consume('RPAREN');
				return this.executeFunction(lowerIdent, args, tok.pos);
			}

			// Constants
			if (lowerIdent in CONSTANTS) {
				return CONSTANTS[lowerIdent];
			}

			// Variable reference
			this.referencedVars.add(rawIdent);

			let val: number | undefined;
			if (this.lookup) {
				if (typeof this.lookup === 'function') {
					val = this.lookup(rawIdent);
					if (val === undefined && rawIdent !== lowerIdent) {
						val = this.lookup(lowerIdent);
					}
				} else if (this.lookup instanceof Map) {
					val = this.lookup.get(rawIdent) ?? this.lookup.get(lowerIdent);
				} else {
					val = (this.lookup as Record<string, number>)[rawIdent] ?? (this.lookup as Record<string, number>)[lowerIdent];
				}
			}

			if (val === undefined || Number.isNaN(val)) {
				throw new Error(`Unknown parameter '${rawIdent}' at index ${tok.pos}`);
			}

			// Check if variable is followed by unit (e.g. "param1 mm")
			if (this.current().type === 'IDENT') {
				const nextIdent = String(this.current().value).toLowerCase();
				if (nextIdent in UNITS && this.peekNext().type !== 'LPAREN') {
					this.consume();
					val *= UNITS[nextIdent];
				}
			}

			return val;
		}

		throw new Error(`Unexpected token '${this.tokenToString(tok)}' at index ${tok.pos}`);
	}

	private executeFunction(fnName: string, args: number[], pos: number): number {
		switch (fnName) {
			// Trigonometry (inputs in degrees by default, consistent with CAD standards)
			case 'sin':
				if (args.length !== 1) throw new Error(`sin() takes 1 argument at index ${pos}`);
				return Math.sin((args[0] * Math.PI) / 180);
			case 'cos':
				if (args.length !== 1) throw new Error(`cos() takes 1 argument at index ${pos}`);
				return Math.cos((args[0] * Math.PI) / 180);
			case 'tan':
				if (args.length !== 1) throw new Error(`tan() takes 1 argument at index ${pos}`);
				return Math.tan((args[0] * Math.PI) / 180);
			// Inverse trigonometry (outputs in degrees)
			case 'asin':
				if (args.length !== 1) throw new Error(`asin() takes 1 argument at index ${pos}`);
				if (args[0] < -1 || args[0] > 1) throw new Error(`asin argument out of range [-1, 1] at index ${pos}`);
				return (Math.asin(args[0]) * 180) / Math.PI;
			case 'acos':
				if (args.length !== 1) throw new Error(`acos() takes 1 argument at index ${pos}`);
				if (args[0] < -1 || args[0] > 1) throw new Error(`acos argument out of range [-1, 1] at index ${pos}`);
				return (Math.acos(args[0]) * 180) / Math.PI;
			case 'atan':
				if (args.length !== 1) throw new Error(`atan() takes 1 argument at index ${pos}`);
				return (Math.atan(args[0]) * 180) / Math.PI;
			case 'atan2':
				if (args.length !== 2) throw new Error(`atan2() takes 2 arguments at index ${pos}`);
				return (Math.atan2(args[0], args[1]) * 180) / Math.PI;
			// Helpers to explicitly convert between degrees and radians
			case 'deg':
				if (args.length !== 1) throw new Error(`deg() takes 1 argument at index ${pos}`);
				return (args[0] * 180) / Math.PI;
			case 'rad':
				if (args.length !== 1) throw new Error(`rad() takes 1 argument at index ${pos}`);
				return (args[0] * Math.PI) / 180;
			// Standard math functions
			case 'sqrt':
				if (args.length !== 1) throw new Error(`sqrt() takes 1 argument at index ${pos}`);
				if (args[0] < 0) throw new Error(`Square root of negative number at index ${pos}`);
				return Math.sqrt(args[0]);
			case 'abs':
				if (args.length !== 1) throw new Error(`abs() takes 1 argument at index ${pos}`);
				return Math.abs(args[0]);
			case 'round':
				if (args.length !== 1) throw new Error(`round() takes 1 argument at index ${pos}`);
				return Math.round(args[0]);
			case 'floor':
				if (args.length !== 1) throw new Error(`floor() takes 1 argument at index ${pos}`);
				return Math.floor(args[0]);
			case 'ceil':
				if (args.length !== 1) throw new Error(`ceil() takes 1 argument at index ${pos}`);
				return Math.ceil(args[0]);
			case 'sign':
				if (args.length !== 1) throw new Error(`sign() takes 1 argument at index ${pos}`);
				return Math.sign(args[0]);
			case 'min':
				if (args.length < 1) throw new Error(`min() takes at least 1 argument at index ${pos}`);
				return Math.min(...args);
			case 'max':
				if (args.length < 1) throw new Error(`max() takes at least 1 argument at index ${pos}`);
				return Math.max(...args);
			default:
				throw new Error(`Unknown function '${fnName}()' at index ${pos}`);
		}
	}
}

/**
 * Evaluates an arithmetic / algebraic expression in string form.
 */
export function evaluateExpression(expr: string, scope?: VariableLookup): number {
	const trimmed = expr.trim();
	if (!trimmed) {
		throw new Error('Expression is empty');
	}
	const lexer = new Lexer(trimmed);
	const tokens = lexer.tokenize();
	const parser = new ExpressionParser(tokens, scope);
	return parser.parse();
}

/**
 * Safely evaluates an expression and returns result or detailed error.
 */
export function validateExpression(
	expr: string,
	scope?: VariableLookup
): { isValid: boolean; value?: number; error?: string; referencedVars: string[] } {
	const trimmed = expr.trim();
	if (!trimmed) {
		return { isValid: false, error: 'Empty expression', referencedVars: [] };
	}
	try {
		const lexer = new Lexer(trimmed);
		const tokens = lexer.tokenize();
		const parser = new ExpressionParser(tokens, scope);
		const val = parser.parse();
		return {
			isValid: true,
			value: val,
			referencedVars: Array.from(parser.getReferencedVariables()),
		};
	} catch (err) {
		// Even if execution failed (e.g. variable lookup), attempt to extract variables
		let vars: string[] = [];
		try {
			vars = Array.from(extractVariables(expr));
		} catch {
			// ignore
		}
		return {
			isValid: false,
			error: err instanceof Error ? err.message : String(err),
			referencedVars: vars,
		};
	}
}

/**
 * Extracts all variable names referenced in the expression without evaluating them.
 */
export function extractVariables(expr: string): Set<string> {
	const trimmed = expr.trim();
	if (!trimmed) return new Set();
	const lexer = new Lexer(trimmed);
	const tokens = lexer.tokenize();
	// Dummy lookup returning 1 for everything to trace identifiers
	const parser = new ExpressionParser(tokens, () => 1);
	try {
		parser.parse();
	} catch {
		// Ignore evaluation errors, we only care about referenced variables collected before failure
	}
	return parser.getReferencedVariables();
}

/**
 * Parameter definition for the parametric solver document.
 */
export interface SketchParameter {
	id: string;
	name: string;
	expression: string;
	value: number;
	comment?: string;
}

/**
 * Result of evaluating parameter dependency graph.
 */
export interface ParameterGraphResult {
	values: Map<string, number>;
	errors: Map<string, string>;
	order: string[];
}

/**
 * Evaluates all parameters in topological dependency order and detects circular dependencies.
 */
export function evaluateParameterGraph(
	parameters: Map<string, SketchParameter> | SketchParameter[]
): ParameterGraphResult {
	const paramList = Array.isArray(parameters) ? parameters : Array.from(parameters.values());
	const paramMap = new Map<string, SketchParameter>();
	for (const p of paramList) {
		paramMap.set(p.name, p);
	}

	const adj = new Map<string, Set<string>>();
	for (const p of paramList) {
		const deps = extractVariables(p.expression);
		adj.set(p.name, deps);
	}

	const values = new Map<string, number>();
	const errors = new Map<string, string>();
	const order: string[] = [];

	// DFS cycle detection and topological sorting
	// 0: unvisited, 1: visiting (in stack), 2: visited
	const state = new Map<string, number>();
	const hasCycle = new Set<string>();

	function dfs(node: string, path: string[]): boolean {
		state.set(node, 1);
		path.push(node);

		const deps = adj.get(node) || new Set();
		for (const dep of deps) {
			if (!paramMap.has(dep)) {
				// Dependency is not a known parameter
				continue;
			}
			const depState = state.get(dep) || 0;
			if (depState === 1) {
				// Cycle found!
				const cycleIndex = path.indexOf(dep);
				const cyclePath = path.slice(cycleIndex).concat(dep).join(' -> ');
				errors.set(node, `Cyclic dependency: ${cyclePath}`);
				hasCycle.add(node);
				hasCycle.add(dep);
				return false;
			}
			if (depState === 0) {
				if (!dfs(dep, path)) {
					hasCycle.add(node);
					return false;
				}
			}
		}

		path.pop();
		state.set(node, 2);
		order.push(node);
		return true;
	}

	for (const p of paramList) {
		if ((state.get(p.name) || 0) === 0) {
			dfs(p.name, []);
		}
	}

	// Now evaluate in topological order
	for (const name of order) {
		if (hasCycle.has(name)) {
			if (!errors.has(name)) {
				errors.set(name, 'Depends on parameter with cyclic reference');
			}
			continue;
		}

		const p = paramMap.get(name)!;
		try {
			const val = evaluateExpression(p.expression, values);
			values.set(name, val);
		} catch (err) {
			errors.set(name, err instanceof Error ? err.message : String(err));
		}
	}

	return { values, errors, order };
}

/**
 * Checks if a parameter name is valid and not reserved.
 */
export function isValidParameterName(name: string): { isValid: boolean; error?: string } {
	const trimmed = name.trim();
	if (!trimmed) {
		return { isValid: false, error: 'Parameter name cannot be empty' };
	}
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
		return {
			isValid: false,
			error: 'Parameter name must start with a letter or underscore, and contain only letters, numbers, and underscores',
		};
	}
	if (RESERVED_WORDS.has(trimmed.toLowerCase())) {
		return {
			isValid: false,
			error: `'${trimmed}' is a reserved keyword or unit name`,
		};
	}
	return { isValid: true };
}

/**
 * Parses a string that may contain either a raw number or a mathematical expression,
 * returning the evaluated finite number or fallback.
 */
export function parseNumericOrExpression(
	text: string,
	fallback: number,
	scope?: VariableLookup
): number {
	const trimmed = text.trim();
	if (!trimmed) return fallback;
	try {
		const val = evaluateExpression(trimmed, scope);
		if (Number.isFinite(val)) return val;
	} catch {
		const num = parseFloat(trimmed.replace(',', '.'));
		if (Number.isFinite(num)) return num;
	}
	return fallback;
}

/**
 * Safely replaces a parameter identifier in an expression string when a parameter is renamed.
 */
export function renameParameterInExpression(expr: string, oldName: string, newName: string): string {
	const regex = new RegExp(`\\b${oldName}\\b`, 'g');
	return expr.replace(regex, newName);
}

/**
 * Returns trimmed expression string if text represents a formula or variable expression
 * (i.e. valid and not a plain numeric literal). Returns undefined if invalid or plain number.
 */
export function getExpressionIfValid(
	text: string,
	scope?: VariableLookup
): string | undefined {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	const res = validateExpression(trimmed, scope);
	if (!res.isValid || res.value === undefined || !isFinite(res.value)) {
		return undefined;
	}
	if (res.referencedVars.length > 0 || isNaN(Number(trimmed.replace(',', '.')))) {
		return trimmed;
	}
	return undefined;
}


