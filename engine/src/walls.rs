//! Serbest mimari: her açıda ve eğri duvarlar, uç noktaya yapışma, köşe dolguları.
//!
//! Eğri duvar `Wall::arc` ile tanımlanır: a→b kirişinin ortasından yayın tepesine uzaklık (mm).
//! Pozitif değer yayı a→b yönünün soluna, negatif sağına büker. Hesap ve 3B için eğri duvar
//! kısa düz parçalara bölünür (`expand`).

use crate::geom::{self, P2};
use crate::model::{Level, Wall};

/// Yayın merkez, yarıçap, başlangıç açısı ve süpürme açısı (radyan; işaretli).
fn arc_params(w: &Wall) -> Option<(P2, f64, f64, f64)> {
    let c = geom::dist(w.a, w.b);
    let s = w.arc;
    if s.abs() < 1.0 || c < 1.0 {
        return None;
    }
    let r = (c * c / 4.0 + s * s) / (2.0 * s.abs());
    let d = [(w.b[0] - w.a[0]) / c, (w.b[1] - w.a[1]) / c];
    let left = [-d[1], d[0]];
    let mid = [(w.a[0] + w.b[0]) / 2.0, (w.a[1] + w.b[1]) / 2.0];
    // merkez, yayın tersi yönde (r - |s|) uzaklıkta
    let sign = s.signum();
    let off = (r - s.abs()) * -sign;
    let center = [mid[0] + left[0] * off, mid[1] + left[1] * off];
    let a0 = (w.a[1] - center[1]).atan2(w.a[0] - center[0]);
    let a1 = (w.b[1] - center[1]).atan2(w.b[0] - center[0]);
    let mut sweep = a1 - a0;
    // yay, sol tarafa bükülüyorsa saat yönü tersine (pozitif) değil: tepe noktası soldadır
    let tau = std::f64::consts::TAU;
    let half_large = s.abs() > c / 2.0;
    if sign > 0.0 {
        // tepe solda → a'dan b'ye saat yönünde (negatif süpürme)
        while sweep > 0.0 {
            sweep -= tau;
        }
        if !half_large && sweep < -std::f64::consts::PI {
            sweep += tau;
        }
    } else {
        while sweep < 0.0 {
            sweep += tau;
        }
        if !half_large && sweep > std::f64::consts::PI {
            sweep -= tau;
        }
    }
    Some((center, r, a0, sweep))
}

/// Duvarın orta çizgisi boyunca noktalar (düz duvarda yalnız uçlar).
pub fn centerline(w: &Wall) -> Vec<P2> {
    let Some((c, r, a0, sweep)) = arc_params(w) else { return vec![w.a, w.b] };
    // en çok 6°'lik parçalar, en az 4 parça
    let n = ((sweep.abs() / 6f64.to_radians()).ceil() as usize).clamp(4, 96);
    let mut pts: Vec<P2> = (0..=n)
        .map(|k| {
            let t = a0 + sweep * k as f64 / n as f64;
            [c[0] + r * t.cos(), c[1] + r * t.sin()]
        })
        .collect();
    // uçlar tam olarak a ve b olsun
    pts[0] = w.a;
    pts[n] = w.b;
    pts
}

/// Orta çizgi uzunluğu (eğri duvarda yay uzunluğu).
pub fn length(w: &Wall) -> f64 {
    match arc_params(w) {
        Some((_, r, _, sweep)) => r * sweep.abs(),
        None => geom::dist(w.a, w.b),
    }
}

/// Eğri duvarları düz parçalara böler. Parça kimlikleri `<duvar>~<sıra>` biçimindedir;
/// parçalar özgün duvarın boya, kalınlık ve yükseklik bilgisini taşır.
pub fn expand(level: &Level) -> Level {
    if level.walls.iter().all(|w| w.arc.abs() < 1.0) {
        return level.clone();
    }
    let mut l = level.clone();
    l.walls = vec![];
    for w in &level.walls {
        if w.arc.abs() < 1.0 {
            l.walls.push(w.clone());
            continue;
        }
        let pts = centerline(w);
        for (k, s) in pts.windows(2).enumerate() {
            let mut p = w.clone();
            p.id = format!("{}~{k}", w.id);
            p.a = s[0];
            p.b = s[1];
            p.arc = 0.0;
            l.walls.push(p);
        }
    }
    l
}

/// Serbest çizim yakalama ayarları.
#[derive(Clone, Copy, Debug)]
pub struct Snap {
    /// Izgara adımı (mm). 0: ızgara yok.
    pub grid: f64,
    /// Açı adımı (derece). 0: serbest açı. 90: dik açı.
    pub angle: f64,
    /// Uç noktalara ve duvar çizgilerine yapışma mesafesi (mm). 0: kapalı.
    pub magnet: f64,
}
impl Default for Snap {
    fn default() -> Self {
        Snap { grid: 10.0, angle: 15.0, magnet: 150.0 }
    }
}

/// Noktayı yakalar: önce mevcut uç noktalar, sonra (başlangıç varsa) açı adımı ve ızgara,
/// en son duvar çizgileri. Dönüş: yakalanan nokta ve yakalama türü.
pub fn snap(level: &Level, p: P2, from: Option<P2>, s: Snap) -> (P2, &'static str) {
    if s.magnet > 0.0 {
        let mut best: Option<(f64, P2)> = None;
        for w in &level.walls {
            for q in [w.a, w.b] {
                let d = geom::dist(p, q);
                if d <= s.magnet && best.map_or(true, |b| d < b.0) && from.map_or(true, |f| geom::dist(f, q) > 1.0) {
                    best = Some((d, q));
                }
            }
        }
        if let Some((_, q)) = best {
            return (q, "uc");
        }
    }
    let mut q = p;
    let mut kind = "serbest";
    if let Some(a) = from {
        if s.angle > 0.0 {
            let dx = p[0] - a[0];
            let dy = p[1] - a[1];
            let len = (dx * dx + dy * dy).sqrt();
            let step = s.angle.to_radians();
            let ang = (dy.atan2(dx) / step).round() * step;
            let len = if s.grid > 0.0 { (len / s.grid).round() * s.grid } else { len };
            q = [a[0] + len * ang.cos(), a[1] + len * ang.sin()];
            // dik açılarda yuvarlama hatasını sil
            q = [(q[0] * 10.0).round() / 10.0, (q[1] * 10.0).round() / 10.0];
            kind = "aci";
            return (q, kind);
        }
    }
    if s.grid > 0.0 {
        q = [(q[0] / s.grid).round() * s.grid, (q[1] / s.grid).round() * s.grid];
        kind = "izgara";
    }
    if s.magnet > 0.0 {
        // duvar çizgisi üzerine izdüşüm
        let mut best: Option<(f64, P2)> = None;
        for w in level.walls.iter().filter(|w| w.arc.abs() < 1.0) {
            let d = geom::dist_to_segment(p, w.a, w.b);
            if d <= s.magnet / 2.0 && best.map_or(true, |b| d < b.0) {
                let ab = geom::sub(w.b, w.a);
                let l2 = ab[0] * ab[0] + ab[1] * ab[1];
                let t = (((p[0] - w.a[0]) * ab[0] + (p[1] - w.a[1]) * ab[1]) / l2).clamp(0.0, 1.0);
                best = Some((d, [w.a[0] + ab[0] * t, w.a[1] + ab[1] * t]));
            }
        }
        if let Some((_, b)) = best {
            return ([(b[0] * 10.0).round() / 10.0, (b[1] * 10.0).round() / 10.0], "duvar");
        }
    }
    (q, kind)
}

/// Serbest duvarların birleştiği noktalarda köşe dolgusu: duvar uç yüzlerinin dışbükey zarfı.
/// Yalnız 90° dışı (ya da üç ve daha fazla duvarın) birleşimlerinde döner; dik köşeler
/// duvarların yarım kalınlık uzantısıyla zaten kapanır.
pub fn corner_fills(level: &Level) -> Vec<(Vec<P2>, f64)> {
    let walls: Vec<&Wall> = level.walls.iter().filter(|w| !w.generated && geom::dist(w.a, w.b) > 1.0).collect();
    let mut points: Vec<P2> = vec![];
    for w in &walls {
        for q in [w.a, w.b] {
            if !points.iter().any(|p| geom::dist(*p, q) < 1.0) {
                points.push(q);
            }
        }
    }
    let mut out = vec![];
    for p in points {
        let at: Vec<&&Wall> = walls.iter().filter(|w| geom::dist(w.a, p) < 1.0 || geom::dist(w.b, p) < 1.0).collect();
        if at.len() < 2 {
            continue;
        }
        let dirs: Vec<P2> = at
            .iter()
            .map(|w| {
                let o = if geom::dist(w.a, p) < 1.0 { w.b } else { w.a };
                let l = geom::dist(o, p);
                [(o[0] - p[0]) / l, (o[1] - p[1]) / l]
            })
            .collect();
        let all_square = at.len() == 2 && (dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1]).abs() < 1e-3;
        if all_square {
            continue;
        }
        let mut pts = vec![];
        let mut hmax: f64 = 0.0;
        for (w, d) in at.iter().zip(&dirs) {
            let n = [-d[1], d[0]];
            let ht = w.thickness / 2.0;
            pts.push([p[0] + n[0] * ht, p[1] + n[1] * ht]);
            pts.push([p[0] - n[0] * ht, p[1] - n[1] * ht]);
            hmax = hmax.max(w.height.unwrap_or(level.height));
        }
        let hull = convex_hull(pts);
        if hull.len() >= 3 && geom::area(&hull) > 1.0 {
            out.push((hull, hmax));
        }
    }
    out
}

fn convex_hull(mut pts: Vec<P2>) -> Vec<P2> {
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap().then(a[1].partial_cmp(&b[1]).unwrap()));
    pts.dedup_by(|a, b| geom::dist(*a, *b) < 0.01);
    if pts.len() < 3 {
        return pts;
    }
    let cross = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut lower: Vec<P2> = vec![];
    for &p in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper: Vec<P2> = vec![];
    for &p in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Çokgeni Douglas–Peucker ile sadeleştirir (kapalı çokgen).
pub fn simplify(poly: &[P2], tol: f64) -> Vec<P2> {
    if poly.len() <= 4 {
        return poly.to_vec();
    }
    // en uzak iki nokta arasından ikiye böl
    let (mut i0, mut i1, mut best) = (0, 0, -1.0);
    for i in 0..poly.len() {
        let d = geom::dist(poly[0], poly[i]);
        if d > best {
            best = d;
            i1 = i;
        }
    }
    best = -1.0;
    for i in 0..poly.len() {
        let d = geom::dist(poly[i1], poly[i]);
        if d > best {
            best = d;
            i0 = i;
        }
    }
    let (s, e) = (i0.min(i1), i0.max(i1));
    let a: Vec<P2> = poly[s..=e].to_vec();
    let mut b: Vec<P2> = poly[e..].to_vec();
    b.extend_from_slice(&poly[..=s]);
    let mut out = dp(&a, tol);
    out.pop();
    let mut tail = dp(&b, tol);
    tail.pop();
    out.extend(tail);
    if out.len() < 3 {
        poly.to_vec()
    } else {
        out
    }
}

fn dp(pts: &[P2], tol: f64) -> Vec<P2> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    let (mut idx, mut dmax) = (0, 0.0);
    for (i, p) in pts.iter().enumerate().skip(1).take(pts.len() - 2) {
        let d = geom::dist_to_segment(*p, a, b);
        if d > dmax {
            dmax = d;
            idx = i;
        }
    }
    if dmax > tol {
        let mut l = dp(&pts[..=idx], tol);
        l.pop();
        l.extend(dp(&pts[idx..], tol));
        l
    } else {
        vec![a, b]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(id: &str, a: P2, b: P2) -> Wall {
        Wall { id: id.into(), a, b, thickness: 100.0, ..Default::default() }
    }

    #[test]
    fn arc_geometry_and_length() {
        let mut x = w("E1", [0.0, 0.0], [4000.0, 0.0]);
        x.arc = 2000.0; // yarım daire, r = 2000
        let pts = centerline(&x);
        assert_eq!(pts[0], [0.0, 0.0]);
        assert_eq!(*pts.last().unwrap(), [4000.0, 0.0]);
        // tepe noktası solda (+y) ve 2000 mm uzakta
        let top = pts.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max);
        assert!((top - 2000.0).abs() < 5.0, "{top}");
        assert!((length(&x) - std::f64::consts::PI * 2000.0).abs() < 1.0);
        x.arc = -500.0;
        let low = centerline(&x).iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
        assert!((low + 500.0).abs() < 5.0, "{low}");
        let l = Level { walls: vec![x], ..Default::default() };
        let e = expand(&l);
        assert!(e.walls.len() >= 4 && e.walls.iter().all(|w| w.arc == 0.0 && w.id.starts_with("E1~")));
    }

    #[test]
    fn snapping_endpoints_angles_and_lines() {
        let l = Level { walls: vec![w("B1", [0.0, 0.0], [3000.0, 0.0])], ..Default::default() };
        let s = Snap::default();
        assert_eq!(snap(&l, [3080.0, 60.0], None, s), ([3000.0, 0.0], "uc"));
        let (q, k) = snap(&l, [2000.0, 1990.0], Some([0.0, 0.0]), Snap { magnet: 0.0, ..s });
        assert_eq!(k, "aci");
        assert!((q[0] - q[1]).abs() < 0.2, "45° yakalanır: {q:?}");
        let (q, k) = snap(&l, [1500.0, 40.0], None, s);
        assert_eq!((q, k), ([1500.0, 0.0], "duvar"));
        assert_eq!(snap(&l, [1234.0, 5678.0], None, s), ([1230.0, 5680.0], "izgara"));
    }

    #[test]
    fn corner_fill_only_for_angled_joints() {
        let square = Level { walls: vec![w("A", [0.0, 0.0], [3000.0, 0.0]), w("B", [0.0, 0.0], [0.0, 3000.0])], ..Default::default() };
        assert!(corner_fills(&square).is_empty());
        let angled = Level { walls: vec![w("A", [0.0, 0.0], [3000.0, 0.0]), w("B", [0.0, 0.0], [2000.0, 2000.0])], ..Default::default() };
        let f = corner_fills(&angled);
        assert_eq!(f.len(), 1);
        assert!(f[0].0.len() >= 3);
    }

    #[test]
    fn angled_and_curved_rooms_are_detected_and_meshed() {
        use crate::model::Scene;
        let mut s = Scene::default();
        s.levels[0].walls.clear();
        // 45° hipotenüslü dik üçgen oda
        let mk = |id: &str, a: P2, b: P2, arc: f64| crate::plan::free_wall(&Scene::default(), a, b, id.into(), Some(100.0), arc, None).unwrap();
        s.levels[0].walls = vec![mk("B1", [0.0, 0.0], [4000.0, 0.0], 0.0), mk("B2", [4000.0, 0.0], [4000.0, 4000.0], 0.0), mk("B3", [4000.0, 4000.0], [0.0, 0.0], 0.0)];
        let d = crate::plan::detect_room(&s.levels[0], [3000.0, 1000.0]).unwrap();
        assert!(d.polygon.len() <= 4, "üçgen sadeleşir: {}", d.polygon.len());
        assert!((d.area_m2 - 7.32).abs() < 0.15, "{}", d.area_m2);
        // eğri duvarla kapanan yarım daire oda
        s.levels[0].walls = vec![mk("B1", [0.0, 0.0], [4000.0, 0.0], 0.0), mk("B2", [4000.0, 0.0], [0.0, 0.0], 2000.0)];
        let d = crate::plan::detect_room(&s.levels[0], [2000.0, -800.0]).unwrap();
        let ideal = std::f64::consts::PI * 1950.0 * 1950.0 / 2.0 / 1e6;
        assert!((d.area_m2 - ideal).abs() / ideal < 0.06, "{} / {}", d.area_m2, ideal);
        // eğri duvarın üstüne açıklık konmaz; uzunluk yay uzunluğudur
        let o = crate::model::Opening { id: "P1".into(), wall: "B2".into(), offset: 100.0, width: 800.0, height: 1000.0, sill: 900.0, ..Default::default() };
        assert_eq!(crate::plan::validate_opening(&s.levels[0], &o).unwrap_err(), "@opening_on_curved_wall");
        assert!((s.levels[0].walls[1].length() - std::f64::consts::PI * 2000.0).abs() < 1.0);
        let m = crate::mesh::build(&s, &crate::mesh::MeshOptions::default());
        assert!(m.triangle_count() > 100);
    }

    #[test]
    fn simplify_staircase_to_diagonal() {
        let mut poly = vec![[0.0, 0.0], [1000.0, 0.0]];
        // 45° kenar boyunca 10 mm'lik basamaklar
        let mut x = 1000.0;
        let mut y = 0.0;
        while y < 1000.0 {
            y += 10.0;
            poly.push([x, y]);
            x -= 10.0;
            poly.push([x, y]);
        }
        poly.push([0.0, 1000.0]);
        let s = simplify(&poly, 15.0);
        assert!(s.len() <= 4, "{}", s.len());
    }
}
