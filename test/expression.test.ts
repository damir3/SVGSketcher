import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	evaluateExpression,
	validateExpression,
	extractVariables,
	evaluateParameterGraph,
	isValidParameterName,
	renameParameterInExpression,
	getExpressionIfValid,
	type SketchParameter,
} from '../src/math/expression';

describe('Expression Evaluator', () => {
	it('evaluates basic arithmetic and precedence', () => {
		assert.equal(evaluateExpression('2 + 3 * 4'), 14);
		assert.equal(evaluateExpression('(2 + 3) * 4'), 20);
		assert.equal(evaluateExpression('10 - 4 - 2'), 4);
		assert.equal(evaluateExpression('10 / 2 * 5'), 25);
		assert.equal(evaluateExpression('10 % 3'), 1);
		assert.equal(evaluateExpression('2 ^ 3 ^ 2'), 512); // right-associative: 2^(3^2) = 2^9
		assert.equal(evaluateExpression('-5 + 8'), 3);
		assert.equal(evaluateExpression('-(2 + 3)'), -5);
		assert.equal(evaluateExpression('+10'), 10);
	});

	it('supports comma and dot decimal separators', () => {
		assert.equal(evaluateExpression('10.5 + 2.5'), 13);
		assert.equal(evaluateExpression('10,5 + 2,5'), 13);
	});

	it('supports length and angle unit suffixes', () => {
		assert.equal(evaluateExpression('10mm + 5mm'), 15);
		assert.equal(evaluateExpression('2cm'), 20);
		assert.equal(evaluateExpression('1m'), 1000);
		assert.equal(evaluateExpression('1in'), 25.4);
		assert.equal(evaluateExpression('1 inch'), 25.4);
		assert.equal(evaluateExpression('1 ft'), 304.8);
		assert.equal(evaluateExpression('10 mm + 2 cm'), 30);
		assert.equal(evaluateExpression('90deg'), 90);
		assert.ok(Math.abs(evaluateExpression('1rad') - 57.2957795) < 1e-4);
	});

	it('supports mathematical constants and functions', () => {
		assert.ok(Math.abs(evaluateExpression('pi') - Math.PI) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('e') - Math.E) < 1e-6);
		assert.equal(evaluateExpression('sqrt(25)'), 5);
		assert.equal(evaluateExpression('abs(-42)'), 42);
		assert.equal(evaluateExpression('min(10, 5, 20)'), 5);
		assert.equal(evaluateExpression('max(10, 5, 20)'), 20);
		assert.equal(evaluateExpression('round(4.6)'), 5);
		assert.equal(evaluateExpression('floor(4.9)'), 4);
		assert.equal(evaluateExpression('ceil(4.1)'), 5);

		// Trigonometry default in degrees
		assert.ok(Math.abs(evaluateExpression('sin(90)') - 1) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('sin(90deg)') - 1) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('cos(0)') - 1) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('tan(45)') - 1) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('asin(1)') - 90) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('atan(1)') - 45) < 1e-6);
		assert.ok(Math.abs(evaluateExpression('atan2(10, 10)') - 45) < 1e-6);
	});

	it('evaluates expressions with variable lookup', () => {
		const vars = new Map<string, number>([
			['width', 100],
			['height', 50],
			['scale', 2],
		]);
		assert.equal(evaluateExpression('width / 2 + 10', vars), 60);
		assert.equal(evaluateExpression('width + height * scale', vars), 200);
		assert.equal(evaluateExpression('width mm + 5 cm', vars), 150);
	});

	it('extracts variable names', () => {
		const vars = extractVariables('width * 2 + height / sqrt(offset) - sin(angle)');
		assert.deepEqual(Array.from(vars).sort(), ['angle', 'height', 'offset', 'width']);
	});

	it('validates expressions gracefully', () => {
		const valid = validateExpression('10 * 2 + 5');
		assert.equal(valid.isValid, true);
		assert.equal(valid.value, 25);

		const invalid = validateExpression('10 + * 2');
		assert.equal(invalid.isValid, false);
		assert.ok(invalid.error);

		const divZero = validateExpression('10 / 0');
		assert.equal(divZero.isValid, false);
		assert.equal(divZero.error, 'Division by zero');
	});

	it('evaluates parameter graphs and resolves dependencies in topological order', () => {
		const params: SketchParameter[] = [
			{ id: '1', name: 'w', expression: '100', value: 0 },
			{ id: '2', name: 'h', expression: 'w / 2', value: 0 },
			{ id: '3', name: 'r', expression: 'h / 5', value: 0 },
			{ id: '4', name: 'extra', expression: 'r + 10', value: 0 },
		];

		const res = evaluateParameterGraph(params);
		assert.equal(res.errors.size, 0);
		assert.equal(res.values.get('w'), 100);
		assert.equal(res.values.get('h'), 50);
		assert.equal(res.values.get('r'), 10);
		assert.equal(res.values.get('extra'), 20);
	});

	it('detects cycles in parameter graph', () => {
		const params: SketchParameter[] = [
			{ id: '1', name: 'a', expression: 'b + 1', value: 0 },
			{ id: '2', name: 'b', expression: 'a + 1', value: 0 },
		];

		const res = evaluateParameterGraph(params);
		assert.ok(res.errors.size > 0);
		assert.ok(res.errors.get('a')?.includes('Cyclic dependency') || res.errors.get('b')?.includes('Cyclic dependency'));
	});

	it('validates parameter names and keywords', () => {
		assert.equal(isValidParameterName('param_1').isValid, true);
		assert.equal(isValidParameterName('_width').isValid, true);
		assert.equal(isValidParameterName('123abc').isValid, false);
		assert.equal(isValidParameterName('sin').isValid, false); // reserved keyword
		assert.equal(isValidParameterName('mm').isValid, false); // reserved unit
		assert.equal(isValidParameterName('pi').isValid, false); // reserved constant
	});

	it('renames parameter in expressions', () => {
		const expr = 'width * 2 + width_extra + width';
		const renamed = renameParameterInExpression(expr, 'width', 'total_width');
		assert.equal(renamed, 'total_width * 2 + width_extra + total_width');
	});

	it('getExpressionIfValid detects valid formula expressions and ignores plain numbers', () => {
		const scope = new Map([['w', 100]]);
		assert.equal(getExpressionIfValid('w', scope), 'w');
		assert.equal(getExpressionIfValid('w / 2', scope), 'w / 2');
		assert.equal(getExpressionIfValid('10 + 20', scope), '10 + 20');
		assert.equal(getExpressionIfValid('50', scope), undefined);
		assert.equal(getExpressionIfValid('50.5', scope), undefined);
		assert.equal(getExpressionIfValid('', scope), undefined);
		assert.equal(getExpressionIfValid('invalid * +', scope), undefined);
	});
});
