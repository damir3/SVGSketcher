use sketcher_core::{
    text_geometry::{self, Alignment, Command, Glyph, Metrics, Options, Target, VerticalAlignment},
    Point2,
};
use wasm_bindgen::prelude::*;

fn count(value: f64, max: usize) -> Result<usize, &'static str> {
    if value < 0.0 || value.fract() != 0.0 || value > max as f64 {
        return Err("Invalid text geometry count");
    }
    Ok(value as usize)
}
fn commands(data: &[f64], cursor: &mut usize, total: usize) -> Result<Vec<Command>, &'static str> {
    let mut result = Vec::with_capacity(total);
    for _ in 0..total {
        let tag = *data.get(*cursor).ok_or("Truncated text outline tag")?;
        *cursor += 1;
        let size = match tag {
            0.0 | 1.0 => 2,
            2.0 => 4,
            3.0 => 6,
            4.0 => 0,
            _ => return Err("Invalid text outline tag"),
        };
        let values = data
            .get(*cursor..*cursor + size)
            .ok_or("Truncated text outline coordinates")?;
        let point = |i| Point2 {
            x: values[i],
            y: values[i + 1],
        };
        result.push(match tag as u8 {
            0 => Command::Move(point(0)),
            1 => Command::Line(point(0)),
            2 => Command::Quad(point(0), point(2)),
            3 => Command::Cubic(point(0), point(2), point(4)),
            _ => Command::Close,
        });
        *cursor += size;
    }
    Ok(result)
}
fn execute(
    glyphs: &[f64],
    outlines: &[f64],
    geometry: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, &'static str> {
    if settings.len() != 11
        || !glyphs.len().is_multiple_of(3)
        || glyphs
            .iter()
            .chain(outlines)
            .chain(geometry)
            .chain(settings)
            .any(|v| !v.is_finite())
        || ![0.0, 1.0].contains(&settings[0])
        || settings[2] <= 0.0
    {
        return Err("Invalid text geometry buffers or settings");
    }
    let alignment = match settings[7] {
        0.0 => Alignment::Left,
        1.0 => Alignment::Center,
        2.0 => Alignment::Right,
        _ => return Err("Invalid text alignment"),
    };
    let vertical_alignment = match settings[8] {
        0.0 => VerticalAlignment::Top,
        1.0 => VerticalAlignment::Middle,
        2.0 => VerticalAlignment::Bottom,
        _ => return Err("Invalid text vertical alignment"),
    };
    let flags = count(settings[9], 31)?;
    let line_count = count(settings[10], u32::MAX as usize)?;
    if line_count == 0 || (settings[0] == 1.0 && line_count != 1) {
        return Err("Invalid text line count");
    }
    let mut cursor = 0;
    let mut previous = 0;
    let mut prepared = Vec::with_capacity(glyphs.len() / 3);
    for record in glyphs.as_chunks::<3>().0 {
        let line = count(record[0], line_count - 1)?;
        if line < previous {
            return Err("Unordered text glyph lines");
        }
        previous = line;
        let total = count(record[2], outlines.len().saturating_sub(cursor))?;
        prepared.push(Glyph {
            line,
            advance: record[1],
            commands: commands(outlines, &mut cursor, total)?,
        });
    }
    if cursor != outlines.len() {
        return Err("Trailing text outline data");
    }
    let metrics = Metrics {
        units_per_em: settings[2],
        ascender: settings[3],
        descender: settings[4],
        cap_height: settings[5],
    };
    let options = Options {
        height: settings[1],
        character_spacing: settings[6],
        alignment,
        vertical_alignment,
        flip_horizontal: flags & 1 != 0,
        flip_vertical: flags & 2 != 0,
        fit_to_path: flags & 4 != 0,
        below: flags & 8 != 0,
        svg: flags & 16 != 0,
        line_count,
    };
    let curves;
    let target = if settings[0] == 0.0 {
        if geometry.len() != 8 {
            return Err("Expected four text rectangle corners");
        }
        Target::Rectangle(std::array::from_fn(|i| Point2 {
            x: geometry[2 * i],
            y: geometry[2 * i + 1],
        }))
    } else {
        curves = crate::regions::decode(geometry)?;
        if curves.len() != 1 {
            return Err("Expected one text curve record");
        }
        Target::Curve(&curves[0].geometry)
    };
    let result = text_geometry::layout(&prepared, metrics, options, target)?;
    let mut output = Vec::new();
    for command in result {
        match command {
            Command::Move(p) => output.extend([0.0, p.x, p.y]),
            Command::Line(p) => output.extend([1.0, p.x, p.y]),
            Command::Quad(a, p) => output.extend([2.0, a.x, a.y, p.x, p.y]),
            Command::Cubic(a, b, p) => output.extend([3.0, a.x, a.y, b.x, b.y, p.x, p.y]),
            Command::Close => output.push(4.0),
        }
    }
    if output.iter().any(|v| !v.is_finite()) {
        return Err("Non-finite text geometry result");
    }
    Ok(output)
}

#[wasm_bindgen]
pub fn text_geometry(
    glyphs: &[f64],
    outlines: &[f64],
    geometry: &[f64],
    settings: &[f64],
) -> Result<Vec<f64>, JsValue> {
    execute(glyphs, outlines, geometry, settings).map_err(JsValue::from_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SETTINGS: [f64; 11] = [
        0.0, 10.0, 1000.0, 800.0, -200.0, 700.0, 0.0, 0.0, 1.0, 0.0, 1.0,
    ];
    const RECTANGLE: [f64; 8] = [0.0, 20.0, 40.0, 20.0, 40.0, 0.0, 0.0, 0.0];
    #[test]
    fn decodes_all_command_tags_and_preserves_glyph_order() {
        let out = execute(
            &[0.0, 600.0, 3.0],
            &[0.0, 0.0, 0.0, 1.0, 2.0, 0.0, 4.0],
            &RECTANGLE,
            &SETTINGS,
        )
        .unwrap();
        assert_eq!(out, vec![0.0, 1.0, 7.0, 1.0, 3.0, 7.0, 4.0]);
        assert!(execute(&[], &[], &RECTANGLE, &SETTINGS).unwrap().is_empty());
    }
    #[test]
    fn rejects_truncated_commands_settings_and_unordered_lines() {
        for data in [
            vec![9.0],
            vec![0.0],
            vec![2.0, 0.0, 0.0],
            vec![3.0, 0.0, 0.0],
            vec![0.0, f64::NAN, 0.0],
        ] {
            assert!(execute(&[0.0, 600.0, 1.0], &data, &RECTANGLE, &SETTINGS).is_err());
        }
        for (at, value) in [
            (0, 2.0),
            (2, 0.0),
            (7, 3.0),
            (8, -1.0),
            (9, 32.0),
            (10, 0.0),
        ] {
            let mut settings = SETTINGS;
            settings[at] = value;
            assert!(execute(&[], &[], &RECTANGLE, &settings).is_err());
        }
        let mut settings = SETTINGS;
        settings[10] = 2.0;
        assert!(execute(
            &[1.0, 10.0, 0.0, 0.0, 10.0, 0.0],
            &[],
            &RECTANGLE,
            &settings
        )
        .is_err());
        assert!(execute(&[0.0, 10.0, 0.0], &[4.0], &RECTANGLE, &SETTINGS).is_err());
        assert!(execute(&[], &[], &[], &SETTINGS).is_err());
    }
}
