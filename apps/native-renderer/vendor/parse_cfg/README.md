# `cfg()` expression parser

`Cfg` is an AST for just `cfg()` expressions. `Target` allows target triples *or* `cfg()`, so it's suitable for parsing targets Cargo allows in `target.🈁️.dependencies`.

```rust
use parse_cfg::*;
fn main() -> Result<(), ParseError> {

let cfg: Cfg = r#"cfg(any(unix, feature = "extra"))"#.parse()?;
assert_eq!(Cfg::Any(vec![
    Cfg::Is("unix".into()),
    Cfg::Equal("feature".into(), "extra".into()),
]), cfg);

let is_set = cfg.eval(|key, comparison| if key == "feature" && comparison == "extra" { Some(comparison) } else { None });
assert!(is_set);

let target = "powerpc64le-unknown-linux-gnu".parse()?;
assert_eq!(Target::Triple {
    arch: "powerpc64le".into(),
    vendor: "unknown".into(),
    os: "linux".into(),
    env: Some("gnu".into()),
}, target);

/// `Cfg` and `Target` types take an optional generic argument for the string type,
/// so you can parse slices without allocating `String`s, or parse into `Cow<str>`.
let target = Target::<&str>::parse_generic("powerpc64le-unknown-linux-gnu")?;
assert_eq!(Target::Triple {
    arch: "powerpc64le",
    vendor: "unknown",
    os: "linux",
    env: Some("gnu"),
}, target);

Ok(()) }
```

It's safe to parse untrusted input. The depth of expressions is limited to 255 levels.

Target triples used by Rust don't follow its documented syntax, so sometimes `os`/`vendor`/`env` will be shifted.
