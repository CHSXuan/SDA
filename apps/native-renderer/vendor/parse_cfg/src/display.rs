use crate::Cfg;
use crate::Target;
use std::fmt::{Display, Formatter, Result};

impl<String: AsRef<str>> Cfg<String> {
    fn fmt_list(list: &[Cfg<String>], f: &mut Formatter<'_>) -> Result {
        for (i, e) in list.iter().enumerate() {
            if i > 0 {
                f.write_str(", ")?;
            }
            e.fmt_bare(f)?;
        }
        Ok(())
    }

    fn fmt_bare(&self, f: &mut Formatter<'_>) -> Result {
        match self {
            Cfg::Is(k) => f.write_str(k.as_ref()),
            Cfg::Equal(k, v) => {
                f.write_str(k.as_ref())?;
                f.write_str(" = \"")?;
                f.write_str(v.as_ref())?; // FIXME: once unescaping is fixed, this one will need too
                f.write_str("\"")
            },
            Cfg::Any(e) => {
                f.write_str("any(")?;
                Self::fmt_list(e, f)?;
                f.write_str(")")
            },
            Cfg::All(e) => {
                f.write_str("all(")?;
                Self::fmt_list(e, f)?;
                f.write_str(")")
            },
            Cfg::Not(e) => {
                f.write_str("not(")?;
                e.fmt_bare(f)?;
                f.write_str(")")
            },
        }
    }
}

impl<String: AsRef<str>> Display for Cfg<String> {
    fn fmt(&self, f: &mut Formatter<'_>) -> Result {
        f.write_str("cfg(")?;
        self.fmt_bare(f)?;
        f.write_str(")")
    }
}


impl<String: AsRef<str>> std::fmt::Debug for Cfg<String> {
    #[cold]
    fn fmt(&self, f: &mut Formatter<'_>) -> Result {
        f.write_str("cfg(")?;
        self.fmt_bare(f)?;
        f.write_str(")")
    }
}

impl<String: AsRef<str>> std::fmt::Debug for Target<String> {
    #[cold]
    fn fmt(&self, f: &mut Formatter<'_>) -> Result {
        match self {
            Target::Triple { arch, vendor, os, env } => {
                f.debug_struct("Triple")
                    .field("arch", &arch.as_ref())
                    .field("vendor", &vendor.as_ref())
                    .field("os", &os.as_ref())
                    .field("env", &env.as_ref().map(|s| s.as_ref()))
                    .finish()
            },
            Target::Cfg(c) => <_ as std::fmt::Display>::fmt(c, f),
        }
    }
}

impl<String: AsRef<str>> Display for Target<String> {
    fn fmt(&self, f: &mut Formatter<'_>) -> Result {
        match self {
            Target::Cfg(c) => c.fmt(f),
            Target::Triple {arch, vendor, os, env} => {
                f.write_str(arch.as_ref())?;
                f.write_str("-")?;
                f.write_str(vendor.as_ref())?;
                f.write_str("-")?;
                f.write_str(os.as_ref())?;
                if let Some(env) = env {
                    f.write_str("-")?;
                    f.write_str(env.as_ref())
                } else {
                    Ok(())
                }
            }
        }
    }
}

#[test]
fn print() {
    assert_eq!("cfg(ok)", "cfg( ok )".parse::<Target>().expect("parses").to_string());
    assert_eq!("cfg(feature = \"x\")", "cfg( feature = \"x\" )".parse::<Target>().expect("parses").to_string());
    assert_eq!("foo-bar-baz", "foo-bar-baz".parse::<Target>().expect("parses").to_string());
    assert_eq!("foo-bar-baz-quz", " foo-bar-baz-quz ".parse::<Target>().expect("parses").to_string());
    assert_eq!("cfg(foo)", &Cfg::Is("foo".to_string()).to_string());
    assert_eq!("cfg(not(foo))", &Cfg::Not(Box::new(Cfg::Is("foo".to_string()))).to_string());
    assert_eq!("cfg(not(any(foo, bar)))", &Cfg::Not(Box::new(Cfg::Any(vec![
        Cfg::Is("foo".to_string()),
        Cfg::Is("bar".to_string()),
    ]))).to_string());
}
