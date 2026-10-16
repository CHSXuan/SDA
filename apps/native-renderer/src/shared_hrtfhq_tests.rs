//! Shared synthetic output contract; no copyrighted fixture or Apple runtime.
use super::*;
fn manifest() -> std::path::PathBuf {
    std::env::var_os("SDA_SHARED_PROFILE_MANIFEST").map(std::path::PathBuf::from)
        .unwrap_or_else(||std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../assets/hrtf/apple-hrtfhq-v1/hrtf-dense/hrtf-set.json"))
}
fn render(layout:vbap::LayoutId,chunk:usize) -> Vec<f32> {
    const FRAMES:usize=98304;
    let mut e=Engine::new(48000,2);e.set_layout(layout).unwrap();
    e.replace_hrtf(hrtf::NativeHrtfSet::load_calibrated(&manifest()).unwrap(),0.0).unwrap();
    e.set_direct_objects(true).unwrap();e.set_directional_hrtf(true);e.direct_mix=1.0;
    e.set_spatial_enhancement(true).unwrap();e.set_spatial_balance(false);e.front_common.enabled=false;
    e.set_master_preamp_db(-12.0).unwrap();
    e.set_program_codec(if layout==vbap::LayoutId::Dolby7_1_4 {"eac3"} else {"mpegh"}.into());
    e.output_active=true;e.paused=false;
    for (index,position) in [[0.,1.,0.],[-1.,0.,1.],[1.,0.,1.],[0.,-1.,0.],[-1.,1.,0.],
        [1.,1.,0.],[-0.7,-1.,0.6],[0.4,0.7,-0.5]].into_iter().enumerate() {
        let id=format!("obj:{}",index+1);let mut state=0x12345678u32.wrapping_add(index as u32);
        let pcm:Vec<f32>=(0..FRAMES).map(|i| {state=state.wrapping_mul(1664525).wrapping_add(1013904223);
            if i<4096 {0.0} else {((state>>16) as i32-32768) as f32*(0.02/32768.0)}}).collect();
        let mut source=Source{kind:SourceKind::Object,object_id:Some(index as u32+1),position,
            gain:1.,target_gain:1.,availability:1.,availability_target:1.,..Default::default()};
        source.samples.write(0,0,&pcm);e.sources.insert(id.clone(),source);e.route_source_now(&id,0).unwrap();
    }
    let mut output=vec![0.;FRAMES*2];
    for start in (0..FRAMES).step_by(chunk) {
        if start==32768 || start==65536 {
            let q=std::f32::consts::FRAC_1_SQRT_2;
            e.head_pose=Some(if start==32768 {[0.,0.,q,q]} else {[q,0.,0.,q]});
            e.pose_route_base=e.head_pose;
            if start==65536 {e.sources.get_mut("obj:8").unwrap().position=[-0.8,-0.5,0.8];}
            let ids:Vec<_>=e.sources.keys().cloned().collect();for id in ids {e.route_source_now(&id,256).unwrap();}
        }
        e.render_into(&mut output[start*2..(start+chunk).min(FRAMES)*2],2);
    }
    assert_eq!(e.peak_guard.diagnostic_gain(),1.0);
    assert!(output.iter().all(|v|v.is_finite()));assert!(output.iter().any(|v|v.abs()>1e-5));
    assert!(!e.active_hrtf_set.as_ref().unwrap().spatial_cues_active());
    assert_eq!(e.sources.len(),8);
    output
}
#[test]
fn shared_hrtfhq_synthetic_output_is_callback_partition_invariant() {
    for (name,layout) in [("atmos",vbap::LayoutId::Dolby7_1_4),("360ra",vbap::LayoutId::Sony360Ra13)] {
        let a=render(layout,128);let b=render(layout,512);
        let error=a.iter().zip(&b).map(|(a,b)|(a-b).abs()).fold(0.0f32,f32::max);
        assert!(error<2e-6,"callback partition changes shared {name} output: {error}");
        if let Some(root)=std::env::var_os("SDA_SHARED_PROFILE_PCM_DIR") {
            let root=std::path::PathBuf::from(root);std::fs::create_dir_all(&root).unwrap();
            let data:Vec<u8>=a.iter().flat_map(|v|v.to_le_bytes()).collect();
            std::fs::write(root.join(format!("{name}.f32")),data).unwrap();
        }
    }
}
