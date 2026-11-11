use super::{Curve, Point2};

const SAMPLES: usize = 128;

/// Legacy calculations use SVG coordinates internally, then return world coordinates.
pub(super) struct Frame {
    center: Point2,
    rx: f64,
    ry: f64,
    u: Point2,
    v: Point2,
}

impl Frame {
    pub(super) fn from_curve(curve: Curve) -> Option<Self> {
        let (center, rx, ry, angle) = match curve {
            Curve::Circle { center, radius } => (
                Point2 {
                    x: center.x,
                    y: -center.y,
                },
                radius,
                radius,
                0.0,
            ),
            Curve::Ellipse {
                center,
                major_axis_point: major,
                minor_axis_point: minor,
            } => {
                let center = Point2 {
                    x: center.x,
                    y: -center.y,
                };
                let dx = major.x - center.x;
                let dy = -major.y - center.y;
                (
                    center,
                    dx.hypot(dy),
                    (minor.x - center.x).hypot(-minor.y - center.y),
                    dy.atan2(dx),
                )
            }
            Curve::Segment { .. } | Curve::Bezier { .. } => return None,
        };
        if rx < 1e-6 || ry < 1e-6 {
            return None;
        }
        let u = Point2 {
            x: angle.cos(),
            y: angle.sin(),
        };
        Some(Self {
            center,
            rx,
            ry,
            u,
            v: Point2 { x: -u.y, y: u.x },
        })
    }

    fn local(&self, p: Point2) -> Point2 {
        let dx = p.x - self.center.x;
        let dy = p.y - self.center.y;
        Point2 {
            x: dx * self.u.x + dy * self.u.y,
            y: dx * self.v.x + dy * self.v.y,
        }
    }

    pub(super) fn implicit_world(&self, point: Point2) -> f64 {
        let p = self.local(Point2 {
            x: point.x,
            y: -point.y,
        });
        (p.x * p.x) / (self.rx * self.rx) + (p.y * p.y) / (self.ry * self.ry) - 1.0
    }

    fn point_at(&self, t: f64) -> Point2 {
        let u = self.rx * t.cos();
        let v = self.ry * t.sin();
        Point2 {
            x: self.center.x + self.u.x * u + self.v.x * v,
            y: self.center.y + self.u.y * u + self.v.y * v,
        }
    }
}

pub(super) fn segment_ellipse(p1: Point2, p2: Point2, ellipse: Curve) -> Vec<Point2> {
    let Some(e) = Frame::from_curve(ellipse) else {
        return vec![];
    };
    let local1 = e.local(Point2 { x: p1.x, y: -p1.y });
    let local2 = e.local(Point2 { x: p2.x, y: -p2.y });
    let du = local2.x - local1.x;
    let dv = local2.y - local1.y;
    let a = e.ry * e.ry * du * du + e.rx * e.rx * dv * dv;
    if a < 1e-12 {
        return vec![];
    }
    let b = 2.0 * (e.ry * e.ry * local1.x * du + e.rx * e.rx * local1.y * dv);
    let c = e.ry * e.ry * local1.x * local1.x + e.rx * e.rx * local1.y * local1.y
        - e.rx * e.rx * e.ry * e.ry;
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < -1e-7 {
        return vec![];
    }
    let sqrt_d = discriminant.max(0.0).sqrt();
    [(-b - sqrt_d) / (2.0 * a), (-b + sqrt_d) / (2.0 * a)]
        .into_iter()
        .filter(|t| (-1e-5..=1.0 + 1e-5).contains(t))
        .map(|t| super::offset(p1, p2.x - p1.x, p2.y - p1.y, t.clamp(0.0, 1.0)))
        .collect()
}

pub(super) fn conic_conic(a: Curve, b: Curve) -> Vec<Point2> {
    let (Some(e1), Some(e2)) = (Frame::from_curve(a), Frame::from_curve(b)) else {
        return vec![];
    };
    let g = |t: f64| {
        let p = e2.local(e1.point_at(t));
        (p.x * p.x) / (e2.rx * e2.rx) + (p.y * p.y) / (e2.ry * e2.ry) - 1.0
    };
    let step = std::f64::consts::TAU / SAMPLES as f64;
    let values: Vec<f64> = (0..=SAMPLES).map(|i| g(i as f64 * step)).collect();
    let mut roots = Vec::new();
    for i in 0..SAMPLES {
        let ta = i as f64 * step;
        let tb = (i + 1) as f64 * step;
        let ga = values[i];
        let gb = values[i + 1];
        if ga * gb <= 0.0 {
            let (mut low, mut high, mut f_low) = (ta, tb, ga);
            for _ in 0..28 {
                let mid = (low + high) * 0.5;
                let f_mid = g(mid);
                if f_mid.abs() < 1e-12 || high - low < 1e-10 {
                    low = mid;
                    break;
                }
                if f_low * f_mid <= 0.0 {
                    high = mid;
                } else {
                    low = mid;
                    f_low = f_mid;
                }
            }
            roots.push((low + high) * 0.5);
        } else if ga.abs() < 1e-4
            && (i == 0 || ga.abs() <= values[i - 1].abs())
            && ga.abs() <= gb.abs()
        {
            roots.push(ta);
        }
    }
    roots
        .into_iter()
        .map(|t| {
            let p = e1.point_at(t);
            Point2 { x: p.x, y: -p.y }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Point2 {
        Point2 { x, y }
    }
    fn ellipse(rx: f64, ry: f64) -> Curve {
        Curve::Ellipse {
            center: p(0.0, 0.0),
            major_axis_point: p(rx, 0.0),
            minor_axis_point: p(0.0, ry),
        }
    }

    #[test]
    fn segment_ellipse_secant_tangent_and_degenerate_axes() {
        assert_eq!(
            segment_ellipse(p(-10.0, 0.0), p(10.0, 0.0), ellipse(5.0, 3.0)),
            vec![p(-5.0, 0.0), p(5.0, 0.0)]
        );
        // Retain both tangent candidates until arc-span filtering and deduplication.
        assert_eq!(
            segment_ellipse(p(-10.0, 3.0), p(10.0, 3.0), ellipse(5.0, 3.0)),
            vec![p(0.0, 3.0), p(0.0, 3.0)]
        );
        assert!(segment_ellipse(p(-10.0, 0.0), p(10.0, 0.0), ellipse(0.0, 3.0)).is_empty());
        assert!(segment_ellipse(p(-10.0, 0.0), p(10.0, 0.0), ellipse(5.0, 1e-8)).is_empty());
    }

    #[test]
    fn conics_have_four_crossings_and_satisfy_both_implicit_equations() {
        let hits = conic_conic(ellipse(5.0, 3.0), ellipse(3.0, 5.0));
        assert_eq!(hits.len(), 4);
        for hit in hits {
            assert!((hit.x.powi(2) / 25.0 + hit.y.powi(2) / 9.0 - 1.0).abs() < 1e-8);
            assert!((hit.x.powi(2) / 9.0 + hit.y.powi(2) / 25.0 - 1.0).abs() < 1e-8);
        }
    }

    #[test]
    fn nested_and_disjoint_conics_have_no_crossings() {
        assert!(conic_conic(ellipse(5.0, 3.0), ellipse(1.0, 0.5)).is_empty());
        assert!(conic_conic(
            ellipse(5.0, 3.0),
            Curve::Circle {
                center: p(20.0, 0.0),
                radius: 1.0
            }
        )
        .is_empty());
    }
}
