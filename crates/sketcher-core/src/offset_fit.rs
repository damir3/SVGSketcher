//! Error-bounded cubic fitting of the already trimmed parallel contour.
use super::*;
use crate::CubicBezier;
use std::collections::{BTreeMap, BTreeSet};
pub(super) const TOLERANCE: f64 = 0.05;
#[derive(Clone, Copy)]
pub(super) struct Piece {
    pub start: usize,
    pub end: usize,
    pub curve: CubicBezier,
}
#[derive(Clone, Copy)]
struct Candidate {
    curve: CubicBezier,
    error: f64,
    split: usize,
}
fn second(b: &CubicBezier, u: f64) -> Point2 {
    step(
        scale(add(step(b[2], b[1], -2.0), b[0]), 6.0 * (1.0 - u)),
        add(step(b[3], b[2], -2.0), b[1]),
        6.0 * u,
    )
}
fn generate(nodes: &[Node], start: usize, end: usize, params: &[f64], length: f64) -> CubicBezier {
    let a = &nodes[start];
    let b = &nodes[end];
    let chord = sub(b.p, a.p);
    let fixed_a = a.corner || dot(a.t, sub(nodes[start + 1].p, a.p)) < 0.0;
    let fixed_b = b.corner || dot(b.t, sub(b.p, nodes[end - 1].p)) < 0.0;
    let (mut c00, mut c01, mut c11, mut x0, mut x1) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (j, &u) in params.iter().enumerate() {
        let v = 1.0 - u;
        let b1 = 3.0 * v * v * u;
        let b2 = 3.0 * v * u * u;
        let aa = scale(a.t, b1);
        let bb = scale(b.t, -b2);
        let rhs = step(sub(nodes[start + j].p, a.p), chord, -(b2 + u * u * u));
        c00 += dot(aa, aa);
        c01 += dot(aa, bb);
        c11 += dot(bb, bb);
        x0 += dot(aa, rhs);
        x1 += dot(bb, rhs);
    }
    let det = c00 * c11 - c01 * c01;
    let mut alpha = if fixed_a {
        0.0
    } else if fixed_b {
        x0 / c00
    } else {
        (x0 * c11 - x1 * c01) / det
    };
    let mut beta = if fixed_b {
        0.0
    } else if fixed_a {
        x1 / c11
    } else {
        (x1 * c00 - x0 * c01) / det
    };
    let fallback = spline::length(chord) / 3.0;
    if !fixed_a && (!alpha.is_finite() || alpha <= 1e-12) {
        alpha = fallback;
    }
    if !fixed_b && (!beta.is_finite() || beta <= 1e-12) {
        beta = fallback;
    }
    alpha = alpha.min(length * 0.75);
    beta = beta.min(length * 0.75);
    [a.p, step(a.p, a.t, alpha), step(b.p, b.t, -beta), b.p]
}
// Each restricted cubic is compared with a straight cubic on its reference chord.
// Convex-hull containment bounds the Hausdorff deviation in both directions.
fn deviation(curve: &CubicBezier, nodes: &[Node], start: usize, params: &[f64]) -> (f64, usize) {
    let mut error = 0.0;
    let mut split = (params.len() - 1) / 2;
    for j in 0..params.len() - 1 {
        let u = params[j];
        let v = params[j + 1];
        let du = (v - u) / 3.0;
        let a = nodes[start + j].p;
        let b = nodes[start + j + 1].p;
        let p = spline::evaluate_bezier(curve, u);
        let q = spline::evaluate_bezier(curve, v);
        let delta = sub(b, a);
        let controls = [
            p,
            step(p, spline::derivative_bezier(curve, u), du),
            step(q, spline::derivative_bezier(curve, v), -du),
            q,
        ];
        for (k, &pt) in controls.iter().enumerate() {
            let fraction = if k == 0 {
                0.0
            } else if k == 3 {
                1.0
            } else {
                (dot(sub(pt, a), delta) / dot(delta, delta).max(1e-24)).clamp(0.0, 1.0)
            };
            let d = dist(pt, step(a, delta, fraction));
            if d > error {
                error = d;
                split = j + usize::from(k > 1);
            }
        }
    }
    (error, split)
}
struct Fitter<'a> {
    nodes: &'a [Node],
    cache: BTreeMap<(usize, usize), Candidate>,
}
impl Fitter<'_> {
    fn approximate(&mut self, start: usize, end: usize) -> Candidate {
        if let Some(&value) = self.cache.get(&(start, end)) {
            return value;
        }
        let nodes = self.nodes;
        let mut params = vec![0.0];
        for i in start + 1..=end {
            params.push(params.last().unwrap() + dist(nodes[i].p, nodes[i - 1].p));
        }
        let length = *params.last().unwrap();
        if length < 1e-12 {
            return Candidate {
                curve: [nodes[start].p, nodes[start].p, nodes[end].p, nodes[end].p],
                error: 0.0,
                split: 1,
            };
        }
        let a = &nodes[start];
        let b = &nodes[end];
        let delta = sub(b.p, a.p);
        let length2 = dot(delta, delta);
        let distance = |pt: Point2| {
            dist(
                pt,
                step(
                    a.p,
                    delta,
                    (dot(sub(pt, a.p), delta) / length2.max(1e-24)).clamp(0.0, 1.0),
                ),
            )
        };
        let chord_length = length2.sqrt();
        let line_curve = [
            a.p,
            step(
                a.p,
                a.t,
                if a.corner || dot(a.t, delta) < 0.0 {
                    0.0
                } else {
                    chord_length / 3.0
                },
            ),
            step(
                b.p,
                b.t,
                if b.corner || dot(b.t, delta) < 0.0 {
                    0.0
                } else {
                    -chord_length / 3.0
                },
            ),
            b.p,
        ];
        let line_error = nodes[start..=end]
            .iter()
            .map(|n| distance(n.p))
            .fold(0.0_f64, f64::max)
            + distance(line_curve[1]).max(distance(line_curve[2]));
        if chord_length > 1e-12 && line_error <= TOLERANCE {
            let value = Candidate {
                curve: line_curve,
                error: line_error,
                split: (end - start) / 2,
            };
            self.cache.insert((start, end), value);
            return value;
        }
        for u in &mut params {
            *u /= length;
        }
        let mut best = Candidate {
            curve: [nodes[start].p; 4],
            error: f64::INFINITY,
            split: (end - start) / 2,
        };
        let mut stalled = 0;
        let mut previous_error = f64::INFINITY;
        for iteration in 0..64 {
            let curve = generate(nodes, start, end, &params, length);
            let (error, split) = deviation(&curve, nodes, start, &params);
            if error < best.error {
                best = Candidate {
                    curve,
                    error,
                    split,
                };
            }
            if error <= TOLERANCE {
                let value = Candidate {
                    curve,
                    error,
                    split,
                };
                self.cache.insert((start, end), value);
                return value;
            }
            if iteration >= 12
                && best.error > TOLERANCE * 1.1
                && best.error >= previous_error * 0.9999
            {
                stalled += 1;
            } else {
                stalled = 0;
            }
            previous_error = best.error;
            if stalled >= 3 || end - start == 1 {
                break;
            }
            let mut next = vec![0.0];
            for j in 1..params.len() - 1 {
                let u = params[j];
                let p = sub(spline::evaluate_bezier(&curve, u), nodes[start + j].p);
                let d = spline::derivative_bezier(&curve, u);
                let den = dot(d, d) + dot(p, second(&curve, u));
                let candidate = if den.abs() > 1e-20 {
                    u - dot(p, d) / den
                } else {
                    u
                };
                next.push(candidate.clamp((params[j - 1] + u) / 2.0, (u + params[j + 1]) / 2.0));
            }
            next.push(1.0);
            params = next;
        }
        if end - start == 1 {
            for _ in 0..48 {
                if deviation(&best.curve, nodes, start, &[0.0, 1.0]).0 <= TOLERANCE {
                    break;
                }
                best.curve[1] = step(best.curve[1], sub(best.curve[0], best.curve[1]), 0.5);
                best.curve[2] = step(best.curve[2], sub(best.curve[3], best.curve[2]), 0.5);
            }
            if deviation(&best.curve, nodes, start, &[0.0, 1.0]).0 > TOLERANCE {
                best.curve[1] = best.curve[0];
                best.curve[2] = best.curve[3];
            }
            best.error = deviation(&best.curve, nodes, start, &[0.0, 1.0]).0;
            best.split = 1;
        }
        self.cache.insert((start, end), best);
        best
    }
    fn fit(&mut self, start: usize, end: usize, result: &mut Vec<Piece>) {
        let best = self.approximate(start, end);
        if best.error <= TOLERANCE {
            result.push(Piece {
                start,
                end,
                curve: best.curve,
            });
            return;
        }
        let count = end - start;
        let split = start + best.split.clamp(count.div_ceil(4), count * 3 / 4);
        self.fit(start, split, result);
        self.fit(split, end, result);
    }
}
pub(super) fn fit(nodes: &[Node], closed: bool) -> Vec<Piece> {
    if nodes.len() < 2 {
        return vec![];
    }
    let mut fitter = Fitter {
        nodes,
        cache: BTreeMap::new(),
    };
    let mut result = vec![];
    let mut protected: BTreeSet<_> = nodes
        .iter()
        .enumerate()
        .filter_map(|(i, n)| (n.corner && i > 0 && i < nodes.len() - 1).then_some(i))
        .collect();
    if closed && nodes.len() > 2 && nodes.iter().any(|n| dist(n.p, nodes[0].p) > 1e-12) {
        for q in 1..4 {
            protected.insert(((nodes.len() - 1) * q / 4).clamp(1, nodes.len() - 2));
        }
    }
    let mut start = 0;
    for end in protected
        .iter()
        .copied()
        .chain(std::iter::once(nodes.len() - 1))
    {
        fitter.fit(start, end, &mut result);
        start = end;
    }
    let mut i = 0;
    while i + 1 < result.len() {
        if protected.contains(&result[i].end) {
            i += 1;
            continue;
        }
        let start = result[i].start;
        let end = result[i + 1].end;
        let best = fitter.approximate(start, end);
        if best.error <= TOLERANCE {
            result.splice(
                i..i + 2,
                [Piece {
                    start,
                    end,
                    curve: best.curve,
                }],
            );
            i = i.saturating_sub(1);
        } else {
            i += 1;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_exact_cubic_needs_one_segment() {
        let curve = [p(0.0, 0.0), p(0.0, 100.0), p(100.0, 100.0), p(100.0, 0.0)];
        let nodes: Vec<_> = (0..=128)
            .map(|i| {
                let t = i as f64 / 128.0;
                Node {
                    p: spline::evaluate_bezier(&curve, t),
                    t: unit(spline::derivative_bezier(&curve, t)),
                    n: p(0.0, 1.0),
                    corner: false,
                }
            })
            .collect();
        let pieces = fit(&nodes, false);
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].curve[0], nodes[0].p);
        assert_eq!(pieces[0].curve[3], nodes[128].p);
    }
    #[test]
    fn a_protected_corner_keeps_zero_handles() {
        let nodes = [
            Node {
                p: p(0.0, 0.0),
                t: p(1.0, 0.0),
                n: p(0.0, 1.0),
                corner: false,
            },
            Node {
                p: p(10.0, 0.0),
                t: p(1.0, 0.0),
                n: p(0.0, 1.0),
                corner: true,
            },
            Node {
                p: p(10.0, 10.0),
                t: p(0.0, 1.0),
                n: p(-1.0, 0.0),
                corner: false,
            },
        ];
        let pieces = fit(&nodes, false);
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].curve[2], nodes[1].p);
        assert_eq!(pieces[1].curve[1], nodes[1].p);
    }
}

#[cfg(test)]
mod closed_tests {
    use super::*;
    #[test]
    fn a_small_closed_loop_does_not_collapse_to_a_line() {
        for radius in [0.01, 10.0] {
            let nodes: Vec<_> = (0..=128)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / 128.0;
                    Node {
                        p: polar(radius, a),
                        t: p(-a.sin(), a.cos()),
                        n: polar(1.0, a),
                        corner: false,
                    }
                })
                .collect();
            assert!(fit(&nodes, true).len() >= 4);
        }
    }
}
