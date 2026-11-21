//! Region arrangement, graph traversal and exact boundary commands. Order and tolerances
//! follow math/regionsReference.ts; hash tables are used only for lookup, never traversal.
use crate::{angle, bezier, distance, intersect, p, spline, CubicBezier, Curve, Point2};
use std::borrow::Cow;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::f64::consts::{PI, TAU};
use std::hash::{BuildHasherDefault, Hasher};

#[derive(Default)]
struct FxHasher(u64);

impl Hasher for FxHasher {
    #[inline]
    fn finish(&self) -> u64 {
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = (self.0.rotate_left(5) ^ u64::from(b)).wrapping_mul(0x517c_c1b7_2722_0a95);
        }
    }
    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.0 = (self.0 ^ i.rotate_right(32)).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
    #[inline]
    fn write_i64(&mut self, i: i64) {
        self.write_u64(i as u64);
    }
}

type FxHashMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

enum CurvePrimitives {
    One([Curve; 1]),
    Many(Vec<Curve>),
}

impl CurvePrimitives {
    fn as_slice(&self) -> &[Curve] {
        match self {
            Self::One(one) => one,
            Self::Many(many) => many,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Geometry {
    Segment(Point2, Point2),
    Circle(Point2, f64),
    Ellipse(Point2, Point2, Point2),
    Arc(Point2, f64, Point2, Point2, bool),
    EllipticalArc(Point2, Point2, Point2, Point2, Point2, bool),
    Spline(Vec<CubicBezier>, bool),
}
#[derive(Clone, Debug)]
pub struct RegionCurve {
    pub id: usize,
    pub geometry: Geometry,
}
#[derive(Clone, Debug)]
pub struct Ring {
    pub points: Vec<Point2>,
    pub commands: Vec<f64>,
}
#[derive(Clone, Debug)]
pub struct Region {
    pub area: f64,
    pub rings: Vec<Ring>,
}

fn svg_angle(a: Point2, b: Point2) -> f64 {
    a.flip_y().angle_to(b.flip_y())
}
fn positive(value: f64) -> f64 {
    if value < 0.0 {
        value + TAU
    } else {
        value
    }
}
fn sweep(start: f64, end: f64, cw: bool) -> f64 {
    positive(if cw {
        (end - start) % TAU
    } else {
        (start - end) % TAU
    })
}
fn delta(start: f64, value: f64, cw: bool) -> f64 {
    sweep(start, value, cw)
}

#[derive(Clone, Copy)]
struct Ellipse {
    center: Point2,
    rx: f64,
    ry: f64,
    u: Point2,
    v: Point2,
}
impl Ellipse {
    fn new(center: Point2, major: Point2, minor: Point2) -> Self {
        let a = svg_angle(center, major);
        let u = Point2::from_polar(1.0, a);
        Self {
            center,
            rx: center.distance(major),
            ry: center.distance(minor),
            u,
            v: u.perp(),
        }
    }
    fn param(self, point: Point2) -> f64 {
        let d = (point - self.center).flip_y();
        (d.dot(self.v) / self.ry.max(1e-6)).atan2(d.dot(self.u) / self.rx.max(1e-6))
    }
    fn point(self, t: f64) -> Point2 {
        (self.center.flip_y() + self.u * (self.rx * t.cos()) + self.v * (self.ry * t.sin()))
            .flip_y()
    }
}
impl Geometry {
    fn periodic(&self) -> bool {
        matches!(
            self,
            Self::Circle(..) | Self::Ellipse(..) | Self::Spline(_, true)
        )
    }
    fn arc(&self) -> bool {
        matches!(self, Self::Arc(..) | Self::EllipticalArc(..))
    }
    fn period(&self) -> f64 {
        if matches!(self, Self::Circle(..) | Self::Ellipse(..)) {
            TAU
        } else {
            1.0
        }
    }
    fn ellipse(&self) -> Option<Ellipse> {
        match *self {
            Self::Ellipse(c, a, b) | Self::EllipticalArc(c, a, b, ..) => {
                Some(Ellipse::new(c, a, b))
            }
            _ => None,
        }
    }
    fn endpoints(&self) -> Option<(Point2, Point2)> {
        match *self {
            Self::Segment(a, b) => Some((a, b)),
            Self::Arc(_, _, a, b, _) | Self::EllipticalArc(_, _, _, a, b, _) => Some((a, b)),
            Self::Spline(ref segments, false) => {
                if let (Some(first), Some(last)) = (segments.first(), segments.last()) {
                    Some((first[0], last[3]))
                } else {
                    None
                }
            }
            _ => None,
        }
    }
    fn arc_angles(&self) -> (f64, f64, bool) {
        match *self {
            Self::Arc(c, _, a, b, cw) => (svg_angle(c, a), svg_angle(c, b), cw),
            Self::EllipticalArc(_, _, _, a, b, cw) => {
                let e = self.ellipse().unwrap();
                (e.param(a), e.param(b), cw)
            }
            _ => unreachable!(),
        }
    }
    pub(crate) fn point(&self, t: f64) -> Point2 {
        match *self {
            Self::Segment(a, b) => a.lerp(b, t.clamp(0.0, 1.0)),
            Self::Circle(c, r) => p(r * t.cos() + c.x, -(r * t.sin() + (-c.y))),
            Self::Ellipse(..) => self.ellipse().unwrap().point(t),
            Self::Arc(c, r, ..) => {
                let (a, b, cw) = self.arc_angles();
                let u = t.clamp(0.0, 1.0) * sweep(a, b, cw);
                let v = if cw { a + u } else { a - u };
                p(r * v.cos() + c.x, -(r * v.sin() + (-c.y)))
            }
            Self::EllipticalArc(..) => {
                let (a, b, cw) = self.arc_angles();
                let u = t.clamp(0.0, 1.0) * sweep(a, b, cw);
                self.ellipse()
                    .unwrap()
                    .point(if cw { a + u } else { a - u })
            }
            Self::Spline(ref segments, _) => spline::point_at(segments, t),
        }
    }
    pub(crate) fn param(&self, point: Point2) -> f64 {
        match *self {
            Self::Segment(a, b) => {
                let d = b - a;
                let l = d.length_squared();
                if l < 1e-12 {
                    0.0
                } else {
                    ((point - a).dot(d) / l).clamp(0.0, 1.0)
                }
            }
            Self::Circle(c, _) => positive(svg_angle(c, point)),
            Self::Ellipse(..) => positive(self.ellipse().unwrap().param(point)),
            Self::Arc(c, _, _, _, cw) => {
                let (a, b, _) = self.arc_angles();
                let span = sweep(a, b, cw);
                if span < 1e-6 {
                    0.0
                } else {
                    (delta(a, svg_angle(c, point), cw) / span).clamp(0.0, 1.0)
                }
            }
            Self::EllipticalArc(_, _, _, _, _, cw) => {
                let (a, b, _) = self.arc_angles();
                let span = sweep(a, b, cw);
                if span < 1e-6 {
                    0.0
                } else {
                    (delta(a, self.ellipse().unwrap().param(point), cw) / span).clamp(0.0, 1.0)
                }
            }
            Self::Spline(ref segments, _) => spline::project(segments, point).0,
        }
    }
    fn cut(&self, point: Point2) -> (f64, Point2) {
        if let Some((a, b)) = self.endpoints() {
            let tol = if let Self::Arc(_, r, ..) = *self {
                1e-3_f64.max(r * 2e-4)
            } else {
                2e-3
            };
            if distance(a, point) < tol {
                return (0.0, point);
            }
            if distance(b, point) < tol {
                return (1.0, point);
            }
        }
        (self.param(point), point)
    }
    fn contains(&self, point: Point2) -> bool {
        if !self.arc() {
            return true;
        }
        let (a, b, cw) = self.arc_angles();
        let (value, tol) = if let Self::Arc(c, r, ..) = *self {
            (svg_angle(c, point), 1e-3 / r.max(1.0))
        } else {
            let e = self.ellipse().unwrap();
            if e.rx < 1e-6 || e.ry < 1e-6 {
                return false;
            }
            (e.param(point), 1e-3 / e.rx.min(e.ry).max(1.0))
        };
        let d = delta(a, value, cw);
        d <= sweep(a, b, cw) + tol || d >= TAU - tol
    }
    fn curve_primitives(&self) -> CurvePrimitives {
        match *self {
            Self::Segment(p1, p2) => CurvePrimitives::One([Curve::Segment { p1, p2 }]),
            Self::Circle(center, radius) | Self::Arc(center, radius, ..) => {
                CurvePrimitives::One([Curve::Circle { center, radius }])
            }
            Self::Ellipse(center, major_axis_point, minor_axis_point)
            | Self::EllipticalArc(center, major_axis_point, minor_axis_point, ..) => {
                CurvePrimitives::One([Curve::Ellipse {
                    center,
                    major_axis_point,
                    minor_axis_point,
                }])
            }
            Self::Spline(ref segments, _) => CurvePrimitives::Many(
                segments
                    .iter()
                    .map(|points| Curve::Bezier { points: *points })
                    .collect(),
            ),
        }
    }
    pub(crate) fn primitives(&self) -> Vec<Curve> {
        self.curve_primitives().as_slice().to_vec()
    }
    fn bounds(&self) -> Option<[f64; 4]> {
        let mut b = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        let mut add = |q: Point2| {
            b[0] = b[0].min(q.x);
            b[1] = b[1].min(q.y);
            b[2] = b[2].max(q.x);
            b[3] = b[3].max(q.y);
        };
        match *self {
            Self::Segment(a, c) => {
                add(a);
                add(c)
            }
            Self::Spline(ref segments, _) => {
                for s in segments {
                    for q in s {
                        add(*q)
                    }
                }
            }
            Self::Circle(c, r) | Self::Arc(c, r, ..) => {
                let d = Point2::new(r, r);
                add(c - d);
                add(c + d);
            }
            _ => {
                let e = self.ellipse().unwrap();
                let x = (e.rx * e.u.x).hypot(e.ry * e.v.x);
                let y = (e.rx * e.u.y).hypot(e.ry * e.v.y);
                let d = Point2::new(x, y);
                add(e.center - d);
                add(e.center + d);
            }
        }
        if let Some((a, c)) = self.endpoints() {
            add(a);
            add(c)
        }
        let extent = (b[2] - b[0]).max(b[3] - b[1]);
        let magnitude = b.iter().map(|v| v.abs()).fold(0.0, f64::max);
        if b.iter().any(|v| !v.is_finite()) || !extent.is_finite() {
            return None;
        }
        let padding = 1e-3_f64.max(extent * 1e-4) + magnitude * f64::EPSILON * 32.0;
        Some([
            b[0] - padding,
            b[1] - padding,
            b[2] + padding,
            b[3] + padding,
        ])
    }
}
fn may_intersect(a: &Geometry, b: &Geometry, aa: Option<[f64; 4]>, bb: Option<[f64; 4]>) -> bool {
    if (matches!(a, Geometry::Segment(..))
        && matches!(b, Geometry::Ellipse(..) | Geometry::EllipticalArc(..)))
        || (matches!(b, Geometry::Segment(..))
            && matches!(a, Geometry::Ellipse(..) | Geometry::EllipticalArc(..)))
    {
        return true;
    }
    match (aa, bb) {
        (Some(a), Some(b)) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]),
        _ => true,
    }
}
pub(crate) fn intersections(a: &Geometry, b: &Geometry, pa: &[Curve], pb: &[Curve]) -> Vec<Point2> {
    let (first, second) = if !matches!(a, Geometry::Spline(..)) && matches!(b, Geometry::Spline(..))
    {
        (pb, pa)
    } else {
        (pa, pb)
    };
    let mut result: Vec<Point2> = Vec::new();
    for x in first {
        for y in second {
            for q in intersect(*x, *y) {
                if a.contains(q) && b.contains(q) && !result.iter().any(|v| distance(*v, q) < 1e-4)
                {
                    result.push(q)
                }
            }
        }
    }
    result
}
#[inline]
fn round_key_f64(value: f64) -> f64 {
    let x = value * 1e5;
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}
fn key_component(value: f64) -> u64 {
    let n = round_key_f64(value);
    if n == 0.0 {
        0
    } else {
        n.to_bits()
    }
}
#[cfg(test)]
fn key(q: Point2) -> (u64, u64) {
    (key_component(q.x), key_component(q.y))
}
#[derive(Clone, Copy, Debug)]
struct Edge {
    curve: usize,
    t0: f64,
    t1: f64,
    from: usize,
}
#[derive(Clone)]
enum AdjList {
    Inline { len: u8, items: [(usize, usize); 2] },
    Heap(Vec<(usize, usize)>),
}
impl AdjList {
    #[inline]
    fn empty() -> Self {
        Self::Inline {
            len: 0,
            items: [(0, 0); 2],
        }
    }
    #[inline]
    fn as_slice(&self) -> &[(usize, usize)] {
        match self {
            Self::Inline { len, items } => &items[..*len as usize],
            Self::Heap(vec) => vec.as_slice(),
        }
    }
    #[inline]
    fn len(&self) -> usize {
        match self {
            Self::Inline { len, .. } => *len as usize,
            Self::Heap(vec) => vec.len(),
        }
    }
    #[inline]
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
    #[inline]
    fn push(&mut self, item: (usize, usize)) {
        match self {
            Self::Inline { len, items } => {
                let l = *len as usize;
                if l < 2 {
                    items[l] = item;
                    *len = (l + 1) as u8;
                } else {
                    let mut v = Vec::with_capacity(4);
                    v.push(items[0]);
                    v.push(items[1]);
                    v.push(item);
                    *self = Self::Heap(v);
                }
            }
            Self::Heap(vec) => vec.push(item),
        }
    }
    #[inline]
    fn retain(&mut self, mut f: impl FnMut((usize, usize)) -> bool) {
        match self {
            Self::Inline { len, items } => {
                let mut write = 0usize;
                for read in 0..*len as usize {
                    if f(items[read]) {
                        items[write] = items[read];
                        write += 1;
                    }
                }
                *len = write as u8;
            }
            Self::Heap(vec) => vec.retain(|&x| f(x)),
        }
    }
}
struct Graph {
    nodes: Vec<Point2>,
    node_keys: Vec<(i64, i64)>,
    next_in_cell: Vec<u32>,
    coarse: FxHashMap<(i64, i64), u32>,
    fallback_keys: FxHashMap<(u64, u64), usize>,
    adj: Vec<AdjList>,
    order: Vec<usize>,
    edges: Vec<Edge>,
}
impl Graph {
    fn with_capacity(nodes: usize) -> Self {
        Self {
            nodes: Vec::with_capacity(nodes),
            node_keys: Vec::with_capacity(nodes),
            next_in_cell: Vec::with_capacity(nodes),
            coarse: FxHashMap::with_capacity_and_hasher(nodes, Default::default()),
            fallback_keys: FxHashMap::default(),
            adj: Vec::with_capacity(nodes),
            order: Vec::with_capacity(nodes),
            edges: Vec::with_capacity(nodes),
        }
    }
    fn node_fallback(&mut self, q: Point2) -> usize {
        let k = (key_component(q.x), key_component(q.y));
        if let Some(&i) = self.fallback_keys.get(&k) {
            return i;
        }
        let x = f64::from_bits(k.0);
        let y = f64::from_bits(k.1);
        for dx in -1..=1 {
            for dy in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let xx = x + dx as f64;
                let yy = y + dy as f64;
                let near = (
                    if xx == 0.0 { 0 } else { xx.to_bits() },
                    if yy == 0.0 { 0 } else { yy.to_bits() },
                );
                if let Some(&i) = self.fallback_keys.get(&near) {
                    if distance(q, self.nodes[i]) <= 1e-5 {
                        return i;
                    }
                }
            }
        }
        let i = self.nodes.len();
        self.nodes.push(q);
        self.node_keys.push((i64::MIN, i64::MIN));
        self.next_in_cell.push(u32::MAX);
        self.adj.push(AdjList::empty());
        self.fallback_keys.insert(k, i);
        i
    }
    #[inline]
    fn node(&mut self, q: Point2) -> usize {
        // Coordinates within +/-4e10 stay exact in f64 after multiplying by 1e5 (< 2^52)
        // and fit cleanly in i64 for coarse bit-shifted cell hashing.
        if q.x.abs() >= 4e10 || q.y.abs() >= 4e10 {
            return self.node_fallback(q);
        }
        let nx = round_key_f64(q.x) as i64;
        let ny = round_key_f64(q.y) as i64;
        let cx = nx >> 10;
        let cy = ny >> 10;
        let rx = nx & 1023;
        let ry = ny & 1023;
        if rx > 0 && rx < 1023 && ry > 0 && ry < 1023 {
            match self.coarse.entry((cx, cy)) {
                Entry::Vacant(slot) => {
                    let i = self.nodes.len();
                    self.nodes.push(q);
                    self.node_keys.push((nx, ny));
                    self.next_in_cell.push(u32::MAX);
                    self.adj.push(AdjList::empty());
                    slot.insert(i as u32);
                    return i;
                }
                Entry::Occupied(mut occ) => {
                    let head = *occ.get();
                    let mut best_near: Option<(i8, i8, usize)> = None;
                    let mut cur = head;
                    while cur != u32::MAX {
                        let idx = cur as usize;
                        let (kx, ky) = self.node_keys[idx];
                        let dx = kx - nx;
                        let dy = ky - ny;
                        if dx == 0 && dy == 0 {
                            return idx;
                        }
                        if (-1..=1).contains(&dx)
                            && (-1..=1).contains(&dy)
                            && distance(q, self.nodes[idx]) <= 1e-5
                        {
                            let rank = (dx as i8, dy as i8);
                            if best_near.is_none_or(|(bdx, bdy, _)| rank < (bdx, bdy)) {
                                best_near = Some((dx as i8, dy as i8, idx));
                            }
                        }
                        cur = self.next_in_cell[idx];
                    }
                    if let Some((_, _, idx)) = best_near {
                        return idx;
                    }
                    let i = self.nodes.len();
                    self.nodes.push(q);
                    self.node_keys.push((nx, ny));
                    self.next_in_cell.push(head);
                    self.adj.push(AdjList::empty());
                    *occ.get_mut() = i as u32;
                    return i;
                }
            }
        }
        // Point lies on a coarse-cell boundary; inspect the 2 or 4 overlapping coarse cells.
        let xs: &[i64] = if rx == 0 {
            &[cx - 1, cx]
        } else if rx == 1023 {
            &[cx, cx + 1]
        } else {
            &[cx]
        };
        let ys: &[i64] = if ry == 0 {
            &[cy - 1, cy]
        } else if ry == 1023 {
            &[cy, cy + 1]
        } else {
            &[cy]
        };
        let mut best_near: Option<(i8, i8, usize)> = None;
        for &ccx in xs {
            for &ccy in ys {
                if let Some(&head) = self.coarse.get(&(ccx, ccy)) {
                    let mut cur = head;
                    while cur != u32::MAX {
                        let idx = cur as usize;
                        let (kx, ky) = self.node_keys[idx];
                        let dx = kx - nx;
                        let dy = ky - ny;
                        if dx == 0 && dy == 0 {
                            return idx;
                        }
                        if (-1..=1).contains(&dx)
                            && (-1..=1).contains(&dy)
                            && distance(q, self.nodes[idx]) <= 1e-5
                        {
                            let rank = (dx as i8, dy as i8);
                            if best_near.is_none_or(|(bdx, bdy, _)| rank < (bdx, bdy)) {
                                best_near = Some((dx as i8, dy as i8, idx));
                            }
                        }
                        cur = self.next_in_cell[idx];
                    }
                }
            }
        }
        if let Some((_, _, idx)) = best_near {
            return idx;
        }
        let i = self.nodes.len();
        self.nodes.push(q);
        self.node_keys.push((nx, ny));
        let prev_head = self.coarse.insert((cx, cy), i as u32).unwrap_or(u32::MAX);
        self.next_in_cell.push(prev_head);
        self.adj.push(AdjList::empty());
        i
    }
    fn add_nodes(&mut self, a: usize, b: usize, curve: usize, t0: f64, t1: f64) {
        if a == b {
            return;
        }
        let edge = Edge {
            curve,
            t0,
            t1,
            from: a,
        };
        if let Some(&(_, eid)) = self.adj[a].as_slice().iter().find(|&&(n, _)| n == b) {
            self.edges[eid] = edge;
            return;
        }
        let eid = self.edges.len();
        self.edges.push(edge);
        if self.adj[a].is_empty() {
            self.order.push(a);
        }
        self.adj[a].push((b, eid));
        if self.adj[b].is_empty() {
            self.order.push(b);
        }
        self.adj[b].push((a, eid));
    }
    fn remove_bridges(&mut self) {
        let mut discovery = vec![0u32; self.nodes.len()];
        let mut low = vec![0u32; self.nodes.len()];
        let mut time = 0u32;
        let mut is_bridge = vec![false; self.edges.len()];
        let mut stack: Vec<(usize, usize, usize)> = Vec::new();
        for &root in &self.order {
            if discovery[root] != 0 {
                continue;
            }
            time += 1;
            discovery[root] = time;
            low[root] = time;
            stack.push((root, 0, usize::MAX));
            while let Some(&(node, index, parent_edge)) = stack.last() {
                let parent = if stack.len() > 1 {
                    Some(stack[stack.len() - 2].0)
                } else {
                    None
                };
                let neighbors = self.adj[node].as_slice();
                if index == neighbors.len() {
                    stack.pop();
                    if let Some(parent) = parent {
                        low[parent] = low[parent].min(low[node]);
                        if low[node] > discovery[parent] {
                            is_bridge[parent_edge] = true;
                        }
                    }
                } else {
                    let (next, eid) = neighbors[index];
                    stack.last_mut().unwrap().1 += 1;
                    if Some(next) == parent {
                        continue;
                    }
                    if discovery[next] == 0 {
                        time += 1;
                        discovery[next] = time;
                        low[next] = time;
                        stack.push((next, 0, eid));
                    } else {
                        low[node] = low[node].min(discovery[next]);
                    }
                }
            }
        }
        for adj in &mut self.adj {
            adj.retain(|(_, eid)| !is_bridge[eid]);
        }
    }
}
fn area(points: &[Point2]) -> f64 {
    let mut a = 0.0;
    for i in 0..points.len() {
        let (x, y) = (points[i], points[(i + 1) % points.len()]);
        a += x.cross(y);
    }
    a / 2.0
}
fn inside(point: Point2, points: &[Point2]) -> bool {
    let mut yes = false;
    let mut j = points.len() - 1;
    for i in 0..points.len() {
        let (a, b) = (points[i], points[j]);
        if (a.y > point.y) != (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
        {
            yes = !yes
        }
        j = i;
    }
    yes
}

fn extract(segments: &[CubicBezier], a: f64, b: f64) -> Vec<CubicBezier> {
    crate::spline_editing::extract(segments, a, b)
        .pieces
        .into_iter()
        .map(|p| p.curve)
        .collect()
}
#[derive(Clone, Copy)]
struct Run {
    edge: Edge,
    forward: bool,
    a: f64,
    b: f64,
    start: usize,
    end: usize,
}
fn commands(
    points: &[Point2],
    edges: &[Edge],
    nodes: &[usize],
    curves: &[RegionCurve],
) -> Vec<f64> {
    let mut out = vec![0.0, points[0].x, points[0].y];
    let mut runs: Vec<Run> = vec![];
    let mut i = 0;
    while i < edges.len() {
        let edge = edges[i];
        let forward = nodes[i] == edge.from;
        let mut r = Run {
            edge,
            forward,
            a: if forward { edge.t0 } else { edge.t1 },
            b: if forward { edge.t1 } else { edge.t0 },
            start: i,
            end: (i + 1) % points.len(),
        };
        while i + 1 < edges.len() {
            let next = edges[i + 1];
            let f = nodes[i + 1] == next.from;
            let (a, b) = if f {
                (next.t0, next.t1)
            } else {
                (next.t1, next.t0)
            };
            if curves[next.curve].id != curves[r.edge.curve].id || (r.b - a).abs() > 1e-6 {
                break;
            }
            r.b = b;
            r.end = (i + 2) % points.len();
            i += 1;
        }
        runs.push(r);
        i += 1;
    }
    for r in runs {
        let g = &curves[r.edge.curve].geometry;
        let end = points[r.end];
        if matches!(g, Geometry::Segment(..)) {
            out.extend([1.0, end.x, end.y]);
            continue;
        }
        if let Geometry::Spline(segments, _) = g {
            let (lo, hi) = (r.a.min(r.b), r.a.max(r.b));
            let mut pieces = if hi <= 1.0 {
                extract(segments, lo, hi)
            } else {
                let mut p = extract(segments, lo % 1.0, 1.0);
                p.extend(extract(segments, 0.0, hi % 1.0));
                p
            };
            if !r.forward {
                pieces.reverse();
                for s in &mut pieces {
                    s.reverse()
                }
            }
            for (i, s) in pieces.iter().enumerate() {
                let e = if i + 1 == pieces.len() { end } else { s[3] };
                out.extend([2.0, s[1].x, s[1].y, s[2].x, s[2].y, e.x, e.y]);
            }
            continue;
        }
        let (rx, ry, rotation, sweep_flag) = match *g {
            Geometry::Circle(_, radius) => (radius, radius, 0.0, r.forward),
            Geometry::Arc(_, radius, _, _, cw) => (radius, radius, 0.0, cw == r.forward),
            Geometry::Ellipse(c, a, _) => {
                let e = g.ellipse().unwrap();
                (e.rx, e.ry, -(angle(c, a) * 180.0 / PI), r.forward)
            }
            Geometry::EllipticalArc(c, a, _, _, _, cw) => {
                let e = g.ellipse().unwrap();
                (e.rx, e.ry, -(angle(c, a) * 180.0 / PI), cw == r.forward)
            }
            _ => unreachable!(),
        };
        let span = (r.b - r.a).abs()
            * if g.arc() {
                if let Geometry::Arc(c, _, a, b, cw) = *g {
                    sweep(-angle(c, a), -angle(c, b), cw)
                } else {
                    let (a, b, cw) = g.arc_angles();
                    sweep(a, b, cw)
                }
            } else {
                1.0
            };
        let mut arc = |to: Point2, s: f64| {
            out.extend([
                3.0,
                rx,
                ry,
                rotation,
                if s > PI { 1.0 } else { 0.0 },
                if sweep_flag { 1.0 } else { 0.0 },
                to.x,
                to.y,
            ])
        };
        if distance(end, points[r.start]) < 1e-5 && span > PI * 1.99 {
            arc(g.point((r.a + r.b) / 2.0), span / 2.0);
            arc(end, span / 2.0)
        } else {
            arc(end, span)
        }
    }
    out.push(4.0);
    out
}

fn refine_segment_param(segment: &CubicBezier, point: Point2) -> f64 {
    let t = spline::project(&[*segment], point).0;
    let (mut a, mut b) = ((t - 0.05).max(0.0), (t + 0.05).min(1.0));
    for _ in 0..50 {
        let t1 = a + (b - a) * 0.382;
        let t2 = a + (b - a) * 0.618;
        if distance(bezier::evaluate(segment, t1), point)
            < distance(bezier::evaluate(segment, t2), point)
        {
            b = t2;
        } else {
            a = t1;
        }
    }
    (a + b) * 0.5
}

fn segment_bounds(segment: &CubicBezier) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for q in segment {
        b[0] = b[0].min(q.x);
        b[1] = b[1].min(q.y);
        b[2] = b[2].max(q.x);
        b[3] = b[3].max(q.y);
    }
    b
}

fn cubic_self_intersection(segment: &CubicBezier) -> Option<(Point2, f64, f64)> {
    let [p0, p1, p2, p3] = *segment;
    let a = -p0 + p1 * 3.0 - p2 * 3.0 + p3;
    let b = p0 * 3.0 - p1 * 6.0 + p2 * 3.0;
    let c = (p1 - p0) * 3.0;
    let denom = a.cross(b);
    let aa = a.length_squared();
    if denom.abs() < 1e-12 || aa < 1e-12 {
        return None;
    }
    let s = -a.cross(c) / denom;
    let p_val = s * s + (a.dot(b) * s + a.dot(c)) / aa;
    let disc = s * s - 4.0 * p_val;
    if disc <= 1e-12 {
        return None;
    }
    let root = disc.sqrt();
    let t1 = 0.5 * (s - root);
    let t2 = 0.5 * (s + root);
    if t1 < -1e-6 || t2 > 1.0 + 1e-6 || t2 - t1 <= 1e-4 {
        return None;
    }
    let u1 = t1.clamp(0.0, 1.0);
    let u2 = t2.clamp(0.0, 1.0);
    let q1 = bezier::evaluate(segment, u1);
    let q2 = bezier::evaluate(segment, u2);
    if distance(q1, q2) >= 1e-5 {
        return None;
    }
    Some((q1.middle(q2), u1, u2))
}

/// Returns `true` when two cubics that share an exact endpoint `shared` are strictly separated
/// across a line through `shared`. By the convex-hull property of Bézier curves, the only possible
/// intersection between them is `shared` itself.
fn separated_at_shared_endpoint(
    shared: Point2,
    a_other: [Point2; 3],
    b_other: [Point2; 3],
    a_adj: Point2,
    b_adj: Point2,
    a_far: Point2,
    b_far: Point2,
) -> bool {
    let va = a_adj - shared;
    let vb = b_adj - shared;
    let la = va.length();
    let lb = vb.length();
    let bisector_normal = if la > 1e-12 && lb > 1e-12 {
        vb * (1.0 / lb) - va * (1.0 / la)
    } else {
        Point2::new(0.0, 0.0)
    };
    let axes = [bisector_normal, vb, -va, b_far - a_far];
    for axis in axes {
        let len_sq = axis.length_squared();
        if len_sq <= 1e-24 {
            continue;
        }
        let eps = 1e-12 * len_sq.sqrt();
        if a_other.iter().all(|&q| (q - shared).dot(axis) < -eps)
            && b_other.iter().all(|&q| (q - shared).dot(axis) > eps)
        {
            return true;
        }
        if a_other.iter().all(|&q| (q - shared).dot(axis) > eps)
            && b_other.iter().all(|&q| (q - shared).dot(axis) < -eps)
        {
            return true;
        }
    }
    false
}

/// Ordered crossing points and normalized parameter pairs for an entire cubic spline.
/// Single-cubic loops precede ascending segment pairs; adjacent endpoints and closed seams are excluded.
pub fn spline_self_intersections(
    segments: &[CubicBezier],
    closed: bool,
) -> Vec<(Point2, f64, f64)> {
    let n = segments.len();
    if n == 0 {
        return Vec::new();
    }
    let mut hits = Vec::new();
    let nf = n as f64;
    for (a, seg) in segments.iter().enumerate() {
        if let Some((pt, u1, u2)) = cubic_self_intersection(seg) {
            hits.push((pt, (a as f64 + u1) / nf, (a as f64 + u2) / nf));
        }
    }
    if n < 2 {
        return hits;
    }
    let boxes: Vec<_> = segments.iter().map(segment_bounds).collect();
    for (a, ba) in boxes.iter().enumerate() {
        for (b, bb) in boxes.iter().enumerate().skip(a + 1) {
            if ba[2] < bb[0] - 1e-4
                || ba[0] > bb[2] + 1e-4
                || ba[3] < bb[1] - 1e-4
                || ba[1] > bb[3] + 1e-4
            {
                continue;
            }
            if b == a + 1 && segments[a][3] == segments[b][0] {
                let sa = segments[a];
                let sb = segments[b];
                if separated_at_shared_endpoint(
                    sa[3],
                    [sa[0], sa[1], sa[2]],
                    [sb[1], sb[2], sb[3]],
                    sa[2],
                    sb[1],
                    sa[0],
                    sb[3],
                ) {
                    continue;
                }
            } else if closed && a == 0 && b == n - 1 && segments[0][0] == segments[n - 1][3] {
                let sa = segments[0];
                let sb = segments[n - 1];
                if separated_at_shared_endpoint(
                    sa[0],
                    [sa[1], sa[2], sa[3]],
                    [sb[0], sb[1], sb[2]],
                    sa[1],
                    sb[2],
                    sa[3],
                    sb[0],
                ) {
                    continue;
                }
            }
            for hit in bezier::intersect_beziers(segments[a], segments[b]) {
                if b == a + 1 && distance(hit, segments[a][3]) < 1e-3 {
                    continue;
                }
                if closed && a == 0 && b == n - 1 && distance(hit, segments[0][0]) < 1e-3 {
                    continue;
                }
                let ta = refine_segment_param(&segments[a], hit);
                let tb = refine_segment_param(&segments[b], hit);
                let pa = bezier::evaluate(&segments[a], ta);
                let pb = bezier::evaluate(&segments[b], tb);
                if distance(pa, pb) >= 1e-5 {
                    continue;
                }
                hits.push((pa.middle(pb), (a as f64 + ta) / nf, (b as f64 + tb) / nf));
            }
        }
    }
    hits
}

fn split_self_intersecting_splines(curves: &[RegionCurve]) -> Cow<'_, [RegionCurve]> {
    let mut out: Option<Vec<RegionCurve>> = None;
    let mut next_id = curves.iter().map(|c| c.id).max().unwrap_or(0) + 1;
    for (curve_index, curve) in curves.iter().enumerate() {
        let Geometry::Spline(ref segments, closed) = curve.geometry else {
            if let Some(ref mut vec) = out {
                vec.push(curve.clone());
            }
            continue;
        };
        let self_hits = spline_self_intersections(segments, closed);
        let mut raw_cuts = Vec::with_capacity(self_hits.len() * 2);
        for (_, u, v) in self_hits {
            raw_cuts.push(u);
            raw_cuts.push(v);
        }
        raw_cuts.retain(|&t| t > 1e-5 && t < 1.0 - 1e-5);
        raw_cuts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let cuts: Vec<f64> = raw_cuts
            .iter()
            .enumerate()
            .filter(|(i, t)| *i == 0 || (**t - raw_cuts[i - 1]).abs() > 1e-6)
            .map(|(_, t)| *t)
            .collect();
        if cuts.is_empty() {
            if let Some(ref mut vec) = out {
                vec.push(curve.clone());
            }
            continue;
        }
        let vec = out.get_or_insert_with(|| curves[..curve_index].to_vec());
        let intervals: Vec<(f64, f64)> = if closed && cuts.len() >= 2 {
            (0..cuts.len())
                .map(|k| (cuts[k], cuts[(k + 1) % cuts.len()]))
                .collect()
        } else {
            let mut stops = Vec::with_capacity(cuts.len() + 2);
            stops.push(0.0);
            stops.extend_from_slice(&cuts);
            stops.push(1.0);
            stops.windows(2).map(|w| (w[0], w[1])).collect()
        };
        for (t0, t1) in intervals {
            let sub = extract(segments, t0, t1);
            if sub.is_empty() {
                continue;
            }
            let id = next_id;
            next_id += 1;
            vec.push(RegionCurve {
                id,
                geometry: Geometry::Spline(sub, false),
            });
        }
    }
    match out {
        Some(vec) => Cow::Owned(vec),
        None => Cow::Borrowed(curves),
    }
}

fn snap_intersection(a: &Geometry, b: &Geometry, q: Point2) -> Point2 {
    let mut best_dist = f64::INFINITY;
    let mut best_pt = q;
    for geom in [a, b] {
        if let Some((p1, p2)) = geom.endpoints() {
            let tol = if let Geometry::Arc(_, r, ..) = *geom {
                1e-3_f64.max(r * 2e-4)
            } else {
                2e-3
            };
            for pt in [p1, p2] {
                let d = distance(pt, q);
                if d < tol && d < best_dist {
                    best_dist = d;
                    best_pt = pt;
                }
            }
        }
    }
    best_pt
}

enum CurveSampler<'a> {
    Segment(Point2, Point2),
    Circle(Point2, f64),
    Ellipse(Ellipse),
    Arc {
        center: Point2,
        radius: f64,
        a: Point2,
        b: Point2,
        start: f64,
        span: f64,
        cw: bool,
    },
    EllipticalArc {
        ellipse: Ellipse,
        a: Point2,
        b: Point2,
        start: f64,
        span: f64,
        cw: bool,
    },
    Spline(&'a [CubicBezier], bool),
}

impl<'a> CurveSampler<'a> {
    fn new(geometry: &'a Geometry) -> Self {
        match *geometry {
            Geometry::Segment(a, b) => Self::Segment(a, b),
            Geometry::Circle(c, r) => Self::Circle(c, r),
            Geometry::Ellipse(c, major, minor) => Self::Ellipse(Ellipse::new(c, major, minor)),
            Geometry::Arc(center, radius, a, b, cw) => {
                let start = svg_angle(center, a);
                let span = sweep(start, svg_angle(center, b), cw);
                Self::Arc {
                    center,
                    radius,
                    a,
                    b,
                    start,
                    span,
                    cw,
                }
            }
            Geometry::EllipticalArc(c, major, minor, a, b, cw) => {
                let ellipse = Ellipse::new(c, major, minor);
                let start = ellipse.param(a);
                let span = sweep(start, ellipse.param(b), cw);
                Self::EllipticalArc {
                    ellipse,
                    a,
                    b,
                    start,
                    span,
                    cw,
                }
            }
            Geometry::Spline(ref segments, closed) => Self::Spline(segments, closed),
        }
    }

    fn sampled_point(&self, mut t: f64) -> Point2 {
        match *self {
            Self::Segment(a, b) => {
                if t <= 0.0 {
                    a
                } else if t >= 1.0 {
                    b
                } else {
                    a.lerp(b, t)
                }
            }
            Self::Circle(c, r) => p(r * t.cos() + c.x, -(r * t.sin() + (-c.y))),
            Self::Ellipse(e) => e.point(t),
            Self::Arc {
                center,
                radius,
                a,
                b,
                start,
                span,
                cw,
            } => {
                if t <= 0.0 {
                    return a;
                }
                if t >= 1.0 {
                    return b;
                }
                let u = t * span;
                let v = if cw { start + u } else { start - u };
                p(
                    radius * v.cos() + center.x,
                    -(radius * v.sin() + (-center.y)),
                )
            }
            Self::EllipticalArc {
                ellipse,
                a,
                b,
                start,
                span,
                cw,
            } => {
                if t <= 0.0 {
                    return a;
                }
                if t >= 1.0 {
                    return b;
                }
                let u = t * span;
                ellipse.point(if cw { start + u } else { start - u })
            }
            Self::Spline(segments, closed) => {
                if !closed {
                    if let (Some(first), Some(last)) = (segments.first(), segments.last()) {
                        if t <= 0.0 {
                            return first[0];
                        }
                        if t >= 1.0 {
                            return last[3];
                        }
                    }
                } else if !(0.0..=1.0).contains(&t) {
                    t = ((t % 1.0) + 1.0) % 1.0;
                }
                spline::point_at(segments, t)
            }
        }
    }
}

fn collect_candidate_pairs(
    curves: &[RegionCurve],
    bounds: &[Option<[f64; 4]>],
) -> Vec<(usize, usize)> {
    let n = curves.len();
    let mut pairs = Vec::new();
    if n < 24 {
        for i in 0..n {
            for j in i + 1..n {
                if curves[i].id != curves[j].id
                    && may_intersect(
                        &curves[i].geometry,
                        &curves[j].geometry,
                        bounds[i],
                        bounds[j],
                    )
                {
                    pairs.push((i, j));
                }
            }
        }
        return pairs;
    }
    let mut bounded = Vec::with_capacity(n);
    let mut unbounded = Vec::new();
    let mut segments = Vec::new();
    let mut ellipses = Vec::new();
    for (idx, c) in curves.iter().enumerate() {
        match bounds[idx] {
            Some(b) => bounded.push((b[0], b[2], b[1], b[3], idx)),
            None => unbounded.push(idx),
        }
        match c.geometry {
            Geometry::Segment(..) => segments.push(idx),
            Geometry::Ellipse(..) | Geometry::EllipticalArc(..) => ellipses.push(idx),
            _ => {}
        }
    }
    bounded.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
    for a in 0..bounded.len() {
        let (_, max_x_a, min_y_a, max_y_a, i) = bounded[a];
        let id_i = curves[i].id;
        for &(min_x_b, _, min_y_b, max_y_b, j) in &bounded[a + 1..] {
            if min_x_b > max_x_a {
                break;
            }
            if max_y_a < min_y_b || max_y_b < min_y_a || id_i == curves[j].id {
                continue;
            }
            pairs.push(if i < j { (i, j) } else { (j, i) });
        }
    }
    for &i in &unbounded {
        let id_i = curves[i].id;
        for (j, curve_j) in curves.iter().enumerate() {
            if i != j && id_i != curve_j.id {
                pairs.push(if i < j { (i, j) } else { (j, i) });
            }
        }
    }
    if !segments.is_empty() && !ellipses.is_empty() {
        for &i in &segments {
            let id_i = curves[i].id;
            for &j in &ellipses {
                if id_i != curves[j].id {
                    pairs.push(if i < j { (i, j) } else { (j, i) });
                }
            }
        }
    }
    pairs.sort_unstable();
    pairs.dedup();
    pairs
}

pub fn find_regions(curves: &[RegionCurve]) -> Vec<Region> {
    let curves_storage = split_self_intersecting_splines(curves);
    let curves: &[RegionCurve] = &curves_storage;
    let bounds: Vec<_> = curves.iter().map(|c| c.geometry.bounds()).collect();
    let primitives: Vec<_> = curves
        .iter()
        .map(|c| c.geometry.curve_primitives())
        .collect();
    let mut cuts = vec![vec![]; curves.len()];
    for (i, j) in collect_candidate_pairs(curves, &bounds) {
        for q in intersections(
            &curves[i].geometry,
            &curves[j].geometry,
            primitives[i].as_slice(),
            primitives[j].as_slice(),
        ) {
            let q = snap_intersection(&curves[i].geometry, &curves[j].geometry, q);
            cuts[i].push(curves[i].geometry.cut(q));
            cuts[j].push(curves[j].geometry.cut(q));
        }
    }
    let estimated_nodes: usize = curves
        .iter()
        .map(|c| match c.geometry {
            Geometry::Segment(..) => 2,
            Geometry::Arc(..) | Geometry::EllipticalArc(..) => 48,
            Geometry::Circle(..) | Geometry::Ellipse(..) | Geometry::Spline(..) => 96,
        })
        .sum();
    let mut graph = Graph::with_capacity(estimated_nodes);
    for (index, c) in curves.iter().enumerate() {
        let g = &c.geometry;
        let sampler = CurveSampler::new(g);
        let raw = &mut cuts[index];
        raw.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        // Compare to the preceding raw cut, not the preceding retained cut.
        let unique: Vec<_> = raw
            .iter()
            .enumerate()
            .filter(|(i, c)| *i == 0 || (c.0 - raw[i - 1].0).abs() > 1e-6)
            .map(|(_, c)| *c)
            .collect();
        let mut intervals = vec![];
        if g.periodic() {
            if unique.is_empty() {
                let p0 = sampler.sampled_point(0.0);
                intervals.push((0.0, p0, g.period(), p0))
            } else {
                for i in 0..unique.len() {
                    let a = unique[i];
                    let b = unique[(i + 1) % unique.len()];
                    intervals.push((
                        a.0,
                        a.1,
                        if i + 1 < unique.len() {
                            b.0
                        } else {
                            b.0 + g.period()
                        },
                        b.1,
                    ));
                }
            }
        } else {
            let mut all = Vec::with_capacity(unique.len() + 2);
            all.push((0.0, sampler.sampled_point(0.0)));
            all.extend(unique);
            all.push((1.0, sampler.sampled_point(1.0)));
            for w in all.windows(2) {
                intervals.push((w[0].0, w[0].1, w[1].0, w[1].1));
            }
        }
        for (t0, p0, t1, p1) in intervals {
            let count = if matches!(g, Geometry::Segment(..)) {
                1
            } else {
                (((if g.arc() { 48.0 } else { 96.0 }) * (t1 - t0).abs() / g.period())
                    .ceil()
                    .max(1.0)) as usize
            };
            let mut prev = p0;
            let mut prev_node: Option<usize> = None;
            for k in 1..=count {
                let next = if k == count {
                    p1
                } else {
                    sampler.sampled_point(t0 + ((t1 - t0) * k as f64) / count as f64)
                };
                if distance(prev, next) > 1e-7 {
                    let a = prev_node.unwrap_or_else(|| graph.node(prev));
                    let b = graph.node(next);
                    graph.add_nodes(
                        a,
                        b,
                        index,
                        t0 + ((t1 - t0) * (k - 1) as f64) / count as f64,
                        t0 + ((t1 - t0) * k as f64) / count as f64,
                    );
                    prev_node = Some(b);
                } else {
                    prev_node = None;
                }
                prev = next;
            }
        }
    }
    graph.remove_bridges();
    let around: Vec<AdjList> = graph
        .adj
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let slice = a.as_slice();
            if slice.len() <= 2 {
                return a.clone();
            }
            let origin = graph.nodes[i];
            let mut keyed: Vec<(usize, usize, f64)> = slice
                .iter()
                .map(|&(n, eid)| (n, eid, angle(origin, graph.nodes[n])))
                .collect();
            keyed.sort_by(|x, y| x.2.partial_cmp(&y.2).unwrap_or(std::cmp::Ordering::Equal));
            AdjList::Heap(keyed.into_iter().map(|(n, eid, _)| (n, eid)).collect())
        })
        .collect();
    let half_edge_count = graph.edges.len() * 2;
    let mut visited = vec![false; half_edge_count];
    let mut local_stamp = vec![0u32; half_edge_count];
    let mut stamp = 0u32;
    let mut local_hes = Vec::with_capacity(64);
    let mut loops: Vec<(Ring, f64)> = vec![];
    for &from in &graph.order {
        for &(to, start_eid) in graph.adj[from].as_slice() {
            let start_he = (start_eid << 1) | usize::from(from != graph.edges[start_eid].from);
            if visited[start_he] {
                continue;
            }
            stamp = stamp.wrapping_add(1);
            if stamp == 0 {
                local_stamp.fill(0);
                stamp = 1;
            }
            local_hes.clear();
            let (mut a, mut b, mut eid) = (from, to, start_eid);
            let mut points = vec![];
            let mut nodes = vec![];
            let mut edges = vec![];
            for _ in 0..10000 {
                let he = (eid << 1) | usize::from(a != graph.edges[eid].from);
                if local_stamp[he] == stamp {
                    break;
                }
                local_stamp[he] = stamp;
                local_hes.push(he);
                points.push(graph.nodes[a]);
                nodes.push(a);
                edges.push(graph.edges[eid]);
                let nexts = around[b].as_slice();
                let Some(index) = nexts.iter().position(|&(v, _)| v == a) else {
                    break;
                };
                let (next, next_eid) = nexts[(index + nexts.len() - 1) % nexts.len()];
                a = b;
                b = next;
                eid = next_eid;
                if a == from && b == to {
                    break;
                }
            }
            for &he in &local_hes {
                visited[he] = true;
            }
            if points.len() < 3 || a != from || b != to {
                continue;
            }
            let ar = area(&points);
            if ar <= 1e-7 {
                continue;
            }
            let commands = commands(&points, &edges, &nodes, curves);
            loops.push((Ring { points, commands }, ar));
        }
    }
    let loop_bounds: Vec<[f64; 4]> = loops
        .iter()
        .map(|(ring, _)| {
            let mut b = [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ];
            for q in &ring.points {
                b[0] = b[0].min(q.x);
                b[1] = b[1].min(q.y);
                b[2] = b[2].max(q.x);
                b[3] = b[3].max(q.y);
            }
            b
        })
        .collect();
    let mut sorted_x: Vec<Option<Vec<Point2>>> = vec![None; loops.len()];
    let mut parents = vec![None; loops.len()];
    const SHARED_BAND: f64 = 1.0001e-4;
    for i in 0..loops.len() {
        let (ref ring, ar) = loops[i];
        let rb = loop_bounds[i];
        let p0 = ring.points[0];
        let mut parent: Option<usize> = None;
        for j in 0..loops.len() {
            let other_ar = loops[j].1;
            if other_ar <= ar || parent.is_some_and(|p_idx| other_ar >= loops[p_idx].1) {
                continue;
            }
            let ob = loop_bounds[j];
            if p0.x < ob[0] - 1e-9
                || p0.x > ob[2] + 1e-9
                || p0.y < ob[1] - 1e-9
                || p0.y > ob[3] + 1e-9
            {
                continue;
            }
            let other = &loops[j].0;
            if !inside(p0, &other.points) {
                continue;
            }
            let shared = if rb[2] + SHARED_BAND < ob[0]
                || rb[0] - SHARED_BAND > ob[2]
                || rb[3] + SHARED_BAND < ob[1]
                || rb[1] - SHARED_BAND > ob[3]
            {
                false
            } else if other.points.len() <= 32 {
                ring.points
                    .iter()
                    .any(|p| other.points.iter().any(|q| p.distance(*q) < 1e-4))
            } else {
                let sorted = sorted_x[j].get_or_insert_with(|| {
                    let mut pts = other.points.clone();
                    pts.sort_unstable_by(|a, b| a.x.total_cmp(&b.x));
                    pts
                });
                ring.points.iter().any(|p| {
                    let lo = sorted.partition_point(|q| q.x < p.x - SHARED_BAND);
                    let hi_x = p.x + SHARED_BAND;
                    let mut k = lo;
                    while k < sorted.len() && sorted[k].x <= hi_x {
                        let q = sorted[k];
                        if (q.y - p.y).abs() < SHARED_BAND && p.distance(q) < 1e-4 {
                            return true;
                        }
                        k += 1;
                    }
                    false
                })
            };
            if !shared {
                parent = Some(j);
            }
        }
        parents[i] = parent;
    }
    loops
        .iter()
        .enumerate()
        .map(|(i, (ring, ar))| {
            let mut rings = vec![ring.clone()];
            let mut hole_area = 0.0;
            for (j, (hole, hole_ar)) in loops.iter().enumerate() {
                if parents[j] == Some(i) {
                    rings.push(hole.clone());
                    hole_area += hole_ar.abs();
                }
            }
            Region {
                area: ar - hole_area,
                rings,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn circle(id: usize, x: f64, r: f64) -> RegionCurve {
        RegionCurve {
            id,
            geometry: Geometry::Circle(p(x, 0.0), r),
        }
    }
    #[test]
    fn disconnected_nested_and_tangent_circles() {
        let r = find_regions(&[
            circle(0, 0.0, 10.0),
            circle(1, 0.0, 2.0),
            circle(2, 50.0, 1.0),
        ]);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].rings.len(), 2);
        assert_eq!(r[1].rings.len(), 1);
        assert_eq!(
            find_regions(&[circle(0, 0.0, 1.0), circle(1, 2.0, 1.0)]).len(),
            2
        );
    }
    #[test]
    fn js_rounds_negative_half_towards_positive_infinity() {
        assert_eq!(key(p(-0.000005, 0.0)), key(p(0.0, 0.0)));
        assert_eq!(key(p(-0.000015, 0.0)), key(p(-0.00001, 0.0)));
    }
    #[test]
    fn bridge_does_not_change_a_rectangle() {
        let mut c = vec![];
        let pts = [p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0), p(0.0, 10.0)];
        for i in 0..4 {
            c.push(RegionCurve {
                id: i,
                geometry: Geometry::Segment(pts[i], pts[(i + 1) % 4]),
            })
        }
        c.push(RegionCurve {
            id: 4,
            geometry: Geometry::Segment(pts[0], p(-5.0, -5.0)),
        });
        let r = find_regions(&c);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].area, 100.0);
    }
    #[test]
    fn region_issue_four_regions() {
        let pts = [
            p(-70.71325976904807, -48.951669519098786), // Point-27
            p(-17.100982328552572, -21.52799891578571), // Point-28
            p(74.04047285091734, 25.072922657761502),   // Point-55
            p(-70.71378470916424, -48.95193749047031),  // Point-29
            p(74.04047285089842, 25.072922657919527),   // Point-30
        ];
        let curves = vec![
            RegionCurve {
                id: 11,
                geometry: Geometry::Segment(pts[0], pts[1]),
            },
            RegionCurve {
                id: 25,
                geometry: Geometry::Segment(pts[1], pts[2]),
            },
            RegionCurve {
                id: 2,
                geometry: Geometry::Spline(
                    vec![[
                        pts[3],
                        p(-76.38805459910975, 31.402809214636047),
                        p(9.555917968086924, 72.31449478600706),
                        pts[4],
                    ]],
                    false,
                ),
            },
            RegionCurve {
                id: 3,
                geometry: Geometry::Spline(
                    vec![
                        [
                            pts[4],
                            p(81.29440434316525, -32.13563250820586),
                            p(33.23648165578342, -7.10041044590254),
                            p(-6.055887911150573e-14, -6.999998057749547),
                        ],
                        [
                            p(-6.055887911150573e-14, -6.999998057749547),
                            p(-33.23648161240703, -6.899585669729027),
                            p(-6.924328501645778, -74.75038210919845),
                            p(-41.7499107971143, -71.49998309632444),
                        ],
                        [
                            p(-41.7499107971143, -71.49998309632444),
                            p(-57.663650372955594, -70.01469555772024),
                            p(-66.22093107343193, -61.04675276832995),
                            pts[3],
                        ],
                    ],
                    false,
                ),
            },
        ];
        let r = find_regions(&curves);
        assert_eq!(r.len(), 4);
    }
    #[test]
    fn region_issue3_test() {
        let p27 = p(-70.71325927281734, -48.951670489171605);
        let p28 = p(-17.10397210470489, -21.522154268869784);
        let p56 = p(-17.09658295979887, -21.51837356748017);
        let p8 = p(-41.74991079711482, -71.49998309632997);
        let p29 = p(-70.71378470912933, -48.95193749045716);

        let curves = vec![
            RegionCurve {
                id: 11,
                geometry: Geometry::Segment(p27, p28),
            },
            RegionCurve {
                id: 4,
                geometry: Geometry::Spline(
                    vec![
                        [
                            p56,
                            p(-22.9479743699381, -41.22489824814197),
                            p(-17.37699860943317, -73.77479616458997),
                            p8,
                        ],
                        [
                            p8,
                            p(-57.66365037295553, -70.01469555771958),
                            p(-66.22093107339695, -61.046752768316956),
                            p29,
                        ],
                    ],
                    false,
                ),
            },
        ];
        let r = find_regions(&curves);
        assert_eq!(r.len(), 1);
    }
    fn self_test_line(a: Point2, b: Point2) -> CubicBezier {
        [a, a.lerp(b, 1.0 / 3.0), a.lerp(b, 2.0 / 3.0), b]
    }
    #[test]
    fn self_intersections_return_normalized_parameters_on_both_branches() {
        let segments = [
            self_test_line(p(-40.0, -30.0), p(40.0, 30.0)),
            self_test_line(p(-40.0, 30.0), p(40.0, -30.0)),
        ];
        let hits = spline_self_intersections(&segments, false);
        assert_eq!(hits.len(), 1);
        let (point, a, b) = hits[0];
        assert!(point.length() < 1e-8);
        assert!((a - 0.25).abs() < 1e-8 && (b - 0.75).abs() < 1e-8);
    }
    #[test]
    fn self_intersections_exclude_only_the_closed_seam_and_handle_empty_geometry() {
        assert!(spline_self_intersections(&[], false).is_empty());
        assert!(spline_self_intersections(&[[p(1.0, 2.0); 4]], true).is_empty());
        let segments = [
            self_test_line(p(-40.0, -30.0), p(40.0, 30.0)),
            self_test_line(p(-40.0, 30.0), p(-40.0, -30.0)),
        ];
        assert_eq!(spline_self_intersections(&segments, false).len(), 1);
        assert!(spline_self_intersections(&segments, true).is_empty());
    }
    #[test]
    fn self_intersections_detect_a_loop_within_one_cubic() {
        let curve = [p(0.0, 0.0), p(100.0, 100.0), p(-100.0, 100.0), p(50.0, 0.0)];
        let hits = spline_self_intersections(&[curve], false);
        assert_eq!(hits.len(), 1);
        let (point, a, b) = hits[0];
        assert!(a > 0.0 && a < b && b < 1.0);
        assert!(point.distance(bezier::evaluate(&curve, a)) < 1e-5);
        assert!(point.distance(bezier::evaluate(&curve, b)) < 1e-5);
    }
    #[test]
    fn adjacent_cubic_fast_rejection_skips_smooth_joins_but_catches_hairpin_crossings() {
        let smooth = [
            [p(0.0, 0.0), p(10.0, 5.0), p(20.0, 5.0), p(30.0, 0.0)],
            [p(30.0, 0.0), p(40.0, -5.0), p(50.0, -5.0), p(60.0, 0.0)],
        ];
        assert!(separated_at_shared_endpoint(
            smooth[0][3],
            [smooth[0][0], smooth[0][1], smooth[0][2]],
            [smooth[1][1], smooth[1][2], smooth[1][3]],
            smooth[0][2],
            smooth[1][1],
            smooth[0][0],
            smooth[1][3],
        ));
        assert!(spline_self_intersections(&smooth, false).is_empty());

        // Adjacent cubics sharing (10, 0) that loop back and cross each other near (0, 5).
        let hairpin = [
            [p(-10.0, 0.0), p(-10.0, 10.0), p(10.0, 10.0), p(10.0, 0.0)],
            [p(10.0, 0.0), p(10.0, -10.0), p(-15.0, 20.0), p(5.0, 15.0)],
        ];
        assert!(!separated_at_shared_endpoint(
            hairpin[0][3],
            [hairpin[0][0], hairpin[0][1], hairpin[0][2]],
            [hairpin[1][1], hairpin[1][2], hairpin[1][3]],
            hairpin[0][2],
            hairpin[1][1],
            hairpin[0][0],
            hairpin[1][3],
        ));
        let hits = spline_self_intersections(&hairpin, false);
        assert_eq!(hits.len(), 1);
        let (pt, a, b) = hits[0];
        assert!(pt.distance(spline::point_at(&hairpin, a)) < 1e-4);
        assert!(pt.distance(spline::point_at(&hairpin, b)) < 1e-4);
    }
}
