//! Polyline fitting, preserving the pre-native costs, iteration order, and tie rules.
use super::{Circle, FitOptions, Spline};
use crate::{p, spline::evaluate_bezier, Point2};
use std::f64::consts::{PI, TAU};
#[derive(Clone)]
pub enum Kind {
    Line,
    Arc(Circle),
    Spline(Spline),
}
#[derive(Clone)]
pub struct Piece {
    pub start: usize,
    pub end: usize,
    pub kind: Kind,
}
pub struct Fitted {
    pub points: Vec<Point2>,
    pub pieces: Vec<Piece>,
    pub corners: Vec<bool>,
    pub closed: bool,
}
fn len(a: Point2, b: Point2) -> f64 {
    a.scaled_distance(b)
}
fn norm(v: Point2) -> Point2 {
    let l = v.scaled_length();
    v * (1.0 / if l == 0.0 { 1.0 } else { l })
}
pub fn polyline_length(points: &[Point2]) -> f64 {
    points.windows(2).map(|p| len(p[0], p[1])).sum()
}
fn lengths(points: &[Point2]) -> Vec<f64> {
    let mut out = vec![0.0];
    for pair in points.windows(2) {
        out.push(out.last().unwrap() + len(pair[0], pair[1]));
    }
    out
}
fn resample(points: &[Point2], closed: bool) -> Vec<Point2> {
    let mut source = points.to_vec();
    if closed && !source.is_empty() {
        source.push(source[0]);
    }
    if source.len() < 2 {
        return points.to_vec();
    }
    let total = polyline_length(&source);
    let count = (total.round() as usize).max(if closed { 3 } else { 1 });
    let step = total / count as f64;
    let mut out = Vec::with_capacity(count + 1);
    out.push(source[0]);
    let mut segment = 1;
    let mut start = 0.0;
    for k in 1..count {
        let target = k as f64 * step;
        while segment < source.len() - 1
            && start + len(source[segment - 1], source[segment]) < target
        {
            start += len(source[segment - 1], source[segment]);
            segment += 1;
        }
        let (a, b) = (source[segment - 1], source[segment]);
        let l = len(a, b);
        let t = if l > 1e-12 {
            ((target - start) / l).clamp(0.0, 1.0)
        } else {
            0.0
        };
        out.push(a.lerp(b, t));
    }
    if !closed {
        out.push(*source.last().unwrap());
    }
    out
}
fn smooth(points: &[Point2], sigma: f64, closed: bool, pinned: &[usize]) -> Vec<Point2> {
    if sigma <= 0.05 || points.len() < 3 {
        return points.to_vec();
    }
    let r = (sigma * 2.5).ceil() as isize;
    let weights: Vec<_> = (-r..=r)
        .map(|k| (-(k * k) as f64 / (2.0 * sigma * sigma)).exp())
        .collect();
    let n = points.len() as isize;
    points
        .iter()
        .enumerate()
        .map(|(i, &pt)| {
            if pinned.contains(&i) || (!closed && (i == 0 || i == points.len() - 1)) {
                return pt;
            }
            let mut sum = Point2::ZERO;
            let mut total = 0.0;
            for k in -r..=r {
                let mut j = i as isize + k;
                if closed {
                    j = j.rem_euclid(n);
                } else if j < 0 || j >= n {
                    continue;
                }
                let j = j as usize;
                if !closed
                    && ((k < 0 && j < i && pinned.iter().any(|&p| p > j && p < i))
                        || (k > 0 && pinned.iter().any(|&p| p > i && p < j)))
                {
                    continue;
                }
                let weight = weights[(k + r) as usize];
                sum += points[j] * weight;
                total += weight;
            }
            p(sum.x / total, sum.y / total)
        })
        .collect()
}
fn angles(points: &[Point2], k: usize, closed: bool) -> Vec<f64> {
    let n = points.len();
    points
        .iter()
        .enumerate()
        .map(|(i, &pt)| {
            let (a, b) = if closed {
                (
                    (i as isize - k as isize).rem_euclid(n as isize) as usize,
                    (i + k) % n,
                )
            } else {
                if i < k || i + k >= n {
                    return 0.0;
                }
                (i - k, i + k)
            };
            let (u, v) = (pt - points[a], points[b] - pt);
            let (lu, lv) = (u.scaled_length(), v.scaled_length());
            if lu < 1e-9 || lv < 1e-9 {
                0.0
            } else {
                (u.dot(v) / (lu * lv)).clamp(-1.0, 1.0).acos()
            }
        })
        .collect()
}
fn corners(points: &[Point2], closed: bool, angle: f64, window: usize) -> Vec<usize> {
    let n = points.len();
    if n < 5 {
        return vec![];
    }
    let k = window.min((n - 1) / 4).max(2);
    let a = angles(points, k, closed);
    let limit = angle * PI / 180.0;
    (0..n)
        .filter(|&i| {
            if a[i] < limit {
                return false;
            }
            for d in -(k as isize)..=k as isize {
                if d == 0 {
                    continue;
                }
                let mut j = i as isize + d;
                if closed {
                    j = j.rem_euclid(n as isize);
                } else if j < 0 || j >= n as isize {
                    continue;
                }
                let j = j as usize;
                if a[j] > a[i] || (a[j] == a[i] && j < i) {
                    return false;
                }
            }
            true
        })
        .collect()
}
fn solve3(a: [f64; 6], b: [f64; 3]) -> Option<[f64; 3]> {
    let [a11, a12, a13, a22, a23, a33] = a;
    let [b1, b2, b3] = b;
    let det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13)
        + a13 * (a12 * a23 - a22 * a13);
    if det.abs() < 1e-12 {
        return None;
    }
    Some([
        (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3))
            / det,
        (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13))
            / det,
        (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13))
            / det,
    ])
}
fn hypot3(v: [f64; 3]) -> f64 {
    let m = v.into_iter().map(f64::abs).fold(0.0, f64::max);
    if m == 0.0 {
        0.0
    } else {
        let [x, y, z] = v.map(|x| (x.abs() / m).powi(2));
        ((x + y) + z).sqrt() * m
    }
}
fn fit_circle(points: &[Point2]) -> Option<Circle> {
    let count = points.len() as f64;
    if count < 3.0 {
        return None;
    }
    let mut mean = Point2::ZERO;
    for &pt in points {
        mean += pt;
    }
    mean = p(mean.x / count, mean.y / count);
    let (mut suu, mut svv, mut suv, mut suuu, mut svvv, mut suvv, mut svuu) =
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for &pt in points {
        let (u, v) = (pt.x - mean.x, pt.y - mean.y);
        suu += u * u;
        svv += v * v;
        suv += u * v;
        suuu += u * u * u;
        svvv += v * v * v;
        suvv += u * v * v;
        svuu += v * u * u;
    }
    let det = suu * svv - suv * suv;
    if det.abs() < 1e-12 {
        return None;
    }
    let (bu, bv) = (0.5 * (suuu + suvv), 0.5 * (svvv + svuu));
    let mut center = p((bu * svv - bv * suv) / det, (bv * suu - bu * suv) / det) + mean;
    let mut radius = points.iter().map(|&pt| len(pt, center)).sum::<f64>() / count;
    if !center.x.is_finite() || !center.y.is_finite() || !radius.is_finite() {
        return None;
    }
    for _ in 0..5 {
        let (mut a11, mut a12, mut a13, mut a22, mut a23, mut a33, mut g1, mut g2, mut g3) =
            (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        for &pt in points {
            let delta = center - pt;
            let d = delta.scaled_length().max(1e-9);
            let (j1, j2) = (delta.x / d, delta.y / d);
            let res = d - radius;
            a11 += j1 * j1;
            a12 += j1 * j2;
            a13 -= j1;
            a22 += j2 * j2;
            a23 -= j2;
            a33 += 1.0;
            g1 += j1 * res;
            g2 += j2 * res;
            g3 -= res;
        }
        let Some(s) = solve3([a11, a12, a13, a22, a23, a33], [-g1, -g2, -g3]) else {
            break;
        };
        center += p(s[0], s[1]);
        radius += s[2];
        if hypot3(s) < 1e-6 {
            break;
        }
    }
    if radius <= 0.0 || !center.x.is_finite() || !center.y.is_finite() {
        None
    } else {
        Some(Circle { center, radius })
    }
}
fn line_deviation(points: &[Point2], from: usize, to: usize) -> f64 {
    let (a, b) = (points[from], points[to]);
    let dir = b - a;
    let l = dir.scaled_length();
    let mut max = 0.0_f64;
    for &pt in &points[from + 1..to] {
        let v = pt - a;
        let d = if l < 1e-9 {
            len(a, pt)
        } else {
            let t = v.dot(dir) / (l * l);
            if t < 0.0 {
                len(a, pt)
            } else if t > 1.0 {
                len(b, pt)
            } else {
                v.cross(dir).abs() / l
            }
        };
        max = max.max(d);
    }
    max
}
fn arc_sweep(points: &[Point2], center: Point2) -> Option<f64> {
    let mut previous = center.angle_to(points[0]);
    let (mut total, mut positive, mut negative) = (0.0, 0.0_f64, 0.0_f64);
    for &pt in &points[1..] {
        let angle = center.angle_to(pt);
        let mut delta = angle - previous;
        if delta > PI {
            delta -= TAU
        }
        if delta < -PI {
            delta += TAU
        }
        if delta > 0.0 {
            positive += delta
        } else {
            negative -= delta
        }
        total += delta;
        previous = angle;
    }
    if positive.min(negative) > (0.15 * total.abs()).max(0.05) {
        None
    } else {
        Some(total)
    }
}
fn try_arc(points: &[Point2], o: &FitOptions) -> Option<Circle> {
    if points.len() < 5 {
        return None;
    }
    let c = fit_circle(points)?;
    if c.radius < o.min_radius || c.radius > o.max_radius {
        return None;
    }
    if points
        .iter()
        .any(|&pt| (len(pt, c.center) - c.radius).abs() > o.tolerance)
    {
        return None;
    }
    let sweep = arc_sweep(points, c.center)?;
    if sweep.abs() > TAU - 0.2 {
        return None;
    }
    let sagitta = c.radius * (1.0 - (PI.min(sweep.abs()) / 2.0).cos());
    if sagitta < o.tolerance * 0.75 {
        None
    } else {
        Some(c)
    }
}
pub fn detect_circle(points: &[Point2], o: &FitOptions) -> Option<Circle> {
    if points.len() < 8 {
        return None;
    }
    let c = fit_circle(points)?;
    if c.radius < o.min_radius || c.radius > o.max_radius {
        return None;
    }
    if points
        .iter()
        .any(|&pt| (len(pt, c.center) - c.radius).abs() > o.tolerance)
    {
        return None;
    }
    let mut closed = points.to_vec();
    closed.push(points[0]);
    let sweep = arc_sweep(&closed, c.center)?;
    if (sweep.abs() - TAU).abs() > 0.3 {
        None
    } else {
        Some(c)
    }
}
fn spline_run(points: &[Point2], from: usize, to: usize, tolerance: f64) -> Spline {
    let tangent = |index: usize| {
        let a = points[from.max(index.saturating_sub(2))];
        let b = points[to.min(index + 2)];
        let l = len(a, b);
        if l < 1e-9 {
            Point2::UNIT_X
        } else {
            (b - a) * (1.0 / l)
        }
    };
    let build = |indices: &[usize]| {
        let fit = indices.iter().map(|&i| points[i]).collect();
        let last = indices.len() - 1;
        let handles = indices
            .iter()
            .enumerate()
            .map(|(k, &index)| {
                let t = tangent(index);
                let previous = if k > 0 {
                    len(points[indices[k - 1]], points[index]) / 3.0
                } else {
                    0.0
                };
                let next = if k < last {
                    len(points[index], points[indices[k + 1]]) / 3.0
                } else {
                    0.0
                };
                let backward = if previous != 0.0 { previous } else { next };
                let forward = if next != 0.0 { next } else { previous };
                [points[index] + t * (-backward), points[index] + t * forward]
            })
            .collect();
        Spline {
            points: fit,
            handles,
        }
    };
    let lengths = lengths(points);
    let mut indices = vec![from, to];
    if to - from >= 6 {
        indices.insert(1, ((from + to) as f64 / 2.0).round() as usize);
    }
    let max_iterations = (((to - from) as f64 / 3.0).round() as usize).clamp(64, 256);
    for _ in 0..max_iterations {
        let fit = build(&indices);
        let mut worst = None;
        let mut error = tolerance;
        for k in 0..indices.len() - 1 {
            let (i0, i1) = (indices[k], indices[k + 1]);
            if i1 - i0 < 2 {
                continue;
            }
            let curve = [
                points[i0],
                fit.handles[k][1],
                fit.handles[k + 1][0],
                points[i1],
            ];
            let samples: Vec<_> = (0..=16)
                .map(|s| evaluate_bezier(&curve, s as f64 / 16.0))
                .collect();
            let span = lengths[i1] - lengths[i0];
            for i in i0 + 1..i1 {
                let t = if span > 1e-9 {
                    (lengths[i] - lengths[i0]) / span
                } else {
                    0.5
                };
                let guess = (t * 16.0).round() as usize;
                let mut best = f64::INFINITY;
                for &sample in &samples[guess.saturating_sub(3)..=16.min(guess + 3)] {
                    best = best.min(len(sample, points[i]));
                }
                if best > error {
                    error = best;
                    worst = Some(i);
                }
            }
        }
        let Some(worst) = worst else { break };
        let pos = indices.iter().position(|&i| i > worst).unwrap();
        indices.insert(pos, worst);
    }
    build(&indices)
}
struct CircleSums {
    origin: Point2,
    n: f64,
    sx: f64,
    sy: f64,
    sxx: f64,
    syy: f64,
    sxy: f64,
    sxxx: f64,
    syyy: f64,
    sxyy: f64,
    sxxy: f64,
}
impl CircleSums {
    fn new(origin: Point2) -> Self {
        Self {
            origin,
            n: 0.0,
            sx: 0.0,
            sy: 0.0,
            sxx: 0.0,
            syy: 0.0,
            sxy: 0.0,
            sxxx: 0.0,
            syyy: 0.0,
            sxyy: 0.0,
            sxxy: 0.0,
        }
    }
    fn add(&mut self, pt: Point2) {
        let (x, y) = (pt.x - self.origin.x, pt.y - self.origin.y);
        self.n += 1.0;
        self.sx += x;
        self.sy += y;
        self.sxx += x * x;
        self.syy += y * y;
        self.sxy += x * y;
        self.sxxx += x * x * x;
        self.syyy += y * y * y;
        self.sxyy += x * y * y;
        self.sxxy += x * x * y;
    }
    fn circle(&self) -> Option<Circle> {
        let n = self.n;
        if n < 3.0 {
            return None;
        }
        let (mx, my) = (self.sx / n, self.sy / n);
        let suu = self.sxx - n * mx * mx;
        let svv = self.syy - n * my * my;
        let suv = self.sxy - n * mx * my;
        let suuu = self.sxxx - 3.0 * mx * self.sxx + 3.0 * mx * mx * self.sx - n * mx * mx * mx;
        let svvv = self.syyy - 3.0 * my * self.syy + 3.0 * my * my * self.sy - n * my * my * my;
        let suvv = self.sxyy - 2.0 * my * self.sxy + my * my * self.sx - mx * self.syy
            + 2.0 * mx * my * self.sy
            - n * mx * my * my;
        let svuu = self.sxxy - 2.0 * mx * self.sxy + mx * mx * self.sy - my * self.sxx
            + 2.0 * mx * my * self.sx
            - n * my * mx * mx;
        let det = suu * svv - suv * suv;
        if det.abs() < 1e-9 {
            return None;
        }
        let (bu, bv) = (0.5 * (suuu + suvv), 0.5 * (svvv + svuu));
        let cu = (bu * svv - bv * suv) / det;
        let cv = (bv * suu - bu * suv) / det;
        let radius = (cu * cu + cv * cv + (suu + svv) / n).sqrt();
        if !radius.is_finite() {
            None
        } else {
            Some(Circle {
                center: p(cu + mx + self.origin.x, cv + my + self.origin.y),
                radius,
            })
        }
    }
}
fn circle_deviation(points: &[Point2], c: Circle, limit: f64) -> f64 {
    let mut max = 0.0_f64;
    for &pt in points {
        max = max.max((len(pt, c.center) - c.radius).abs());
        if max > limit {
            break;
        }
    }
    max
}
fn line_error(points: &[Point2]) -> f64 {
    let a = points[0];
    let dir = *points.last().unwrap() - a;
    let l2 = dir.length_squared();
    if l2 < 1e-12 {
        return 0.0;
    }
    let mut sum = 0.0;
    for &pt in &points[1..points.len() - 1] {
        let c = (pt - a).cross(dir);
        sum += c * c / l2;
    }
    sum
}
fn circle_error(points: &[Point2], c: Circle) -> f64 {
    points[1..points.len() - 1]
        .iter()
        .map(|&pt| (len(pt, c.center) - c.radius).powi(2))
        .sum()
}
fn spline_piece(points: &[Point2], start: usize, end: usize, o: &FitOptions) -> Piece {
    let kind = if end - start < 2 || line_deviation(points, start, end) <= o.tolerance {
        Kind::Line
    } else {
        Kind::Spline(spline_run(points, start, end, o.tolerance))
    };
    Piece { start, end, kind }
}
#[derive(Clone, Copy)]
enum ChoiceKind {
    Line,
    Arc(Circle),
    Spline,
}
#[derive(Clone, Copy)]
struct Choice {
    from: usize,
    line: bool,
    kind: ChoiceKind,
}
fn fit_run(
    points: &[Point2],
    from: usize,
    to: usize,
    o: &FitOptions,
    lengths: &[f64],
) -> Vec<Piece> {
    let count = to - from + 1;
    let tol = o.tolerance;
    let error_weight = 0.05 / (tol * tol);
    let per_length = 1.0 / o.min_segment.max(1.0);
    let mut best_other = vec![f64::INFINITY; count];
    let mut best_line = best_other.clone();
    let mut other: Vec<Option<Choice>> = vec![None; count];
    let mut line = other.clone();
    best_other[0] = 0.0;
    let mut spline_min = f64::INFINITY;
    let mut spline_from = 0;
    for i in 0..count {
        if i > 0 {
            let cost = spline_min + 1.5 + per_length * (lengths[from + i] - lengths[from]);
            if cost < best_other[i] {
                best_other[i] = cost;
                other[i] = Some(Choice {
                    from: spline_from,
                    line: false,
                    kind: ChoiceKind::Spline,
                });
            }
        }
        let best = best_other[i].min(best_line[i]);
        if !best.is_finite() {
            continue;
        }
        let best_is_line = best_other[i] > best_line[i];
        let prev_spline = matches!(other[i].map(|c| c.kind), Some(ChoiceKind::Spline));
        if best_other[i].is_finite() && !prev_spline {
            let key = best_other[i] - per_length * (lengths[from + i] - lengths[from]);
            if key < spline_min {
                spline_min = key;
                spline_from = i;
            }
        }
        let start = from + i;
        let mut sums = CircleSums::new(points[start]);
        sums.add(points[start]);
        let mut line_alive = true;
        let mut failures = 0;
        for j in i + 1..count {
            let end = from + j;
            sums.add(points[end]);
            if line_alive && line_deviation(points, start, end) > tol {
                line_alive = false;
            }
            let mut circle = None;
            if end - start >= 4 {
                if let Some(rough) = sums
                    .circle()
                    .filter(|&c| circle_deviation(&points[start..=end], c, tol * 1.5) <= tol * 1.5)
                {
                    circle = Some(rough);
                    failures = 0;
                } else {
                    failures += 1;
                }
            }
            if !line_alive && failures > 6 {
                break;
            }
            if lengths[end] - lengths[start] < o.min_segment {
                continue;
            }
            if line_alive && !prev_spline && best_other[i].is_finite() {
                let cost = best_other[i]
                    + 1.0
                    + error_weight * line_error(&points[start..=end]) / (end - start) as f64;
                if cost < best_line[j] {
                    best_line[j] = cost;
                    line[j] = Some(Choice {
                        from: i,
                        line: false,
                        kind: ChoiceKind::Line,
                    });
                }
            }
            if !line_alive && circle.is_some() {
                if let Some(c) = try_arc(&points[start..=end], o) {
                    let cost = best
                        + 1.02
                        + error_weight * circle_error(&points[start..=end], c)
                            / (end - start) as f64;
                    if cost < best_other[j] {
                        best_other[j] = cost;
                        other[j] = Some(Choice {
                            from: i,
                            line: best_is_line,
                            kind: ChoiceKind::Arc(c),
                        });
                    }
                }
            }
        }
    }
    let mut pieces = Vec::new();
    let mut j = count - 1;
    let mut is_line = best_other[j] > best_line[j];
    while j > 0 {
        let Some(c) = (if is_line { line[j] } else { other[j] }) else {
            break;
        };
        let (start, end) = (from + c.from, from + j);
        pieces.push(match c.kind {
            ChoiceKind::Line => Piece {
                start,
                end,
                kind: Kind::Line,
            },
            ChoiceKind::Arc(c) => Piece {
                start,
                end,
                kind: Kind::Arc(c),
            },
            ChoiceKind::Spline => spline_piece(points, start, end, o),
        });
        j = c.from;
        is_line = c.line;
    }
    pieces.reverse();
    let mut out: Vec<Piece> = Vec::new();
    for i in 0..pieces.len() {
        let piece = pieces[i].clone();
        let length = lengths[piece.end] - lengths[piece.start];
        if !matches!(piece.kind, Kind::Arc(_))
            && length < o.min_segment * 0.5
            && !out.is_empty()
            && i + 1 < pieces.len()
            && !matches!(out.last().unwrap().kind, Kind::Spline(_))
            && !matches!(pieces[i + 1].kind, Kind::Spline(_))
        {
            let middle = ((piece.start + piece.end) as f64 / 2.0).round() as usize;
            out.last_mut().unwrap().end = middle;
            pieces[i + 1].start = middle;
        } else {
            out.push(piece);
        }
    }
    out
}
#[derive(Clone, Copy)]
struct Knot {
    point: Point2,
    incoming: Option<Point2>,
    outgoing: Option<Point2>,
}
fn piece_knots(points: &[Point2], piece: &Piece) -> Vec<Knot> {
    match &piece.kind {
        Kind::Line => vec![
            Knot {
                point: points[piece.start],
                incoming: None,
                outgoing: None,
            },
            Knot {
                point: points[piece.end],
                incoming: None,
                outgoing: None,
            },
        ],
        Kind::Arc(c) => {
            let (a, b, mid) = (
                points[piece.start],
                points[piece.end],
                points[(piece.start + piece.end).div_ceil(2)],
            );
            let ccw = |from: f64, to: f64| ((to - from) % TAU + TAU) % TAU;
            let theta_a = c.center.angle_to(a);
            let total = ccw(theta_a, c.center.angle_to(b));
            let middle = ccw(theta_a, c.center.angle_to(mid));
            let sweep = if middle <= total { total } else { total - TAU };
            let count = (sweep.abs() / (PI / 2.0)).ceil().max(1.0) as usize;
            let alpha = sweep / count as f64;
            let dir = if sweep >= 0.0 { 1.0 } else { -1.0 };
            let ra = len(c.center, a);
            let rb = len(c.center, b);
            let ra = if ra == 0.0 { c.radius } else { ra };
            let rb = if rb == 0.0 { c.radius } else { rb };
            let factor = (4.0 / 3.0) * (alpha.abs() / 4.0).tan();
            (0..=count)
                .map(|i| {
                    let theta = theta_a + i as f64 * alpha;
                    let r = if i == 0 {
                        ra
                    } else if i == count {
                        rb
                    } else {
                        c.radius
                    };
                    let pt = if i == 0 {
                        a
                    } else if i == count {
                        b
                    } else {
                        Point2::from_polar(c.radius, theta) + c.center
                    };
                    let tangent = Point2::from_polar(1.0, theta).perp() * dir;
                    let h = factor * r;
                    Knot {
                        point: pt,
                        incoming: if i > 0 { Some(tangent * (-h)) } else { None },
                        outgoing: if i < count { Some(tangent * h) } else { None },
                    }
                })
                .collect()
        }
        Kind::Spline(s) => s
            .points
            .iter()
            .enumerate()
            .map(|(i, &pt)| Knot {
                point: pt,
                incoming: if i > 0 {
                    Some(s.handles[i][0] - pt)
                } else {
                    None
                },
                outgoing: if i < s.points.len() - 1 {
                    Some(s.handles[i][1] - pt)
                } else {
                    None
                },
            })
            .collect(),
    }
}
fn resolve(k: Knot, closed: bool, first: bool, last: bool) -> Vec<(Point2, [Point2; 2])> {
    let p = k.point;
    match (k.incoming, k.outgoing) {
        (None, None) => vec![(p, [p, p])],
        (Some(v), None) => vec![(p, [p + v, if !closed && last { p - v } else { p }])],
        (None, Some(v)) => vec![(p, [if !closed && first { p - v } else { p }, p + v])],
        (Some(v1), Some(v2)) => {
            let (d1, d2) = (v1.scaled_length(), v2.scaled_length());
            if d1 < 1e-9 && d2 < 1e-9 {
                return vec![(p, [p, p])];
            }
            if d1 < 1e-9 {
                return vec![(p, [p, p + v2])];
            }
            if d2 < 1e-9 {
                return vec![(p, [p + v1, p])];
            }
            let incoming = (-v1) * (1.0 / d1);
            let outgoing = v2 * (1.0 / d2);
            if incoming.dot(outgoing) >= (20.0 * PI / 180.0).cos() {
                let t = norm(incoming + outgoing);
                vec![(p, [p + t * (-d1), p + t * d2])]
            } else {
                vec![(p, [p + v1, p]), (p, [p, p + v2])]
            }
        }
    }
}
fn pieces_to_spline(points: &[Point2], pieces: &[Piece], closed: bool) -> Spline {
    if !closed && pieces.len() == 1 && matches!(pieces[0].kind, Kind::Line) {
        let (a, b) = (points[pieces[0].start], points[pieces[0].end]);
        let v = (b - a) * (1.0 / 3.0);
        return Spline {
            points: vec![a, b],
            handles: vec![[a - v, a + v], [b - v, b + v]],
        };
    }
    let mut knots: Vec<Knot> = Vec::new();
    for piece in pieces {
        let sub = piece_knots(points, piece);
        if sub.is_empty() {
            continue;
        }
        if let Some(last) = knots.last_mut() {
            last.outgoing = sub[0].outgoing;
            knots.extend_from_slice(&sub[1..]);
        } else {
            knots.extend(sub);
        }
    }
    if closed && knots.len() >= 2 {
        knots[0].incoming = knots.last().unwrap().incoming;
        knots.pop();
    }
    let mut out = Spline::default();
    let mut trailing = None;
    for (i, &k) in knots.iter().enumerate() {
        let resolved = resolve(k, closed, i == 0, i == knots.len() - 1);
        if closed && i == 0 && resolved.len() == 2 {
            out.points.push(resolved[1].0);
            out.handles.push(resolved[1].1);
            trailing = Some(resolved[0]);
        } else {
            for (pt, h) in resolved {
                out.points.push(pt);
                out.handles.push(h);
            }
        }
    }
    if let Some((pt, h)) = trailing {
        out.points.push(pt);
        out.handles.push(h);
    }
    if closed && !out.points.is_empty() {
        out.points.push(out.points[0]);
        out.handles.push(out.handles[0]);
    }
    out
}
pub fn circle_spline(c: Circle) -> Spline {
    let (cx, cy, r) = (c.center.x, c.center.y, c.radius);
    let k = (4.0 / 3.0) * (PI / 8.0).tan() * r;
    Spline {
        points: vec![p(cx + r, cy), p(cx, cy + r), p(cx - r, cy), p(cx, cy - r)],
        handles: vec![
            [p(cx + r, cy - k), p(cx + r, cy + k)],
            [p(cx + k, cy + r), p(cx - k, cy + r)],
            [p(cx - r, cy + k), p(cx - r, cy - k)],
            [p(cx - k, cy - r), p(cx + k, cy - r)],
        ],
    }
}
fn closed_start(points: &[Point2], o: &FitOptions) -> usize {
    let k = (o.min_segment * 0.25).round().max(2.0) as usize;
    let angles = angles(points, k, true);
    let mut best = 0;
    let mut change = -1.0;
    for i in 0..points.len() {
        let c =
            (angles[(i + 1) % points.len()] - angles[(i + points.len() - 1) % points.len()]).abs();
        if c > change {
            change = c;
            best = i;
        }
    }
    best
}
pub fn fit_polyline(
    input: &[Point2],
    closed: bool,
    o: &FitOptions,
) -> Result<Option<Fitted>, &'static str> {
    let length = polyline_length(input)
        + if closed && !input.is_empty() {
            len(input[0], *input.last().unwrap())
        } else {
            0.0
        };
    if !length.is_finite() || length > 2_000_000.0 {
        return Err("Image trace path exceeds fitting sample limit");
    }
    let mut points = resample(input, closed);
    if points.len() < if closed { 4 } else { 2 } {
        return Ok(None);
    }
    let window = (o.min_segment * 0.35)
        .max(o.tolerance * 2.0)
        .round()
        .max(2.0) as usize;
    let preview = smooth(&points, (o.smoothing * 0.5).max(0.6), closed, &[]);
    let mut corners = corners(&preview, closed, o.corner_angle, window);
    points = smooth(&points, o.smoothing, closed, &corners);
    let had_corners = !corners.is_empty();
    if closed {
        let start = if had_corners {
            corners[0]
        } else {
            closed_start(&points, o)
        };
        points.rotate_left(start);
        let n = points.len();
        for c in &mut corners {
            *c = (*c + n - start) % n;
        }
        corners.sort_unstable();
        points.push(points[0]);
        if corners.first() != Some(&0) {
            corners.insert(0, 0);
        }
    }
    let lengths = lengths(&points);
    let mut breaks = if closed {
        corners.clone()
    } else {
        let mut b = vec![0];
        b.extend(
            corners
                .iter()
                .copied()
                .filter(|&c| c > 0 && c < points.len() - 1),
        );
        b
    };
    breaks.push(points.len() - 1);
    let mut pieces = Vec::new();
    let mut flags = Vec::new();
    for (k, b) in breaks.windows(2).enumerate() {
        if b[1] <= b[0] {
            continue;
        }
        let run = fit_run(&points, b[0], b[1], o, &lengths);
        for (i, piece) in run.into_iter().enumerate() {
            pieces.push(piece);
            flags.push(i == 0 && (k > 0 || (closed && had_corners)));
        }
    }
    if pieces.is_empty() {
        return Ok(None);
    }
    for piece in &pieces {
        if let Kind::Arc(c) = piece.kind {
            for index in [piece.start, piece.end] {
                let angle = c.center.angle_to(points[index]);
                points[index] = Point2::from_polar(c.radius, angle) + c.center;
            }
        }
    }
    if closed {
        let last = points.len() - 1;
        points[last] = points[0];
    }
    if o.use_splines || pieces.iter().all(|p| matches!(p.kind, Kind::Spline(_))) {
        let s = pieces_to_spline(&points, &pieces, closed);
        let end = points.len() - 1;
        return Ok(Some(Fitted {
            points,
            pieces: vec![Piece {
                start: 0,
                end,
                kind: Kind::Spline(s),
            }],
            corners: vec![false],
            closed,
        }));
    }
    if closed
        && pieces.len() > 1
        && matches!(pieces[0].kind, Kind::Spline(_))
        && matches!(pieces.last().unwrap().kind, Kind::Spline(_))
    {
        if let Some(first) = pieces
            .iter()
            .position(|p| !matches!(p.kind, Kind::Spline(_)))
        {
            if first > 0 {
                let n = points.len() - 1;
                let shift = pieces[first].start;
                points.pop();
                points.rotate_left(shift);
                points.push(points[0]);
                pieces.rotate_left(first);
                flags.rotate_left(first);
                for p in &mut pieces {
                    p.start = (p.start + n - shift) % n;
                    let end = (p.end + n - shift) % n;
                    p.end = if end == 0 { n } else { end };
                }
            }
        }
    }
    let mut out = Vec::new();
    let mut out_flags = Vec::new();
    let mut i = 0;
    while i < pieces.len() {
        if !matches!(pieces[i].kind, Kind::Spline(_)) {
            out.push(pieces[i].clone());
            out_flags.push(flags[i]);
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < pieces.len() && matches!(pieces[j + 1].kind, Kind::Spline(_)) {
            j += 1;
        }
        if i == j {
            out.push(pieces[i].clone());
        } else {
            out.push(Piece {
                start: pieces[i].start,
                end: pieces[j].end,
                kind: Kind::Spline(pieces_to_spline(&points, &pieces[i..=j], false)),
            });
        }
        out_flags.push(flags[i]);
        i = j + 1;
    }
    Ok(Some(Fitted {
        points,
        pieces: out,
        corners: out_flags,
        closed,
    }))
}
pub fn end_direction(points: &[Point2], piece: &Piece, start: bool) -> Point2 {
    let pt = points[if start { piece.start } else { piece.end }];
    let near = points[if start {
        piece.end.min(piece.start + 2)
    } else {
        piece.start.max(piece.end.saturating_sub(2))
    }];
    let travel = if start { near - pt } else { pt - near };
    let dir = match piece.kind {
        Kind::Line => points[piece.end] - points[piece.start],
        Kind::Arc(c) => {
            let v = (pt - c.center).perp();
            if v.dot(travel) < 0.0 {
                -v
            } else {
                v
            }
        }
        Kind::Spline(_) => travel,
    };
    norm(dir)
}
