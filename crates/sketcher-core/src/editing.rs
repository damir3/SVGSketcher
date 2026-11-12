//! Pure trim/extend queries. Mutation, constraint transfer and undo remain with the document.
use crate::regions::{intersections, spline_self_intersections, Geometry, RegionCurve};
use crate::{spline, Point2};
use std::f64::consts::TAU;

#[derive(Clone, Copy, Debug)]
pub struct Intersection {
    pub point: Point2,
    pub param: f64,
    pub source: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct Trim {
    pub interval: [f64; 2],
    pub start: Point2,
    pub end: Point2,
    pub start_source: Option<usize>,
    pub end_source: Option<usize>,
    pub whole: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct Extend {
    pub end: bool,
    pub from: Point2,
    pub to: Point2,
    pub source: Option<usize>,
    pub full: bool,
}
fn p(x: f64, y: f64) -> Point2 {
    Point2 { x, y }
}
fn length(v: Point2) -> f64 {
    spline::length(v)
}
fn distance(a: Point2, b: Point2) -> f64 {
    length(p(a.x - b.x, a.y - b.y))
}
fn angle(c: Point2, v: Point2) -> f64 {
    (v.y - c.y).atan2(v.x - c.x)
}
fn normalized(v: Point2) -> Point2 {
    let l = length(v);
    if l < 1e-12 {
        p(1.0, 0.0)
    } else {
        p(v.x * (1.0 / l), v.y * (1.0 / l))
    }
}
fn angular(mut value: f64) -> f64 {
    while value < 0.0 {
        value += TAU
    }
    while value >= TAU {
        value -= TAU
    }
    value
}

pub fn curve_intersections(target: &RegionCurve, others: &[RegionCurve]) -> Vec<Intersection> {
    let g = &target.geometry;
    let primitives = g.primitives();
    let is_open = matches!(
        g,
        Geometry::Segment(..)
            | Geometry::Arc(..)
            | Geometry::EllipticalArc(..)
            | Geometry::Spline(_, false)
    );
    let mut result = vec![];
    let mut push_hit = |point: Point2, param: f64, source: usize| {
        if is_open && (param < 1e-4 || param > 1.0 - 1e-4) {
            return;
        }
        result.push(Intersection {
            point,
            param,
            source,
        });
    };
    for (index, other) in others.iter().enumerate() {
        if other.id == target.id {
            continue;
        }
        for point in intersections(
            g,
            &other.geometry,
            &primitives,
            &other.geometry.primitives(),
        ) {
            push_hit(point, g.param(point), index);
        }
    }
    if let Geometry::Spline(ref segments, closed) = *g {
        let self_source = others
            .iter()
            .position(|other| other.id == target.id)
            .unwrap_or(others.len());
        for (point, u, v) in spline_self_intersections(segments, closed) {
            push_hit(point, u, self_source);
            push_hit(point, v, self_source);
        }
    }
    result.sort_by(|a, b| {
        a.param
            .partial_cmp(&b.param)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let eps = if matches!(g, Geometry::Circle(..) | Geometry::Ellipse(..)) {
        1e-3
    } else {
        1e-4
    };
    let mut unique: Vec<Intersection> = vec![];
    for item in result {
        if !unique.iter().any(|u| (u.param - item.param).abs() < eps) {
            unique.push(item)
        }
    }
    unique
}

pub fn trim(target: &RegionCurve, others: &[RegionCurve], cursor: Point2, control: bool) -> Trim {
    let g = &target.geometry;
    let hits = curve_intersections(target, others);
    let cursor_param = g.param(cursor);
    let closed = matches!(g, Geometry::Circle(..) | Geometry::Ellipse(..))
        || matches!(g, Geometry::Spline(_, true)) && !control;
    let result = |a: f64, b: f64, start_source, end_source, whole| Trim {
        interval: [a, b],
        start: g.point(a),
        end: g.point(b),
        start_source,
        end_source,
        whole,
    };
    if !closed {
        if hits.is_empty() {
            return result(0.0, 1.0, None, None, true);
        }
        for i in 0..=hits.len() {
            let a = if i == 0 { 0.0 } else { hits[i - 1].param };
            let b = if i == hits.len() { 1.0 } else { hits[i].param };
            if cursor_param >= a - 1e-5 && cursor_param <= b + 1e-5 {
                return result(
                    a,
                    b,
                    if i > 0 {
                        Some(hits[i - 1].source)
                    } else {
                        None
                    },
                    hits.get(i).map(|h| h.source),
                    false,
                );
            }
        }
        return result(0.0, hits[0].param, None, Some(hits[0].source), false);
    }
    if hits.len() < 2 {
        let period = if matches!(g, Geometry::Circle(..) | Geometry::Ellipse(..)) {
            TAU
        } else {
            1.0
        };
        return result(0.0, period, None, None, true);
    }
    let mut a = hits.len() - 1;
    let mut b = 0;
    for i in 0..hits.len() - 1 {
        if cursor_param >= hits[i].param - 1e-5 && cursor_param <= hits[i + 1].param + 1e-5 {
            a = i;
            b = i + 1;
            break;
        }
    }
    result(
        hits[a].param,
        hits[b].param,
        Some(hits[a].source),
        Some(hits[b].source),
        false,
    )
}

pub fn extend(
    target: &RegionCurve,
    others: &[RegionCurve],
    cursor: Point2,
    control: bool,
) -> Option<Extend> {
    let g = &target.geometry;
    let (start, finish) = match *g {
        Geometry::Segment(a, b)
        | Geometry::Arc(_, _, a, b, _)
        | Geometry::EllipticalArc(_, _, _, a, b, _) => (a, b),
        Geometry::Spline(_, true) if !control => return None,
        Geometry::Spline(..) => (g.point(0.0), g.point(1.0)),
        _ => return None,
    };
    let end = distance(cursor, finish) <= distance(cursor, start);
    let from = if end { finish } else { start };
    if matches!(g, Geometry::Segment(..) | Geometry::Spline(..)) {
        let dir = if let Geometry::Spline(segments, _) = g {
            let tangent = spline::tangent_at(segments, if end { 1.0 } else { 0.0 });
            normalized(if end {
                tangent
            } else {
                p(-tangent.x, -tangent.y)
            })
        } else {
            let other = if end { start } else { finish };
            normalized(p(from.x - other.x, from.y - other.y))
        };
        let ray = Geometry::Segment(from, p(from.x + dir.x * 50000.0, from.y + dir.y * 50000.0));
        let primitives = ray.primitives();
        let mut best = f64::INFINITY;
        let mut hit = None;
        for (index, other) in others.iter().enumerate() {
            if other.id == target.id {
                continue;
            }
            for point in intersections(
                &ray,
                &other.geometry,
                &primitives,
                &other.geometry.primitives(),
            ) {
                let t = (point.x - from.x) * dir.x + (point.y - from.y) * dir.y;
                if t > 1e-3 && t < best {
                    best = t;
                    hit = Some((point, index));
                }
            }
        }
        if matches!(g, Geometry::Spline(..)) {
            let self_source = others
                .iter()
                .position(|other| other.id == target.id)
                .unwrap_or(others.len());
            for point in intersections(&ray, g, &primitives, &g.primitives()) {
                let t = (point.x - from.x) * dir.x + (point.y - from.y) * dir.y;
                if t > 1e-3 && t < best {
                    best = t;
                    hit = Some((point, self_source));
                }
            }
        }
        let (to, source) = if let Some((q, i)) = hit {
            (q, Some(i))
        } else {
            (p(from.x + dir.x * 50.0, from.y + dir.y * 50.0), None)
        };
        return Some(Extend {
            end,
            from,
            to,
            source,
            full: false,
        });
    }
    let (full, theta_start, theta_end, cw) = match *g {
        Geometry::Arc(c, r, a, b, cw) => (Geometry::Circle(c, r), angle(c, a), angle(c, b), cw),
        Geometry::EllipticalArc(c, major, minor, a, b, cw) => {
            let parameter = |v| ellipse_param(c, major, minor, v);
            (
                Geometry::Ellipse(c, major, minor),
                parameter(a),
                parameter(b),
                cw,
            )
        }
        _ => unreachable!(),
    };
    let current = angular(if cw {
        theta_start - theta_end
    } else {
        theta_end - theta_start
    });
    let max = TAU - current - 1e-4;
    if matches!(g, Geometry::Arc(..)) && max <= 1e-4 {
        return None;
    }
    let primitives = full.primitives();
    let mut best = f64::INFINITY;
    let mut hit = None;
    for (index, other) in others.iter().enumerate() {
        if other.id == target.id {
            continue;
        }
        for point in intersections(
            &full,
            &other.geometry,
            &primitives,
            &other.geometry.primitives(),
        ) {
            let theta = match *g {
                Geometry::Arc(c, ..) => angle(c, point),
                Geometry::EllipticalArc(c, a, b, ..) => ellipse_param(c, a, b, point),
                _ => unreachable!(),
            };
            let span = angular(if end {
                if cw {
                    theta_end - theta
                } else {
                    theta - theta_end
                }
            } else if cw {
                theta - theta_start
            } else {
                theta_start - theta
            });
            if span > 1e-3 && span <= max && span < best {
                best = span;
                hit = Some((point, index));
            }
        }
    }
    Some(if let Some((to, source)) = hit {
        Extend {
            end,
            from,
            to,
            source: Some(source),
            full: false,
        }
    } else {
        Extend {
            end,
            from,
            to: from,
            source: None,
            full: true,
        }
    })
}
fn ellipse_param(c: Point2, major: Point2, minor: Point2, v: Point2) -> f64 {
    let a = angle(c, major);
    let (ux, uy) = (a.cos(), a.sin());
    let (vx, vy) = (-uy, ux);
    let (x, y) = (v.x - c.x, v.y - c.y);
    ((x * vx + y * vy) / distance(c, minor)).atan2((x * ux + y * uy) / distance(c, major))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(id: usize, a: Point2, b: Point2) -> RegionCurve {
        RegionCurve {
            id,
            geometry: Geometry::Segment(a, b),
        }
    }
    #[test]
    fn chooses_middle_trim_and_nearest_forward_extension() {
        let t = line(0, p(0.0, 0.0), p(10.0, 0.0));
        let others = [
            line(1, p(3.0, -2.0), p(3.0, 2.0)),
            line(2, p(7.0, -2.0), p(7.0, 2.0)),
            line(3, p(20.0, -2.0), p(20.0, 2.0)),
        ];
        let r = trim(&t, &others, p(5.0, 0.0), false);
        assert_eq!(r.interval, [0.3, 0.7]);
        assert_eq!(r.start_source, Some(0));
        let e = extend(&t, &others, p(10.0, 0.0), false).unwrap();
        assert_eq!(e.to, p(20.0, 0.0));
        assert_eq!(e.source, Some(2));
    }
    #[test]
    fn empty_ray_defaults_and_closed_fit_rejection() {
        let t = line(0, p(0.0, 0.0), p(0.0, 0.0));
        assert_eq!(
            extend(&t, &[], p(0.0, 0.0), false).unwrap().to,
            p(50.0, 0.0)
        );
        let s = RegionCurve {
            id: 0,
            geometry: Geometry::Spline(vec![], true),
        };
        assert!(extend(&s, &[], p(0.0, 0.0), false).is_none());
        assert!(extend(&s, &[], p(0.0, 0.0), true).is_some());
    }
    #[test]
    fn circles_without_two_cuts_are_whole_entities() {
        let t = RegionCurve {
            id: 0,
            geometry: Geometry::Circle(p(0.0, 0.0), 1.0),
        };
        let r = trim(&t, &[], p(1.0, 0.0), false);
        assert!(r.whole);
        assert_eq!(r.interval, [0.0, TAU]);
        assert!(extend(&t, &[], p(1.0, 0.0), false).is_none());
    }
    #[test]
    fn spline_self_intersections_support_trim_and_self_extend() {
        let loop_curve = RegionCurve {
            id: 1,
            geometry: Geometry::Spline(
                vec![
                    [p(-20.0, 0.0), p(0.0, 30.0), p(20.0, 30.0), p(20.0, 0.0)],
                    [p(20.0, 0.0), p(20.0, -30.0), p(-10.0, -30.0), p(0.0, 30.0)],
                ],
                false,
            ),
        };
        let hits = curve_intersections(&loop_curve, &[]);
        assert_eq!(hits.len(), 2);
        assert!(hits[0].param < 0.5 && hits[1].param > 0.5);

        let crunode = RegionCurve {
            id: 2,
            geometry: Geometry::Spline(
                vec![[p(0.0, 0.0), p(4.0, 2.0), p(-4.0, 2.0), p(0.0, 0.0)]],
                false,
            ),
        };
        assert_eq!(curve_intersections(&crunode, &[]).len(), 0);
        // Shift interior crossing strictly inside (0, 1)
        let interior_crunode = RegionCurve {
            id: 3,
            geometry: Geometry::Spline(
                vec![[p(-2.0, -2.0), p(6.0, 4.0), p(-6.0, 4.0), p(2.0, -2.0)]],
                false,
            ),
        };
        let crunode_hits = curve_intersections(&interior_crunode, &[]);
        assert_eq!(crunode_hits.len(), 2);
        assert!(crunode_hits[0].point.x.abs() < 1e-6);

        let bow_tie = RegionCurve {
            id: 4,
            geometry: Geometry::Spline(
                vec![
                    [
                        p(-40.0, 25.0),
                        p(-10.0, 25.0),
                        p(10.0, -25.0),
                        p(40.0, -25.0),
                    ],
                    [p(40.0, -25.0), p(50.0, 0.0), p(50.0, 0.0), p(40.0, 25.0)],
                    [
                        p(40.0, 25.0),
                        p(10.0, 25.0),
                        p(-10.0, -25.0),
                        p(-40.0, -25.0),
                    ],
                    [
                        p(-40.0, -25.0),
                        p(-50.0, 0.0),
                        p(-50.0, 0.0),
                        p(-40.0, 25.0),
                    ],
                ],
                true,
            ),
        };
        let trimmed = trim(&bow_tie, &[], p(45.0, 0.0), false);
        assert!(!trimmed.whole);
        assert!((trimmed.start.x).hypot(trimmed.start.y) < 1e-6);
        assert!((trimmed.end.x).hypot(trimmed.end.y) < 1e-6);

        let hook = RegionCurve {
            id: 5,
            geometry: Geometry::Spline(
                vec![
                    [p(-20.0, 20.0), p(-5.0, 35.0), p(10.0, 35.0), p(20.0, 20.0)],
                    [p(20.0, 20.0), p(35.0, 5.0), p(10.0, -20.0), p(5.0, 0.0)],
                ],
                false,
            ),
        };
        let ext = extend(&hook, &[], p(5.0, 0.0), false).unwrap();
        assert_eq!(ext.source, Some(0));
        assert!(ext.to.y > 20.0);
    }
}
