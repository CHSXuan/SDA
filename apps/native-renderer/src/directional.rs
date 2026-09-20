//! Delay-aligned, compact-support interpolation on measured HRTF directions.
use crate::{hrtf::StereoIr, spatial};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Direction {
    pub diffuse: f32,
    pub horizontal_only: bool,
    pub position: [f32; 3],
    pub head: Option<[f32; 4]>,
    pub width: f32,
    pub height: f32,
    pub depth: f32,
}

type Route = (
    Direction,
    crate::vbap::LayoutId,
    [f32; crate::vbap::MAX_BUS_COUNT],
    [f32; crate::vbap::MAX_BUS_COUNT],
);
#[derive(Clone, Copy)]
pub struct Frame {
    pub input: f32,
    pub near: [f32; 2],
    pub output: [f32; 2],
}
impl Default for Frame {
    fn default() -> Self {
        Self {
            input: 0.0,
            near: [1.0; 2],
            output: [0.0; 2],
        }
    }
}
pub struct ContinuousSource {
    pub perf_id: String,
    hardware: crate::hardware::Chain,
    convolver: crate::convolution::StereoPartitionedConvolver,
    route: Option<Route>,
    pending: Option<Route>,
    near: crate::near_field::Filter,
    // Sample-major hot storage: the mixer reads the previous output and writes
    // excitation/near targets together, avoiding five distant cache lines per object.
    pub frames: [Frame; crate::convolution::DEFAULT_PARTITION],
    input: [f32; crate::convolution::DEFAULT_PARTITION],
    left: [f32; crate::convolution::DEFAULT_PARTITION],
    right: [f32; crate::convolution::DEFAULT_PARTITION],
}
impl ContinuousSource {
    pub fn new(set: &crate::hrtf::NativeHrtfSet) -> Result<Self, String> {
        let zero = vec![0.0; set.directional_filter_len()];
        Ok(Self {
            perf_id: String::new(),
            hardware: crate::hardware::Chain::new(&set.cinema.monitor.hardware),
            convolver: crate::convolution::StereoPartitionedConvolver::new(
                &zero,
                &zero,
                crate::convolution::DEFAULT_PARTITION,
            )?,
            route: None,
            pending: None,
            near: Default::default(),
            input: [0.0; crate::convolution::DEFAULT_PARTITION],
            frames: [Frame::default(); crate::convolution::DEFAULT_PARTITION],
            left: [0.0; crate::convolution::DEFAULT_PARTITION],
            right: [0.0; crate::convolution::DEFAULT_PARTITION],
        })
    }
    pub fn schedule(
        &mut self,
        direction: Direction,
        layout: crate::vbap::LayoutId,
        gains: [f32; crate::vbap::MAX_BUS_COUNT],
        amounts: [f32; crate::vbap::MAX_BUS_COUNT],
    ) {
        let route = (direction, layout, gains, amounts);
        self.pending = (self.route != Some(route)).then_some(route);
    }
    fn finish(&mut self, set: &crate::hrtf::NativeHrtfSet) -> Result<(), String> {
        let _perf=crate::performance::span("hrtf.object.convolution",&self.perf_id,crate::convolution::DEFAULT_PARTITION as u64);
        for (input, frame) in self.input.iter_mut().zip(&self.frames) {
            *input = self.hardware.process(frame.input);
        }
        if self.input.iter().any(|x| *x != 0.0) || !self.convolver.tail_is_silent() {
            if let Some((direction, layout, gains, amounts)) = self.pending.take() {
                let _filter_perf=crate::performance::span("hrtf.object.filter_update",&self.perf_id,(set.directional_filter_len()*2) as u64);
                let (left, right) =
                    set.directional_dry_compact(direction, layout, gains, amounts)?;
                let filter = self.convolver.prepare_pair(&left, &right);
                if self.route.is_none() {
                    self.convolver.set_prepared_filter(filter);
                } else {
                    self.convolver
                        .transition_to(filter, crate::convolution::DEFAULT_PARTITION);
                }
                self.route = Some((direction, layout, gains, amounts));
            }
        }
        self.left.fill(0.0);
        self.right.fill(0.0);
        self.convolver
            .process_block(&self.input, &mut self.left, &mut self.right)?;
        for (i, frame) in self.frames.iter_mut().enumerate() {
            frame.output = self.near.process([self.left[i], self.right[i]], frame.near);
            frame.input = 0.0;
            frame.near = [1.0; 2];
        }
        Ok(())
    }
}
pub fn finish_sources<'a>(
    sources: impl Iterator<Item = &'a mut ContinuousSource>,
    set: &crate::hrtf::NativeHrtfSet,
) -> Result<(), String> {
    use rayon::prelude::*;
    let mut sources: Vec<_> = sources.collect();
    if let Some(pool) = crate::direct_renderer::workers().filter(|_| sources.len() >= 8) {
        pool.install(|| {
            sources
                .par_iter_mut()
                .with_min_len(2)
                .try_for_each(|s| s.finish(set))
        })
    } else {
        sources.iter_mut().try_for_each(|s| s.finish(set))
    }
}

pub struct Grid {
    directions: Vec<[f64; 3]>,
    arrivals: Vec<[usize; 2]>,
    /// Whole-waveform alignment lags between neighbouring IR pairs, per ear.
    /// Peak-position alignment leaves the fine phase structure of the two
    /// measurements misaligned by several samples; mixing then cancels the
    /// common (correlated) part and collapses interaural coherence, which
    /// unfocuses binaural imaging between grid points. The lag stores the
    /// shift (in samples, IR b relative to IR a) that maximises waveform
    /// correlation, computed lazily per pair.
    alignment_lags: std::sync::Mutex<std::collections::HashMap<(usize, usize), [i32; 2]>>,
}
impl Clone for Grid {
    fn clone(&self) -> Self {
        Self {
            directions: self.directions.clone(),
            arrivals: self.arrivals.clone(),
            alignment_lags: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}
impl std::fmt::Debug for Grid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Grid")
            .field("directions", &self.directions.len())
            .field("cached_lags", &self.alignment_lags.lock().map(|c| c.len()).unwrap_or(0))
            .finish()
    }
}

/// Best whole-waveform lag of `b` relative to `a` for one ear. Positive lag
/// means `b` must be delayed by that many samples to align with `a`.
fn waveform_alignment_lag(a: &[f32], b: &[f32], max_lag: isize) -> i32 {
    let energy_a: f64 = a.iter().map(|v| (*v as f64).powi(2)).sum();
    if energy_a <= 1e-20 { return 0; }
    let mut best = (0_i32, f64::NEG_INFINITY);
    for lag in -max_lag..=max_lag {
        // After applying `lag` to b, compare the overlapping region.
        // lag >= 0: b[t] aligns with a[t + lag]. lag < 0: b[t - lag] with a[t].
        let (a_start, b_start) = if lag >= 0 { (lag as usize, 0usize) } else { (0usize, (-lag) as usize) };
        let overlap = a.len().saturating_sub(a_start).min(b.len().saturating_sub(b_start));
        let mut correlation = 0.0_f64;
        let mut energy_b = 0.0_f64;
        for t in 0..overlap {
            let av = a[a_start + t] as f64;
            let bv = b[b_start + t] as f64;
            correlation += av * bv;
            energy_b += bv * bv;
        }
        if energy_b <= 1e-20 { continue; }
        let normalized = correlation / (energy_a * energy_b).sqrt();
        if normalized > best.1 { best = (lag as i32, normalized); }
    }
    best.0
}

impl Grid {
    fn pair_lag(&self, irs: &[StereoIr], a: usize, b: usize) -> [i32; 2] {
        let key = if a <= b { (a, b) } else { (b, a) };
        if let Ok(cached) = self.alignment_lags.lock() {
            if let Some(lags) = cached.get(&key) {
                return *lags;
            }
        }
        let (first, second) = if a <= b { (a, b) } else { (b, a) };
        let mut lags = [0_i32; 2];
        for (ear, slot) in lags.iter_mut().enumerate() {
            let n = irs[first].dry.len() / 2;
            let a_slice = &irs[first].dry[ear * n..(ear + 1) * n];
            let b_slice = &irs[second].dry[ear * n..(ear + 1) * n];
            // Store the lag of `second` relative to `first`.
            let lag = waveform_alignment_lag(a_slice, b_slice, 40);
            *slot = if a <= b { lag } else { -lag };
        }
        if let Ok(mut cache) = self.alignment_lags.lock() {
            cache.insert(key, lags);
        }
        lags
    }
}
fn unit(az: f64, el: f64) -> [f64; 3] {
    let a = az.to_radians();
    let e = el.to_radians();
    [-a.sin() * e.cos(), a.cos() * e.cos(), e.sin()]
}
fn add_shifted(output: &mut [f32], input: &[f32], offset: isize, gain: f32) {
    if gain == 0.0 {
        return;
    }
    let src = (-offset).max(0) as usize;
    let dst = offset.max(0) as usize;
    if src >= input.len() || dst >= output.len() {
        return;
    }
    for (a, b) in output[dst..].iter_mut().zip(&input[src..]) {
        *a += b * gain;
    }
}
impl Grid {
    pub fn new(irs: &[StereoIr]) -> Self {
        Self {
            directions: irs
                .iter()
                .map(|ir| unit(ir.azimuth, ir.elevation))
                .collect(),
            arrivals: irs
                .iter()
                .map(|ir| {
                    let n = ir.dry.len() / 2;
                    std::array::from_fn(|ear| {
                        ir.dry[ear * n..(ear + 1) * n]
                            .iter()
                            .enumerate()
                            .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
                            .map_or(0, |x| x.0)
                    })
                })
                .collect(),
            alignment_lags: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
    fn weights(&self, az: f64, el: f64) -> Vec<(usize, f64)> {
        let u = unit(az, el);
        let mut distances: Vec<_> = self
            .directions
            .iter()
            .enumerate()
            .map(|(i, p)| {
                (
                    i,
                    (2.0 - 2.0 * p.iter().zip(u).map(|(a, b)| a * b).sum::<f64>())
                        .max(0.0)
                        .sqrt(),
                )
            })
            .collect();
        distances.sort_by(|a, b| a.1.total_cmp(&b.1));
        if distances[0].1 < 1e-7 {
            let count = distances.iter().take_while(|x| x.1 < 1e-7).count();
            return distances
                .iter()
                .take(count)
                .map(|x| (x.0, 1.0 / count as f64))
                .collect();
        }
        // Include all tied neighbours. Weights vanish at the support boundary,
        // avoiding discontinuities when nearest-neighbour membership changes.
        let radius = distances[(distances.len() - 1).min(7)].1 * 1.05 + 1e-6;
        let mut weights: Vec<_> = distances
            .into_iter()
            .take_while(|x| x.1 < radius)
            .map(|(i, d)| {
                let t = d / radius;
                (i, (1.0 - t).powi(4) * (1.0 + 4.0 * t) / (d * d))
            })
            .collect();
        let sum: f64 = weights.iter().map(|x| x.1).sum();
        for w in &mut weights {
            w.1 /= sum;
        }
        weights
    }
    pub fn interpolate(&self, irs: &[StereoIr], az: f64, el: f64) -> (Vec<f32>, Vec<f32>) {
        let weights = self.weights(az, el);
        let n = irs.iter().map(|ir| ir.dry.len() / 2).max().unwrap_or(0);
        let mut output = [vec![0.0; n + 4], vec![0.0; n + 4]];
        // The dominant measurement anchors the output position (its ITD and
        // level pattern are physically intact); every other neighbour is
        // whole-waveform aligned to it per ear before mixing. Aligning to a
        // weighted average arrival instead leaves the fine phase structure
        // misaligned, and the mix then cancels the correlated part between
        // the ears, collapsing interaural coherence (unfocused, "wide"
        // imaging). Per-ear alignment keeps the frontal IACC at the measured
        // level; the mix interpolates each ear's fine structure toward the
        // dominant direction, which is the physically expected behaviour of
        // a source between two measurements.
        let dominant = weights
            .iter()
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map_or(0, |x| x.0);
        for ear in 0..2 {
            for &(index, weight) in &weights {
                let len = irs[index].dry.len() / 2;
                let shift = if index == dominant {
                    0.0
                } else {
                    let lag = self.pair_lag(irs, dominant, index)[ear];
                    // lag of `index` relative to `dominant`; align by shifting
                    // the neighbour back onto the dominant's timeline.
                    f64::from(-lag)
                };
                let base = shift.floor() as isize;
                let fraction = (shift - base as f64) as f32;
                let input = &irs[index].dry[ear * len..(ear + 1) * len];
                add_shifted(
                    &mut output[ear],
                    input,
                    -base,
                    weight as f32 * (1.0 - fraction),
                );
                add_shifted(
                    &mut output[ear],
                    input,
                    -(base + 1),
                    weight as f32 * fraction,
                );
            }
        }
        // Delay alignment prevents duplicated onsets, but interpolation of
        // different waveforms (including fractional shifts) loses energy. Use
        // the weighted measurement energy as a layout-independent reference.
        // Both ears receive the same scalar: preserve ITD and interaural level.
        let target: f64 = weights.iter().map(|(i,w)|
            irs[*i].dry.iter().map(|v|(*v as f64).powi(2)).sum::<f64>() * w).sum();
        let actual: f64 = output.iter().flatten().map(|v|(*v as f64).powi(2)).sum();
        if actual > 1e-20 && target > 1e-20 {
            let scale=(target/actual).sqrt() as f32;
            for ear in &mut output {for v in ear {*v *= scale;}}
        }
        let [left, right] = output;
        (left, right)
    }
    /// Object-local quadrature, independent of the virtual speaker layout.
    /// Staggered arrivals reduce coherent buildup between directions. Normalize
    /// the response energy, not the PCM, so musical dynamics remain untouched.
    pub fn footprint(&self, irs: &[StereoIr], direction: Direction) -> (Vec<f32>, Vec<f32>) {
        let mut direct = self.direct_footprint(irs, direction);
        let diffuse = direction.diffuse.clamp(0.0, 1.0);
        if diffuse == 0.0 { return direct; }
        let energy = |p: &(Vec<f32>,Vec<f32>)| -> f64 {
            p.0.iter().chain(&p.1).map(|v| (*v as f64).powi(2)).sum()
        };
        let n = direct.0.len() + 127;
        let mut field = (vec![0.0; n], vec![0.0; n]);
        let mut reference_energy = 0.0;
        for i in 0..12 {
            let az = i as f64 * 137.507764;
            let el = if direction.horizontal_only {0.0} else {
                (1.0 - 2.0 * (i as f64 + 0.5) / 12.0).asin().to_degrees()
            };
            let p = unit(az, el).map(|v|v as f32);
            let relative = spatial::adm_to_spherical(spatial::head_relative_adm(p, direction.head));
            let pair = self.interpolate(irs, relative.azimuth as f64, relative.elevation as f64);
            reference_energy += energy(&pair) / 12.0;
            let delay = (i * 37 % 128) as isize;
            add_shifted(&mut field.0, &pair.0, delay, 1.0 / 12.0_f32.sqrt());
            add_shifted(&mut field.1, &pair.1, delay, 1.0 / 12.0_f32.sqrt());
        }
        let field_energy = energy(&field);
        let scale = if field_energy > 1e-20 {(reference_energy / field_energy).sqrt() as f32}else{0.0};
        let target_energy = energy(&direct) * (1.0-diffuse) as f64 + reference_energy * diffuse as f64;
        direct.0.resize(n,0.0); direct.1.resize(n,0.0);
        for (out, spread) in [(&mut direct.0, &field.0), (&mut direct.1, &field.1)] {
            for (a,b) in out.iter_mut().zip(spread) {*a = *a * (1.0-diffuse).sqrt() + *b * scale * diffuse.sqrt();}
        }
        let mixed_energy = energy(&direct);
        if mixed_energy > 1e-20 {
            let scale = (target_energy / mixed_energy).sqrt() as f32;
            for v in direct.0.iter_mut().chain(&mut direct.1) {*v *= scale;}
        }
        direct
    }

    fn direct_footprint(&self, irs: &[StereoIr], direction: Direction) -> (Vec<f32>, Vec<f32>) {
        let s = spatial::adm_to_spherical(direction.position);
        let at = |az: f64, el: f64| {
            let p = unit(az, el).map(|x| x as f32);
            let relative = spatial::adm_to_spherical(spatial::head_relative_adm(p, direction.head));
            self.interpolate(irs, relative.azimuth as f64, relative.elevation as f64)
        };
        let mut pair = at(s.azimuth as f64, s.elevation as f64);
        if direction.width == 0.0 && direction.height == 0.0 {
            return pair;
        }
        // Zero height/depth often makes several quadrature points identical.
        // Merge their weights before interpolating; retain the same footprint.
        let mut points = vec![(s.azimuth as f64, s.elevation as f64, 1.0_f32 / 3.0)];
        for (da, de, r) in [
            (-0.5, 0.0, 1.0),
            (0.5, 0.0, 1.0),
            (0.0, -0.5, 1.0),
            (0.0, 0.5, 1.0),
            (-0.5, 0.0, 1.0 - direction.depth * 0.5),
            (0.5, 0.0, 1.0 - direction.depth * 0.5),
            (-0.5, 0.0, 1.0 + direction.depth * 0.5),
            (0.5, 0.0, 1.0 + direction.depth * 0.5),
        ] {
            let az = (s.azimuth + da * direction.width / r) as f64;
            let el = (s.elevation + de * direction.height / r).clamp(-89.9, 89.9) as f64;
            if let Some(point) = points.iter_mut().find(|p| p.0 == az && p.1 == el) {
                point.2 += 1.0 / 12.0;
            } else {
                points.push((az, el, 1.0 / 12.0));
            }
        }
        for x in pair.0.iter_mut().chain(&mut pair.1) {
            *x *= points[0].2;
        }
        for &(az, el, weight) in &points[1..] {
            let next = at(az, el);
            for (out, input) in [(&mut pair.0, next.0), (&mut pair.1, next.1)] {
                for (a, b) in out.iter_mut().zip(input) {
                    *a += b * weight;
                }
            }
        }
        pair
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interpolation_preserves_measured_energy_between_directions() {
        let mut a=vec![0.0;64];let mut b=a.clone();
        a[4]=1.0;a[5]=0.5;a[36]=0.7;a[37]=0.35;
        b[5]=1.0;b[6]=-0.5;b[37]=0.7;b[38]=-0.35;
        let irs=vec![StereoIr{azimuth:-30.0,elevation:0.0,dry:a,wet:vec![]},StereoIr{azimuth:30.0,elevation:0.0,dry:b,wet:vec![]}];
        let grid=Grid::new(&irs);
        let expected: f64=irs[0].dry.iter().map(|v|(*v as f64).powi(2)).sum();
        for az in [-30.0,-15.0,0.0,15.0,30.0] {
            let (l,r)=grid.interpolate(&irs,az,0.0);
            let energy:f64=l.iter().chain(&r).map(|v|(*v as f64).powi(2)).sum();
            assert!((energy/expected-1.0).abs()<1e-6,"energy dip at {az}");
            assert!(l.iter().zip(&r).all(|(l,r)|(r-l*0.7).abs()<1e-6),"interaural balance changed");
        }
    }
    #[test]
    fn hardware_objects_keep_direction_and_match_parallel_mixing() {
        let render = |hardware: bool, fast: bool, position: [f32;3]| {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../web/public/hrtf/hrtf-set.json");
            let mut e = crate::Engine::new(48000,2);
            e.cinema.monitor.hardware.enabled = hardware;
            e.cinema.monitor.hardware.rail_v = 1.0;
            e.directional_hrtf = true;
            e.disable_fast_objects = !fast;
            e.replace_hrtf(crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap(),0.0).unwrap();
            e.direct_mix = 1.0;
            e.paused = false; e.output_active = true;
            for id in 0..8 {
                let mut source = crate::Source { kind: crate::SourceKind::Object,
                    position, diffuse: if id==0 {0.25}else{0.0},
                    gain:1.0,target_gain:1.0,availability:1.0,availability_target:1.0,..Default::default() };
                let pcm:Vec<_>=(0..16384).map(|i|0.08*(i as f32*0.13+id as f32).sin()).collect();
                source.samples.write(0,0,&pcm);
                let key=format!("obj:{id}");e.sources.insert(key.clone(),source);e.route_source_now(&key,0).unwrap();
            }
            let mut out=vec![0.0;32768];e.render_into(&mut out,2);
            assert!(e.sources.values().all(|s|s.continuous_active && s.continuous.is_some() && s.direct.is_none()));
            if fast {assert!(e.fast_object_blocks>0);}
            assert!(out.iter().all(|v|v.is_finite()));
            if hardware && fast {
                for source in e.sources.values_mut() {
                    source.zone_exclusion = vec![crate::adm_zone::Zone::Polar {
                        min:[-180.0,80.0],max:[180.0,90.0]
                    }].into();
                    let pcm:Vec<_>=(0..32768).map(|i|0.01*(i as f32*0.13).sin()).collect();
                    source.samples.write(16384,16384,&pcm);
                }
                let mut tail=vec![0.0;65536]; e.render_into(&mut tail,2);
                assert!(tail[49152..].iter().any(|v|v.abs()>1e-5),"hardware exclusion fallback lost audio");
                assert!(e.sources.values().all(|s|!s.continuous_active && s.direct.is_none()));
            }
            out
        };
        let left=render(true,true,[-0.8,0.5,0.0]);
        let slow=render(true,false,[-0.8,0.5,0.0]);
        assert!(left.iter().zip(&slow).all(|(a,b)|(a-b).abs()<2e-6));
        let right=render(true,true,[0.8,0.5,0.0]);
        let dry=render(false,true,[-0.8,0.5,0.0]);
        let energy=|v:&[f32]|v[8192..].iter().map(|v|v*v).sum::<f32>();
        assert!(energy(&left)>1e-8);
        assert!(energy(&left)<energy(&dry)*0.5,"hardware must affect object PCM");
        let delta:f32=left.iter().zip(&right).map(|(a,b)|(a-b).abs()).sum();
        assert!(delta>0.01,"hardware must not disable spatial direction");
    }
    #[test]
    fn diffuse_response_preserves_energy_and_partial_sources_keep_direction() {
        let irs: Vec<_> = (0..12).map(|i| {
            let mut dry = vec![0.0; 64];
            dry[4 + i % 4] = 1.0;
            dry[32 + 7 - i % 4] = 1.0;
            StereoIr { azimuth: i as f64 * 30.0, elevation: 0.0,
                dry, wet: vec![] }
        }).collect();
        let grid = Grid::new(&irs);
        let base = Direction { position: [0.0,1.0,0.0], head: None,
            width: 0.0, height: 0.0, depth: 0.0, diffuse: 0.0, horizontal_only: true };
        let energy = |p: &(Vec<f32>,Vec<f32>)| p.0.iter().chain(&p.1).map(|v|v*v).sum::<f32>();
        for diffuse in [0.25,0.5,1.0] {
            let a = grid.footprint(&irs,Direction { diffuse, ..base });
            let b = grid.footprint(&irs,Direction { diffuse, position:[1.0,0.0,0.0], ..base });
            assert!(energy(&a) > 0.5 && energy(&a) < 2.01);
            if diffuse < 1.0 { assert_ne!(a,b); }
            else { assert_eq!(a,b, "fully diffuse field has no authored point direction"); }
        }
    }
    #[test]
    #[ignore = "offline full engine realtime budget measurement"]
    fn benchmark_shared_engine_108() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/public/hrtf/hrtf-set.json");
        let blocks=400_usize;
        let total_frames=(blocks*crate::convolution::DEFAULT_PARTITION) as u32;
        let mut e = crate::Engine::new(48000, 2);
        e.set_layout(crate::vbap::LayoutId::Dolby9_1_6).unwrap();
        if let Ok(path) = std::env::var("SDA_BENCH_ROOM") {
            let room = crate::cinema::RoomProfile::load(&path).unwrap();
            e.set_layout(crate::vbap::LayoutId::parse(&room.layout).unwrap())
                .unwrap();
            e.cinema.enabled = true;
            e.room_profile = Some(std::sync::Arc::new(room));
        }
        e.replace_hrtf(
            crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap(),
            0.04,
        )
        .unwrap();
        e.directional_hrtf = true;
        e.near_field.enabled = true;
        e.source_extent = crate::source_extent::Settings {
            enabled: true,
            width: 0.25,
            diffusion: 0.12,
        };
        if std::env::var_os("SDA_BENCH_POINT").is_some() {
            e.source_extent.width = 0.0;
            e.source_extent.diffusion = 0.0;
        }
        eprintln!(
            "benchmark layout={} room={} width={} diffusion={}",
            e.layout.as_str(),
            e.cinema.enabled,
            e.source_extent.width,
            e.source_extent.diffusion
        );
        e.paused = false;
        e.output_active = true;
        for id in 0..118 {
            let angle = id as f32 * 0.13;
            let object = id < 108;
            let mut source = crate::Source {
                kind: if object {
                    crate::SourceKind::Object
                } else {
                    crate::SourceKind::Bed
                },
                object_id: object.then_some(id),
                position: [angle.cos() * 0.7, angle.sin() * 0.7, 0.3],
                bed_label: (!object).then(|| {
                    crate::vbap::speakers(e.layout)[(id - 108) as usize]
                        .name
                        .into()
                }),
                gain: 1.0,
                target_gain: 1.0,
                availability: 1.0,
                availability_target: 1.0,
                ..Default::default()
            };
            let samples: Vec<_> = (0..total_frames)
                .map(|i| ((i + id * 17) as f32 * 0.013).sin() * 0.001)
                .collect();
            source.samples.write(0, 0, &samples);
            if object {
                source.spatial_events.insert(
                    0,
                    crate::SpatialEvent {
                        position: [(angle + 0.6).cos() * 0.7, (angle + 0.6).sin() * 0.7, 0.5],
                        extent: [0.0; 3],
                        zone_exclusion: Default::default(),
                        horizontal_only: false,
                        diffuse: 0.0,
                        spread: 0.0,
                        ramp: total_frames,
                    },
                );
            }
            if !object {
                let label = source.bed_label.clone().unwrap();
                crate::Engine::set_source_route(&mut source, crate::bed_route(&label, &e.vbap), 0);
            }
            let name = format!("source:{id}");
            e.sources.insert(name.clone(), source);
            e.route_source_now(&name, 0).unwrap();
        }
        let mut times = Vec::new();
        let mut cold = 0.0_f64;
        let mut output = vec![0.0; crate::convolution::DEFAULT_PARTITION * 2];
        for block in 0..blocks {
            if block == 16 {
                e.profile_ms = [0.0; 4];
            }
            let start = std::time::Instant::now();
            e.render_into(&mut output, 2);
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            assert!(output.iter().all(|x| x.is_finite()));
            if block >= 16 {
                times.push(ms)
            } else {
                cold += ms;
            }
        }
        eprintln!(
            "stage ms route / directional / legacy / buses: {:?}",
            e.profile_ms.map(|v| v / (blocks-16) as f64)
        );
        eprintln!("source-major object blocks={}", e.fast_object_blocks);
        times.sort_by(f64::total_cmp);
        eprintln!(
            "FULL 108 moving objects + 10 beds + reflections + near: mean={:.2} p95={:.2} max={:.2}ms budget=21.33ms; first 16 blocks={cold:.2}ms (audio 341.33ms)",
            times.iter().sum::<f64>() / times.len() as f64,
            times[times.len() * 95 / 100],
            times[times.len() - 1]
        );
    }
    #[test]
    fn source_major_matches_sample_major_pcm_events_and_activity() {
        let build = |reference| {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../web/public/hrtf/hrtf-set.json");
            let mut e = crate::Engine::new(48000, 2);
            e.replace_hrtf(
                crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap(),
                0.04,
            )
            .unwrap();
            e.disable_fast_objects = reference;
            e.directional_hrtf = true;
            e.near_field.enabled = true;
            e.source_extent = crate::source_extent::Settings {
                enabled: true,
                width: 0.25,
                diffusion: 0.12,
            };
            e.paused = false;
            e.output_active = true;
            e.speaker_levels.fill(0.7);
            e.speaker_background.fill(0.25);
            for id in 0..18 {
                let object = id < 16;
                let angle = id as f32 * 0.4;
                let mut source = crate::Source {
                    kind: if object {
                        crate::SourceKind::Object
                    } else {
                        crate::SourceKind::Bed
                    },
                    object_id: object.then_some(id),
                    position: [angle.cos() * 0.6, angle.sin() * 0.6, 0.3],
                    gain: 1.0,
                    target_gain: 1.0,
                    availability: 1.0,
                    availability_target: 1.0,
                    ..Default::default()
                };
                let samples: Vec<_> = (0..32000)
                    .map(|i| ((i + id * 13) as f32 * 0.027).sin() * 0.001)
                    .collect();
                source.samples.write(0, 0, &samples[..8000]);
                source.samples.write(0, 10000, &samples[10000..]);
                source.gain_events.insert(
                    57,
                    crate::GainEvent {
                        gain: 0.65,
                        ramp: 123,
                    },
                );
                source.mute_events.insert(111, id % 2 == 0);
                source.mute_events.insert(1293, false);
                if object {
                    source.spatial_events.insert(
                        31,
                        crate::SpatialEvent {
                            position: [-0.3, 0.2, 0.7],
                            extent: [0.2, 0.1, 0.1],
                            zone_exclusion: if id == 1 {
                                std::sync::Arc::from([crate::adm_zone::Zone::Polar {
                                    min: [20.0, -10.0],
                                    max: [40.0, 10.0],
                                }])
                            } else {
                                Default::default()
                            },
                            horizontal_only: id % 2 == 0,
                            diffuse: 0.2,
                            spread: 0.0,
                            ramp: 15000,
                        },
                    );
                } else {
                    let label = if id == 16 { "FrontLeft" } else { "FrontRight" };
                    source.bed_label = Some(label.into());
                    crate::Engine::set_source_route(
                        &mut source,
                        crate::bed_route(label, &e.vbap),
                        0,
                    );
                }
                if id == 3 {
                    source.remove_at = Some(28003);
                }
                let name = format!("source:{id}");
                e.sources.insert(name.clone(), source);
                e.route_source_now(&name, 0).unwrap();
            }
            e
        };
        let mut actual = build(false);
        let mut reference = build(true);
        let chunks = [31, 993, 17, 1024, 511, 2048];
        let mut step = 0;
        while actual.sample_pos < 32000 {
            let frames = chunks[step % chunks.len()].min((32000 - actual.sample_pos) as usize);
            let mut a = vec![0.0; frames * 2];
            let mut b = a.clone();
            actual.render_into(&mut a, 2);
            reference.render_into(&mut b, 2);
            let delta = a
                .iter()
                .zip(&b)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0_f32, f32::max);
            assert!(
                a.iter().all(|x| x.is_finite()) && delta < 1e-3,
                "transposed mixer PCM mismatch at {}: {delta}",
                actual.sample_pos
            );
            assert_eq!(actual.underrun_samples, reference.underrun_samples);
            assert_eq!(actual.route_update_count, reference.route_update_count);
            assert_eq!(
                actual.last_queued_activity.active_ids(),
                reference.last_queued_activity.active_ids()
            );
            for (id, source) in &actual.sources {
                let other = &reference.sources[id];
                assert_eq!(source.position, other.position);
                assert_eq!(source.bus_gains, other.bus_gains);
                assert_eq!(source.gain, other.gain);
            }
            step += 1;
        }
        assert!(actual.fast_object_blocks > 0);
        assert_eq!(reference.fast_object_blocks, 0);
    }
    #[test]
    fn cold_start_and_mode_switches_settle_to_the_same_pcm() {
        let build = |enabled| {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../web/public/hrtf/hrtf-set.json");
            let mut e = crate::Engine::new(48000, 2);
            e.replace_hrtf(
                crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap(),
                0.04,
            )
            .unwrap();
            e.directional_hrtf = enabled;
            e.near_field.enabled = true;
            e.paused = false;
            e.output_active = true;
            let mut source = crate::Source {
                kind: crate::SourceKind::Object,
                position: [0.4, 0.3, 0.2],
                gain: 1.0,
                target_gain: 1.0,
                availability: 1.0,
                availability_target: 1.0,
                ..Default::default()
            };
            let samples: Vec<_> = (0..98304)
                .map(|i| (i as f32 * 0.031).sin() * 0.01)
                .collect();
            source.samples.write(0, 0, &samples);
            e.sources.insert("obj:1".into(), source);
            e.route_source_now("obj:1", 0).unwrap();
            e
        };
        let mut actual = build(true);
        let mut reference = build(false);
        let mut a = vec![0.0; 2048];
        let mut b = a.clone();
        for block in 0..96 {
            if block == 24 {
                actual.directional_hrtf = false;
            }
            if block == 48 {
                actual.directional_hrtf = true;
                reference.directional_hrtf = true;
            }
            actual.render_into(&mut a, 2);
            reference.render_into(&mut b, 2);
            assert!(a.iter().chain(&b).all(|x| x.is_finite()));
            if block == 0 {
                assert!(
                    actual.sources["obj:1"].direct.is_none(),
                    "new continuous source allocated a legacy room convolver"
                );
                assert!(actual.sources["obj:1"].continuous.is_some());
            }
            if (44..48).contains(&block) || block >= 88 {
                let delta = a
                    .iter()
                    .zip(&b)
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0_f32, f32::max);
                assert!(
                    delta < 2e-6,
                    "mode switch did not settle at block {block}: {delta}"
                );
                assert!(
                    a.iter().any(|x| x.abs() > 1e-5),
                    "mode switch lost the object"
                );
            }
        }
    }
    #[test]
    fn authored_diffuse_objects_use_independent_convolution_when_directional_is_toggled() {
        for diffuse in [0.25, 1.0] {
            let build = |enabled| {
                let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../web/public/hrtf/hrtf-set.json");
                let mut e = crate::Engine::new(48000, 2);
                e.replace_hrtf(crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap(), 0.04).unwrap();
                e.directional_hrtf = enabled;
                e.direct_objects = true;
                e.direct_mix = 1.0;
                e.paused = false;
                e.output_active = true;
                let mut source = crate::Source {
                    kind: crate::SourceKind::Object, position: [-0.22, 1.0, 0.19], diffuse,
                    gain: 1.0, target_gain: 1.0, availability: 1.0, availability_target: 1.0,
                    ..Default::default()
                };
                let pcm: Vec<_> = (0..65536).map(|i| (i as f32 * 0.031).sin() * 0.01).collect();
                source.samples.write(0, 0, &pcm);
                e.sources.insert("obj:11".into(), source);
                e.route_source_now("obj:11", 0).unwrap();
                e
            };
            let mut actual = build(true);
            let mut reference = build(false);
            let mut difference = 0.0_f32;
            for block in 0..64 {
                if block == 16 { actual.directional_hrtf = false; }
                if block == 32 { actual.directional_hrtf = true; }
                let mut a = [0.0; 2048]; let mut b = a;
                actual.render_into(&mut a, 2); reference.render_into(&mut b, 2);
                if block > 48 { difference += a.iter().zip(b).map(|(a,b)|(a-b).abs()).sum::<f32>(); }
                assert!(a.iter().all(|x|x.is_finite()));
                if block > 4 { assert!(a.iter().any(|x| x.abs()>1e-5)); }
            }
            assert!(difference > 0.01, "directional must not fall back to layout");
            assert!(actual.sources["obj:11"].continuous_active);
            assert!(actual.sources["obj:11"].direct.is_none());
            assert_eq!(actual.sources["obj:11"].diffusion_mix, 0.0);
        }
    }
    #[test]
    fn shared_reflections_match_independent_objects_with_near_field_and_focus() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/public/hrtf/hrtf-set.json");
        let mut set = crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap();
        let solver = crate::vbap::VbapSolver::with_layout(crate::vbap::LayoutId::Dolby9_1_6);
        let mut buses = crate::bus_renderer::BusRenderer::new(&set, &solver, 0.04).unwrap();
        let mut old: Vec<_> = (0..4)
            .map(|_| crate::direct_renderer::DirectSource::new(&set, 0.04).unwrap())
            .collect();
        let mut new: Vec<_> = (0..4)
            .map(|_| ContinuousSource::new(&set).unwrap())
            .collect();
        for source in &mut old {
            source.near_reference = Some(Box::new(
                crate::direct_renderer::DirectSource::new(&set, 0.0).unwrap(),
            ));
        }
        let amounts = std::array::from_fn(|i| if i % 2 == 0 { 0.4 } else { 0.0 });
        let mut difference = 0.0_f32;
        let mut tail = false;
        for block in 0..48 {
            buses.begin_block();
            for (id, (a, b)) in old.iter_mut().zip(&mut new).enumerate() {
                let gains = solver.pan([id as f32 * 0.2 - 0.3, 0.6, 0.4], 0.0);
                let direction = Direction {
                    position: [(block as f32 * 0.04 + id as f32).sin() * 0.6, 0.5, 0.3],
                    head: None,
                    diffuse: 0.0, horizontal_only: false,
                    width: 30.0,
                    height: 20.0,
                    depth: 0.3,
                };
                a.direction = Some(direction);
                a.schedule_focus(solver.layout(), 0.04, gains, amounts);
                b.schedule(direction, solver.layout(), gains, amounts);
                for i in 0..crate::convolution::DEFAULT_PARTITION {
                    let input = if block < 20 {
                        ((block * crate::convolution::DEFAULT_PARTITION + i + id * 17) as f32
                            * 0.19)
                            .sin()
                            * 0.01
                    } else {
                        0.0
                    };
                    a.input[i] = input;
                    b.frames[i].input = input;
                    a.near_targets[i] = [1.2, 0.7];
                    b.frames[i].near = [1.2, 0.7];
                    buses.add_reflections(input, &gains, i);
                }
            }
            for i in 0..crate::convolution::DEFAULT_PARTITION {
                buses.shape_background(i, &amounts);
            }
            crate::direct_renderer::finish_sources(old.iter_mut(), &mut set, &solver, 0.04)
                .unwrap();
            finish_sources(new.iter_mut(), &set).unwrap();
            buses.finish_block().unwrap();
            for i in 0..crate::convolution::DEFAULT_PARTITION {
                let room = buses.output_at(i);
                for ear in 0..2 {
                    let expected: f32 = old
                        .iter()
                        .map(|s| if ear == 0 { s.left[i] } else { s.right[i] })
                        .sum();
                    let actual: f32 =
                        room[ear] + new.iter().map(|s| s.frames[i].output[ear]).sum::<f32>();
                    difference = difference.max((expected - actual).abs());
                    if block > 20 && room[ear].abs() > 1e-6 {
                        tail = true;
                    }
                }
            }
        }
        assert!(tail);
        assert!(difference < 2e-6, "shared-room PCM difference {difference}");
    }

    #[test]
    #[ignore = "offline 108-object shared reflection performance measurement"]
    fn benchmark_shared_directional_objects() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/public/hrtf/hrtf-set.json");
        let set = crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap();
        let solver = crate::vbap::VbapSolver::with_layout(crate::vbap::LayoutId::Dolby9_1_6);
        let mut sources: Vec<_> = (0..108)
            .map(|_| ContinuousSource::new(&set).unwrap())
            .collect();
        let mut buses = crate::bus_renderer::BusRenderer::new(&set, &solver, 0.04).unwrap();
        for width in [0.0, 30.0] {
            let mut times = Vec::new();
            for block in 0..80 {
                let start = std::time::Instant::now();
                buses.begin_block();
                for (id, source) in sources.iter_mut().enumerate() {
                    let angle = id as f32 * 0.13 + block as f32 * 0.01;
                    let position = [angle.cos() * 0.7, angle.sin() * 0.7, 0.3];
                    let gains = solver.pan(position, 0.0);
                    source.schedule(
                        Direction {
                            position,
                            head: None,
                    diffuse: 0.0, horizontal_only: false,
                            width,
                            height: 0.0,
                            depth: 0.0,
                        },
                        solver.layout(),
                        gains,
                        [0.0; crate::vbap::MAX_BUS_COUNT],
                    );
                    for frame in &mut source.frames {
                        frame.input = 0.001;
                        frame.near = [1.2, 0.7];
                    }
                    for i in 0..crate::convolution::DEFAULT_PARTITION {
                        buses.add_reflections(0.001, &gains, i);
                    }
                }
                for i in 0..crate::convolution::DEFAULT_PARTITION {
                    buses.shape_background(i, &[0.0; crate::vbap::MAX_BUS_COUNT]);
                }
                finish_sources(sources.iter_mut(), &set).unwrap();
                buses.finish_block().unwrap();
                if block >= 16 {
                    times.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            times.sort_by(f64::total_cmp);
            eprintln!(
                "108 moving + shared room + near, width={width}: mean={:.2} p95={:.2} max={:.2} ms; budget=21.33ms",
                times.iter().sum::<f64>() / times.len() as f64,
                times[times.len() * 95 / 100],
                times[times.len() - 1]
            );
        }
    }
    #[test]
    #[ignore = "offline directional convolution performance measurement"]
    fn benchmark_directional_objects() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../web/public/hrtf/hrtf-set.json");
        let mut set = crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap();
        let solver = crate::vbap::VbapSolver::with_layout(crate::vbap::LayoutId::Dolby9_1_6);
        let mut sources: Vec<_> = (0..108)
            .map(|_| crate::direct_renderer::DirectSource::new(&set, 0.04).unwrap())
            .collect();
        for width in [0.0, 30.0] {
            let start = std::time::Instant::now();
            for block in 0..30 {
                for (id, source) in sources.iter_mut().enumerate() {
                    let phase = id as f32 * 0.13 + block as f32 * 0.01;
                    let position = [phase.cos() * 0.7, phase.sin() * 0.7, 0.3];
                    source.direction = Some(Direction {
                        position,
                        head: None,
                    diffuse: 0.0, horizontal_only: false,
                        width,
                        height: 0.0,
                        depth: 0.0,
                    });
                    source.schedule_focus(
                        solver.layout(),
                        0.04,
                        solver.pan(position, 0.0),
                        [0.0; crate::vbap::MAX_BUS_COUNT],
                    );
                    source.input.fill(0.001);
                }
                crate::direct_renderer::finish_sources(sources.iter_mut(), &mut set, &solver, 0.04)
                    .unwrap();
            }
            eprintln!(
                "108 moving objects width={width}: {:.2} ms/block (audio {:.2} ms)",
                start.elapsed().as_secs_f64() * 1000.0 / 30.0,
                crate::convolution::DEFAULT_PARTITION as f64 / 48.0
            );
        }
    }
    #[test]
    fn actual_object_pcm_uses_direction_instead_of_layout() {
        let render = |layout: crate::vbap::LayoutId, enabled: bool| {
            let mut e = crate::Engine::new(48000, 2);
            e.set_layout(layout).unwrap();
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../web/public/hrtf/hrtf-set.json");
            e.replace_hrtf(
                crate::hrtf::NativeHrtfSet::load_calibrated(&path).unwrap(),
                0.0,
            )
            .unwrap();
            e.directional_hrtf = enabled;
            e.paused = false;
            e.output_active = true;
            let mut source = crate::Source {
                kind: crate::SourceKind::Object,
                position: [0.7, -0.5, 0.4],
                gain: 1.0,
                target_gain: 1.0,
                availability: 1.0,
                availability_target: 1.0,
                ..Default::default()
            };
            let samples: Vec<_> = (0..24000).map(|i| (i as f32 * 0.17).sin() * 0.01).collect();
            source.samples.write(0, 0, &samples);
            e.sources.insert("obj:1".into(), source);
            e.route_source_now("obj:1", 0).unwrap();
            let mut out = vec![0.0; 48000];
            e.render_into(&mut out, 2);
            out
        };
        let a = render(crate::vbap::LayoutId::Dolby5_1_2, true);
        let b = render(crate::vbap::LayoutId::Dolby9_1_6, true);
        let old = render(crate::vbap::LayoutId::Dolby5_1_2, false);
        assert!(a.iter().chain(&b).all(|x| x.is_finite()));
        let difference = a[36000..]
            .iter()
            .zip(&b[36000..])
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            difference < 2e-6,
            "layout leaked into uncalibrated dry direction: {difference}"
        );
        assert!(
            a[36000..]
                .iter()
                .zip(&old[36000..])
                .map(|(a, b)| (a - b).abs())
                .sum::<f32>()
                > 0.01
        );
    }
    #[test]
    fn delay_alignment_preserves_itd_and_does_not_duplicate_impulses() {
        // Waveform-structured bursts (decaying tail after the onset) so the
        // whole-waveform alignment has fine structure to lock onto, mirroring
        // real measurements. Left burst at `l`, right burst at 64 + `r` (each
        // ear owns one half of the packed dry buffer).
        let mut seed = 12345_u32;
        let mut burst = |position: usize, offset: usize| -> Vec<f32> {
            let mut dry = vec![0.0; 128];
            dry[offset + position] = 1.0;
            for k in 1..24 {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                if offset + position + k < 128 {
                    dry[offset + position + k] = ((seed >> 9) % 2000) as f32 / 65536.0;
                }
            }
            dry
        };
        let irs: Vec<_> = [(-30.0, 10, 20), (30.0, 20, 10)]
            .into_iter()
            .map(|(az, l, r)| {
                let mut dry = vec![0.0; 128];
                for (i, v) in burst(l, 0).iter().enumerate() { dry[i] += *v; }
                for (i, v) in burst(r, 64).iter().enumerate() { dry[i] += *v; }
                StereoIr { azimuth: az, elevation: 0.0, wet: dry.clone(), dry }
            })
            .collect();
        let grid = Grid::new(&irs);
        let (l, r) = grid.interpolate(&irs, 0.0, 0.0);
        // Between measurements each ear stays one onset group: the neighbour's
        // burst is aligned onto the dominant's, never left as a separate echo.
        assert!(l.iter().chain(&r).all(|v| v.is_finite()));
        let l_energy: f32 = l.iter().map(|v| v * v).sum();
        let r_energy: f32 = r.iter().map(|v| v * v).sum();
        assert!((l_energy - r_energy).abs() < 0.35 * l_energy, "centred source must stay balanced: {l_energy} vs {r_energy}");
        let late_tail: f32 = l[45..64].iter().map(|v| v * v).sum::<f32>() + r[45..64].iter().map(|v| v * v).sum::<f32>();
        assert!(late_tail < 0.05 * (l_energy + r_energy), "neighbour onset leaked as echo: {late_tail}");
        let (l, r) = grid.interpolate(&irs, -30.0, 0.0);
        assert_eq!(l[10], 1.0);
        assert_eq!(r[20], 1.0);
        let a = grid.interpolate(&irs, 179.99999, 0.0);
        let b = grid.interpolate(&irs, -179.99999, 0.0);
        // The rear-pole mirrors pick different dominant measurements, so the
        // two outputs are aligned to different timelines; both must stay sane
        // and within the same measured-energy envelope.
        assert!(a.0.iter().chain(&b.0).all(|v| v.is_finite()));
        let energy = |p: &(Vec<f32>, Vec<f32>)| -> f64 {
            p.0.iter().chain(&p.1).map(|v| (*v as f64).powi(2)).sum()
        };
        let (ea, eb) = (energy(&a), energy(&b));
        assert!(ea > 0.0 && eb > 0.0 && (ea / eb - 1.0).abs() < 0.1, "rear pole energy must match: {ea} vs {eb}");
    }
}
