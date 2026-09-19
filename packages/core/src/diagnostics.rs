//! Structural diagnostics only. Never retains compressed bytes or decoder memory.
use std::cell::RefCell;
use serde::Serialize;
#[derive(Default)] struct Capture {enabled:bool,sequence:u64,bytes:usize,dropped:u64,events:Vec<Event>}
#[derive(Serialize)] #[serde(rename_all="camelCase")] struct Event {checkpoint:&'static str,sequence:u64,bytes:usize,error_tag:Option<String>}
thread_local! {static CAPTURE:RefCell<Capture>=RefCell::new(Capture::default());}
pub fn enable(value:bool){CAPTURE.with(|c|{*c.borrow_mut()=Capture{enabled:value,..Default::default()}});}
pub fn input(bytes:usize){CAPTURE.with(|c|{let mut c=c.borrow_mut();if c.enabled{c.bytes=bytes;c.sequence+=1;}});}
pub fn checkpoint(checkpoint:&'static str){record(checkpoint,None);}
fn record(checkpoint:&'static str,error_tag:Option<String>){CAPTURE.with(|c|{let mut c=c.borrow_mut();if !c.enabled{return;}if c.events.len()>=128{c.dropped+=1;return;}let event=Event{checkpoint,sequence:c.sequence,bytes:c.bytes,error_tag};c.events.push(event);});}
pub fn failure(checkpoint:&'static str,error:String)->String{
    // Non-reversible diagnostic comparison tag, not the error text or audio data.
    let hash=error.bytes().fold(0xcbf29ce484222325u64,|h,b|(h^(b as u64)).wrapping_mul(0x100000001b3));
    record(checkpoint,Some(format!("{hash:016x}")));error
}
pub fn drain()->String{CAPTURE.with(|c|{let mut c=c.borrow_mut();let events=std::mem::take(&mut c.events);let dropped=std::mem::take(&mut c.dropped);serde_json::json!({"schema":1,"implementation":"sda-core-checkpoints-v1","dropped":dropped,"events":events}).to_string()})}

#[cfg(test)] mod tests {use super::*;#[test]fn bounded_and_opt_in(){enable(false);checkpoint("test");assert!(!drain().contains("test"));enable(true);input(42);for _ in 0..130{checkpoint("test");}let v:serde_json::Value=serde_json::from_str(&drain()).unwrap();assert_eq!(v["dropped"],2);assert_eq!(v["events"][0]["bytes"],42);assert_eq!(v["events"].as_array().unwrap().len(),128);enable(false);}}
