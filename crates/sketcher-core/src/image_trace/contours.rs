use crate::{p, Point2};
use std::collections::HashMap;
pub fn marching(field: &[f32], w: usize, h: usize, iso: f64) -> Vec<Vec<Point2>> {
    let pw = w + 2;
    let off = pw * (h + 2);
    let value = |i: isize, j: isize| {
        if i < 0 || j < 0 || i >= w as isize || j >= h as isize {
            0.0_f64.min(iso - 1.0)
        } else {
            field[j as usize * w + i as usize] as f64
        }
    };
    let edge_id = |i: isize, j: isize, e: usize| match e {
        0 => (j + 1) as usize * pw + (i + 1) as usize,
        2 => (j + 2) as usize * pw + (i + 1) as usize,
        3 => off + (j + 1) as usize * pw + (i + 1) as usize,
        _ => off + (j + 1) as usize * pw + (i + 2) as usize,
    };
    let point = |i: isize, j: isize, e: usize| {
        let (i0, j0, i1, j1) = match e {
            0 => (i, j, i + 1, j),
            2 => (i, j + 1, i + 1, j + 1),
            3 => (i, j, i, j + 1),
            _ => (i + 1, j, i + 1, j + 1),
        };
        let (a, b) = (value(i0, j0), value(i1, j1));
        let t = if (b - a).abs() < 1e-12 {
            0.5
        } else {
            ((iso - a) / (b - a)).clamp(0.0, 1.0)
        };
        p(
            i0 as f64 + (i1 - i0) as f64 * t + 0.5,
            j0 as f64 + (j1 - j0) as f64 * t + 0.5,
        )
    };
    let mut starts = HashMap::new();
    let mut order = Vec::new();
    let mut ends = Vec::new();
    let mut points = HashMap::new();
    for j in -1..h as isize {
        for i in -1..w as isize {
            let c = [
                value(i, j),
                value(i + 1, j),
                value(i + 1, j + 1),
                value(i, j + 1),
            ];
            let mut ix = 0;
            for (k, v) in c.iter().enumerate() {
                if *v > iso {
                    ix |= 1 << k;
                }
            }
            let center = (c[0] + c[1] + c[2] + c[3]) / 4.0 > iso;
            let segments: &[(usize, usize, usize)] = match ix {
                0 | 15 => &[],
                1 => &[(3, 0, 0)],
                2 => &[(0, 1, 1)],
                3 => &[(3, 1, 0)],
                4 => &[(1, 2, 2)],
                5 if center => &[(0, 1, 1), (2, 3, 3)],
                5 => &[(3, 0, 0), (1, 2, 2)],
                6 => &[(0, 2, 1)],
                7 => &[(3, 2, 3)],
                8 => &[(2, 3, 3)],
                9 => &[(0, 2, 0)],
                10 if center => &[(3, 0, 0), (1, 2, 2)],
                10 => &[(0, 1, 1), (2, 3, 3)],
                11 => &[(1, 2, 2)],
                12 => &[(3, 1, 3)],
                13 => &[(0, 1, 1)],
                14 => &[(3, 0, 0)],
                _ => unreachable!(),
            };
            for &(a, b, r) in segments {
                let (ia, ib) = (edge_id(i, j, a), edge_id(i, j, b));
                let pa = *points.entry(ia).or_insert_with(|| point(i, j, a));
                let pb = *points.entry(ib).or_insert_with(|| point(i, j, b));
                let rp = p(
                    i as f64 + if r == 1 || r == 2 { 1.0 } else { 0.0 } + 0.5,
                    j as f64 + if r >= 2 { 1.0 } else { 0.0 } + 0.5,
                );
                let cross = (pb - pa).cross(rp - pa);
                let forward = if (ix >> r) & 1 != 0 {
                    cross > 0.0
                } else {
                    cross < 0.0
                };
                let (from, to) = if forward { (ia, ib) } else { (ib, ia) };
                if !starts.contains_key(&from) {
                    order.push(from);
                }
                starts.insert(from, ends.len());
                ends.push(to);
            }
        }
    }
    let mut used = vec![false; ends.len()];
    let mut out = Vec::new();
    for start in order {
        let mut edge = start;
        let mut contour = Vec::new();
        while let Some(&s) = starts.get(&edge) {
            if used[s] {
                break;
            }
            used[s] = true;
            contour.push(points[&edge]);
            edge = ends[s];
        }
        if contour.len() >= 3 {
            out.push(contour);
        }
    }
    out
}
pub fn pixel_edges(mask: &[u8], w: usize, h: usize) -> Vec<Vec<Point2>> {
    let fg = |x: isize, y: isize| {
        x >= 0
            && y >= 0
            && x < w as isize
            && y < h as isize
            && mask[y as usize * w + x as usize] == 1
    };
    let mut edges: Vec<(usize, usize, usize)> = Vec::new();
    let mut outgoing: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut add = |x0, y0, x1, y1, d| {
        let from = y0 * (w + 1) + x0;
        outgoing.entry(from).or_default().push(edges.len());
        edges.push((from, y1 * (w + 1) + x1, d));
    };
    for y in 0..h {
        for x in 0..w {
            if !fg(x as isize, y as isize) {
                continue;
            }
            if !fg(x as isize, y as isize - 1) {
                add(x, y, x + 1, y, 0);
            }
            if !fg(x as isize + 1, y as isize) {
                add(x + 1, y, x + 1, y + 1, 1);
            }
            if !fg(x as isize, y as isize + 1) {
                add(x + 1, y + 1, x, y + 1, 2);
            }
            if !fg(x as isize - 1, y as isize) {
                add(x, y + 1, x, y, 3);
            }
        }
    }
    let mut used = vec![false; edges.len()];
    let mut out = Vec::new();
    for start in 0..edges.len() {
        if used[start] {
            continue;
        }
        let mut corners = Vec::new();
        let mut edge = start;
        let mut prev = usize::MAX;
        while !used[edge] {
            used[edge] = true;
            let (from, to, d) = edges[edge];
            if d != prev {
                corners.push(p((from % (w + 1)) as f64, (from / (w + 1)) as f64));
            }
            prev = d;
            let candidates: Vec<_> = outgoing
                .get(&to)
                .into_iter()
                .flatten()
                .copied()
                .filter(|&e| !used[e])
                .collect();
            if candidates.is_empty() {
                break;
            }
            let mut next = candidates[0];
            if candidates.len() > 1 {
                for preferred in [(prev + 1) % 4, prev, (prev + 3) % 4] {
                    if let Some(&e) = candidates.iter().find(|&&e| edges[e].2 == preferred) {
                        next = e;
                        break;
                    }
                }
            }
            edge = next;
        }
        if corners.len() > 1 && edges[start].2 == prev {
            corners.remove(0);
        }
        if corners.len() >= 3 {
            out.push(corners);
        }
    }
    out
}
