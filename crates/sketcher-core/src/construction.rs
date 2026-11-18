//! Pure numeric primitive construction, shared by editor previews and document creation.
use crate::{p, Point2};
use std::f64::consts::{PI, TAU};
type Circle = (Point2, f64);
const ARITIES: [usize; 19] = [
    6, 6, 7, 10, 10, 11, 12, 11, 11, 9, 6, 9, 8, 9, 5, 6, 6, 6, 8,
];
fn length(v: Point2) -> f64 {
    v.scaled_length()
}
fn distance(a: Point2, b: Point2) -> f64 {
    length(b - a)
}
fn middle(a: Point2, b: Point2) -> Point2 {
    (a + b) * 0.5
}
fn polar(r: f64, a: f64) -> Point2 {
    p(r * a.cos(), r * a.sin())
}
fn push(out: &mut Vec<f64>, q: Point2) {
    out.extend([q.x, q.y]);
}
fn circle_data(c: Option<Circle>) -> Option<Vec<f64>> {
    c.map(|(q, r)| vec![q.x, q.y, r])
}
fn circumcircle(a: Point2, b: Point2, c: Point2) -> Option<Circle> {
    let d = 2.0 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if d.abs() < 1e-6 {
        return None;
    }
    let aa = a.length_squared();
    let bb = b.length_squared();
    let cc = c.length_squared();
    let center = p(
        (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d,
        (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d,
    );
    let r = distance(center, a);
    if !r.is_finite() || !(1e-3..=1e6).contains(&r) {
        None
    } else {
        Some((center, r))
    }
}
#[derive(Clone, Copy)]
struct Line {
    p: Point2,
    n: Point2,
}
fn line_intersection(a: Line, b: Line, oa: f64, ob: f64) -> Option<Point2> {
    let det = a.n.cross(b.n);
    if det.abs() < 1e-8 {
        return None;
    }
    let h1 = a.p.dot(a.n) + oa;
    let h2 = b.p.dot(b.n) + ob;
    Some(p(
        (h1 * b.n.y - a.n.y * h2) / det,
        (a.n.x * h2 - h1 * b.n.x) / det,
    ))
}
fn two_tangent(a: Line, b: Line, cursor: Point2, radius: Option<f64>) -> Option<Circle> {
    let origin = line_intersection(a, b, 0.0, 0.0)?;
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    if let Some(r) = radius {
        for sa in [-1.0, 1.0] {
            for sb in [-1.0, 1.0] {
                let center = line_intersection(a, b, sa * r, sb * r)?;
                let d = distance(center, cursor);
                if d < best_distance {
                    best = Some((center, r));
                    best_distance = d;
                }
            }
        }
    } else {
        for raw in [a.n + b.n, a.n - b.n] {
            let len = length(raw);
            if len <= 1e-8 {
                continue;
            }
            let axis = raw * (1.0 / len);
            let center = origin + axis * (cursor - origin).dot(axis);
            let r = (center - a.p).dot(a.n).abs();
            let d = distance(center, cursor);
            if r > 1e-6 && (best.is_none() || d < best_distance) {
                best = Some((center, r));
                best_distance = d;
            }
        }
    }
    best
}
fn three_tangent(lines: [Line; 3]) -> Option<Circle> {
    let mut best: Option<Circle> = None;
    for s1 in [-1.0, 1.0] {
        for s2 in [-1.0, 1.0] {
            for s3 in [-1.0, 1.0] {
                let signs = [s1, s2, s3];
                let mut matrix = std::array::from_fn::<_, 3, _>(|i| {
                    [
                        lines[i].n.x,
                        lines[i].n.y,
                        -signs[i],
                        lines[i].p.dot(lines[i].n),
                    ]
                });
                for col in 0..3 {
                    let mut pivot = col;
                    for row in col + 1..3 {
                        if matrix[row][col].abs() > matrix[pivot][col].abs() {
                            pivot = row;
                        }
                    }
                    if matrix[pivot][col].abs() < 1e-8 {
                        break;
                    }
                    matrix.swap(col, pivot);
                    let div = matrix[col][col];
                    for v in &mut matrix[col][col..] {
                        *v /= div;
                    }
                    for row in 0..3 {
                        if row == col {
                            continue;
                        }
                        let f = matrix[row][col];
                        let pivot_row = matrix[col];
                        for (value, pivot_value) in
                            matrix[row][col..].iter_mut().zip(&pivot_row[col..])
                        {
                            *value -= f * pivot_value;
                        }
                    }
                }
                if (0..3).any(|i| matrix[i][i].abs() < 1e-8) {
                    continue;
                }
                let r = matrix[2][3].abs();
                if r > 0.01 && best.is_none_or(|(_, br)| r < br) {
                    best = Some((p(matrix[0][3], matrix[1][3]), r));
                }
            }
        }
    }
    best
}
fn positive(a: f64) -> f64 {
    (a + TAU) % TAU
}
fn angle(c: Point2, q: Point2, o: f64) -> f64 {
    ((q.y - c.y) * o).atan2(q.x - c.x)
}
fn sweep(a: f64, b: f64, cw: bool) -> f64 {
    let s = if cw { b - a } else { a - b } % TAU;
    if s < 0.0 {
        s + TAU
    } else {
        s
    }
}
fn describe_tangent(start: Point2, end: Point2, t: Point2, c: Point2, r: f64, o: f64) -> Vec<f64> {
    let cw = (start - c).cross(t) * o > 0.0;
    vec![
        c.x,
        c.y,
        r,
        f64::from(cw),
        sweep(angle(c, start, o), angle(c, end, o), cw),
        end.x,
        end.y,
    ]
}
fn tangent_arc(d: &[f64]) -> Option<Vec<f64>> {
    let q = |i| p(d[i], d[i + 1]);
    let start = q(0);
    let cursor = q(2);
    let t = q(4);
    let n = t.perp();
    let v = cursor - start;
    let len = length(v);
    let den = 2.0 * v.dot(n);
    let s = len * len / den;
    let r = s.abs();
    let natural = if len < 1e-3 || den.abs() < 1e-4 || !(0.5..=50000.0).contains(&r) {
        None
    } else {
        Some(describe_tangent(start, cursor, t, start + n * s, r, d[10]))
    };
    if d[6] == 0.0 && d[8] == 0.0 {
        return natural;
    }
    let a = if d[8] != 0.0 {
        d[9]
    } else {
        natural.as_ref().map_or(PI / 2.0, |g| g[4])
    };
    let r = if d[6] != 0.0 {
        d[7]
    } else {
        natural
            .as_ref()
            .map_or_else(|| (len / (2.0 * (a / 2.0).sin())).max(1.0), |g| g[2])
    };
    let side = if v.dot(n) < 0.0 { -1.0 } else { 1.0 };
    let end = start + t * (r * a.sin()) + n * (side * r * (1.0 - a.cos()));
    Some(describe_tangent(
        start,
        end,
        t,
        start + n * (side * r),
        r,
        d[10],
    ))
}
fn slot_centers(a: Point2, b: Point2, r: f64, mode: f64) -> (Point2, Point2, Point2, Point2, f64) {
    let v = b - a;
    let len = length(v);
    let u = if len > 1e-4 {
        v * (1.0 / len)
    } else {
        Point2::UNIT_X
    };
    let n = u.perp();
    if mode == 0.0 {
        (a, b, u, n, r.max(0.1))
    } else if mode == 1.0 {
        (a * 2.0 - b, b, u, n, r.max(0.1))
    } else {
        let er = r.min((len / 2.0 - 0.1).max(0.1)).max(0.1);
        (a + u * er, b + u * (-er), u, n, er)
    }
}
/// A missing construction is ordinary degeneracy; malformed numeric records are errors.
pub fn query(mode: u32, d: &[f64]) -> Result<Option<Vec<f64>>, &'static str> {
    let m = mode as usize;
    if m >= ARITIES.len() || d.len() != ARITIES[m] || d.iter().any(|v| !v.is_finite()) {
        return Err("Invalid construction input");
    }
    let flag = |i| d[i] == 0.0 || d[i] == 1.0;
    if matches!(mode, 7 | 8) && (!flag(6) || !flag(8) || ![-1.0, 1.0].contains(&d[10]))
        || mode == 9 && ![-1.0, 1.0].contains(&d[8])
        || mode == 10 && ![0.0, 1.0, 2.0].contains(&d[5])
        || mode == 12 && ![0.0, 1.0, 2.0].contains(&d[6])
        || mode == 13 && ![-1.0, 1.0].contains(&d[7])
        || mode == 15 && (!flag(5) || d[4] < 3.0 || d[4].fract() != 0.0)
        || mode == 16 && (!flag(5) || d[3] < 3.0 || d[3] > 100000.0 || d[3].fract() != 0.0)
        || mode == 17 && d[5] < 0.0
    {
        return Err("Invalid construction options");
    }
    let q = |i| p(d[i], d[i + 1]);
    let line = |i| Line {
        p: q(i),
        n: q(i + 2),
    };
    let out = match mode {
        0 => circle_data(circumcircle(q(0), q(2), q(4))),
        1 => {
            let a = q(0);
            let b = q(2);
            let c = circumcircle(a, b, q(4)).or_else(|| {
                let v = b - a;
                let len = length(v);
                if len < 1e-8 {
                    return None;
                }
                let n = v.perp() * (1.0 / len);
                circumcircle(a, b, middle(a, b) + n * (len / 2.0).max(10.0))
            });
            circle_data(c)
        }
        2 => {
            let a = q(0);
            let b = q(2);
            let v = b - a;
            let len = length(v);
            let r = d[6] / 2.0;
            if len < 1e-8 || r < len / 2.0 {
                None
            } else {
                let h = (r * r - len * len / 4.0).max(0.0).sqrt();
                let mid = middle(a, b);
                let n = v.perp() * (1.0 / len);
                let ca = mid + n * h;
                let cb = mid + n * (-h);
                circle_data(Some((
                    if distance(ca, q(4)) <= distance(cb, q(4)) {
                        ca
                    } else {
                        cb
                    },
                    r,
                )))
            }
        }
        3 => line_intersection(line(0), line(4), d[8], d[9]).map(|c| vec![c.x, c.y]),
        4 => circle_data(two_tangent(line(0), line(4), q(8), None)),
        5 => circle_data(two_tangent(line(0), line(4), q(8), Some(d[10]))),
        6 => circle_data(three_tangent([line(0), line(4), line(8)])),
        7 => {
            let start = q(0);
            let end = q(2);
            let cursor = q(4);
            let mut bulge = cursor;
            if d[6] != 0.0 || d[8] != 0.0 {
                let half = distance(start, end) / 2.0;
                let n = (end - start).perp() * (1.0 / (2.0 * half));
                let mid = middle(start, end);
                let side = if (cursor - mid).dot(n) < 0.0 {
                    -1.0
                } else {
                    1.0
                };
                let a = if d[8] != 0.0 {
                    d[9]
                } else {
                    if d[7] < half {
                        return Ok(None);
                    }
                    let minor = 2.0 * (half / d[7]).asin();
                    if (start - cursor).dot(end - cursor) > 0.0 {
                        TAU - minor
                    } else {
                        minor
                    }
                };
                bulge = mid + n * (side * half * (a / 4.0).tan());
            }
            circumcircle(start, end, bulge).and_then(|(c, r)| {
                if !(1.0..=50000.0).contains(&r) {
                    return None;
                }
                let a = angle(c, start, d[10]);
                let cw = positive(angle(c, end, d[10]) - a);
                let b = positive(angle(c, bulge, d[10]) - a);
                let clockwise = b > 0.0 && b < cw;
                Some(vec![
                    c.x,
                    c.y,
                    r,
                    f64::from(clockwise),
                    if clockwise { cw } else { TAU - cw },
                ])
            })
        }
        8 => tangent_arc(d),
        9 => {
            let c = q(0);
            let start = q(2);
            let cursor = q(4);
            let r = distance(c, start);
            let a = angle(c, start, d[8]);
            let b = angle(c, cursor, d[8]);
            let delta = positive(b - a + PI) - PI;
            let cw = if d[6].abs() >= 0.001 {
                d[6] >= 0.0
            } else {
                delta >= 0.0
            };
            let span = if d[7] < 0.0 { sweep(a, b, cw) } else { d[7] };
            let wa = if d[7] < 0.0 {
                angle(c, cursor, 1.0)
            } else {
                (a + if cw { span } else { -span }) * d[8]
            };
            let end = c + polar(1.0, wa) * r;
            Some(vec![end.x, end.y, r, f64::from(cw), span])
        }
        10 => {
            let (a, b, u, n, r) = slot_centers(q(0), q(2), d[4], d[5]);
            Some(vec![a.x, a.y, b.x, b.y, u.x, u.y, n.x, n.y, r])
        }
        11 => {
            let a = q(0);
            let b = q(2);
            let n = q(6);
            let r = d[8];
            let mut out = vec![];
            for p in [a + n * r, b + n * r, b + n * (-r), a + n * (-r)] {
                push(&mut out, p);
            }
            Some(out)
        }
        12 => {
            let a = q(0);
            let b = q(2);
            let cursor = q(4);
            let r = if d[6] == 2.0 {
                let len = distance(a, b);
                let u = if len > 1e-4 {
                    (b - a) * (1.0 / len)
                } else {
                    Point2::UNIT_X
                };
                let dist = (cursor - a).dot(u.perp()).abs();
                let raw = if dist > 0.1 {
                    dist
                } else {
                    distance(b, cursor)
                };
                raw.min((len / 2.0 - 0.1).max(0.1)).max(0.1)
            } else {
                let (c1, c2, ..) = slot_centers(a, b, d[7], d[6]);
                let ab = c2 - c1;
                let ll = ab.length_squared();
                let pt = if ll < 1e-12 {
                    c1
                } else {
                    c1 + ab * ((cursor - c1).dot(ab) / ll).clamp(0.0, 1.0)
                };
                distance(pt, cursor).max(0.1)
            };
            Some(vec![r])
        }
        13 => {
            let c = q(0);
            let c1 = q(2);
            let c2 = q(4);
            let ra = d[6];
            let sign = d[7];
            let r = d[8].min((ra - 0.5).max(0.1)).max(0.1);
            let a = angle(c, c1, 1.0);
            let b = angle(c, c2, 1.0);
            let ccw = ((b - a) % TAU + TAU) % TAU;
            let span = if sign > 0.0 { ccw } else { (TAU - ccw) % TAU };
            let mid = a + sign * (span * 0.5);
            let r1 = polar(1.0, a);
            let r2 = polar(1.0, b);
            let rm = polar(1.0, mid);
            let mut out = vec![r];
            for p in [
                c + r1 * (ra - r),
                c + r1 * (ra + r),
                c + r2 * (ra - r),
                c + r2 * (ra + r),
                c + rm * ra,
                c + rm * (ra + r),
                c + rm * (ra - r),
                c1 + r1.perp() * sign * (-r),
                c2 + r2.perp() * sign * r,
            ] {
                push(&mut out, p);
            }
            Some(out)
        }
        14 => Some(vec![(distance(q(0), q(2)) - d[4])
            .abs()
            .min((d[4] - 0.5).max(0.1))
            .max(0.1)]),
        15 => {
            let a = q(0);
            let b = q(2);
            let len = distance(a, b);
            let half = PI / d[4];
            let n = (b - a).perp() * (1.0 / len);
            let ap = len / (2.0 * half.tan());
            let c = middle(a, b) + n * if d[5] != 0.0 { -ap } else { ap };
            Some(vec![
                c.x,
                c.y,
                len / (2.0 * half.sin()),
                angle(c, if d[5] != 0.0 { b } else { a }, 1.0),
            ])
        }
        16 => {
            let n = d[3] as usize;
            let r = if d[5] != 0.0 {
                d[2]
            } else {
                d[2] / (PI / n as f64).cos()
            };
            let a = if d[5] != 0.0 {
                d[4]
            } else {
                d[4] - PI / n as f64
            };
            let step = TAU / n as f64;
            let mut out = Vec::with_capacity(n * 2);
            for i in 0..n {
                push(&mut out, polar(r, a + i as f64 * step) + q(0));
            }
            Some(out)
        }
        17 => {
            let a = q(0);
            let v = q(2) - a;
            let len = length(v);
            let dir = if len > d[5] {
                v * (1.0 / len)
            } else {
                Point2::UNIT_X
            };
            let b = a + dir * d[4];
            Some(vec![b.x, b.y])
        }
        18 => {
            let c = q(0);
            let a = angle(c, q(2), 1.0);
            let mut s = (angle(c, q(4), 1.0) - a) % TAU;
            if s < 0.0 {
                s += TAU;
            }
            let mut t = (angle(c, q(6), 1.0) - a) % TAU;
            if t < 0.0 {
                t += TAU;
            }
            Some(vec![f64::from(t > 0.0 && t < s)])
        }
        _ => unreachable!(),
    };
    // Degenerate geometry may overflow intermediate arithmetic even for finite input.
    Ok(out.filter(|out| out.iter().all(|v| v.is_finite())))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn result(mode: u32, data: &[f64]) -> Vec<f64> {
        query(mode, data).unwrap().unwrap()
    }
    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }
    #[test]
    fn circles_preserve_chord_sides_and_degenerate_cases() {
        assert_eq!(
            result(0, &[0.0, 0.0, 2.0, 0.0, 0.0, 2.0]),
            vec![1.0, 1.0, 2.0_f64.sqrt()]
        );
        assert_eq!(query(0, &[0.0, 0.0, 1.0, 0.0, 2.0, 0.0]), Ok(None));
        assert!(query(1, &[0.0, 0.0, 10.0, 0.0, 5.0, 0.0])
            .unwrap()
            .is_some());
        for y in [-10.0, 10.0] {
            let g = result(2, &[0.0, 0.0, 6.0, 0.0, 3.0, y, 10.0]);
            assert_eq!(g, vec![3.0, if y < 0.0 { -4.0 } else { 4.0 }, 5.0]);
        }
        assert_eq!(query(2, &[0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 5.0]), Ok(None));
    }
    #[test]
    fn tangent_circles_touch_each_line() {
        let lines = [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        for radius in [None, Some(4.0)] {
            let mut input = lines.to_vec();
            input.extend([5.0, 6.0]);
            let mode = if let Some(r) = radius {
                input.push(r);
                5
            } else {
                4
            };
            let g = result(mode, &input);
            close(g[0].abs(), g[2]);
            close(g[1].abs(), g[2]);
            if let Some(r) = radius {
                close(g[2], r);
                assert_eq!(&g[..2], &[r, r]);
            }
        }
        // A 3-4-5 triangle has inradius 1, center (1,1).
        let g = result(
            6,
            &[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 3.0, 0.0, 0.8, 0.6],
        );
        close(g[0], 1.0);
        close(g[1], 1.0);
        close(g[2], 1.0);
        assert_eq!(
            query(4, &[0.0, 0.0, 1.0, 0.0, 3.0, 0.0, 1.0, 0.0, 2.0, 4.0]),
            Ok(None)
        );
    }
    #[test]
    fn tangent_arc_keeps_endpoint_tangent_and_both_view_orientations() {
        for o in [-1.0, 1.0] {
            let g = result(8, &[0.0, 0.0, 10.0, 10.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, o]);
            close(g[0], 0.0);
            close(g[1], 10.0);
            close(g[2], 10.0);
            close(g[4], PI / 2.0);
            assert_eq!(g[3], f64::from(o > 0.0));
            assert_eq!(&g[5..], &[10.0, 10.0]);
        }
        assert_eq!(
            query(
                8,
                &[0.0, 0.0, 10.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0]
            ),
            Ok(None)
        );
    }
    #[test]
    fn slot_caps_and_concentric_sides_keep_their_radii() {
        let g = result(10, &[0.0, 0.0, 10.0, 0.0, 20.0, 2.0]);
        close(g[0], 4.9);
        close(g[2], 5.1);
        close(g[8], 4.9);
        for sign in [-1.0, 1.0] {
            let g = result(13, &[0.0, 0.0, 10.0, 0.0, 0.0, 10.0, 10.0, sign, 2.0]);
            for i in [1, 5, 13] {
                close(length(p(g[i], g[i + 1])), 8.0);
            }
            for i in [3, 7, 11] {
                close(length(p(g[i], g[i + 1])), 12.0);
            }
            close(distance(p(g[15], g[16]), p(10.0, 0.0)), 2.0);
            close(distance(p(g[17], g[18]), p(0.0, 10.0)), 2.0);
        }
    }
    #[test]
    fn polygons_share_edge_and_vertex_construction() {
        for reversed in [0.0, 1.0] {
            let g = result(15, &[0.0, 0.0, 10.0, 0.0, 6.0, reversed]);
            let vertices = result(16, &[g[0], g[1], g[2], 6.0, g[3], 1.0]);
            let expected = if reversed == 0.0 {
                [0.0, 0.0, 10.0, 0.0]
            } else {
                [10.0, 0.0, 0.0, 0.0]
            };
            for i in 0..4 {
                close(vertices[i], expected[i]);
            }
            for v in vertices.as_chunks::<2>().0 {
                close(distance(p(v[0], v[1]), p(g[0], g[1])), g[2]);
            }
        }
    }
    #[test]
    fn malformed_inputs_are_errors_and_overflow_is_a_missing_construction() {
        assert!(query(99, &[]).is_err());
        assert!(query(0, &[f64::NAN; 6]).is_err());
        assert!(query(0, &[]).is_err());
        assert!(query(16, &[0.0, 0.0, 1.0, 1e20, 0.0, 1.0]).is_err());
        assert!(query(8, &[0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 2.0, 0.0, 0.0, 0.0, -1.0]).is_err());
        assert_eq!(
            query(0, &[1e200, 1e200, -1e200, 1e200, 1e200, -1e200]),
            Ok(None)
        );
    }
}
