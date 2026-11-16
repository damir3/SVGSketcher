//! Complete raster-to-primitives tracing. No JS callbacks or document state.
mod contours;
mod fit;
mod raster;
mod skeleton;
use crate::{p, Point2};
use fit::{Fitted, Kind};
use std::f64::consts::PI;
pub const MAX_PIXELS: usize = 4096 * 4096;
pub const SETTINGS_LEN: usize = 22;
#[derive(Clone, Copy)]
pub struct Circle {
    pub center: Point2,
    pub radius: f64,
}
#[derive(Clone, Default)]
pub struct Spline {
    pub points: Vec<Point2>,
    pub handles: Vec<[Point2; 2]>,
}
pub struct FitOptions {
    pub tolerance: f64,
    pub min_segment: f64,
    pub corner_angle: f64,
    pub smoothing: f64,
    pub use_splines: bool,
    pub min_radius: f64,
    pub max_radius: f64,
}
pub struct Settings {
    pub width: usize,
    pub height: usize,
    pub y_scale: f64,
    pub pixel_size: f64,
    pub centerline: bool,
    pub pixel_edges: bool,
    pub guo_hall: bool,
    pub auto_threshold: bool,
    pub threshold: f64,
    pub invert: bool,
    pub blur: f64,
    pub despeckle: f64,
    pub smoothing: f64,
    pub tolerance: f64,
    pub auto_min: bool,
    pub min_segment: f64,
    pub corner_angle: f64,
    pub use_lines: bool,
    pub use_arcs: bool,
    pub use_circles: bool,
    pub include_splines: bool,
    pub use_splines: bool,
}
impl Settings {
    pub fn decode(values: &[f64], pixels: usize) -> Result<Self, &'static str> {
        if values.len() != SETTINGS_LEN || values.iter().any(|v| !v.is_finite()) {
            return Err("Invalid image trace settings");
        }
        let v = values;
        for i in [0, 1] {
            if v[i] < 1.0 || v[i] > 4096.0 || v[i].fract() != 0.0 {
                return Err("Invalid image trace dimensions");
            }
        }
        let (w, h) = (v[0] as usize, v[1] as usize);
        if w * h != pixels || pixels > MAX_PIXELS {
            return Err("Invalid image trace raster size");
        }
        for i in [4, 5, 6, 7, 9, 14, 17, 18, 19, 20, 21] {
            if v[i] != 0.0 && v[i] != 1.0 {
                return Err("Invalid image trace flag");
            }
        }
        if v[2] <= 0.0
            || v[3] <= 0.0
            || !(0.0..=256.0).contains(&v[8])
            || !(0.0..=100.0).contains(&v[10])
            || v[11] < 0.0
            || !(0.0..=100.0).contains(&v[12])
            || v[13] < 0.0
            || v[15] < 0.0
            || !(0.0..=180.0).contains(&v[16])
        {
            return Err("Invalid image trace option range");
        }
        Ok(Self {
            width: w,
            height: h,
            y_scale: v[2],
            pixel_size: v[3],
            centerline: v[4] == 1.0,
            pixel_edges: v[5] == 1.0,
            guo_hall: v[6] == 1.0,
            auto_threshold: v[7] == 1.0,
            threshold: v[8],
            invert: v[9] == 1.0,
            blur: v[10],
            despeckle: v[11],
            smoothing: v[12],
            tolerance: v[13],
            auto_min: v[14] == 1.0,
            min_segment: v[15],
            corner_angle: v[16],
            use_lines: v[17] == 1.0,
            use_arcs: v[18] == 1.0,
            use_circles: v[19] == 1.0,
            include_splines: v[20] == 1.0,
            use_splines: v[21] == 1.0,
        })
    }
    fn fit_options(&self) -> FitOptions {
        FitOptions {
            tolerance: self.tolerance.max(0.1),
            min_segment: if self.auto_min {
                8.0_f64
                    .max(self.tolerance * 5.0)
                    .max(p(self.width as f64, self.height as f64).scaled_length() * 0.01)
            } else {
                self.min_segment
            },
            corner_angle: self.corner_angle,
            smoothing: self.smoothing,
            use_splines: self.use_splines,
            min_radius: (self.tolerance * 2.0).max(1.05 / self.pixel_size.max(1e-9)),
            max_radius: p(self.width as f64, self.height as f64 * self.y_scale).scaled_length()
                * 3.0,
        }
    }
}
pub enum SegmentKind {
    Line,
    Arc { circle: Circle, mid: Point2 },
    Spline(Spline),
}
pub struct Segment {
    pub a: usize,
    pub b: usize,
    pub kind: SegmentKind,
}
pub struct Path {
    pub segments: Vec<Segment>,
    pub closed: bool,
    pub tangent: Vec<bool>,
}
#[derive(Default)]
pub struct Trace {
    pub threshold: f64,
    pub vertices: Vec<Point2>,
    pub paths: Vec<Path>,
    pub circles: Vec<Circle>,
    pub closed_splines: Vec<Spline>,
}
struct Builder {
    result: Trace,
    options: FitOptions,
}
impl Builder {
    fn vertex(&mut self, pt: Point2) -> usize {
        self.result.vertices.push(pt);
        self.result.vertices.len() - 1
    }
    fn closed(&mut self, mut points: Vec<Point2>) -> Result<(), &'static str> {
        if points.len() < 3 {
            return Ok(());
        }
        points.push(points[0]);
        let length = fit::polyline_length(&points);
        points.pop();
        if length < self.options.min_segment {
            return Ok(());
        }
        if let Some(c) = fit::detect_circle(&points, &self.options) {
            if self.options.use_splines {
                self.result.closed_splines.push(fit::circle_spline(c));
            } else {
                self.result.circles.push(c);
            }
            return Ok(());
        }
        let Some(fitted) = fit::fit_polyline(&points, true, &self.options)? else {
            return Ok(());
        };
        if fitted.pieces.len() == 1 {
            if let Kind::Spline(mut s) = fitted.pieces[0].kind.clone() {
                s.points.pop();
                s.handles.pop();
                self.result.closed_splines.push(s);
                return Ok(());
            }
        }
        let vertices: Vec<_> = fitted
            .pieces
            .iter()
            .map(|p| self.vertex(fitted.points[p.start]))
            .collect();
        let last = vertices[0];
        self.path(fitted, vertices, last);
        Ok(())
    }
    fn open(&mut self, points: Vec<Point2>, a: usize, b: usize) -> Result<(), &'static str> {
        if let Some(fitted) = fit::fit_polyline(&points, false, &self.options)? {
            let vertices = fitted
                .pieces
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    if i == 0 {
                        a
                    } else {
                        self.vertex(fitted.points[p.start])
                    }
                })
                .collect();
            self.path(fitted, vertices, b);
        }
        Ok(())
    }
    fn path(&mut self, fitted: Fitted, vertices: Vec<usize>, last: usize) {
        let tangent = fitted
            .pieces
            .iter()
            .enumerate()
            .map(|(i, piece)| {
                if fitted.corners[i] {
                    return false;
                }
                let previous = if i > 0 {
                    Some(i - 1)
                } else if fitted.closed {
                    Some(fitted.pieces.len() - 1)
                } else {
                    None
                };
                let Some(previous) = previous.filter(|&p| p != i) else {
                    return false;
                };
                let prev = &fitted.pieces[previous];
                if matches!(prev.kind, Kind::Spline(_))
                    || matches!(piece.kind, Kind::Spline(_))
                    || (matches!(prev.kind, Kind::Line) && matches!(piece.kind, Kind::Line))
                {
                    return false;
                }
                let incoming = fit::end_direction(&fitted.points, prev, false);
                let outgoing = fit::end_direction(&fitted.points, piece, true);
                incoming.dot(outgoing)
                    > (12.0_f64.min(self.options.corner_angle / 2.0) * PI / 180.0).cos()
            })
            .collect();
        let segments = fitted
            .pieces
            .into_iter()
            .enumerate()
            .map(|(i, piece)| {
                let a = vertices[i];
                let b = vertices.get(i + 1).copied().unwrap_or(last);
                let kind = match piece.kind {
                    Kind::Line => SegmentKind::Line,
                    Kind::Arc(circle) => SegmentKind::Arc {
                        circle,
                        mid: fitted.points[(piece.start + piece.end).div_ceil(2)],
                    },
                    Kind::Spline(mut s) => {
                        s.points = s.points[1..s.points.len() - 1].to_vec();
                        SegmentKind::Spline(s)
                    }
                };
                Segment { a, b, kind }
            })
            .collect();
        self.result.paths.push(Path {
            segments,
            closed: fitted.closed,
            tangent,
        });
    }
}
pub fn trace(gray: &[f32], s: &Settings) -> Result<Trace, &'static str> {
    if gray.len() != s.width * s.height
        || gray
            .iter()
            .any(|v| !v.is_finite() || *v < 0.0 || *v > 255.0)
    {
        return Err("Invalid image trace grayscale raster");
    }
    let (w, h) = (s.width, s.height);
    let blurred = raster::blur(gray, w, h, s.blur);
    let threshold = if s.auto_threshold {
        raster::otsu(&blurred)
    } else {
        s.threshold
    };
    let mask = blurred
        .iter()
        .map(|&v| u8::from(((v as f64) < threshold) != s.invert))
        .collect();
    let mask = raster::despeckle(mask, w, h, s.despeckle.round());
    let mut b = Builder {
        result: Trace {
            threshold,
            ..Trace::default()
        },
        options: s.fit_options(),
    };
    let scale = |mut points: Vec<Point2>| {
        for p in &mut points {
            p.y *= s.y_scale;
        }
        points
    };
    if !s.centerline {
        let contours = if s.pixel_edges {
            contours::pixel_edges(&mask, w, h)
        } else {
            let field: Vec<_> = mask.iter().map(|&v| v as f32).collect();
            contours::marching(&raster::blur(&field, w, h, 0.8), w, h, 0.5)
        };
        for points in contours {
            b.closed(scale(points))?;
        }
    } else {
        let skeleton = skeleton::thin(&mask, w, h, s.guo_hall);
        let graph = skeleton::prune(
            skeleton::graph(&skeleton, w, h),
            (b.options.min_segment * 0.75).max(b.options.tolerance * 3.0),
        );
        let mut vertices = vec![None; graph.nodes.len()];
        for edge in graph.edges {
            let points = scale(edge.points);
            if fit::polyline_length(&points) < b.options.tolerance * 2.0 {
                continue;
            }
            let mut ends = [0; 2];
            for (i, node) in [edge.a, edge.b].into_iter().enumerate() {
                ends[i] = *vertices[node].get_or_insert_with(|| {
                    let pt = graph.nodes[node];
                    b.vertex(p(pt.x, pt.y * s.y_scale))
                });
            }
            b.open(points, ends[0], ends[1])?;
        }
        for points in graph.loops {
            b.closed(scale(points))?;
        }
    }
    Ok(filter(b.result, s))
}
fn filter(mut t: Trace, s: &Settings) -> Trace {
    if s.use_splines || (s.use_lines && s.use_arcs && s.use_circles && s.include_splines) {
        return t;
    }
    let included = |kind: &SegmentKind| match kind {
        SegmentKind::Line => s.use_lines,
        SegmentKind::Arc { .. } => s.use_arcs,
        SegmentKind::Spline(_) => s.include_splines,
    };
    let mut paths = Vec::new();
    for mut original in t.paths {
        let Some(gap) = original
            .segments
            .iter()
            .position(|seg| !included(&seg.kind))
        else {
            paths.push(original);
            continue;
        };
        let start = if original.closed { gap + 1 } else { 0 };
        let n = original.segments.len();
        if n == 0 {
            continue;
        }
        original.segments.rotate_left(start % n);
        original.tangent.rotate_left(start % n);
        let mut active: Option<Path> = None;
        for (seg, tangent) in original.segments.into_iter().zip(original.tangent) {
            if !included(&seg.kind) {
                if let Some(path) = active.take() {
                    paths.push(path);
                }
                continue;
            }
            let path = active.get_or_insert_with(|| Path {
                segments: Vec::new(),
                closed: false,
                tangent: Vec::new(),
            });
            path.tangent.push(!path.segments.is_empty() && tangent);
            path.segments.push(seg);
        }
        if let Some(path) = active {
            paths.push(path);
        }
    }
    t.paths = paths;
    if !s.use_circles {
        t.circles.clear();
    }
    if !s.include_splines {
        t.closed_splines.clear();
    }
    t
}
