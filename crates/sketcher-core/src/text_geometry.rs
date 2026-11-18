//! Text layout over font-extracted outlines; font parsing and SVG formatting stay with the caller.
use crate::{curve_path, regions::Geometry, Point2};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Command {
    Move(Point2),
    Line(Point2),
    Quad(Point2, Point2),
    Cubic(Point2, Point2, Point2),
    Close,
}
impl Command {
    fn map(self, transform: &mut impl FnMut(Point2) -> Point2) -> Self {
        match self {
            Self::Move(p) => Self::Move(transform(p)),
            Self::Line(p) => Self::Line(transform(p)),
            Self::Quad(a, p) => Self::Quad(transform(a), transform(p)),
            Self::Cubic(a, b, p) => Self::Cubic(transform(a), transform(b), transform(p)),
            Self::Close => Self::Close,
        }
    }
}
pub struct Glyph {
    pub line: usize,
    pub advance: f64,
    pub commands: Vec<Command>,
}
#[derive(Clone, Copy)]
pub enum Alignment {
    Left,
    Center,
    Right,
}
#[derive(Clone, Copy)]
pub enum VerticalAlignment {
    Top,
    Middle,
    Bottom,
}
#[derive(Clone, Copy)]
pub struct Metrics {
    pub units_per_em: f64,
    pub ascender: f64,
    pub descender: f64,
    pub cap_height: f64,
}
#[derive(Clone, Copy)]
pub struct Options {
    pub height: f64,
    pub character_spacing: f64,
    pub alignment: Alignment,
    pub vertical_alignment: VerticalAlignment,
    pub flip_horizontal: bool,
    pub flip_vertical: bool,
    pub fit_to_path: bool,
    pub below: bool,
    pub svg: bool,
    pub line_count: usize,
}
pub enum Target<'a> {
    Rectangle([Point2; 4]),
    Curve(&'a Geometry),
}

fn measure(glyphs: &[Glyph], scale: f64, spacing: f64) -> (Vec<f64>, Vec<f64>, f64) {
    let widths: Vec<_> = glyphs.iter().map(|g| g.advance * scale).collect();
    let gaps: Vec<_> = widths.iter().map(|w| w * spacing).collect();
    let mut total = 0.0;
    for (i, w) in widths.iter().enumerate() {
        total += w + if i < widths.len() - 1 { gaps[i] } else { 0.0 };
    }
    (widths, gaps, total)
}
fn append(
    output: &mut Vec<Command>,
    glyph: &Glyph,
    svg: bool,
    mut transform: impl FnMut(Point2) -> Point2,
) {
    output.extend(glyph.commands.iter().map(|c| {
        c.map(&mut |p| {
            let point = transform(p);
            if svg {
                point.flip_y()
            } else {
                point
            }
        })
    }));
}
fn unit(p: Point2) -> Point2 {
    let length = p.scaled_length();
    if length < 1e-12 {
        Point2::UNIT_X
    } else {
        p / length
    }
}

pub fn layout(
    glyphs: &[Glyph],
    metrics: Metrics,
    options: Options,
    target: Target<'_>,
) -> Result<Vec<Command>, &'static str> {
    let mut output = Vec::new();
    if options.height <= 0.0 {
        return Ok(output);
    }
    let scale = options.height / metrics.units_per_em;
    let spacing = options.character_spacing / 100.0;
    match target {
        Target::Rectangle([p0, p1, p2, p3]) => {
            let width = p0.scaled_distance(p1);
            let height = p0.scaled_distance(p3);
            if !width.is_finite() || !height.is_finite() {
                return Err("Non-finite text rectangle dimensions");
            }
            if width <= 1e-3 || height <= 1e-3 {
                return Ok(output);
            }
            let center = p0.middle(p2);
            let ux = unit(p1 - p0);
            let uy = unit(p0 - p3);
            let line_height = options.height * 1.25;
            let block_height = (options.line_count - 1) as f64 * line_height;
            let ascender = if metrics.ascender == 0.0 {
                metrics.units_per_em * 0.8
            } else {
                metrics.ascender
            } * scale;
            let descender = if metrics.descender == 0.0 {
                -metrics.units_per_em * 0.2
            } else {
                metrics.descender
            } * scale;
            let mid = (ascender + descender) / 2.0;
            let baseline = match options.vertical_alignment {
                VerticalAlignment::Top => height / 2.0 - 1.0 - ascender,
                VerticalAlignment::Bottom => -height / 2.0 + 1.0 - descender + block_height,
                VerticalAlignment::Middle => block_height / 2.0 - mid,
            };
            let top = baseline + ascender;
            let bottom = baseline - (options.line_count - 1) as f64 * line_height + descender;
            let block_center = (top + bottom) / 2.0;
            let mut begin = 0;
            while begin < glyphs.len() {
                let line = glyphs[begin].line;
                let mut end = begin + 1;
                while end < glyphs.len() && glyphs[end].line == line {
                    end += 1;
                }
                let run = &glyphs[begin..end];
                let (widths, gaps, total) = measure(run, scale, spacing);
                let start = match options.alignment {
                    Alignment::Left => -width / 2.0 + 1.0,
                    Alignment::Center => -total / 2.0,
                    Alignment::Right => width / 2.0 - total - 1.0,
                };
                let line_baseline = baseline - line as f64 * line_height;
                let mut current = start;
                for (i, glyph) in run.iter().enumerate() {
                    append(&mut output, glyph, options.svg, |p| {
                        let mut x = current + p.x;
                        let mut y = line_baseline - p.y;
                        if options.flip_horizontal {
                            x = 2.0 * start + total - x;
                        }
                        if options.flip_vertical {
                            y = 2.0 * block_center - y;
                        }
                        center + ux * x + uy * y
                    });
                    current += widths[i] + if i < run.len() - 1 { gaps[i] } else { 0.0 };
                }
                begin = end;
            }
        }
        Target::Curve(curve) => {
            if glyphs.is_empty() {
                return Ok(output);
            }
            let path = curve_path::prepare(curve);
            if [path.length, path.period, path.begin, path.direction]
                .iter()
                .any(|v| !v.is_finite())
            {
                return Err("Non-finite text curve metrics");
            }
            if path.length <= 1e-3 {
                return Ok(output);
            }
            let (widths, gaps, mut total) = measure(glyphs, scale, spacing);
            let open_path = matches!(curve, Geometry::Segment(..) | Geometry::Spline(_, false));
            let mut extra_gap = 0.0;
            if options.fit_to_path {
                if glyphs.len() > 1 {
                    let unspaced: f64 = widths.iter().sum();
                    extra_gap = (path.length - unspaced) / (glyphs.len() - 1).max(1) as f64;
                }
                total = path.length;
            }
            let remaining = path.length - total;
            let aligned_span = if open_path {
                remaining
            } else {
                remaining.max(0.0)
            };
            let start = if options.fit_to_path {
                0.0
            } else {
                match options.alignment {
                    Alignment::Left => 0.0,
                    Alignment::Center => aligned_span / 2.0,
                    Alignment::Right => aligned_span,
                }
            };
            let mut normal_offset = if options.below {
                -metrics.cap_height * scale
            } else {
                0.5
            };
            if options.flip_vertical {
                normal_offset = if options.below {
                    0.0
                } else {
                    metrics.cap_height * scale
                };
            }
            let normal_direction = if options.flip_vertical { 1.0 } else { -1.0 };
            let mut current = start;
            for (i, glyph) in glyphs.iter().enumerate() {
                let mid = current + widths[i] / 2.0;
                current += widths[i]
                    + if options.fit_to_path {
                        extra_gap
                    } else {
                        gaps[i]
                    };
                let distance = if options.flip_horizontal {
                    2.0 * start + total - mid
                } else {
                    mid
                };
                let mut frame = curve_path::sample(curve, &path, distance);
                if open_path && !options.fit_to_path && total > path.length {
                    // Keep the aligned run intact beyond an open path instead of piling glyphs at its ends.
                    let edge = distance.clamp(0.0, path.length);
                    frame.point += frame.tangent * (distance - edge);
                }
                let tangent = if options.flip_horizontal {
                    -frame.tangent
                } else {
                    frame.tangent
                };
                append(&mut output, glyph, options.svg, |p| {
                    let dx = p.x - widths[i] / 2.0;
                    let dy = normal_offset + normal_direction * p.y;
                    frame.point + tangent * dx + frame.normal * dy
                });
            }
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p;
    fn metrics() -> Metrics {
        Metrics {
            units_per_em: 1000.0,
            ascender: 800.0,
            descender: -200.0,
            cap_height: 700.0,
        }
    }
    fn options() -> Options {
        Options {
            height: 10.0,
            character_spacing: 0.0,
            alignment: Alignment::Left,
            vertical_alignment: VerticalAlignment::Middle,
            flip_horizontal: false,
            flip_vertical: false,
            fit_to_path: false,
            below: false,
            svg: false,
            line_count: 1,
        }
    }
    fn glyph(line: usize) -> Glyph {
        Glyph {
            line,
            advance: 600.0,
            commands: vec![
                Command::Move(p(0.0, 0.0)),
                Command::Quad(p(1.0, -3.0), p(3.0, -7.0)),
                Command::Cubic(p(4.0, -6.0), p(5.0, -4.0), p(6.0, 0.0)),
                Command::Close,
            ],
        }
    }

    #[test]
    fn rectangle_retains_baselines_and_empty_line_spacing() {
        let target = || Target::Rectangle([p(0.0, 20.0), p(40.0, 20.0), p(40.0, 0.0), p(0.0, 0.0)]);
        let result = layout(&[glyph(0)], metrics(), options(), target()).unwrap();
        assert_eq!(result[0], Command::Move(p(1.0, 7.0)));
        assert_eq!(result[1], Command::Quad(p(2.0, 10.0), p(4.0, 14.0)));
        let result = layout(
            &[glyph(0), glyph(2)],
            metrics(),
            Options {
                line_count: 3,
                ..options()
            },
            target(),
        )
        .unwrap();
        assert_eq!(result[0], Command::Move(p(1.0, 19.5)));
        assert_eq!(result[4], Command::Move(p(1.0, -5.5)));
    }
    #[test]
    fn path_fitting_and_both_flips_keep_the_glyph_command_structure() {
        let curve = Geometry::Segment(p(0.0, 0.0), p(20.0, 0.0));
        let result = layout(
            &[glyph(0), glyph(0)],
            metrics(),
            Options {
                fit_to_path: true,
                ..options()
            },
            Target::Curve(&curve),
        )
        .unwrap();
        assert_eq!(result[0], Command::Move(p(0.0, 0.5)));
        assert_eq!(result[4], Command::Move(p(14.0, 0.5)));
        let result = layout(
            &[glyph(0)],
            metrics(),
            Options {
                fit_to_path: true,
                flip_horizontal: true,
                flip_vertical: true,
                svg: true,
                ..options()
            },
            Target::Curve(&curve),
        )
        .unwrap();
        assert_eq!(result[0], Command::Move(p(20.0, -7.0)));
        assert_eq!(result[3], Command::Close);
    }
    #[test]
    fn zero_length_targets_produce_empty_geometry() {
        assert!(layout(
            &[glyph(0)],
            metrics(),
            options(),
            Target::Rectangle([Point2::ZERO; 4])
        )
        .unwrap()
        .is_empty());
        let curve = Geometry::Segment(Point2::ZERO, Point2::ZERO);
        assert!(
            layout(&[glyph(0)], metrics(), options(), Target::Curve(&curve))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn below_cap_line_touches_the_path_without_changing_flipped_baselines() {
        let curve = Geometry::Segment(p(0.0, 0.0), p(20.0, 0.0));
        for flip_horizontal in [false, true] {
            let below = layout(
                &[glyph(0)],
                metrics(),
                Options {
                    below: true,
                    flip_horizontal,
                    ..options()
                },
                Target::Curve(&curve),
            )
            .unwrap();
            assert!(matches!(below[0], Command::Move(p) if p.y == -7.0));
            assert!(matches!(below[1], Command::Quad(_, p) if p.y == 0.0));
            let flipped = layout(
                &[glyph(0)],
                metrics(),
                Options {
                    below: true,
                    flip_vertical: true,
                    flip_horizontal,
                    ..options()
                },
                Target::Curve(&curve),
            )
            .unwrap();
            assert!(matches!(flipped[0], Command::Move(p) if p.y == 0.0));
            assert!(matches!(flipped[1], Command::Quad(_, p) if p.y == -7.0));
        }
    }

    #[test]
    fn overlong_text_aligns_to_open_spline_ends_without_stacking_glyphs() {
        let curve = Geometry::Spline(
            vec![[p(0.0, 0.0), p(10.0, 0.0), p(20.0, 0.0), p(30.0, 0.0)]],
            false,
        );
        let glyphs: Vec<_> = (0..10).map(|_| glyph(0)).collect();
        for (alignment, start) in [
            (Alignment::Left, 0.0),
            (Alignment::Center, -15.0),
            (Alignment::Right, -30.0),
        ] {
            for flip_horizontal in [false, true] {
                let result = layout(
                    &glyphs,
                    metrics(),
                    Options {
                        alignment,
                        flip_horizontal,
                        ..options()
                    },
                    Target::Curve(&curve),
                )
                .unwrap();
                for i in 0..10 {
                    let Command::Move(point) = result[i * 4] else {
                        panic!("Expected glyph origin");
                    };
                    let expected = if flip_horizontal {
                        start + 60.0 - i as f64 * 6.0
                    } else {
                        start + i as f64 * 6.0
                    };
                    assert!((point.x - expected).abs() < 1e-12);
                    assert_eq!(point.y, 0.5);
                }
            }
        }
    }
}
