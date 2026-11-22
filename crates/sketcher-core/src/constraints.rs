//! Native residuals and Jacobians. Tags and reference order match nativeConstraints.ts.
use crate::matrix::{NormalEquationsWorkspace, SparseRows};
use crate::solver::Evaluation;
use ConstraintKind::*;
mod dependency;
mod inspection;
mod splines;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ConstraintKind {
    FixedPoint,
    Coincident,
    Horizontal,
    Vertical,
    Radius,
    EqualRadius,
    Distance,
    EqualLength,
    Midpoint,
    PointOnCircle,
    PointOnLine,
    Parallel,
    Perpendicular,
    Collinear,
    Angle,
    TangentLineCircle,
    TangentCircleCircle,
    PointOnEllipse,
    EllipticalArcEndpoints,
    CircularArcEndpoints,
    PointToLineDistance,
    Symmetry,
    CircularPatternPoint,
    RectangularPatternPoint,
    OffsetLineEndpoint,
    OffsetCircle,
    OffsetSplinePoint,
    OriginDistance,
    LineToAxisDistance,
    PointOnSpline,
    AutomaticSplineHandles,
}

impl TryFrom<usize> for ConstraintKind {
    type Error = &'static str;

    // These tags are part of the packed constraint format shared with TypeScript.
    fn try_from(tag: usize) -> Result<Self, Self::Error> {
        Ok(match tag {
            0 => FixedPoint,
            1 => Coincident,
            2 => Horizontal,
            3 => Vertical,
            4 => Radius,
            5 => EqualRadius,
            6 => Distance,
            7 => EqualLength,
            8 => Midpoint,
            9 => PointOnCircle,
            10 => PointOnLine,
            11 => Parallel,
            12 => Perpendicular,
            13 => Collinear,
            14 => Angle,
            15 => TangentLineCircle,
            16 => TangentCircleCircle,
            17 => PointOnEllipse,
            18 => EllipticalArcEndpoints,
            19 => CircularArcEndpoints,
            20 => PointToLineDistance,
            21 => Symmetry,
            22 => CircularPatternPoint,
            23 => RectangularPatternPoint,
            24 => OffsetLineEndpoint,
            25 => OffsetCircle,
            26 => OffsetSplinePoint,
            27 => OriginDistance,
            28 => LineToAxisDistance,
            29 => PointOnSpline,
            30 => AutomaticSplineHandles,
            _ => return Err("Unknown native constraint kind"),
        })
    }
}

struct Ref {
    index: Option<usize>,
    constant: f64,
}
struct Constraint {
    kind: ConstraintKind,
    row: usize,
    hard_row: Option<usize>,
    weight: f64,
    a: f64,
    b: f64,
    sin_cos: Option<(f64, f64)>,
    refs: Vec<Ref>,
}

fn integer(value: f64) -> Result<usize, &'static str> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value >= usize::MAX as f64 {
        return Err("Invalid native constraint index");
    }
    Ok(value as usize)
}

impl Constraint {
    fn equations(&self) -> usize {
        match self.kind {
            AutomaticSplineHandles => self.b as usize * 4,
            OffsetCircle if self.refs.len() != 2 => 3,
            Collinear if self.a == 0.0 => 2,
            OriginDistance if self.b == 3.0 => 2,
            FixedPoint
            | Coincident
            | Midpoint
            | EllipticalArcEndpoints
            | CircularArcEndpoints
            | Symmetry
            | CircularPatternPoint
            | RectangularPatternPoint
            | OffsetSplinePoint
            | LineToAxisDistance => 2,
            _ => 1,
        }
    }

    fn residuals(&self, p: &[f64]) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.equations());
        self.residuals_into(p, &mut out);
        out
    }

    fn residuals_into(&self, p: &[f64], out: &mut Vec<f64>) {
        out.clear();
        let w = self.weight;
        match self.kind {
            FixedPoint => out.extend_from_slice(&[(p[0] - self.a) * w, (p[1] - self.b) * w]),
            Coincident => out.extend_from_slice(&[(p[0] - p[2]) * w, (p[1] - p[3]) * w]),
            Horizontal => out.push((p[3] - p[1]) * w),
            Vertical => out.push((p[2] - p[0]) * w),
            Radius => out.push((p[0] - self.a) * w),
            EqualRadius => out.push((p[0] - p[1]) * w),
            Distance => {
                let (dx, dy) = (p[2] - p[0], p[3] - p[1]);
                let distance = if self.b == 1.0 {
                    dx * if dx >= 0.0 { 1.0 } else { -1.0 }
                } else if self.b == 2.0 {
                    dy * if dy >= 0.0 { 1.0 } else { -1.0 }
                } else {
                    dx.hypot(dy)
                };
                out.push((distance - self.a) * w);
            }
            EqualLength => {
                out.push(((p[0] - p[2]).hypot(p[1] - p[3]) - (p[4] - p[6]).hypot(p[5] - p[7])) * w)
            }
            Midpoint => out.extend_from_slice(&[
                (p[0] - ((1.0 - self.a) * p[2] + self.a * p[4])) * w,
                (p[1] - ((1.0 - self.a) * p[3] + self.a * p[5])) * w,
            ]),
            PointOnCircle => out.push(((p[0] - p[2]).hypot(p[1] - p[3]) - p[4]) * w),
            PointOnLine => {
                let (dx, dy) = (p[4] - p[2], p[5] - p[3]);
                out.push((((p[0] - p[2]) * dy - (p[1] - p[3]) * dx) / dx.hypot(dy).max(1e-7)) * w);
            }
            Parallel | Perpendicular | Collinear => {
                let (dx1, dy1, dx2, dy2) = (p[2] - p[0], p[3] - p[1], p[6] - p[4], p[7] - p[5]);
                let (l1, l2) = (dx1.hypot(dy1).max(1e-7), dx2.hypot(dy2).max(1e-7));
                let product = if self.kind == Perpendicular {
                    dx1 * dx2 + dy1 * dy2
                } else {
                    dx1 * dy2 - dy1 * dx2
                };
                let equation = (product / (l1 * l2)) * ((l1 + l2) * 0.5) * w;
                if self.kind != Collinear || self.a == 1.0 {
                    out.push(equation);
                } else {
                    let cross =
                        ((p[4] + p[6]) * 0.5 - p[0]) * dy1 - ((p[5] + p[7]) * 0.5 - p[1]) * dx1;
                    out.extend_from_slice(&[equation, (cross / l1) * w]);
                }
            }
            Angle => {
                let (dx1, dy1) = ((p[2] - p[0]) * p[8], (p[3] - p[1]) * p[8]);
                let (dx2, dy2) = ((p[6] - p[4]) * p[9], (p[7] - p[5]) * p[9]);
                let (l1, l2) = (dx1.hypot(dy1).max(1e-7), dx2.hypot(dy2).max(1e-7));
                let average = if self.b == 1.0 {
                    l2
                } else if self.b == 2.0 {
                    l1
                } else {
                    (l1 + l2) * 0.5
                };
                // Match Vec2.divideScalar and rotateAround operation order.
                let (x1, y1) = (dx1 * (1.0 / l1), dy1 * (1.0 / l1));
                let (x2, y2) = (dx2 * (1.0 / l2), dy2 * (1.0 / l2));
                let angle = p[10] * ((self.a * std::f64::consts::PI) / 180.0);
                let (sin, cos) = (angle.sin(), angle.cos());
                let (rx, ry) = (x1 * cos - y1 * sin, y1 * cos + x1 * sin);
                out.push((rx * y2 - ry * x2) * average * w);
            }
            TangentLineCircle | PointToLineDistance => {
                let (dx, dy) = (p[4] - p[2], p[5] - p[3]);
                let distance = ((p[0] - p[2]) * dy - (p[1] - p[3]) * dx) / dx.hypot(dy).max(1e-7);
                let target = if self.kind == TangentLineCircle {
                    self.a * p[6]
                } else {
                    self.b * self.a
                };
                out.push((distance - target) * w);
            }
            TangentCircleCircle => {
                let distance = (p[2] - p[0]).hypot(p[3] - p[1]).max(1e-7);
                let target = if self.a == 0.0 {
                    p[4] + p[5]
                } else if self.a == 1.0 {
                    p[4] - p[5]
                } else {
                    p[5] - p[4]
                };
                out.push((distance - target) * w);
            }
            PointOnEllipse => out.push(ellipse_residual(p, 6, w)),
            EllipticalArcEndpoints => {
                out.extend_from_slice(&[ellipse_residual(p, 6, w), ellipse_residual(p, 8, w)])
            }
            CircularArcEndpoints => out.extend_from_slice(&[
                ((p[2] - p[0]).hypot(p[3] - p[1]) - p[6]) * w,
                ((p[4] - p[0]).hypot(p[5] - p[1]) - p[6]) * w,
            ]),
            Symmetry => {
                if self.a == 1.0 {
                    out.extend_from_slice(&[(p[0] + p[2]) * 0.5 * w, (p[1] + p[3]) * 0.5 * w]);
                } else {
                    let (dx, dy) = (p[6] - p[4], p[7] - p[5]);
                    let length = dx.hypot(dy).max(1e-7);
                    let (mx, my) = ((p[0] + p[2]) * 0.5, (p[1] + p[3]) * 0.5);
                    out.extend_from_slice(&[
                        (((mx - p[4]) * dy - (my - p[5]) * dx) / length) * w,
                        (((p[2] - p[0]) * dx + (p[3] - p[1]) * dy) / length) * w,
                    ]);
                }
            }
            CircularPatternPoint => {
                let (sin, cos) = self.sin_cos.unwrap_or_else(|| {
                    let angle = pattern_angle(p[6], p[7], self.b, self.a);
                    (angle.sin(), angle.cos())
                });
                let (x, y) = (p[2] - p[0], p[3] - p[1]);
                let (tx, ty) = (p[0] + x * cos - y * sin, p[1] + y * cos + x * sin);
                out.extend_from_slice(&[(p[4] - tx) * w, (p[5] - ty) * w]);
            }
            RectangularPatternPoint => {
                let directions = rectangular_directions(p);
                let o1 = axis_offset(p[12], self.a, p[14]);
                let o2 = axis_offset(p[13], self.b, p[15]);
                let x = directions.u1[0] * o1 + directions.u2[0] * o2;
                let y = directions.u1[1] * o1 + directions.u2[1] * o2;
                out.extend_from_slice(&[(p[2] - (p[0] + x)) * w, (p[3] - (p[1] + y)) * w]);
            }
            OffsetLineEndpoint => {
                let (dx, dy) = (p[4] - p[2], p[5] - p[3]);
                let left = (dx * (p[1] - p[3]) - dy * (p[0] - p[2])) / dx.hypot(dy).max(1e-9);
                out.push((left - self.b * self.a) * w);
            }
            OffsetCircle if self.refs.len() == 2 => out.push((p[0] - p[1] - self.b * self.a) * w),
            OffsetCircle => out.extend_from_slice(&[
                (p[0] - p[2]) * w,
                (p[1] - p[3]) * w,
                (p[4] - p[5] - self.b * self.a) * w,
            ]),
            OffsetSplinePoint => {
                let distance = p[6] * self.a;
                out.extend_from_slice(&[
                    (p[0] - (p[2] + p[4] * distance)) * w,
                    (p[1] - (p[3] + p[5] * distance)) * w,
                ]);
            }
            OriginDistance => {
                if self.b == 3.0 {
                    out.extend_from_slice(&[p[0] * w, p[1] * w]);
                } else if self.b == 0.0 {
                    out.push((p[0].hypot(p[1]) - self.a) * w);
                } else {
                    let coordinate = p[if self.b == 1.0 { 0 } else { 1 }];
                    out.push(if self.a == 0.0 {
                        coordinate * w
                    } else {
                        (coordinate - p[2] * self.a) * w
                    });
                }
            }
            LineToAxisDistance => {
                if self.b == 1.0 {
                    out.extend_from_slice(&[p[0] * w, p[1] * w]);
                } else {
                    out.extend_from_slice(&[
                        (p[0] - p[2] * self.a) * w,
                        (p[1] - p[2] * self.a) * w,
                    ]);
                }
            }
            PointOnSpline | AutomaticSplineHandles => out.extend(self.spline_residuals(p)),
        }
    }

    #[cfg(test)]
    fn jacobian(&self, p: &[f64]) -> Vec<(usize, usize, f64)> {
        let mut entries = Vec::new();
        self.jacobian_into(p, &mut |row, col, val| entries.push((row, col, val)));
        entries
    }

    fn jacobian_into(&self, p: &[f64], emit: &mut impl FnMut(usize, usize, f64)) {
        let w = self.weight;
        let mut add = |row: usize, slot: usize, value: f64| {
            if let Some(col) = self.refs[slot].index {
                // Pattern point entries bypass addJacobianEntry in the TS reference.
                if self.kind == CircularPatternPoint
                    || (self.kind == RectangularPatternPoint && slot < 4)
                    || value.abs() > 1e-12
                {
                    emit(row, col, value);
                }
            }
        };
        match self.kind {
            FixedPoint => {
                add(0, 0, w);
                add(1, 1, w);
            }
            Coincident => {
                add(0, 0, w);
                add(0, 2, -w);
                add(1, 1, w);
                add(1, 3, -w);
            }
            Horizontal => {
                add(0, 1, -w);
                add(0, 3, w);
            }
            Vertical => {
                add(0, 0, -w);
                add(0, 2, w);
            }
            Radius => add(0, 0, w),
            EqualRadius => {
                add(0, 0, w);
                add(0, 1, -w);
            }
            Distance => {
                let (dx, dy) = (p[2] - p[0], p[3] - p[1]);
                if self.b == 1.0 {
                    let sign = if dx >= 0.0 { 1.0 } else { -1.0 };
                    add(0, 0, -sign * w);
                    add(0, 2, sign * w);
                } else if self.b == 2.0 {
                    let sign = if dy >= 0.0 { 1.0 } else { -1.0 };
                    add(0, 1, -sign * w);
                    add(0, 3, sign * w);
                } else {
                    let scale = (w * 1.0) / dx.hypot(dy).max(1e-7);
                    let (x, y) = (dx * scale, dy * scale);
                    add(0, 0, -x);
                    add(0, 1, -y);
                    add(0, 2, x);
                    add(0, 3, y);
                }
            }
            EqualLength => {
                let (dx1, dy1, dx2, dy2) = (p[2] - p[0], p[3] - p[1], p[6] - p[4], p[7] - p[5]);
                let (l1, l2) = (dx1.hypot(dy1).max(1e-7), dx2.hypot(dy2).max(1e-7));
                add(0, 0, (-dx1 / l1) * w);
                add(0, 1, (-dy1 / l1) * w);
                add(0, 2, (dx1 / l1) * w);
                add(0, 3, (dy1 / l1) * w);
                add(0, 4, (dx2 / l2) * w);
                add(0, 5, (dy2 / l2) * w);
                add(0, 6, (-dx2 / l2) * w);
                add(0, 7, (-dy2 / l2) * w);
            }
            Midpoint => {
                add(0, 0, w);
                add(0, 2, -(1.0 - self.a) * w);
                add(0, 4, -self.a * w);
                add(1, 1, w);
                add(1, 3, -(1.0 - self.a) * w);
                add(1, 5, -self.a * w);
            }
            PointOnCircle => {
                let (dx, dy) = (p[0] - p[2], p[1] - p[3]);
                let scale = (w * 1.0) / dx.hypot(dy).max(1e-7);
                let (x, y) = (dx * scale, dy * scale);
                add(0, 0, x);
                add(0, 1, y);
                add(0, 2, -x);
                add(0, 3, -y);
                add(0, 4, -w);
            }
            Angle => {
                let d1 = [(p[2] - p[0]) * p[8], (p[3] - p[1]) * p[8]];
                let d2 = [(p[6] - p[4]) * p[9], (p[7] - p[5]) * p[9]];
                let lengths = [d1[0].hypot(d1[1]), d2[0].hypot(d2[1])];
                let l1 = lengths[0].max(1e-7);
                let l2 = lengths[1].max(1e-7);
                let u1 = [d1[0] / l1, d1[1] / l1];
                let u2 = [d2[0] / l2, d2[1] / l2];
                let angle = p[10] * self.a * std::f64::consts::PI / 180.0;
                let (sin, cos) = (angle.sin(), angle.cos());
                let rotated = [u1[0] * cos - u1[1] * sin, u1[1] * cos + u1[0] * sin];
                let cross = rotated[0] * u2[1] - rotated[1] * u2[0];
                let (average, factors) = if self.b == 1.0 {
                    (l2, [0.0, 1.0])
                } else if self.b == 2.0 {
                    (l1, [1.0, 0.0])
                } else {
                    ((l1 + l2) * 0.5, [0.5, 0.5])
                };
                let gradient =
                    |u: [f64; 2], length: f64, actual: f64, mut g: [f64; 2], factor: f64| {
                        if actual > 1e-7 {
                            let dot = u[0] * g[0] + u[1] * g[1];
                            g[0] -= u[0] * dot;
                            g[1] -= u[1] * dot;
                        }
                        for axis in 0..2 {
                            g[axis] *= average / length;
                            if actual > 1e-7 {
                                g[axis] += u[axis] * cross * factor;
                            }
                            g[axis] *= w;
                        }
                        g
                    };
                let g1 = gradient(
                    u1,
                    l1,
                    lengths[0],
                    [u2[1] * cos - u2[0] * sin, -u2[1] * sin - u2[0] * cos],
                    factors[0],
                );
                let g2 = gradient(u2, l2, lengths[1], [-rotated[1], rotated[0]], factors[1]);
                for (slot, gradient, sign) in
                    [(0, g1, -p[8]), (2, g1, p[8]), (4, g2, -p[9]), (6, g2, p[9])]
                {
                    add(0, slot, gradient[0] * sign);
                    add(0, slot + 1, gradient[1] * sign);
                }
            }
            CircularArcEndpoints => {
                for (row, slot) in [(0, 2), (1, 4)] {
                    let (dx, dy) = (p[slot] - p[0], p[slot + 1] - p[1]);
                    let inverse = 1.0 / dx.hypot(dy).max(1e-7);
                    let (x, y) = ((dx * inverse) * w, (dy * inverse) * w);
                    add(row, slot, x);
                    add(row, slot + 1, y);
                    add(row, 0, -x);
                    add(row, 1, -y);
                    add(row, 6, -w);
                }
            }
            CircularPatternPoint => {
                let (sin, cos) = self.sin_cos.unwrap_or_else(|| {
                    let angle = pattern_angle(p[6], p[7], self.b, self.a);
                    (angle.sin(), angle.cos())
                });
                add(0, 4, w);
                add(0, 2, -cos * w);
                add(0, 3, sin * w);
                add(0, 0, -(1.0 - cos) * w);
                add(0, 1, -sin * w);
                add(1, 5, w);
                add(1, 2, -sin * w);
                add(1, 3, -cos * w);
                add(1, 0, sin * w);
                add(1, 1, -(1.0 - cos) * w);
            }
            RectangularPatternPoint => {
                let d = rectangular_directions(p);
                let o1 = axis_offset(p[12], self.a, p[14]);
                let o2 = axis_offset(p[13], self.b, p[15]);
                add(0, 2, w);
                add(0, 0, -w);
                add(1, 3, w);
                add(1, 1, -w);
                if let Some(inverse) = d.inverse1 {
                    let [a, b, c, e] = direction_derivatives(d.u1, inverse);
                    let dx = [
                        o1 * a + if d.inverse2.is_none() { o2 * -c } else { 0.0 },
                        o1 * b + if d.inverse2.is_none() { o2 * -e } else { 0.0 },
                    ];
                    let dy = [
                        o1 * c + if d.inverse2.is_none() { o2 * a } else { 0.0 },
                        o1 * e + if d.inverse2.is_none() { o2 * b } else { 0.0 },
                    ];
                    add_axis_derivatives(&mut add, 4, dx, dy, w);
                }
                if let Some(inverse) = d.inverse2 {
                    let [a, b, c, e] = direction_derivatives(d.u2, inverse);
                    add_axis_derivatives(&mut add, 8, [o2 * a, o2 * b], [o2 * c, o2 * e], w);
                }
            }
            OffsetLineEndpoint => {
                for (row, col, val) in self.offset_line_jacobian(p) {
                    emit(row, col, val);
                }
            }
            OffsetCircle if self.refs.len() == 2 => {
                // Shared-center offset circle/arc: drive only the child radius.
                add(0, 0, w);
            }
            OffsetCircle => {
                // Offsets drive children only; parent references remain active in residuals.
                add(0, 0, w);
                add(1, 1, w);
                add(2, 4, w);
            }
            OffsetSplinePoint => {
                add(0, 0, w);
                add(1, 1, w);
            }
            OriginDistance => {
                if self.b == 3.0 {
                    add(0, 0, w);
                    add(1, 1, w);
                } else if self.b == 1.0 {
                    add(0, 0, w);
                } else if self.b == 2.0 {
                    add(0, 1, w);
                } else {
                    let length = p[0].hypot(p[1]).max(1e-7);
                    add(0, 0, (p[0] / length) * w);
                    add(0, 1, (p[1] / length) * w);
                }
            }
            LineToAxisDistance => {
                add(0, 0, w);
                add(1, 1, w);
            }
            AutomaticSplineHandles => {
                for (row, col, val) in self.automatic_jacobian(p) {
                    emit(row, col, val);
                }
            }
            PointOnLine
            | Parallel
            | Perpendicular
            | Collinear
            | TangentLineCircle
            | TangentCircleCircle
            | PointOnEllipse
            | EllipticalArcEndpoints
            | PointToLineDistance
            | Symmetry
            | PointOnSpline => self.numeric_jacobian_into(p, emit),
        }
    }

    fn numeric_jacobian_into(&self, p: &[f64], emit: &mut impl FnMut(usize, usize, f64)) {
        let mut columns: Vec<usize> = self.refs.iter().filter_map(|r| r.index).collect();
        columns.sort_unstable();
        columns.dedup();
        let mut trial = p.to_vec();
        let central = self.kind == Parallel;
        let eq_count = self.equations();
        let mut base = Vec::with_capacity(eq_count);
        if !central {
            self.residuals_into(p, &mut base);
        }
        let mut plus = Vec::with_capacity(eq_count);
        let mut minus = Vec::with_capacity(eq_count);
        let mut deferred = Vec::new();
        let step = if central { 2.0 * 1e-5 } else { 1e-5 };
        for &column in &columns {
            // All aliases of a shared parameter must be perturbed together.
            for (slot, r) in self.refs.iter().enumerate() {
                if r.index == Some(column) {
                    trial[slot] = p[slot] + 1e-5;
                }
            }
            self.residuals_into(&trial, &mut plus);
            if central {
                for (slot, r) in self.refs.iter().enumerate() {
                    if r.index == Some(column) {
                        trial[slot] = p[slot] - 1e-5;
                    }
                }
                self.residuals_into(&trial, &mut minus);
            }
            for (slot, r) in self.refs.iter().enumerate() {
                if r.index == Some(column) {
                    trial[slot] = p[slot];
                }
            }
            let minus_slice = if central { &minus } else { &base };
            let d0 = (plus[0] - minus_slice[0]) / step;
            if d0.abs() > 1e-11 {
                emit(0, column, d0);
            }
            for equation in 1..eq_count {
                let derivative = (plus[equation] - minus_slice[equation]) / step;
                if derivative.abs() > 1e-11 {
                    deferred.push((equation, column, derivative));
                }
            }
        }
        if !deferred.is_empty() {
            for equation in 1..eq_count {
                for &(eq, col, val) in &deferred {
                    if eq == equation {
                        emit(eq, col, val);
                    }
                }
            }
        }
    }

    fn geometric_jacobian_into(&self, p: &[f64], emit: &mut impl FnMut(usize, usize, f64)) {
        match self.kind {
            OffsetLineEndpoint => self.numeric_jacobian_into(p, emit),
            OffsetCircle if self.refs.len() == 2 => {
                let w = self.weight;
                if w.abs() > 1e-12 {
                    if let Some(col) = self.refs[0].index {
                        emit(0, col, w);
                    }
                    if let Some(col) = self.refs[1].index {
                        emit(0, col, -w);
                    }
                }
            }
            OffsetCircle => {
                let w = self.weight;
                let mut add = |row: usize, slot: usize, value: f64| {
                    if let Some(col) = self.refs[slot].index {
                        if value.abs() > 1e-12 {
                            emit(row, col, value);
                        }
                    }
                };
                add(0, 0, w);
                add(0, 2, -w);
                add(1, 1, w);
                add(1, 3, -w);
                add(2, 4, w);
                add(2, 5, -w);
            }
            _ => self.jacobian_into(p, emit),
        }
    }

    fn offset_line_jacobian(&self, p: &[f64]) -> Vec<(usize, usize, f64)> {
        let initial = self.residuals(p)[0];
        let mut trial = p.to_vec();
        let mut entries = Vec::new();
        for child in &self.refs[..2] {
            let Some(column) = child.index else {
                continue;
            };
            // The TS method perturbs the map entry, including any alias in the original line.
            for (i, r) in self.refs.iter().enumerate() {
                if r.index == Some(column) {
                    trial[i] = p[i] + 1e-6;
                }
            }
            let derivative = (self.residuals(&trial)[0] - initial) / 1e-6;
            for (i, r) in self.refs.iter().enumerate() {
                if r.index == Some(column) {
                    trial[i] = p[i];
                }
            }
            if derivative.abs() > 1e-12 {
                entries.push((0, column, derivative));
            }
        }
        entries
    }
}

fn pattern_angle(index: f64, quantity: f64, distribution: f64, total: f64) -> f64 {
    (pattern_degrees(index, quantity, distribution, total) * std::f64::consts::PI) / 180.0
}

pub(crate) fn pattern_degrees(index: f64, quantity: f64, distribution: f64, total: f64) -> f64 {
    let count = quantity.round().max(2.0);
    if distribution == 0.0 {
        (index * 360.0) / count
    } else {
        let step = total / (count - 1.0);
        if distribution == 1.0 {
            index * step
        } else if index % 2.0 == 1.0 {
            ((index + 1.0) / 2.0) * step
        } else {
            -(index / 2.0) * step
        }
    }
}

pub(crate) fn axis_offset(index: f64, distance: f64, symmetric: f64) -> f64 {
    if index == 0.0 {
        0.0
    } else if symmetric == 0.0 {
        index * distance
    } else if index % 2.0 == 1.0 {
        (index / 2.0).ceil() * distance
    } else {
        -(index / 2.0) * distance
    }
}

struct RectangularDirections {
    u1: [f64; 2],
    u2: [f64; 2],
    inverse1: Option<f64>,
    inverse2: Option<f64>,
}

fn rectangular_directions(p: &[f64]) -> RectangularDirections {
    let mut u1 = [1.0, 0.0];
    let mut inverse1 = None;
    let mut inverse2 = None;
    let (dx1, dy1) = (p[6] - p[4], p[7] - p[5]);
    let l1 = dx1.hypot(dy1);
    if p[16] == 1.0 && l1 > 1e-6 {
        let inverse = 1.0 / l1;
        u1 = [dx1 * inverse, dy1 * inverse];
        inverse1 = Some(inverse);
    }
    let mut u2 = [-u1[1], u1[0]];
    let (dx2, dy2) = (p[10] - p[8], p[11] - p[9]);
    let l2 = dx2.hypot(dy2);
    if p[17] == 1.0 && l2 > 1e-6 {
        let inverse = 1.0 / l2;
        u2 = [dx2 * inverse, dy2 * inverse];
        inverse2 = Some(inverse);
    }
    RectangularDirections {
        u1,
        u2,
        inverse1,
        inverse2,
    }
}

fn direction_derivatives(u: [f64; 2], inverse: f64) -> [f64; 4] {
    [
        (1.0 - u[0] * u[0]) * inverse,
        -u[0] * u[1] * inverse,
        -u[0] * u[1] * inverse,
        (1.0 - u[1] * u[1]) * inverse,
    ]
}

fn add_axis_derivatives(
    add: &mut impl FnMut(usize, usize, f64),
    start: usize,
    dx: [f64; 2],
    dy: [f64; 2],
    weight: f64,
) {
    for (row, derivative) in [(0, dx), (1, dy)] {
        add(row, start + 2, -derivative[0] * weight);
        add(row, start + 3, -derivative[1] * weight);
        add(row, start, derivative[0] * weight);
        add(row, start + 1, derivative[1] * weight);
    }
}

// References are [center, major-axis point, minor-axis point, point, optional second point].
fn ellipse_residual(p: &[f64], point: usize, weight: f64) -> f64 {
    let (ux, uy, vx, vy) = (p[2] - p[0], p[3] - p[1], p[4] - p[0], p[5] - p[1]);
    let (rx, ry) = (ux.hypot(uy).max(1e-7), vx.hypot(vy).max(1e-7));
    let (dx, dy) = (p[point] - p[0], p[point + 1] - p[1]);
    let u = dx * (ux * (1.0 / rx)) + dy * (uy * (1.0 / rx));
    let v = dx * (vx * (1.0 / ry)) + dy * (vy * (1.0 / ry));
    ((u * u) / (rx * rx) + (v * v) / (ry * ry) - 1.0) * ((rx + ry) * 0.5) * weight
}

pub struct Program {
    constraints: Vec<Constraint>,
    covered: Vec<bool>,
    hard_covered: Vec<bool>,
    n: usize,
}

impl Program {
    pub fn decode(data: &[f64], n: usize, m: usize, hard_m: usize) -> Result<Self, &'static str> {
        if hard_m > m {
            return Err("Invalid native constraint dimensions");
        }
        let mut program = Self {
            constraints: Vec::new(),
            covered: vec![false; m],
            hard_covered: vec![false; hard_m],
            n,
        };
        let mut offset = 0;
        while offset < data.len() {
            let header = data
                .get(offset..offset + 7)
                .ok_or("Truncated native constraint header")?;
            if header.iter().any(|v| !v.is_finite()) {
                return Err("Non-finite native constraint data");
            }
            let tag = integer(header[0])?;
            let count = integer(header[6])?;
            let kind = ConstraintKind::try_from(tag)?;
            let expected_refs = match kind {
                FixedPoint | EqualRadius => 2,
                Coincident | Horizontal | Vertical | Distance => 4,
                Radius => 1,
                EqualLength | Parallel | Perpendicular | Collinear | PointOnEllipse | Symmetry
                | CircularPatternPoint => 8,
                OffsetCircle if count == 2 => 2,
                Midpoint | PointOnLine | TangentCircleCircle | PointToLineDistance
                | OffsetLineEndpoint | OffsetCircle => 6,
                PointOnCircle => 5,
                Angle => 11,
                TangentLineCircle | CircularArcEndpoints | OffsetSplinePoint => 7,
                EllipticalArcEndpoints => 10,
                RectangularPatternPoint => 18,
                OriginDistance | LineToAxisDistance => 3,
                PointOnSpline | AutomaticSplineHandles => count,
            };
            if count != expected_refs {
                return Err("Invalid native constraint reference count");
            }
            if count > (data.len() - offset - 7) / 2 {
                return Err("Truncated native constraint references");
            }
            if (kind == Distance && ![0.0, 1.0, 2.0].contains(&header[5]))
                || (kind == Collinear && header[4] != 0.0 && header[4] != 1.0)
                || (kind == Angle && ![0.0, 1.0, 2.0].contains(&header[5]))
                || (kind == TangentCircleCircle && ![0.0, 1.0, 2.0].contains(&header[4]))
                || (kind == Symmetry && ![0.0, 1.0].contains(&header[4]))
                || (kind == CircularPatternPoint && ![0.0, 1.0, 2.0].contains(&header[5]))
                || (kind == OriginDistance && ![0.0, 1.0, 2.0, 3.0].contains(&header[5]))
                || (kind == LineToAxisDistance && ![0.0, 1.0].contains(&header[5]))
            {
                return Err("Invalid native constraint variant");
            }
            let row = integer(header[1])?;
            let hard_row = if header[2] == -1.0 {
                None
            } else {
                Some(integer(header[2])?)
            };
            let refs_data = data
                .get(offset + 7..offset + 7 + count * 2)
                .ok_or("Truncated native constraint references")?;
            let mut refs = Vec::with_capacity(count);
            for pair in refs_data.as_chunks::<2>().0 {
                let index = if pair[0] == -1.0 {
                    None
                } else {
                    Some(integer(pair[0])?)
                };
                if index.is_some_and(|i| i >= n) || !pair[1].is_finite() {
                    return Err("Invalid native constraint parameter");
                }
                refs.push(Ref {
                    index,
                    constant: pair[1],
                });
            }
            if matches!(kind, PointOnSpline | AutomaticSplineHandles) {
                splines::validate(kind, header[4], header[5], &refs)?;
            }
            let constants = match kind {
                CircularPatternPoint => &refs[6..],
                RectangularPatternPoint => &refs[12..],
                OffsetSplinePoint | OriginDistance | LineToAxisDistance => &refs[2..],
                _ => &[],
            };
            if constants.iter().any(|r| r.index.is_some())
                || (kind == RectangularPatternPoint
                    && refs[14..].iter().any(|r| ![0.0, 1.0].contains(&r.constant)))
            {
                return Err("Invalid native constraint configuration reference");
            }
            let sin_cos = if kind == CircularPatternPoint {
                let angle = pattern_angle(refs[6].constant, refs[7].constant, header[5], header[4]);
                Some((angle.sin(), angle.cos()))
            } else {
                None
            };
            let constraint = Constraint {
                kind,
                row,
                hard_row,
                weight: header[3],
                a: header[4],
                b: header[5],
                sin_cos,
                refs,
            };
            let equations = constraint.equations();
            Self::cover(&mut program.covered, row, equations)?;
            if let Some(row) = hard_row {
                Self::cover(&mut program.hard_covered, row, equations)?;
            }
            program.constraints.push(constraint);
            offset += 7 + count * 2;
        }
        Ok(program)
    }

    fn cover(covered: &mut [bool], row: usize, count: usize) -> Result<(), &'static str> {
        let end = row
            .checked_add(count)
            .ok_or("Native constraint row overflow")?;
        let rows = covered
            .get_mut(row..end)
            .ok_or("Native constraint row outside system")?;
        if rows.iter().any(|&v| v) {
            return Err("Overlapping native constraint rows");
        }
        rows.fill(true);
        Ok(())
    }

    pub fn needs_callback(&self, mode: Evaluation) -> bool {
        match mode {
            Evaluation::Commit => true,
            Evaluation::HardResiduals | Evaluation::HardJacobian => {
                self.hard_covered.iter().any(|&v| !v)
            }
            _ => self.covered.iter().any(|&v| !v),
        }
    }

    pub fn output_len(&self, mode: Evaluation) -> Result<usize, &'static str> {
        let m = if matches!(mode, Evaluation::HardResiduals | Evaluation::HardJacobian) {
            self.hard_covered.len()
        } else {
            self.covered.len()
        };
        match mode {
            Evaluation::Commit => Ok(0),
            Evaluation::Linearization => m
                .checked_mul(self.n)
                .and_then(|j| j.checked_add(m))
                .ok_or("Native constraint dimensions overflow"),
            Evaluation::HardJacobian => m
                .checked_mul(self.n)
                .ok_or("Native constraint dimensions overflow"),
            _ => Ok(m),
        }
    }

    pub fn fill(
        &self,
        state: &[f64],
        mode: Evaluation,
        output: &mut [f64],
    ) -> Result<(), &'static str> {
        if state.len() != self.n || output.len() != self.output_len(mode)? {
            return Err("Invalid native constraint evaluation dimensions");
        }
        if matches!(mode, Evaluation::Commit) {
            return Ok(());
        }
        let hard_only = matches!(mode, Evaluation::HardResiduals | Evaluation::HardJacobian);
        let residuals = !matches!(mode, Evaluation::HardJacobian);
        let jacobian = matches!(mode, Evaluation::Linearization | Evaluation::HardJacobian);
        let offset = if matches!(mode, Evaluation::Linearization) {
            self.covered.len()
        } else {
            0
        };
        let mut p = Vec::with_capacity(16);
        let mut res_buf = Vec::with_capacity(4);
        for constraint in &self.constraints {
            let row = if hard_only {
                let Some(row) = constraint.hard_row else {
                    continue;
                };
                row
            } else {
                constraint.row
            };
            p.clear();
            p.extend(
                constraint
                    .refs
                    .iter()
                    .map(|r| r.index.map_or(r.constant, |i| state[i])),
            );
            if residuals {
                constraint.residuals_into(&p, &mut res_buf);
                output[row..row + res_buf.len()].copy_from_slice(&res_buf);
            }
            if jacobian {
                // Native rows are authoritative; ignore callback values in those rows.
                output[offset + row * self.n..offset + (row + constraint.equations()) * self.n]
                    .fill(0.0);
                constraint.jacobian_into(&p, &mut |equation, column, value| {
                    output[offset + (row + equation) * self.n + column] += value;
                });
            }
        }
        Ok(())
    }
}

pub(crate) struct ActiveSubset {
    pub(crate) vars: Vec<usize>,
    pub(crate) var_to_local: Vec<usize>,
    pub(crate) constraints: Vec<usize>,
    pub(crate) idle_sum_sq: f64,
}

fn find_root(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

fn merge_sparse_row(row_vec: &mut Vec<(usize, f64)>) {
    if row_vec.len() > 1 {
        row_vec.sort_by_key(|&(c, _)| c);
        let mut write = 0;
        for read in 0..row_vec.len() {
            let (col, val) = row_vec[read];
            if write > 0 && row_vec[write - 1].0 == col {
                row_vec[write - 1].1 += val;
            } else {
                row_vec[write] = (col, val);
                write += 1;
            }
        }
        row_vec.truncate(write);
        row_vec.retain(|&(_, v)| v != 0.0);
    } else if row_vec.first().is_some_and(|&(_, v)| v == 0.0) {
        row_vec.clear();
    }
}

impl Program {
    pub(crate) fn evaluate_residuals(
        &self,
        state: &[f64],
        hard_only: bool,
        output: &mut [f64],
    ) -> Result<(), &'static str> {
        let expected = if hard_only {
            self.hard_covered.len()
        } else {
            self.covered.len()
        };
        if state.len() != self.n || output.len() != expected {
            return Err("Invalid native constraint evaluation dimensions");
        }
        output.fill(0.0);
        let mut p = Vec::with_capacity(16);
        let mut res_buf = Vec::with_capacity(4);
        for constraint in &self.constraints {
            let row = if hard_only {
                let Some(row) = constraint.hard_row else {
                    continue;
                };
                row
            } else {
                constraint.row
            };
            p.clear();
            p.extend(
                constraint
                    .refs
                    .iter()
                    .map(|r| r.index.map_or(r.constant, |i| state[i])),
            );
            constraint.residuals_into(&p, &mut res_buf);
            output[row..row + res_buf.len()].copy_from_slice(&res_buf);
        }
        Ok(())
    }

    pub(crate) fn evaluate_hard_error(&self, state: &[f64]) -> Result<f64, &'static str> {
        if state.len() != self.n {
            return Err("Invalid native constraint evaluation dimensions");
        }
        let mut sum = 0.0;
        let mut p = Vec::with_capacity(16);
        let mut res_buf = Vec::with_capacity(4);
        for constraint in &self.constraints {
            if constraint.hard_row.is_none() {
                continue;
            }
            p.clear();
            p.extend(
                constraint
                    .refs
                    .iter()
                    .map(|r| r.index.map_or(r.constant, |i| state[i])),
            );
            constraint.residuals_into(&p, &mut res_buf);
            for &r in &res_buf {
                sum += r * r;
            }
        }
        Ok(sum * 0.5)
    }

    /// Partitions free variables and constraints into connected components, retaining only
    /// components that currently have non-negligible residual error or a lower-bound violation.
    pub(crate) fn active_subset(
        &self,
        state: &[f64],
        lower_bounds: &[f64],
        residuals: &[f64],
        error_threshold: f64,
    ) -> ActiveSubset {
        let mut parent: Vec<usize> = (0..self.n).collect();
        let mut constraint_var = Vec::with_capacity(self.constraints.len());
        for constraint in &self.constraints {
            let mut first = usize::MAX;
            for r in &constraint.refs {
                if let Some(i) = r.index {
                    if first == usize::MAX {
                        first = i;
                    } else {
                        let ra = find_root(&mut parent, first);
                        let rb = find_root(&mut parent, i);
                        if ra != rb {
                            parent[rb] = ra;
                        }
                    }
                }
            }
            constraint_var.push(first);
        }
        let mut comp_sum_sq = vec![0.0; self.n];
        let mut const_sum_sq = 0.0;
        for (idx, constraint) in self.constraints.iter().enumerate() {
            let count = constraint.equations();
            let mut sum_sq = 0.0;
            for &r in &residuals[constraint.row..constraint.row + count] {
                sum_sq += r * r;
            }
            let v = constraint_var[idx];
            if v == usize::MAX {
                const_sum_sq += sum_sq;
            } else {
                let root = find_root(&mut parent, v);
                comp_sum_sq[root] += sum_sq;
            }
        }
        let sum_sq_threshold = error_threshold * 2.0;
        let mut active_root = vec![false; self.n];
        for i in 0..self.n {
            let root = find_root(&mut parent, i);
            if comp_sum_sq[root] > sum_sq_threshold || state[i] < lower_bounds[i] {
                active_root[root] = true;
            }
        }
        let mut var_to_local = vec![usize::MAX; self.n];
        let mut vars = Vec::new();
        for (i, slot) in var_to_local.iter_mut().enumerate() {
            let root = find_root(&mut parent, i);
            if active_root[root] {
                *slot = vars.len();
                vars.push(i);
            }
        }
        let mut constraints = Vec::new();
        let mut idle_sum_sq = const_sum_sq;
        for (idx, constraint) in self.constraints.iter().enumerate() {
            let v = constraint_var[idx];
            if v != usize::MAX && active_root[find_root(&mut parent, v)] {
                constraints.push(idx);
            } else if v != usize::MAX {
                let count = constraint.equations();
                for &r in &residuals[constraint.row..constraint.row + count] {
                    idle_sum_sq += r * r;
                }
            }
        }
        ActiveSubset {
            vars,
            var_to_local,
            constraints,
            idle_sum_sq,
        }
    }

    pub(crate) fn evaluate_subset_error(&self, state: &[f64], subset: &ActiveSubset) -> f64 {
        let mut sum_sq = subset.idle_sum_sq;
        let mut p = Vec::with_capacity(16);
        let mut res_buf = Vec::with_capacity(4);
        for &idx in &subset.constraints {
            let constraint = &self.constraints[idx];
            p.clear();
            p.extend(
                constraint
                    .refs
                    .iter()
                    .map(|r| r.index.map_or(r.constant, |i| state[i])),
            );
            constraint.residuals_into(&p, &mut res_buf);
            for &r in &res_buf {
                sum_sq += r * r;
            }
        }
        sum_sq * 0.5
    }

    /// Evaluates active constraints directly into `ws`, accumulating `H = J^T * J` and `g = J^T * f`
    /// without allocating a full `Vec<Vec<_>>` Jacobian matrix.
    pub(crate) fn accumulate_subset_normal_equations(
        &self,
        state: &[f64],
        subset: &ActiveSubset,
        ws: &mut NormalEquationsWorkspace,
    ) {
        ws.reset();
        let mut p = Vec::with_capacity(16);
        let mut res_buf = Vec::with_capacity(4);
        let mut row_bufs: Vec<Vec<(usize, f64)>> = (0..4).map(|_| Vec::with_capacity(12)).collect();
        for &idx in &subset.constraints {
            let constraint = &self.constraints[idx];
            let count = constraint.equations();
            if row_bufs.len() < count {
                row_bufs.resize_with(count, || Vec::with_capacity(12));
            }
            for row in &mut row_bufs[..count] {
                row.clear();
            }
            p.clear();
            p.extend(
                constraint
                    .refs
                    .iter()
                    .map(|r| r.index.map_or(r.constant, |i| state[i])),
            );
            constraint.residuals_into(&p, &mut res_buf);
            constraint.jacobian_into(&p, &mut |equation, column, value| {
                let local = subset.var_to_local[column];
                debug_assert!(local < subset.vars.len());
                row_bufs[equation].push((local, value));
            });
            for eq in 0..count {
                merge_sparse_row(&mut row_bufs[eq]);
                ws.add_row(&row_bufs[eq], res_buf[eq]);
            }
        }
    }

    pub fn evaluate_sparse(
        &self,
        state: &[f64],
        hard_only: bool,
    ) -> Result<(Vec<f64>, SparseRows), &'static str> {
        if state.len() != self.n {
            return Err("Invalid native constraint evaluation dimensions");
        }
        let m = if hard_only {
            self.hard_covered.len()
        } else {
            self.covered.len()
        };
        let mut residuals = if hard_only { Vec::new() } else { vec![0.0; m] };
        let mut rows: Vec<Vec<(usize, f64)>> = vec![Vec::new(); m];
        let mut p = Vec::with_capacity(16);
        let mut res_buf = Vec::with_capacity(4);
        for constraint in &self.constraints {
            let row = if hard_only {
                let Some(row) = constraint.hard_row else {
                    continue;
                };
                row
            } else {
                constraint.row
            };
            p.clear();
            p.extend(
                constraint
                    .refs
                    .iter()
                    .map(|r| r.index.map_or(r.constant, |i| state[i])),
            );
            if !hard_only {
                constraint.residuals_into(&p, &mut res_buf);
                residuals[row..row + res_buf.len()].copy_from_slice(&res_buf);
            }
            if hard_only {
                // DoF / nullspace analysis uses two-way offset derivatives so redundant constraints
                // between parent and offset child do not artificially pin the parent.
                constraint.geometric_jacobian_into(&p, &mut |equation, column, value| {
                    rows[row + equation].push((column, value));
                });
            } else {
                constraint.jacobian_into(&p, &mut |equation, column, value| {
                    rows[row + equation].push((column, value));
                });
            }
        }
        for row_vec in &mut rows {
            merge_sparse_row(row_vec);
        }
        Ok((residuals, rows))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn constraint(kind: ConstraintKind, a: f64, b: f64, indices: &[Option<usize>]) -> Constraint {
        Constraint {
            kind,
            row: 0,
            hard_row: Some(0),
            weight: 1.0,
            a,
            b,
            sin_cos: None,
            refs: indices
                .iter()
                .map(|&index| Ref {
                    index,
                    constant: 0.0,
                })
                .collect(),
        }
    }

    #[test]
    fn angle_rotation_and_axis_scaling_preserve_orientation() {
        let mut c = constraint(Angle, 90.0, 1.0, &[None; 11]);
        let mut p = [0.0, 0.0, 1.0, 0.0, 2.0, 3.0, 2.0, 8.0, 1.0, 1.0, 1.0];
        assert!(c.residuals(&p)[0].abs() < 1e-14);
        p[6] = 7.0;
        p[7] = 3.0;
        assert!((c.residuals(&p)[0] + 5.0).abs() < 1e-14);
        c.b = 0.0;
        assert!((c.residuals(&p)[0] + 3.0).abs() < 1e-14);
    }

    #[test]
    fn analytic_angle_jacobian_matches_central_differences_and_preserves_scale() {
        let refs = [
            Some(0),
            Some(1),
            Some(2),
            Some(3),
            Some(0),
            Some(1),
            Some(4),
            Some(5),
            None,
            None,
            None,
        ];
        let mut c = constraint(Angle, 67.0, 0.0, &refs);
        let mut p = [2.0, 3.0, 12.0, -1.0, 2.0, 3.0, -4.0, 15.0, -1.0, 1.0, -1.0];
        for axis in [0.0, 1.0, 2.0] {
            c.b = axis;
            let mut actual = [0.0; 6];
            for (_, col, value) in c.jacobian(&p) {
                actual[col] += value;
            }
            for (col, derivative) in actual.iter().enumerate() {
                let mut plus = p;
                let mut minus = p;
                for (local, reference) in c.refs.iter().enumerate() {
                    if reference.index == Some(col) {
                        plus[local] += 1e-5;
                        minus[local] -= 1e-5;
                    }
                }
                let numeric = (c.residuals(&plus)[0] - c.residuals(&minus)[0]) / 2e-5;
                assert!((derivative - numeric).abs() < 1e-8);
            }
        }
        c.b = 0.0;
        c.a = 90.0;
        p = [0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 0.0, 20.0, 1.0, 1.0, 1.0];
        let coordinates = [0.0, 0.0, 10.0, 0.0, 0.0, 20.0];
        let scaling_derivative: f64 = c
            .jacobian(&p)
            .iter()
            .map(|(_, col, value)| coordinates[*col] * value)
            .sum();
        assert!(scaling_derivative.abs() < 1e-12);
    }

    #[test]
    fn origin_modes_preserve_signed_distances_and_equation_counts() {
        let mut c = constraint(OriginDistance, 5.0, 1.0, &[Some(0), Some(1), None]);
        let p = [-3.0, 4.0, -1.0];
        assert_eq!(c.residuals(&p), vec![2.0]);
        assert_eq!(c.jacobian(&p), vec![(0, 0, 1.0)]);
        c.b = 2.0;
        assert_eq!(c.residuals(&p), vec![9.0]);
        assert_eq!(c.jacobian(&p), vec![(0, 1, 1.0)]);
        c.b = 0.0;
        assert_eq!(c.residuals(&p), vec![0.0]);
        assert_eq!(c.jacobian(&p), vec![(0, 0, -0.6), (0, 1, 0.8)]);
        c.b = 3.0;
        assert_eq!(c.equations(), 2);
        assert_eq!(c.residuals(&p), vec![-3.0, 4.0]);
        assert_eq!(c.jacobian(&p), vec![(0, 0, 1.0), (1, 1, 1.0)]);
    }

    #[test]
    fn origin_radial_jacobian_keeps_length_floor_and_small_derivative_cutoff() {
        let mut c = constraint(OriginDistance, 5.0, 0.0, &[Some(0), Some(1), None]);
        assert!(c.jacobian(&[0.0, 0.0, 1.0]).is_empty());
        let entries = c.jacobian(&[1e-9, -2e-9, 1.0]);
        assert!((entries[0].2 - 0.01).abs() < 1e-15);
        assert!((entries[1].2 + 0.02).abs() < 1e-15);
        c.b = 1.0;
        c.weight = 1e-13;
        assert!(c.jacobian(&[3.0, 4.0, 1.0]).is_empty());
    }

    #[test]
    fn line_axis_retains_two_rows_for_a_shared_endpoint() {
        let mut c = constraint(LineToAxisDistance, 4.0, 0.0, &[Some(0), Some(0), None]);
        assert_eq!(c.equations(), 2);
        assert_eq!(c.residuals(&[1.0, 1.0, -1.0]), vec![5.0, 5.0]);
        assert_eq!(
            c.jacobian(&[1.0, 1.0, -1.0]),
            vec![(0, 0, 1.0), (1, 0, 1.0)]
        );
        c.b = 1.0;
        assert_eq!(c.residuals(&[1.0, 1.0, -1.0]), vec![1.0, 1.0]);
    }

    #[test]
    fn offset_line_moves_only_children_and_perturbs_parent_aliases_together() {
        let mut c = constraint(
            OffsetLineEndpoint,
            2.0,
            1.0,
            &[Some(0), Some(1), Some(2), Some(3), Some(4), Some(5)],
        );
        let p = [3.0, 7.0, 0.0, 0.0, 10.0, 0.0];
        assert_eq!(c.residuals(&p), vec![5.0]);
        let jacobian = c.jacobian(&p);
        assert_eq!(jacobian.len(), 1);
        assert_eq!((jacobian[0].0, jacobian[0].1), (0, 1));
        assert!((jacobian[0].2 - 1.0).abs() < 1e-8);
        c.refs[2].index = Some(0);
        c.refs[3].index = Some(1);
        assert!(c.jacobian(&[0.0, 0.0, 0.0, 0.0, 10.0, 0.0]).is_empty());
    }

    #[test]
    fn rectangular_pattern_uses_perpendicular_second_direction_when_absent() {
        let c = constraint(RectangularPatternPoint, 5.0, 10.0, &[None; 18]);
        let p = [
            2.0, 3.0, -3.0, 13.0, 0.0, 0.0, 3.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0,
            0.0,
        ];
        assert!(c.residuals(&p).iter().all(|v| v.abs() < 1e-13));
        assert_eq!(axis_offset(2.0, 7.0, 1.0), -7.0);
        assert_eq!(axis_offset(3.0, 7.0, 1.0), 14.0);
    }

    #[test]
    fn circular_point_derivatives_bypass_the_small_coefficient_cutoff() {
        let mut c = constraint(
            CircularPatternPoint,
            360.0,
            0.0,
            &[None, None, None, None, Some(0), Some(1), None, None],
        );
        c.weight = 1e-13;
        let entries = c.jacobian(&[0.0, 0.0, 10.0, 0.0, 0.0, 10.0, 1.0, 4.0]);
        assert_eq!(entries, vec![(0, 0, 1e-13), (1, 1, 1e-13)]);
    }

    #[test]
    fn elliptical_endpoints_use_both_rows_and_perturb_shared_parameters_together() {
        let c = constraint(
            EllipticalArcEndpoints,
            0.0,
            0.0,
            &[
                None,
                None,
                None,
                None,
                None,
                None,
                Some(0),
                Some(1),
                Some(0),
                Some(1),
            ],
        );
        let p = [1.0, 2.0, 6.0, 2.0, 1.0, 5.0, 6.0, 2.0, 6.0, 2.0];
        assert_eq!(c.equations(), 2);
        assert_eq!(c.residuals(&p), vec![0.0, 0.0]);
        let jacobian = c.jacobian(&p);
        assert_eq!(jacobian.len(), 4);
        assert!((jacobian[0].2 - 1.6).abs() < 2e-6);
        assert_eq!(jacobian[0].2, jacobian[2].2);
        assert_eq!(jacobian[1].2, jacobian[3].2);
    }

    #[test]
    fn circular_endpoints_accumulate_radius_aliases_in_both_equations() {
        let c = constraint(
            CircularArcEndpoints,
            0.0,
            0.0,
            &[None, None, Some(0), None, Some(0), None, Some(0)],
        );
        let p = [0.0, 0.0, 3.0, 4.0, 3.0, 4.0, 3.0];
        assert_eq!(c.residuals(&p), vec![2.0, 2.0]);
        let jacobian = c.jacobian(&p);
        let derivative: f64 = jacobian.iter().filter(|e| e.0 == 0).map(|e| e.2).sum();
        assert!((derivative + 0.4).abs() < 1e-14);
        assert_eq!(
            jacobian
                .iter()
                .filter(|e| e.0 == 1)
                .map(|e| e.2)
                .sum::<f64>(),
            derivative
        );
    }

    #[test]
    fn fixed_constraint_covers_all_modes_and_skips_evaluation_callbacks() {
        let program = Program::decode(
            &[0.0, 0.0, 0.0, 1.0, 10.0, 20.0, 2.0, 0.0, 0.0, 1.0, 0.0],
            2,
            2,
            2,
        )
        .unwrap();
        assert!(!program.needs_callback(Evaluation::Linearization));
        assert!(program.needs_callback(Evaluation::Commit));
        let mut output = vec![99.0; 6];
        program
            .fill(&[2.0, 3.0], Evaluation::Linearization, &mut output)
            .unwrap();
        assert_eq!(output, vec![-8.0, -17.0, 1.0, 0.0, 0.0, 1.0]);
    }
    #[test]
    fn aliased_parameters_cancel_and_soft_constraints_do_not_affect_hard_modes() {
        let program = Program::decode(
            &[5.0, 0.0, -1.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0],
            1,
            1,
            0,
        )
        .unwrap();
        let mut output = vec![0.0; 2];
        program
            .fill(&[3.0], Evaluation::Linearization, &mut output)
            .unwrap();
        assert_eq!(output, vec![0.0, 0.0]);
        assert!(!program.needs_callback(Evaluation::HardJacobian));
    }
    #[test]
    fn rejects_truncation_invalid_references_and_overlapping_rows() {
        assert!(Program::decode(&[0.0], 1, 1, 1).is_err());
        let data = [4.0, 0.0, 0.0, 1.0, 2.0, 0.0, 1.0, 2.0, 0.0];
        assert!(Program::decode(&data, 1, 1, 1).is_err());
        let mut valid = data;
        valid[7] = 0.0;
        assert!(Program::decode(&[valid, valid].concat(), 1, 1, 1).is_err());
    }
}
