import { SketchDocument } from '../../src/model/sketch';
export function copyScene() {
	const doc = new SketchDocument();
	const ids: string[] = [];
	doc.withDeferredSolve(() => {
		const a = doc.addPoint({ x: 10, y: 5 }),
			b = doc.addPoint({ x: 20, y: 5 });
		ids.push(doc.addLine(a.id, b.id).id);
		const center = doc.addPoint({ x: 30, y: 10 }),
			start = doc.addPoint({ x: 35, y: 10 }),
			end = doc.addPoint({ x: 30, y: 15 });
		ids.push(doc.addCircle(center.id, 5).id, doc.addArc(center.id, start.id, end.id, 5, true).id);
		const major = doc.addPoint({ x: 38, y: 10 }),
			minor = doc.addPoint({ x: 30, y: 13 });
		ids.push(
			doc.addEllipse(center.id, major.id, minor.id).id,
			doc.addEllipticalArc(center.id, major.id, minor.id, major.id, minor.id, true).id
		);
		const fit = [
			{ x: 0, y: 0 },
			{ x: 7, y: 10 },
			{ x: 15, y: 3 },
		].map(p => doc.addPoint(p).id);
		ids.push(doc.addFitSpline(fit).id);
		const controls = [
			{ x: -20, y: 0 },
			{ x: -17, y: 8 },
			{ x: -5, y: -3 },
			{ x: -2, y: 6 },
		].map(p => doc.addPoint(p).id);
		ids.push(doc.addControlSpline(controls).id);
		ids.push(doc.addPoint({ x: 0, y: 6 }).id);
	});
	doc.clearHistory();
	return { doc, ids };
}
