//! 2D point and vector arithmetic.

use std::ops::{Add, AddAssign, Div, DivAssign, Mul, MulAssign, Neg, Sub, SubAssign};

/// A 2D point or vector with double-precision floating point coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

/// Shorthand constructor for a [`Point2`].
#[inline]
pub const fn p(x: f64, y: f64) -> Point2 {
    Point2 { x, y }
}

impl Point2 {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };
    pub const UNIT_X: Self = Self { x: 1.0, y: 0.0 };
    pub const UNIT_Y: Self = Self { x: 0.0, y: 1.0 };

    #[inline]
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// Dot product between two vectors.
    #[inline]
    pub fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y
    }

    /// 2D cross product (determinant of 2x2 matrix formed by `self` and `other`).
    #[inline]
    pub fn cross(self, other: Self) -> f64 {
        self.x * other.y - self.y * other.x
    }

    /// Squared Euclidean length (norm) of the vector.
    #[inline]
    pub fn length_squared(self) -> f64 {
        self.dot(self)
    }

    /// Euclidean length (norm) of the vector.
    ///
    /// Matches the TypeScript reference's scaled two-coordinate norm.
    /// A single ULP can change branch decisions in projection searches.
    #[inline]
    pub fn length(self) -> f64 {
        let (x, y) = (self.x.abs(), self.y.abs());
        if x.is_infinite() || y.is_infinite() {
            return f64::INFINITY;
        }
        if x.is_nan() || y.is_nan() {
            return f64::NAN;
        }
        let maximum = x.max(y);
        if maximum == 0.0 {
            return 0.0;
        }
        let (x, y) = (x / maximum, y / maximum);
        (x * x + y * y).sqrt() * maximum
    }

    /// Euclidean distance between two points.
    #[inline]
    pub fn distance(self, other: Self) -> f64 {
        (self - other).length()
    }

    /// Squared Euclidean distance between two points.
    #[inline]
    pub fn distance_squared(self, other: Self) -> f64 {
        (self - other).length_squared()
    }

    /// Perpendicular vector rotated 90 degrees counter-clockwise `(-y, x)`.
    #[inline]
    pub fn perp(self) -> Self {
        Self {
            x: -self.y,
            y: self.x,
        }
    }

    /// Normalized unit vector. Returns `(1.0, 0.0)` if length is smaller than `1e-12`.
    #[inline]
    pub fn unit(self) -> Self {
        let len = self.length();
        if len < 1e-12 {
            Self { x: 1.0, y: 0.0 }
        } else {
            self * (1.0 / len)
        }
    }

    /// Alias for [`Point2::unit`].
    #[inline]
    pub fn normalize(self) -> Self {
        self.unit()
    }

    /// Midpoint between two points.
    #[inline]
    pub fn middle(self, other: Self) -> Self {
        Self {
            x: (self.x + other.x) * 0.5,
            y: (self.y + other.y) * 0.5,
        }
    }

    /// Angle in radians from `self` to `other` (using `atan2(dy, dx)`).
    #[inline]
    pub fn angle_to(self, other: Self) -> f64 {
        (other.y - self.y).atan2(other.x - self.x)
    }

    /// Polar coordinate constructor `(r * cos(theta), r * sin(theta))`.
    #[inline]
    pub fn from_polar(r: f64, theta: f64) -> Self {
        Self {
            x: r * theta.cos(),
            y: r * theta.sin(),
        }
    }

    /// Linear interpolation between `self` and `other` with parameter `t`.
    #[inline]
    pub fn lerp(self, other: Self, t: f64) -> Self {
        self + (other - self) * t
    }

    /// Point with negated Y coordinate `(x, -y)`. Useful for SVG/Cartesian conversions.
    #[inline]
    pub fn flip_y(self) -> Self {
        Self {
            x: self.x,
            y: -self.y,
        }
    }

    /// Component-wise minimum.
    #[inline]
    pub fn min(self, other: Self) -> Self {
        Self {
            x: self.x.min(other.x),
            y: self.y.min(other.y),
        }
    }

    /// Component-wise maximum.
    #[inline]
    pub fn max(self, other: Self) -> Self {
        Self {
            x: self.x.max(other.x),
            y: self.y.max(other.y),
        }
    }
}

impl Add for Point2 {
    type Output = Self;
    #[inline]
    fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl AddAssign for Point2 {
    #[inline]
    fn add_assign(&mut self, rhs: Self) {
        self.x += rhs.x;
        self.y += rhs.y;
    }
}

impl Sub for Point2 {
    type Output = Self;
    #[inline]
    fn sub(self, rhs: Self) -> Self {
        Self {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

impl SubAssign for Point2 {
    #[inline]
    fn sub_assign(&mut self, rhs: Self) {
        self.x -= rhs.x;
        self.y -= rhs.y;
    }
}

impl Mul<f64> for Point2 {
    type Output = Self;
    #[inline]
    fn mul(self, s: f64) -> Self {
        Self {
            x: self.x * s,
            y: self.y * s,
        }
    }
}

impl Mul<Point2> for f64 {
    type Output = Point2;
    #[inline]
    fn mul(self, p: Point2) -> Point2 {
        Point2 {
            x: self * p.x,
            y: self * p.y,
        }
    }
}

impl MulAssign<f64> for Point2 {
    #[inline]
    fn mul_assign(&mut self, s: f64) {
        self.x *= s;
        self.y *= s;
    }
}

impl Div<f64> for Point2 {
    type Output = Self;
    #[inline]
    fn div(self, s: f64) -> Self {
        Self {
            x: self.x / s,
            y: self.y / s,
        }
    }
}

impl DivAssign<f64> for Point2 {
    #[inline]
    fn div_assign(&mut self, s: f64) {
        self.x /= s;
        self.y /= s;
    }
}

impl Neg for Point2 {
    type Output = Self;
    #[inline]
    fn neg(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
        }
    }
}

// Standalone mathematical helper functions for concise expressions.
#[inline]
pub fn dot(a: Point2, b: Point2) -> f64 {
    a.dot(b)
}

#[inline]
pub fn cross(a: Point2, b: Point2) -> f64 {
    a.cross(b)
}

#[inline]
pub fn sub(a: Point2, b: Point2) -> Point2 {
    a - b
}

#[inline]
pub fn add(a: Point2, b: Point2) -> Point2 {
    a + b
}

#[inline]
pub fn scale(a: Point2, s: f64) -> Point2 {
    a * s
}

#[inline]
pub fn add_scaled(a: Point2, b: Point2, s: f64) -> Point2 {
    a + b * s
}

#[inline]
pub fn step(a: Point2, dir: Point2, s: f64) -> Point2 {
    a + dir * s
}

#[inline]
pub fn distance(a: Point2, b: Point2) -> f64 {
    a.distance(b)
}

#[inline]
pub fn unit(a: Point2) -> Point2 {
    a.unit()
}

#[inline]
pub fn perp(a: Point2) -> Point2 {
    a.perp()
}

#[inline]
pub fn middle(a: Point2, b: Point2) -> Point2 {
    a.middle(b)
}

#[inline]
pub fn angle(c: Point2, a: Point2) -> f64 {
    c.angle_to(a)
}

#[inline]
pub fn polar(r: f64, theta: f64) -> Point2 {
    Point2::from_polar(r, theta)
}
