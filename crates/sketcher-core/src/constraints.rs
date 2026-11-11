//! Native residuals and Jacobians. Tags and reference order match nativeConstraints.ts.
use crate::matrix::SparseRows;
use crate::solver::Evaluation;
mod splines;

struct Ref {
    index: Option<usize>,
    constant: f64,
}
struct Constraint {
    kind: usize,
    row: usize,
    hard_row: Option<usize>,
    weight: f64,
    a: f64,
    b: f64,
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
        if self.kind == 30 {
            self.b as usize * 4
        } else if self.kind == 25 {
            3
        } else if matches!(self.kind, 0 | 1 | 8 | 18 | 19 | 21..=23 | 26 | 28)
            || (self.kind == 13 && self.a == 0.0)
            || (self.kind == 27 && self.b == 3.0)
        {
            2
        } else {
            1
        }
    }

    fn residuals(&self, p: &[f64]) -> Vec<f64> {
        let w = self.weight;
        match self.kind {
            0 => vec![(p[0] - self.a) * w, (p[1] - self.b) * w],
            1 => vec![(p[0] - p[2]) * w, (p[1] - p[3]) * w],
            2 => vec![(p[3] - p[1]) * w],
            3 => vec![(p[2] - p[0]) * w],
            4 => vec![(p[0] - self.a) * w],
            5 => vec![(p[0] - p[1]) * w],
            6 => {
                let (dx, dy) = (p[2] - p[0], p[3] - p[1]);
                let distance = if self.b == 1.0 {
                    dx * if dx >= 0.0 { 1.0 } else { -1.0 }
                } else if self.b == 2.0 {
                    dy * if dy >= 0.0 { 1.0 } else { -1.0 }
                } else {
                    dx.hypot(dy)
                };
                vec![(distance - self.a) * w]
            }
            7 => vec![((p[0] - p[2]).hypot(p[1] - p[3]) - (p[4] - p[6]).hypot(p[5] - p[7])) * w],
            8 => vec![
                (p[0] - ((1.0 - self.a) * p[2] + self.a * p[4])) * w,
                (p[1] - ((1.0 - self.a) * p[3] + self.a * p[5])) * w,
            ],
            9 => vec![((p[0] - p[2]).hypot(p[1] - p[3]) - p[4]) * w],
            10 => {
                let (dx, dy) = (p[4] - p[2], p[5] - p[3]);
                vec![(((p[0] - p[2]) * dy - (p[1] - p[3]) * dx) / dx.hypot(dy).max(1e-7)) * w]
            }
            11..=13 => {
                let (dx1, dy1, dx2, dy2) = (p[2] - p[0], p[3] - p[1], p[6] - p[4], p[7] - p[5]);
                let (l1, l2) = (dx1.hypot(dy1).max(1e-7), dx2.hypot(dy2).max(1e-7));
                let product = if self.kind == 12 {
                    dx1 * dx2 + dy1 * dy2
                } else {
                    dx1 * dy2 - dy1 * dx2
                };
                let equation = (product / (l1 * l2)) * ((l1 + l2) * 0.5) * w;
                if self.kind != 13 || self.a == 1.0 {
                    vec![equation]
                } else {
                    let cross =
                        ((p[4] + p[6]) * 0.5 - p[0]) * dy1 - ((p[5] + p[7]) * 0.5 - p[1]) * dx1;
                    vec![equation, (cross / l1) * w]
                }
            }
            14 => {
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
                vec![(rx * y2 - ry * x2) * average * w]
            }
            15 | 20 => {
                let (dx, dy) = (p[4] - p[2], p[5] - p[3]);
                let distance = ((p[0] - p[2]) * dy - (p[1] - p[3]) * dx) / dx.hypot(dy).max(1e-7);
                let target = if self.kind == 15 {
                    self.a * p[6]
                } else {
                    self.b * self.a
                };
                vec![(distance - target) * w]
            }
            16 => {
                let distance = (p[2] - p[0]).hypot(p[3] - p[1]).max(1e-7);
                let target = if self.a == 0.0 {
                    p[4] + p[5]
                } else if self.a == 1.0 {
                    p[4] - p[5]
                } else {
                    p[5] - p[4]
                };
                vec![(distance - target) * w]
            }
            17 => vec![ellipse_residual(p, 6, w)],
            18 => vec![ellipse_residual(p, 6, w), ellipse_residual(p, 8, w)],
            19 => vec![
                ((p[2] - p[0]).hypot(p[3] - p[1]) - p[6]) * w,
                ((p[4] - p[0]).hypot(p[5] - p[1]) - p[6]) * w,
            ],
            21 => {
                if self.a == 1.0 {
                    vec![(p[0] + p[2]) * 0.5 * w, (p[1] + p[3]) * 0.5 * w]
                } else {
                    let (dx, dy) = (p[6] - p[4], p[7] - p[5]);
                    let length = dx.hypot(dy).max(1e-7);
                    let (mx, my) = ((p[0] + p[2]) * 0.5, (p[1] + p[3]) * 0.5);
                    vec![
                        (((mx - p[4]) * dy - (my - p[5]) * dx) / length) * w,
                        (((p[2] - p[0]) * dx + (p[3] - p[1]) * dy) / length) * w,
                    ]
                }
            }
            22 => {
                let angle = pattern_angle(p[6], p[7], self.b, self.a);
                let (sin, cos) = (angle.sin(), angle.cos());
                let (x, y) = (p[2] - p[0], p[3] - p[1]);
                let (tx, ty) = (p[0] + x * cos - y * sin, p[1] + y * cos + x * sin);
                vec![(p[4] - tx) * w, (p[5] - ty) * w]
            }
            23 => {
                let directions = rectangular_directions(p);
                let o1 = axis_offset(p[12], self.a, p[14]);
                let o2 = axis_offset(p[13], self.b, p[15]);
                let x = directions.u1[0] * o1 + directions.u2[0] * o2;
                let y = directions.u1[1] * o1 + directions.u2[1] * o2;
                vec![(p[2] - (p[0] + x)) * w, (p[3] - (p[1] + y)) * w]
            }
            24 => {
                let (dx, dy) = (p[4] - p[2], p[5] - p[3]);
                let left = (dx * (p[1] - p[3]) - dy * (p[0] - p[2])) / dx.hypot(dy).max(1e-9);
                vec![(left - self.b * self.a) * w]
            }
            25 => vec![
                (p[0] - p[2]) * w,
                (p[1] - p[3]) * w,
                (p[4] - p[5] - self.b * self.a) * w,
            ],
            26 => {
                let distance = p[6] * self.a;
                vec![
                    (p[0] - (p[2] + p[4] * distance)) * w,
                    (p[1] - (p[3] + p[5] * distance)) * w,
                ]
            }
            27 => {
                if self.b == 3.0 {
                    vec![p[0] * w, p[1] * w]
                } else if self.b == 0.0 {
                    vec![(p[0].hypot(p[1]) - self.a) * w]
                } else {
                    let coordinate = p[if self.b == 1.0 { 0 } else { 1 }];
                    vec![if self.a == 0.0 {
                        coordinate * w
                    } else {
                        (coordinate - p[2] * self.a) * w
                    }]
                }
            }
            28 => {
                if self.b == 1.0 {
                    vec![p[0] * w, p[1] * w]
                } else {
                    vec![(p[0] - p[2] * self.a) * w, (p[1] - p[2] * self.a) * w]
                }
            }
            29 | 30 => self.spline_residuals(p),
            _ => unreachable!(),
        }
    }

    fn jacobian(&self, p: &[f64]) -> Vec<(usize, usize, f64)> {
        let w = self.weight;
        let mut entries = Vec::new();
        let mut add = |row: usize, slot: usize, value: f64| {
            if let Some(col) = self.refs[slot].index {
                // Pattern point entries bypass addJacobianEntry in the TS reference.
                if self.kind == 22 || (self.kind == 23 && slot < 4) || value.abs() > 1e-12 {
                    entries.push((row, col, value));
                }
            }
        };
        match self.kind {
            0 => {
                add(0, 0, w);
                add(1, 1, w);
            }
            1 => {
                add(0, 0, w);
                add(0, 2, -w);
                add(1, 1, w);
                add(1, 3, -w);
            }
            2 => {
                add(0, 1, -w);
                add(0, 3, w);
            }
            3 => {
                add(0, 0, -w);
                add(0, 2, w);
            }
            4 => add(0, 0, w),
            5 => {
                add(0, 0, w);
                add(0, 1, -w);
            }
            6 => {
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
            7 => {
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
            8 => {
                add(0, 0, w);
                add(0, 2, -(1.0 - self.a) * w);
                add(0, 4, -self.a * w);
                add(1, 1, w);
                add(1, 3, -(1.0 - self.a) * w);
                add(1, 5, -self.a * w);
            }
            9 => {
                let (dx, dy) = (p[0] - p[2], p[1] - p[3]);
                let scale = (w * 1.0) / dx.hypot(dy).max(1e-7);
                let (x, y) = (dx * scale, dy * scale);
                add(0, 0, x);
                add(0, 1, y);
                add(0, 2, -x);
                add(0, 3, -y);
                add(0, 4, -w);
            }
            19 => {
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
            22 => {
                let angle = pattern_angle(p[6], p[7], self.b, self.a);
                let (sin, cos) = (angle.sin(), angle.cos());
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
            23 => {
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
            24 => return self.offset_line_jacobian(p),
            25 => {
                // Offsets drive children only; parent references remain active in residuals.
                add(0, 0, w);
                add(1, 1, w);
                add(2, 4, w);
            }
            26 => {
                add(0, 0, w);
                add(1, 1, w);
            }
            27 => {
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
            28 => {
                add(0, 0, w);
                add(1, 1, w);
            }
            30 => return self.automatic_jacobian(p),
            10..=18 | 20..=21 | 29 => return self.numeric_jacobian(p),
            _ => unreachable!(),
        }
        entries
    }

    fn numeric_jacobian(&self, p: &[f64]) -> Vec<(usize, usize, f64)> {
        let mut columns: Vec<usize> = self.refs.iter().filter_map(|r| r.index).collect();
        columns.sort_unstable();
        columns.dedup();
        let mut trial = p.to_vec();
        let central = self.kind == 11;
        let mut entries = Vec::new();
        for equation in 0..self.equations() {
            let f0 = if central {
                0.0
            } else {
                self.residuals(p)[equation]
            };
            for &column in &columns {
                // All aliases of a shared parameter must be perturbed together.
                for (slot, r) in self.refs.iter().enumerate() {
                    if r.index == Some(column) {
                        trial[slot] = p[slot] + 1e-5;
                    }
                }
                let plus = self.residuals(&trial)[equation];
                let minus = if central {
                    for (slot, r) in self.refs.iter().enumerate() {
                        if r.index == Some(column) {
                            trial[slot] = p[slot] - 1e-5;
                        }
                    }
                    self.residuals(&trial)[equation]
                } else {
                    f0
                };
                for (slot, r) in self.refs.iter().enumerate() {
                    if r.index == Some(column) {
                        trial[slot] = p[slot];
                    }
                }
                let derivative = (plus - minus) / if central { 2.0 * 1e-5 } else { 1e-5 };
                if derivative.abs() > 1e-11 {
                    entries.push((equation, column, derivative));
                }
            }
        }
        entries
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
    let count = quantity.round().max(2.0);
    let degrees = if distribution == 0.0 {
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
    };
    (degrees * std::f64::consts::PI) / 180.0
}

fn axis_offset(index: f64, distance: f64, symmetric: f64) -> f64 {
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
            let kind = integer(header[0])?;
            let expected_refs = match kind {
                0 | 5 => 2,
                1 | 2 | 3 | 6 => 4,
                4 => 1,
                7 | 11..=13 | 17 | 21 | 22 => 8,
                8 | 10 | 16 | 20 | 24 | 25 => 6,
                9 => 5,
                14 => 11,
                15 | 19 | 26 => 7,
                18 => 10,
                23 => 18,
                27 | 28 => 3,
                29 | 30 => integer(header[6])?,
                _ => return Err("Unknown native constraint kind"),
            };
            let count = integer(header[6])?;
            if count != expected_refs {
                return Err("Invalid native constraint reference count");
            }
            if count > (data.len() - offset - 7) / 2 {
                return Err("Truncated native constraint references");
            }
            if (kind == 6 && ![0.0, 1.0, 2.0].contains(&header[5]))
                || (kind == 13 && header[4] != 0.0 && header[4] != 1.0)
                || (kind == 14 && ![0.0, 1.0, 2.0].contains(&header[5]))
                || (kind == 16 && ![0.0, 1.0, 2.0].contains(&header[4]))
                || (kind == 21 && ![0.0, 1.0].contains(&header[4]))
                || (kind == 22 && ![0.0, 1.0, 2.0].contains(&header[5]))
                || (kind == 27 && ![0.0, 1.0, 2.0, 3.0].contains(&header[5]))
                || (kind == 28 && ![0.0, 1.0].contains(&header[5]))
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
            if matches!(kind, 29 | 30) {
                splines::validate(kind, header[4], header[5], &refs)?;
            }
            let constants = match kind {
                22 => &refs[6..],
                23 => &refs[12..],
                26..=28 => &refs[2..],
                _ => &[],
            };
            if constants.iter().any(|r| r.index.is_some())
                || (kind == 23 && refs[14..].iter().any(|r| ![0.0, 1.0].contains(&r.constant)))
            {
                return Err("Invalid native constraint configuration reference");
            }
            let constraint = Constraint {
                kind,
                row,
                hard_row,
                weight: header[3],
                a: header[4],
                b: header[5],
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
                let values = constraint.residuals(&p);
                output[row..row + values.len()].copy_from_slice(&values);
            }
            if jacobian {
                // Native rows are authoritative; ignore callback values in those rows.
                output[offset + row * self.n..offset + (row + constraint.equations()) * self.n]
                    .fill(0.0);
                for (equation, column, value) in constraint.jacobian(&p) {
                    output[offset + (row + equation) * self.n + column] += value;
                }
            }
        }
        Ok(())
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
        let mut residuals = vec![0.0; m];
        let mut rows: Vec<Vec<(usize, f64)>> = vec![Vec::new(); m];
        let mut p = Vec::with_capacity(16);
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
                let values = constraint.residuals(&p);
                residuals[row..row + values.len()].copy_from_slice(&values);
            }
            for (equation, column, value) in constraint.jacobian(&p) {
                rows[row + equation].push((column, value));
            }
        }
        for row_vec in &mut rows {
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
        Ok((residuals, rows))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn constraint(kind: usize, a: f64, b: f64, indices: &[Option<usize>]) -> Constraint {
        Constraint {
            kind,
            row: 0,
            hard_row: Some(0),
            weight: 1.0,
            a,
            b,
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
        let mut c = constraint(14, 90.0, 1.0, &[None; 11]);
        let mut p = [0.0, 0.0, 1.0, 0.0, 2.0, 3.0, 2.0, 8.0, 1.0, 1.0, 1.0];
        assert!(c.residuals(&p)[0].abs() < 1e-14);
        p[6] = 7.0;
        p[7] = 3.0;
        assert!((c.residuals(&p)[0] + 5.0).abs() < 1e-14);
        c.b = 0.0;
        assert!((c.residuals(&p)[0] + 3.0).abs() < 1e-14);
    }

    #[test]
    fn origin_modes_preserve_signed_distances_and_equation_counts() {
        let mut c = constraint(27, 5.0, 1.0, &[Some(0), Some(1), None]);
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
        let mut c = constraint(27, 5.0, 0.0, &[Some(0), Some(1), None]);
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
        let mut c = constraint(28, 4.0, 0.0, &[Some(0), Some(0), None]);
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
            24,
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
        let c = constraint(23, 5.0, 10.0, &[None; 18]);
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
            22,
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
            18,
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
            19,
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
