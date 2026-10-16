import type { SketchDocument } from './sketch';

export function loadTrianglePreset(sketch: SketchDocument): void {
  sketch.beginTransaction();
  sketch.clear();

  // Create points
  const pA = sketch.addPoint(-80, 0);
  const pB = sketch.addPoint(80, 0);
  const pC = sketch.addPoint(0, 120);

  // Fix origin / vertex A
  sketch.addFixedConstraint(pA.id);

  // Create lines
  sketch.addLine(pA.id, pB.id);
  const lLeft = sketch.addLine(pA.id, pC.id);
  const lRight = sketch.addLine(pB.id, pC.id);

  // Constraints
  sketch.addHorizontalConstraint(pA.id, pB.id);
  sketch.addDistanceConstraint(pA.id, pB.id, 160);
  sketch.addEqualLengthConstraint(lLeft.id, lRight.id);

  sketch.solve();
  sketch.commitTransaction();
}

export function loadBracketPreset(sketch: SketchDocument): void {
  sketch.beginTransaction();
  sketch.clear();

  // 6 vertices of L-bracket
  const p0 = sketch.addPoint(0, 0);
  const p1 = sketch.addPoint(140, 0);
  const p2 = sketch.addPoint(140, 30);
  const p3 = sketch.addPoint(35, 30);
  const p4 = sketch.addPoint(35, 120);
  const p5 = sketch.addPoint(0, 120);

  sketch.addFixedConstraint(p0.id);

  sketch.addLine(p0.id, p1.id);
  sketch.addLine(p1.id, p2.id);
  sketch.addLine(p2.id, p3.id);
  sketch.addLine(p3.id, p4.id);
  sketch.addLine(p4.id, p5.id);
  sketch.addLine(p5.id, p0.id);

  sketch.addHorizontalConstraint(p0.id, p1.id);
  sketch.addVerticalConstraint(p1.id, p2.id);
  sketch.addHorizontalConstraint(p2.id, p3.id);
  sketch.addVerticalConstraint(p3.id, p4.id);
  sketch.addHorizontalConstraint(p4.id, p5.id);
  sketch.addVerticalConstraint(p5.id, p0.id);

  sketch.addDistanceConstraint(p0.id, p1.id, 140);
  sketch.addDistanceConstraint(p5.id, p0.id, 120);
  sketch.addDistanceConstraint(p1.id, p2.id, 30);
  sketch.addDistanceConstraint(p5.id, p4.id, 35);

  sketch.solve();
  sketch.commitTransaction();
}

export function loadFourBarLinkagePreset(sketch: SketchDocument): void {
  sketch.beginTransaction();
  sketch.clear();

  // Ground pivots
  const pA = sketch.addPoint(-100, -40);
  const pD = sketch.addPoint(100, -40);
  sketch.addFixedConstraint(pA.id);
  sketch.addFixedConstraint(pD.id);

  // Moving joints
  const pB = sketch.addPoint(-60, 30);
  const pC = sketch.addPoint(70, 45);

  // Links
  sketch.addLine(pA.id, pD.id, true); // Construction line for ground
  sketch.addLine(pA.id, pB.id);
  sketch.addLine(pB.id, pC.id);
  sketch.addLine(pD.id, pC.id);

  sketch.addDistanceConstraint(pA.id, pB.id, 80);
  sketch.addDistanceConstraint(pB.id, pC.id, 130);
  sketch.addDistanceConstraint(pD.id, pC.id, 90);

  sketch.solve();
  sketch.commitTransaction();
}

export function loadCircleTangentPreset(sketch: SketchDocument): void {
  sketch.beginTransaction();
  sketch.clear();

  const cCenter = sketch.addPoint(-50, 0);
  sketch.addFixedConstraint(cCenter.id);
  const circ = sketch.addCircle(cCenter.id, 50);
  sketch.addRadiusConstraint(circ.id, 50);

  const p1 = sketch.addPoint(-120, 80);
  const p2 = sketch.addPoint(100, 80);
  const line = sketch.addLine(p1.id, p2.id);

  sketch.addHorizontalConstraint(p1.id, p2.id);
  sketch.addTangentConstraint(line.id, circ.id);

  sketch.solve();
  sketch.commitTransaction();
}
