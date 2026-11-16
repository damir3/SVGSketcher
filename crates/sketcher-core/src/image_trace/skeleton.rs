use super::fit::polyline_length;
use crate::{p, Point2};
use std::collections::HashSet;
const RING: [(isize, isize); 8] = [
    (0, -1),
    (1, -1),
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
];
fn at(img: &[u8], w: usize, h: usize, x: isize, y: isize) -> u8 {
    if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
        0
    } else {
        img[y as usize * w + x as usize]
    }
}
pub fn thin(mask: &[u8], w: usize, h: usize, guo: bool) -> Vec<u8> {
    let mut img = mask.to_vec();
    let mut candidates: Vec<_> = (0..img.len()).filter(|&i| img[i] != 0).collect();
    let mut changed = true;
    let mut remove = Vec::new();
    while changed {
        changed = false;
        for pass in 0..2 {
            remove.clear();
            for &i in &candidates {
                if img[i] == 0 {
                    continue;
                }
                let (x, y) = ((i % w) as isize, (i / w) as isize);
                let ring = RING.map(|(dx, dy)| at(&img, w, h, x + dx, y + dy));
                let [p2, p3, p4, p5, p6, p7, p8, p9] = ring;
                let deletable = if guo {
                    let c = u8::from(p2 == 0 && (p3 | p4) != 0)
                        + u8::from(p4 == 0 && (p5 | p6) != 0)
                        + u8::from(p6 == 0 && (p7 | p8) != 0)
                        + u8::from(p8 == 0 && (p9 | p2) != 0);
                    let n = ((p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8))
                        .min((p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9));
                    let m = if pass == 0 {
                        (p6 | p7 | u8::from(p9 == 0)) & p8
                    } else {
                        (p2 | p3 | u8::from(p5 == 0)) & p4
                    };
                    c == 1 && (2..=3).contains(&n) && m == 0
                } else {
                    let b: u8 = ring.iter().sum();
                    if !(2..=6).contains(&b) {
                        continue;
                    }
                    let a = (0..8)
                        .filter(|&k| ring[k] == 0 && ring[(k + 1) % 8] != 0)
                        .count();
                    if a != 1 {
                        continue;
                    }
                    if pass == 0 {
                        p2 * p4 * p6 == 0 && p4 * p6 * p8 == 0
                    } else {
                        p2 * p4 * p8 == 0 && p2 * p6 * p8 == 0
                    }
                };
                if deletable {
                    remove.push(i);
                }
            }
            for &i in &remove {
                img[i] = 0;
            }
            changed |= !remove.is_empty();
        }
        if changed {
            candidates.retain(|&i| img[i] != 0);
        }
    }
    changed = true;
    while changed {
        changed = false;
        for i in 0..img.len() {
            if img[i] == 0 {
                continue;
            }
            let (x, y) = ((i % w) as isize, (i / w) as isize);
            let ring = RING.map(|(dx, dy)| at(&img, w, h, x + dx, y + dy));
            if ring.iter().sum::<u8>() < 2 {
                continue;
            }
            let mut seen = [false; 8];
            let mut groups = 0;
            for k in 0..8 {
                if ring[k] == 0 || seen[k] {
                    continue;
                }
                groups += 1;
                let mut stack = vec![k];
                seen[k] = true;
                while let Some(c) = stack.pop() {
                    for o in 0..8 {
                        if ring[o] == 0 || seen[o] {
                            continue;
                        }
                        if (RING[o].0 - RING[c].0).abs() <= 1 && (RING[o].1 - RING[c].1).abs() <= 1
                        {
                            seen[o] = true;
                            stack.push(o);
                        }
                    }
                }
            }
            if groups == 1 {
                img[i] = 0;
                changed = true;
            }
        }
    }
    img
}
#[derive(Clone)]
pub struct Edge {
    pub a: usize,
    pub b: usize,
    pub points: Vec<Point2>,
}
pub struct Graph {
    pub nodes: Vec<Point2>,
    pub edges: Vec<Edge>,
    pub loops: Vec<Vec<Point2>>,
}
fn neighbors(img: &[u8], w: usize, h: usize, i: usize) -> Vec<usize> {
    let (x, y) = ((i % w) as isize, (i / w) as isize);
    RING.iter()
        .filter_map(|&(dx, dy)| {
            let (xx, yy) = (x + dx, y + dy);
            if at(img, w, h, xx, yy) != 0 {
                Some(yy as usize * w + xx as usize)
            } else {
                None
            }
        })
        .collect()
}
pub fn graph(img: &[u8], w: usize, h: usize) -> Graph {
    let center = |i: usize| p((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
    let pixels: Vec<_> = (0..img.len()).filter(|&i| img[i] != 0).collect();
    let mut degree = vec![0; img.len()];
    for &i in &pixels {
        degree[i] = neighbors(img, w, h, i).len();
    }
    let mut node_of = vec![None; img.len()];
    let mut nodes = Vec::new();
    for &start in &pixels {
        if degree[start] == 2 || node_of[start].is_some() {
            continue;
        }
        let id = nodes.len();
        let mut stack = vec![start];
        node_of[start] = Some(id);
        let mut sum = Point2::ZERO;
        let mut count = 0;
        while let Some(i) = stack.pop() {
            sum += center(i);
            count += 1;
            for n in neighbors(img, w, h, i) {
                if degree[n] != 2 && node_of[n].is_none() {
                    node_of[n] = Some(id);
                    stack.push(n);
                }
            }
        }
        // JS divides coordinates individually here, rather than multiplying a vector by a reciprocal.
        nodes.push(p(sum.x / count as f64, sum.y / count as f64));
    }
    let mut visited = vec![false; img.len()];
    let mut edges = Vec::new();
    let mut direct_pairs = HashSet::new();
    for &start in &pixels {
        let Some(a) = node_of[start] else { continue };
        for first in neighbors(img, w, h, start) {
            if let Some(direct) = node_of[first] {
                if direct == a {
                    continue;
                }
                let key = (start.min(first), start.max(first));
                if !direct_pairs.insert(key) {
                    continue;
                }
                edges.push(Edge {
                    a,
                    b: direct,
                    points: vec![nodes[a], nodes[direct]],
                });
                continue;
            }
            if visited[first] {
                continue;
            }
            let mut points = vec![nodes[a]];
            let mut prev = start;
            let mut cur = first;
            let mut end = None;
            loop {
                visited[cur] = true;
                points.push(center(cur));
                let ns = neighbors(img, w, h, cur);
                let next = ns
                    .iter()
                    .copied()
                    .find(|&n| n != prev && !(node_of[n] == Some(a) && points.len() == 2))
                    .or_else(|| ns.iter().copied().find(|&n| n != prev));
                let Some(next) = next else { break };
                if node_of[next].is_some() {
                    end = node_of[next];
                    break;
                }
                if visited[next] {
                    break;
                }
                prev = cur;
                cur = next;
            }
            let Some(b) = end else { continue };
            if b == a && points.len() < 4 {
                continue;
            }
            points.push(nodes[b]);
            edges.push(Edge { a, b, points });
        }
    }
    let mut loops = Vec::new();
    for &start in &pixels {
        if visited[start] || degree[start] != 2 {
            continue;
        }
        let mut points = Vec::new();
        let mut prev = None;
        let mut cur = start;
        while !visited[cur] {
            visited[cur] = true;
            points.push(center(cur));
            let next = neighbors(img, w, h, cur)
                .into_iter()
                .find(|&n| Some(n) != prev && !visited[n]);
            let Some(next) = next else { break };
            prev = Some(cur);
            cur = next;
        }
        if points.len() >= 8 {
            loops.push(points);
        }
    }
    Graph {
        nodes,
        edges,
        loops,
    }
}
fn degrees(edges: &[Edge], n: usize) -> Vec<usize> {
    let mut out = vec![0; n];
    for e in edges {
        out[e.a] += 1;
        out[e.b] += 1;
    }
    out
}
pub fn prune(mut graph: Graph, spur: f64) -> Graph {
    for _ in 0..4 {
        let mut changed = false;
        let mut degree = degrees(&graph.edges, graph.nodes.len());
        graph.edges.retain(|e| {
            let free_a = degree[e.a] == 1;
            let free_b = degree[e.b] == 1;
            let keep = polyline_length(&e.points) >= spur
                || !((free_a && degree[e.b] >= 3)
                    || (free_b && degree[e.a] >= 3)
                    || (free_a && free_b));
            changed |= !keep;
            keep
        });
        degree = degrees(&graph.edges, graph.nodes.len());
        for node in 0..graph.nodes.len() {
            if degree[node] != 2 {
                continue;
            }
            let attached: Vec<_> = graph
                .edges
                .iter()
                .enumerate()
                .filter(|(_, e)| e.a == node || e.b == node)
                .map(|(i, _)| i)
                .collect();
            if attached.len() != 2 {
                continue;
            }
            let (i, j) = (attached[0], attached[1]);
            let first = &graph.edges[i];
            let second = &graph.edges[j];
            let mut points = first.points.clone();
            let a = if first.b == node {
                first.a
            } else {
                points.reverse();
                first.b
            };
            let mut tail = second.points.clone();
            let b = if second.a == node {
                second.b
            } else {
                tail.reverse();
                second.a
            };
            points.extend_from_slice(&tail[1..]);
            graph.edges.remove(j);
            graph.edges.remove(i);
            if a == node && b == node {
                points.pop();
                graph.loops.push(points);
            } else {
                graph.edges.push(Edge { a, b, points });
            }
            degree = degrees(&graph.edges, graph.nodes.len());
            changed = true;
        }
        if !changed {
            break;
        }
    }
    graph.loops.retain(|l| polyline_length(l) >= spur * 2.0);
    graph
}
