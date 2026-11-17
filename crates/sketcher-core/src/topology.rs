//! Coincidence reachability and ordered primitive incidence, independent of document IDs.
use crate::Point2;
use std::collections::HashMap;

#[derive(Clone, Copy)]
pub struct Node {
    pub position: Option<Point2>,
    pub listed: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Connection {
    pub primitive: usize,
    pub connected: usize,
    pub other: usize,
}
pub struct Group {
    pub members: Vec<usize>,
    pub connections: Vec<Connection>,
}
pub struct Snapshot {
    pub labels: Vec<usize>,
    pub groups: Vec<Group>,
}

fn cell(p: Point2, tolerance: f64) -> Option<(i64, i64)> {
    let (x, y) = ((p.x / tolerance).floor(), (p.y / tolerance).floor());
    // Keep integer-neighbor lookup exact; extreme coordinates use the conservative scan.
    (x.abs() <= (1_u64 << 50) as f64 && y.abs() <= (1_u64 << 50) as f64)
        .then_some((x as i64, y as i64))
}
fn near(a: Point2, b: Point2, tolerance: f64) -> bool {
    let d = b - a;
    d.x.abs() <= tolerance && d.y.abs() <= tolerance && d.scaled_length() <= tolerance
}

pub struct Graph {
    adjacency: Vec<Vec<usize>>,
}
impl Graph {
    /// Link order is constraint order, listed-point order, then the implicit origin.
    pub fn new(
        nodes: &[Node],
        links: &[[usize; 2]],
        origin: Option<usize>,
        tolerance: f64,
    ) -> Self {
        let mut adjacency = vec![vec![]; nodes.len()];
        for &[a, b] in links {
            adjacency[a].push(b);
            adjacency[b].push(a);
        }
        let listed: Vec<_> = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.listed && n.position.is_some())
            .map(|(i, _)| i)
            .collect();
        let mut buckets: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let mut extremes = vec![];
        for &i in &listed {
            if let Some(key) = cell(nodes[i].position.unwrap(), tolerance) {
                buckets.entry(key).or_default().push(i);
            } else {
                extremes.push(i);
            }
        }
        for (i, node) in nodes.iter().enumerate() {
            let Some(position) = node.position else {
                continue;
            };
            let mut candidates: Vec<usize> = vec![];
            if let Some((x, y)) = cell(position, tolerance) {
                // Two cells conservatively cover rounding of division near cell boundaries.
                for dx in -2..=2 {
                    for dy in -2..=2 {
                        if let Some(indices) = buckets.get(&(x + dx, y + dy)) {
                            candidates.extend(indices);
                        }
                    }
                }
                candidates.extend(&extremes);
                candidates.sort_unstable();
            } else {
                candidates.extend(&listed);
            }
            for j in candidates {
                if j != i && near(position, nodes[j].position.unwrap(), tolerance) {
                    adjacency[i].push(j);
                }
            }
            if let Some(origin) = origin {
                if origin != i && near(position, Point2::ZERO, tolerance) {
                    adjacency[i].push(origin);
                }
            }
        }
        Self { adjacency }
    }

    fn reach(&self, root: usize, seen: &mut [usize], stamp: usize) -> Vec<usize> {
        let mut result = vec![root];
        let mut stack = vec![root];
        seen[root] = stamp;
        while let Some(current) = stack.pop() {
            for &next in &self.adjacency[current] {
                if seen[next] != stamp {
                    seen[next] = stamp;
                    result.push(next);
                    stack.push(next);
                }
            }
        }
        result
    }

    pub fn group(&self, root: usize) -> Vec<usize> {
        self.reach(root, &mut vec![0; self.adjacency.len()], 1)
    }

    // Iterative Kosaraju preserves directed built-in-point behavior without recursion depth limits.
    fn components(&self) -> (Vec<usize>, Vec<usize>) {
        let n = self.adjacency.len();
        let mut visited = vec![false; n];
        let mut order = Vec::with_capacity(n);
        let mut reverse = vec![vec![]; n];
        for (a, neighbors) in self.adjacency.iter().enumerate() {
            for &b in neighbors {
                reverse[b].push(a);
            }
        }
        for root in 0..n {
            if visited[root] {
                continue;
            }
            visited[root] = true;
            let mut stack = vec![(root, 0)];
            while let Some((node, at)) = stack.last_mut() {
                if *at < self.adjacency[*node].len() {
                    let next = self.adjacency[*node][*at];
                    *at += 1;
                    if !visited[next] {
                        visited[next] = true;
                        stack.push((next, 0));
                    }
                } else {
                    order.push(*node);
                    stack.pop();
                }
            }
        }
        let mut labels = vec![usize::MAX; n];
        let mut roots = vec![];
        for root in order.into_iter().rev() {
            if labels[root] != usize::MAX {
                continue;
            }
            let label = roots.len();
            roots.push(root);
            labels[root] = label;
            let mut stack = vec![root];
            while let Some(node) = stack.pop() {
                for &next in &reverse[node] {
                    if labels[next] == usize::MAX {
                        labels[next] = label;
                        stack.push(next);
                    }
                }
            }
        }
        (labels, roots)
    }

    pub fn prepare(&self, endpoints: &[[usize; 2]]) -> Snapshot {
        let (labels, roots) = self.components();
        let mut incident = vec![vec![]; labels.len()];
        for (i, &[a, b]) in endpoints.iter().enumerate() {
            incident[a].push(i);
            incident[b].push(i);
        }
        let mut seen_points = vec![0; labels.len()];
        let mut seen_edges = vec![0; endpoints.len()];
        let groups = roots
            .iter()
            .enumerate()
            .map(|(label, &root)| {
                let stamp = label + 1;
                let mut members = self.reach(root, &mut seen_points, stamp);
                members.sort_unstable();
                let mut connections = vec![];
                for &point in &members {
                    for &primitive in &incident[point] {
                        if seen_edges[primitive] == stamp {
                            continue;
                        }
                        seen_edges[primitive] = stamp;
                        let [a, b] = endpoints[primitive];
                        let (in_a, in_b) = (seen_points[a] == stamp, seen_points[b] == stamp);
                        if in_a != in_b {
                            connections.push(Connection {
                                primitive,
                                connected: if in_a { a } else { b },
                                other: if in_a { b } else { a },
                            });
                        }
                    }
                }
                connections.sort_unstable_by_key(|c| c.primitive);
                Group {
                    members,
                    connections,
                }
            })
            .collect();
        Snapshot { labels, groups }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
    fn node(x: f64, y: f64) -> Node {
        Node {
            position: Some(p(x, y)),
            listed: true,
        }
    }

    #[test]
    fn preserves_transitive_tolerance_and_constraint_then_geometry_order() {
        let nodes = [
            node(10.0, 0.0),
            node(10.0008, 0.0),
            node(10.0016, 0.0),
            node(40.0, 0.0),
            node(50.0, 0.0),
        ];
        let graph = Graph::new(&nodes, &[[0, 3], [0, 4]], None, 0.001);
        assert_eq!(graph.group(0), vec![0, 3, 4, 1, 2]);
        let prepared = graph.prepare(&[[0, 1], [2, 3]]);
        assert_eq!(prepared.groups.len(), 1);
        assert!(prepared.groups[0].connections.is_empty());
    }

    #[test]
    fn built_in_axis_reachability_is_directed_and_connections_exclude_both_ends() {
        let nodes = [
            node(1.0, 0.0),
            node(5.0, 0.0),
            Node {
                position: Some(p(1.0, 0.0)),
                listed: false,
            },
        ];
        let graph = Graph::new(&nodes, &[], None, 0.001);
        assert_eq!(graph.group(0), vec![0]);
        assert_eq!(graph.group(2), vec![2, 0]);
        let snapshot = graph.prepare(&[[0, 1], [0, 2]]);
        assert_eq!(snapshot.groups[snapshot.labels[0]].connections.len(), 2);
        assert_eq!(
            snapshot.groups[snapshot.labels[2]].connections,
            vec![Connection {
                primitive: 0,
                connected: 0,
                other: 1
            }]
        );
    }

    #[test]
    fn long_constraint_chains_and_extreme_cells_do_not_overflow_or_recurse() {
        let nodes = vec![
            Node {
                position: None,
                listed: false
            };
            10000
        ];
        let links: Vec<_> = (1..nodes.len()).map(|i| [i - 1, i]).collect();
        let graph = Graph::new(&nodes, &links, None, 0.001);
        assert_eq!(graph.prepare(&[]).groups.len(), 1);
        let graph = Graph::new(
            &[node(1e200, 1e200), node(1e200, 1e200), node(-1e200, 1e200)],
            &[],
            None,
            0.001,
        );
        assert_eq!(graph.group(0), vec![0, 1]);
    }
}
