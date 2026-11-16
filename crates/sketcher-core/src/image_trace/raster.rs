//! Raster stages preserve the reference's f32 storage and f64 accumulation.
pub fn blur(src: &[f32], w: usize, h: usize, sigma: f64) -> Vec<f32> {
    if sigma <= 0.05 {
        return src.to_vec();
    }
    let r = (sigma * 3.0).ceil().max(1.0) as isize;
    let mut kernel = Vec::with_capacity((2 * r + 1) as usize);
    let mut total = 0.0;
    for i in -r..=r {
        let v = (-(i * i) as f64 / (2.0 * sigma * sigma)).exp();
        kernel.push(v as f32);
        total += v;
    }
    for v in &mut kernel {
        *v = (*v as f64 / total) as f32;
    }
    let mut temp = vec![0.0; src.len()];
    for y in 0..h {
        for x in 0..w {
            let mut sum = 0.0;
            for k in -r..=r {
                let xx = (x as isize + k).clamp(0, w as isize - 1) as usize;
                sum += src[y * w + xx] as f64 * kernel[(k + r) as usize] as f64;
            }
            temp[y * w + x] = sum as f32;
        }
    }
    let mut out = vec![0.0; src.len()];
    for y in 0..h {
        for x in 0..w {
            let mut sum = 0.0;
            for k in -r..=r {
                let yy = (y as isize + k).clamp(0, h as isize - 1) as usize;
                sum += temp[yy * w + x] as f64 * kernel[(k + r) as usize] as f64;
            }
            out[y * w + x] = sum as f32;
        }
    }
    out
}
pub fn otsu(gray: &[f32]) -> f64 {
    let mut hist = [0.0; 256];
    for &v in gray {
        hist[(v as f64).round().clamp(0.0, 255.0) as usize] += 1.0;
    }
    let total = gray.len() as f64;
    let sum: f64 = hist.iter().enumerate().map(|(i, v)| i as f64 * v).sum();
    let (mut sum_bg, mut weight, mut best, mut variance) = (0.0, 0.0, 128, -1.0);
    for (t, &v) in hist.iter().enumerate() {
        weight += v;
        if weight == 0.0 {
            continue;
        }
        let fg = total - weight;
        if fg == 0.0 {
            break;
        }
        sum_bg += t as f64 * v;
        let diff = sum_bg / weight - (sum - sum_bg) / fg;
        let var = weight * fg * diff.powi(2);
        if var > variance {
            variance = var;
            best = t;
        }
    }
    (best + 1) as f64
}
fn components(
    mask: &[u8],
    w: usize,
    h: usize,
    value: u8,
    eight: bool,
) -> (Vec<usize>, Vec<usize>, Vec<bool>) {
    let mut labels = vec![0; mask.len()];
    let mut sizes = vec![0];
    let mut borders = vec![false];
    let mut stack = Vec::new();
    for start in 0..mask.len() {
        if mask[start] != value || labels[start] != 0 {
            continue;
        }
        let label = sizes.len();
        let (mut size, mut border) = (0, false);
        labels[start] = label;
        stack.push(start);
        while let Some(i) = stack.pop() {
            size += 1;
            let (x, y) = (i % w, i / w);
            border |= x == 0 || y == 0 || x == w - 1 || y == h - 1;
            for dy in -1isize..=1 {
                for dx in -1isize..=1 {
                    if (dx == 0 && dy == 0) || (!eight && dx != 0 && dy != 0) {
                        continue;
                    }
                    let (xx, yy) = (x as isize + dx, y as isize + dy);
                    if xx < 0 || yy < 0 || xx >= w as isize || yy >= h as isize {
                        continue;
                    }
                    let n = yy as usize * w + xx as usize;
                    if mask[n] == value && labels[n] == 0 {
                        labels[n] = label;
                        stack.push(n);
                    }
                }
            }
        }
        sizes.push(size);
        borders.push(border);
    }
    (labels, sizes, borders)
}
pub fn despeckle(mut mask: Vec<u8>, w: usize, h: usize, area: f64) -> Vec<u8> {
    if area <= 1.0 {
        return mask;
    }
    let (labels, sizes, _) = components(&mask, w, h, 1, true);
    for (i, v) in mask.iter_mut().enumerate() {
        let l = labels[i];
        if l != 0 && (sizes[l] as f64) < area {
            *v = 0;
        }
    }
    let (labels, sizes, borders) = components(&mask, w, h, 0, false);
    for (i, v) in mask.iter_mut().enumerate() {
        let l = labels[i];
        if l != 0 && !borders[l] && (sizes[l] as f64) < area {
            *v = 1;
        }
    }
    mask
}
