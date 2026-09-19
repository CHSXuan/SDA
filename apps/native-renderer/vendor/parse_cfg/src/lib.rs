#![doc = include_str!("../README.md")]

use nom::branch::alt;
use nom::error::ErrorKind;
use nom::multi::separated_list1;
use nom::AsChar;
use nom::Finish;
use std::fmt;
use std::str::FromStr;
pub type NomError<'a> = nom::error::Error<&'a str>;
use nom::bytes::complete::{escaped, is_not, take_while1};
use nom::character::complete::char as chr;
use nom::character::complete::{one_of, multispace0};
use nom::combinator::{eof, map, opt};
use nom::sequence::delimited;
use nom::sequence::{preceded, separated_pair, terminated, Tuple};
use nom::InputTakeAtPosition;
use nom::Parser;
use nom::{bytes::complete::tag, IResult};

mod display;

/// Syntax errors
#[derive(Clone, Eq, PartialEq, Debug)]
pub struct ParseError {
    /// Error code from `nom`
    pub kind: ErrorKind,
    /// Human-readable message
    pub msg: String,
    /// Number of bytes into the input string
    pub byte_position: usize,
}

impl std::error::Error for ParseError {}
impl fmt::Display for ParseError {
    #[cold]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Parse {}, col {}", self.msg, self.byte_position + 1)
    }
}

#[derive(Clone, Eq, PartialEq, Hash)]
pub enum Cfg<String = std::string::String> {
    Any(Vec<Cfg<String>>),
    All(Vec<Cfg<String>>),
    Not(Box<Cfg<String>>),
    Equal(String, String),
    Is(String),
}

impl<String: AsRef<str>> Target<String> {
    /// Check if the target matches keys returned by the getter.
    ///
    /// The getter takes a key, and a hint of the value that it's being compared against (to handle `feature = "value"`).
    /// Value given to the callback will be `""` for existence checks (like `cfg(unix)`).
    ///
    /// The callback returns `Some` with the key's actual value if it's set, or `None` if the key is not set. For booleans equal true return `Some("")`.
    ///
    /// NB: don't use `move` closures for the callback, because these aren't allowed to return data they own. Use closures temporarily borrowing the data from their outer scope.
    ///
    /// Targets check for target_arch, target_vendor, target_os, and target_env separately.
    ///
    /// See `rustc --print=cfg` for list of values to set to emulate proper environment, and `rustup target list` for list of valid target triples.
    #[inline]
    pub fn eval<'cfg, GetterCallback>(&'cfg self, getter: GetterCallback) -> bool where GetterCallback: Fn(&'cfg str, &'cfg str) -> Option<&'cfg str> {
        match self {
            Self::Cfg(cfg) => cfg.eval_(&getter),
            Self::Triple { arch, vendor, os, env } => {
                let arch = arch.as_ref();
                let vendor = vendor.as_ref();
                let os = os.as_ref();
                let arch = arch.as_ref();
                let env = env.as_ref().map(|e| e.as_ref()).unwrap_or("");
                getter("target_arch", &arch).unwrap_or("") == arch &&
                getter("target_vendor", &vendor).unwrap_or("") == vendor &&
                getter("target_os", &os).unwrap_or("") == os &&
                env == getter("target_env", env).unwrap_or("")
            },
        }
    }
}

impl Target<String> {
    /// Parse a target triple or a `cfg(…)` expression.
    ///
    /// Supports values that are valid in Cargo's `[target.<this expression>.dependencies]`.
    ///
    /// Parses into owned `String`s.
    #[inline]
    pub fn parse(target_triple_or_cfg: &str) -> Result<Self, ParseError> {
        parse_target(target_triple_or_cfg)
    }
}

impl<'input> Target<&'input str> {
    /// Parse a target triple or a `cfg(…)` expression.
    ///
    /// Supports values that are valid in Cargo's `[target.<this expression>.dependencies]`.
    ///
    /// Parses into temporarily borrowed `&str`s.
    #[inline]
    pub fn parse_ref(target_triple_or_cfg: &'input str) -> Result<Self, ParseError> {
        parse_target(target_triple_or_cfg)
    }
}

impl<'input, String: From<&'input str>> Target<String> {
    /// Parse a target triple or a `cfg(…)` expression.
    ///
    /// Supports values that are valid in Cargo's `[target.<this expression>.dependencies]`.
    ///
    /// Parses into any string-like type
    #[inline]
    pub fn parse_generic(target_triple_or_cfg: &'input str) -> Result<Self, ParseError> {
        parse_target(target_triple_or_cfg)
    }
}

impl<String: AsRef<str>> Cfg<String> {
    /// Check if the cfg matches keys returned by the getter.
    ///
    /// The getter takes a key, and a hint of the value that it's being compared against (to handle `feature = "value"`).
    /// Value given to the callback will be `""` for existence checks (like `cfg(unix)`).
    ///
    /// The callback returns `Some` with the key's actual value if it's set, or `None` if the key is not set. For booleans equal true return `Some("")`.
    ///
    /// NB: don't use `move` closures for the callback, because these aren't allowed to return data they own. Use closures temporarily borrowing the data from their outer scope.
    ///
    /// See `rustc --print=cfg` for list of values to set to emulate proper environment.
    #[inline]
    pub fn eval<'cfg, GetterCallback>(&'cfg self, getter: GetterCallback) -> bool where GetterCallback: Fn(&'cfg str, &'cfg str) -> Option<&'cfg str> {
        self.eval_(&getter)
    }

    fn eval_<'cfg>(&'cfg self, getter: &dyn Fn(&'cfg str, &'cfg str) -> Option<&'cfg str>) -> bool {
        match self {
            Cfg::Any(cfg) => cfg.iter().any(|c| c.eval_(getter)),
            Cfg::All(cfg) => cfg.iter().all(|c| c.eval_(getter)),
            Cfg::Not(cfg) => !cfg.eval_(getter),
            Cfg::Equal(k, v) => {
                let k = k.as_ref();
                let v = v.as_ref();
                getter(k, v).map_or(false, move |has| has == v)
            },
            Cfg::Is(k) => getter(k.as_ref(), "").is_some(),
        }
    }
}

impl<'input> Cfg<&'input str> {
    /// Parse `cfg(…)` expression into temporary `&str`s
    #[inline]
    pub fn parse_ref(cfg_str: &'input str) -> Result<Self, ParseError> {
        parse_cfg(cfg_str)
    }
}

impl Cfg<String> {
    /// Parse `cfg(…)` expression into owning `String`s.
    #[inline]
    pub fn parse(cfg_str: &str) -> Result<Self, ParseError> {
        parse_cfg(cfg_str)
    }
}

impl<'input, String: From<&'input str>> Cfg<String> {
    /// Parse `cfg(…)` expression into any string-like type
    #[inline]
    pub fn parse_generic(cfg_str: &'input str) -> Result<Self, ParseError> {
        parse_cfg::<String>(cfg_str)
    }

    /// Parse the inner `X` of expression `cfg(X)`
    ///
    /// Use `Cfg::<String>::parse_inner_expr(input)`.
    pub fn parse_inner_expr(cfg_inner_str: &'input str) -> Result<Self, ParseError> {
        delimited(multispace0, |s| expr_no_ws(s, 0), multispace0)(cfg_inner_str)
            .finish()
            .map(|(_, res)| res)
            .map_err(move |e| from_err(e, cfg_inner_str.len()))
    }
}

#[cold]
#[inline(never)]
fn from_err(e: NomError<'_>, original_input_len: usize) -> ParseError {
    ParseError {
        msg: e.to_string(),
        byte_position: original_input_len - e.input.len(),
        kind: e.code,
    }
}

#[derive(Clone, Eq, PartialEq, Hash)]
pub enum Target<String = std::string::String> {
    Triple {
        arch: String,
        vendor: String,
        os: String,
        env: Option<String>,
    },
    Cfg(Cfg<String>),
}

/// Parse expression `cfg(…)`
#[inline(never)]
fn parse_cfg<'input, String: From<&'input str>>(cfg_str: &'input str) -> Result<Cfg<String>, ParseError> {
    cfg(cfg_str)
        .finish()
        .map(|(_, res)| res)
        .map_err(move |e| from_err(e, cfg_str.len()))
}

/// Parse expression valid as Cargo target (`cfg()` or `target-triple`)
#[inline(never)]
fn parse_target<'input, String: From<&'input str>>(target_str: &'input str) -> Result<Target<String>, ParseError> {
    (target, multispace0, eof).parse(target_str)
        .finish()
        .map(|(_, (res, _, _))| res)
        .map_err(move |e| from_err(e, target_str.len()))
}

fn cfg<'input, String: From<&'input str>>(input: &'input str) -> IResult<&str, Cfg<String>> {
    preceded(
        prews(tag("cfg")),
        delimited(
            prews(chr('(')),
            prews(|i| expr_no_ws(i, 0)),
            terminated(delimited(multispace0, chr(')'), multispace0), eof),
        ),
    )(input)
}

fn expr_no_ws<'input, String: From<&'input str>>(input: &'input str, depth: u8) -> IResult<&'input str, Cfg<String>> {
    alt((
    move |i| any_or_all(i, "any", depth, Cfg::Any),
    move |i| any_or_all(i, "all", depth, Cfg::All),
    move |i| not(i, depth),
    equal,
    is
    ))(input)
}

fn any_or_all<'input, String: From<&'input str>>(input: &'input str, tag_name: &'static str, depth: u8, ctor: fn(Vec<Cfg<String>>) -> Cfg<String>) -> IResult<&'input str, Cfg<String>> {
    map(preceded(tag(tag_name), move |i| expr_list(i, depth.checked_add(1).ok_or_else(move || depth_failure(i))?)), ctor)(input)
}

fn not<'input, String: From<&'input str>>(input: &'input str, depth: u8) -> IResult<&'input str, Cfg<String>> {
    map(
        preceded(
            tag("not"),
            delimited(prews(chr('(')), prews(move |i| expr_no_ws(i, depth.checked_add(1).ok_or_else(move || depth_failure(i))?)), prews(chr(')'))),
        ),
        |e| Cfg::Not(Box::new(e)),
    )(input)
}

#[cold]
#[inline(never)]
fn depth_failure(input: &str) -> nom::Err<NomError<'_>> {
    nom::Err::Failure(NomError { code: ErrorKind::TooLarge, input })
}

fn expr_list<'input, String: From<&'input str>>(input: &'input str, depth: u8) -> IResult<&'input str, Vec<Cfg<String>>> {
    delimited(
        prews(chr('(')),
        separated_list1(prews(chr(',')), prews(move |i| expr_no_ws(i, depth))),
        prews(chr(')')),
    )(input)
}

fn equal<'input, String: From<&'input str>>(input: &'input str) -> IResult<&'input str, Cfg<String>> {
    map(
        separated_pair(
            bareword,
            delimited(multispace0, chr('='), multispace0),
            alt((literal, bareword)),
        ),
        |(a, b)| Cfg::Equal(String::from(a), String::from(b)),
    )(input)
}

fn prews<I, O2, E: nom::error::ParseError<I>, G>(inner: G) -> impl FnMut(I) -> IResult<I, O2, E>
where
    G: Parser<I, O2, E>,
    I: InputTakeAtPosition,
    <I as InputTakeAtPosition>::Item: AsChar + Clone,
{
    preceded(multispace0, inner)
}

fn bareword(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_alphanumeric() || c == '_' || c == '-')(input)
}

fn is<'input, String: From<&'input str>>(input: &'input str) -> IResult<&'input str, Cfg<String>> {
    map(bareword, |s| Cfg::Is(String::from(s)))(input)
}

fn quote_char(input: &str) -> IResult<&str, ()> {
    map(chr('"'), drop)(input)
}

fn literal(input: &str) -> IResult<&str, &str> {
    delimited(
        quote_char,
        escaped(is_not("\"\\"), '\\', one_of("\"n\\")), // FIXME: needs escaped_transform
        quote_char,
    )(input)
}

fn target<'input, String: From<&'input str>>(input: &'input str) -> IResult<&'input str, Target<String>> {
    alt((triple, map(cfg, Target::Cfg)))(input)
}

fn alnum(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_alphanumeric() || c == '_')(input)
}

fn triple<'input, String: From<&'input str>>(input: &'input str) -> IResult<&'input str, Target<String>> {
    let (input, (arch, _, vendor, _, os, env)) = (
        prews(alnum),
        chr('-'),
        alnum,
        chr('-'),
        alnum,
        opt(preceded(chr('-'), alnum)),
    )
        .parse(input)?;

    Ok((
        input,
        Target::Triple {
            arch: String::from(arch),
            vendor: String::from(vendor),
            os: String::from(os),
            env: env.map(String::from),
        },
    ))
}

impl FromStr for Cfg<String> {
    type Err = ParseError;
    #[inline]
    fn from_str(cfg_str: &str) -> Result<Cfg<String>, Self::Err> {
        parse_cfg::<String>(cfg_str)
    }
}

impl FromStr for Target<String> {
    type Err = ParseError;
    #[inline]
    fn from_str(cfg_str: &str) -> Result<Target<String>, Self::Err> {
        parse_target::<String>(cfg_str)
    }
}

#[test]
fn exprs() {
    assert!(expr_no_ws::<&str>("all", 0).is_ok());
    assert!(expr_no_ws::<&str>("all", 255).is_err());
    assert!(Cfg::<std::borrow::Cow<'_, str>>::parse_inner_expr(" \nall ").is_ok());
    assert!(Cfg::<String>::parse_inner_expr(" not\t ").is_ok());
    assert!(expr_no_ws::<&str>("?", 0).is_err());
    assert!(expr_no_ws::<&str>("  ?", 0).is_err());
}

#[test]
fn parses() {
    assert_eq!(Ok(Cfg::Is("a".to_string())), parse_cfg(r#"cfg(a)"#));
    assert_eq!(Ok(Target::Cfg(Cfg::Is("a".to_string()))), parse_target(r#"cfg(a)"#));
    assert_eq!(Ok(Target::Triple{
        arch: "sparcv9".to_string(),
        vendor: "sun".to_string(),
        os: "solaris".to_string(),
        env: None,
    }), parse_target("sparcv9-sun-solaris"));
    assert_eq!(Ok(Target::Triple {
        arch: "armv5te".to_string(),
        vendor: "unknown".to_string(),
        os: "linux".to_string(),
        env: Some("musleabi".to_string()),
    }), "  armv5te-unknown-linux-musleabi  ".parse());
    assert_eq!(Ok(Cfg::Any(vec![Cfg::Is("ha".to_string())])), r#"cfg(any(ha))"#.parse());
    assert_eq!(Ok(Cfg::All(vec![Cfg::Is("ha".to_string())])), parse_cfg(r#"cfg(all(ha))"#));
    assert_eq!(Ok(Cfg::Not(Box::new(Cfg::Is("ha".to_string())))), parse_cfg(r#"cfg(not(ha)) "#));
    assert_eq!(Ok(Cfg::Any(vec![
        Cfg::Is("a".to_string()), Cfg::Is("b".to_string())
        ])), parse_cfg(r#"cfg( any ( a, b))"#));
    assert_eq!(Ok(Cfg::Is("a".to_string())), r#"cfg ( a )"#.parse());
    assert_eq!(Ok(Cfg::Is("a")), Cfg::parse_ref(r#"   cfg ( a )   "#));
    assert_eq!(Ok(Cfg::Equal("a","b")), parse_cfg(r#" cfg(a=b) "#));
    assert_eq!(Ok(Cfg::Equal("a","b")), parse_cfg(r#" cfg(  a  =  b  ) "#));
    assert_eq!(Ok(Cfg::Any(vec![Cfg::Equal("a","b")])), parse_cfg(r#"cfg(any(a=b))"#));
    assert_eq!(Ok(Cfg::All(vec![Cfg::Equal("a","b")])), parse_cfg(r#"cfg(all(a=b))"#));
    assert_eq!(Ok(Cfg::Not(Box::new(Cfg::Equal("a","b")))), parse_cfg(r#"cfg(not(a=b))"#));
    assert_eq!(Ok(Cfg::Not(Box::new(Cfg::Equal("a_b","b")))), parse_cfg(r#" cfg( not( a_b  =  b ) ) "#));
    assert_eq!(Ok(Cfg::Not(Box::new(Cfg::Equal("a","b")))), parse_cfg::<&str>(r#" cfg( not( a  =  "b" ) ) "#));
    assert!(parse_cfg::<&str>(r#" cfg( not( a  =  "b\"\\" ) ) "#).is_ok());
}

#[test]
fn stack_overflow() {
    let err = Cfg::<&str>::parse_inner_expr(&"any(".repeat(300)).err().unwrap();
    assert_eq!(err.kind, ErrorKind::TooLarge);
    assert_eq!(err.byte_position, 1023);
}

#[test]
fn evals() {
    assert!(Target::<std::borrow::Cow<'_, str>>::parse_generic("powerpc64-unknown-linux-gnu").unwrap().eval(&|k,_| match k {
        "target_arch" => Some("powerpc64"),
        "target_vendor" => Some("unknown"),
        "target_os" => Some("linux"),
        "target_env" => Some("gnu"),
        _ => None,
    }));

    let hi = "hi".to_string();
    let temp_hi = Some(hi.as_str());
    assert!(Cfg::<&str>::parse_inner_expr("any (test , unix)").unwrap().eval(|k, _| if k == "test" { Some("") } else { None }));
    assert!(parse_target::<&str>("cfg(not(any(woop)))").unwrap().eval(|_, _| None));
    assert!(Target::parse("cfg(all(foo, bar))").unwrap().eval(|k, _| if k == "foo" || k == "bar" { Some("") } else { None }));
    assert!(parse_target::<&str>("cfg(not(all(foo, bar)))").unwrap().eval(|k, _| if k == "foo" { temp_hi } else { None }));
    assert!(Target::parse_ref("cfg(foo = hi)").unwrap().eval(|k, _| if k == "foo" { Some("hi") } else { None }));
    assert!(parse_target::<&str>("cfg(foo = \"hi\")").unwrap().eval(|k, _| if k == "foo" { Some("hi") } else { None }));
    assert!(!parse_target::<&str>("cfg(foo = \"hi\")").unwrap().eval(|k, _| if k == "foo" { Some("bye") } else { None }));
    assert!(Cfg::<&str>::parse_inner_expr("feature = \"hi\"").unwrap().eval(&|k, v| if k == "feature" && v == "hi" { Some(v) } else { None }));
    assert!(!Cfg::<String>::parse_inner_expr("feature = \"other\"").unwrap().eval(&|k, v| if k == "feature" && v == "hi" { Some(v) } else { None }));
}

#[test]
fn targets() {
    for t in ["aarch64-apple-ios", "  aarch64-apple-ios  ", "aarch64-linux-android", "aarch64-unknown-fuchsia",
    "aarch64-unknown-linux-gnu", "aarch64-unknown-linux-musl", "arm-linux-androideabi",
    "arm-unknown-linux-gnueabi", "arm-unknown-linux-gnueabihf", "arm-unknown-linux-musleabi",
    "arm-unknown-linux-musleabihf", "armv5te-unknown-linux-gnueabi",
    "armv5te-unknown-linux-musleabi", "armv7-apple-ios", "armv7-linux-androideabi",
    "armv7-unknown-linux-gnueabihf", "armv7-unknown-linux-musleabihf", "armv7s-apple-ios",
    "asmjs-unknown-emscripten", "i386-apple-ios", "i586-pc-windows-msvc",
    "i586-unknown-linux-gnu", "i586-unknown-linux-musl", "i686-apple-darwin",
    "i686-linux-android", "i686-pc-windows-gnu", "i686-pc-windows-msvc",
    "i686-unknown-freebsd", "i686-unknown-linux-gnu", "i686-unknown-linux-musl",
    "mips-unknown-linux-gnu", "mips-unknown-linux-musl", "mips64-unknown-linux-gnuabi64",
    "mips64el-unknown-linux-gnuabi64", "mipsel-unknown-linux-gnu", "mipsel-unknown-linux-musl",
    "powerpc-unknown-linux-gnu", "powerpc64-unknown-linux-gnu", "powerpc64le-unknown-linux-gnu",
    "s390x-unknown-linux-gnu", "sparc64-unknown-linux-gnu", "sparcv9-sun-solaris",
    "thumbv6m-none-eabi", "thumbv7em-none-eabi", "thumbv7em-none-eabihf",
    "thumbv7m-none-eabi", "wasm32-unknown-emscripten", "wasm32-unknown-unknown",
    "x86_64-apple-darwin", "x86_64-apple-ios", "x86_64-linux-android",
    "x86_64-pc-windows-gnu", "x86_64-pc-windows-msvc", "x86_64-rumprun-netbsd",
    "x86_64-sun-solaris", "x86_64-unknown-cloudabi", "x86_64-unknown-freebsd",
    "x86_64-unknown-fuchsia", "x86_64-unknown-linux-gnu", "x86_64-unknown-linux-gnux32",
    "x86_64-unknown-linux-musl", "x86_64-unknown-netbsd", "x86_64-unknown-redox"].iter() {
        assert!(parse_target::<&str>(t).is_ok(), "{t}");
    }
}

#[test]
fn garbage() {
    assert_eq!(Target::parse_ref("?x86_64-pc-windows-gnu").err().unwrap().byte_position, 0);
    assert!(parse_target::<&str>("x86_64-pc-windows-gnu!(#$@#)").is_err());
    assert_eq!(Target::parse("cfg(ok)--not ok").err().unwrap().byte_position, 7);
}
