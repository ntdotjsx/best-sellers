use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

const EMBEDDED_EXT_VERSION: &str = "1.2.0";
const EMBEDDED_INDEX_HTML: &[u8] = include_bytes!("../frontend/dist/index.html");
const EMBEDDED_EXT_MANIFEST: &[u8] = include_bytes!("../extension/manifest.json");
const EMBEDDED_EXT_BG: &[u8] = include_bytes!("../extension/background.js");
const EMBEDDED_EXT_BRIDGE: &[u8] = include_bytes!("../extension/bridge.js");
const EMBEDDED_EXT_SHOPEE: &[u8] = include_bytes!("../extension/content_shopee.js");
const EMBEDDED_EXT_SHOPEE_MAIN: &[u8] = include_bytes!("../extension/content_shopee_main.js");
const EMBEDDED_EXT_LAZADA: &[u8] = include_bytes!("../extension/content_lazada.js");

fn get_managed_extension_dir(base_dir: &Path) -> PathBuf {
    if let Ok(local_app) = env::var("LOCALAPPDATA") {
        PathBuf::from(local_app).join("StoreExplorer").join("extension")
    } else {
        base_dir.join("extension")
    }
}

fn sync_extension_files(target_dir: &Path) -> bool {
    let ver_file = target_dir.join(".version");
    let current_ver = fs::read_to_string(&ver_file).unwrap_or_default();
    let needs_update = current_ver.trim() != EMBEDDED_EXT_VERSION || !target_dir.join("manifest.json").exists();

    if needs_update {
        let _ = fs::create_dir_all(target_dir);
        let files: &[(&str, &[u8])] = &[
            ("manifest.json", EMBEDDED_EXT_MANIFEST),
            ("background.js", EMBEDDED_EXT_BG),
            ("bridge.js", EMBEDDED_EXT_BRIDGE),
            ("content_shopee.js", EMBEDDED_EXT_SHOPEE),
            ("content_shopee_main.js", EMBEDDED_EXT_SHOPEE_MAIN),
            ("content_lazada.js", EMBEDDED_EXT_LAZADA),
        ];
        for (name, bytes) in files {
            let _ = fs::write(target_dir.join(name), bytes);
        }
        let _ = fs::write(&ver_file, EMBEDDED_EXT_VERSION);
    }
    needs_update
}

fn launch_browsers_with_extension(ext_dir: &Path, port: u16) -> Vec<String> {
    let ext_arg = format!("--load-extension={}", ext_dir.to_string_lossy());
    let url_arg = format!("http://127.0.0.1:{}/", port);

    let mut candidates = vec![
        ("Brave", PathBuf::from(r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe")),
        ("Chrome", PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe")),
        ("Chrome (x86)", PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")),
        ("Edge", PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")),
        ("Edge (x64)", PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")),
    ];

    if let Ok(local_app) = env::var("LOCALAPPDATA") {
        let la = PathBuf::from(local_app);
        candidates.push(("Brave (User)", la.join(r"BraveSoftware\Brave-Browser\Application\brave.exe")));
        candidates.push(("Chrome (User)", la.join(r"Google\Chrome\Application\chrome.exe")));
        candidates.push(("Edge (User)", la.join(r"Microsoft\Edge\Application\msedge.exe")));
    }

    let mut launched = Vec::new();
    for (name, path) in candidates {
        if path.exists() {
            if Command::new(&path).arg(&ext_arg).arg(&url_arg).spawn().is_ok() {
                launched.push(name.to_string());
            }
        }
    }
    launched
}

// ---------------------------------------------------------------------------
// Native PostgreSQL v3 Wire Protocol Client (Zero External Crates)
// ---------------------------------------------------------------------------

struct PgClient {
    stream: TcpStream,
}

impl PgClient {
    fn connect() -> Result<Self, String> {
        let mut host = env::var("PGHOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let mut port = env::var("PGPORT").unwrap_or_else(|_| "5433".to_string());
        let mut user = env::var("PGUSER").unwrap_or_else(|_| "postgres".to_string());
        let mut password = env::var("PGPASSWORD").unwrap_or_else(|_| "postgres".to_string());
        let mut dbname = env::var("PGDATABASE").unwrap_or_else(|_| "store_explorer".to_string());

        if let Ok(cfg_str) = fs::read_to_string("db_config.json") {
            if let Ok(cfg) = JsonParser::parse(&cfg_str) {
                let h = cfg.get_str("host");
                let p = cfg.get_str("port");
                let u = cfg.get_str("user");
                let pw = cfg.get_str("password");
                let db = cfg.get_str("dbname");
                if !h.is_empty() { host = h; }
                if !p.is_empty() { port = p; }
                if !u.is_empty() { user = u; }
                if !pw.is_empty() { password = pw; }
                if !db.is_empty() { dbname = db; }
            }
        }

        Self::connect_custom(&host, &port, &user, &password, &dbname)
    }

    fn connect_custom(
        host: &str,
        port: &str,
        user: &str,
        password: &str,
        dbname: &str,
    ) -> Result<Self, String> {
        let addr = format!("{}:{}", host, port);
        let mut stream = TcpStream::connect(&addr)
            .map_err(|e| format!("PostgreSQL connect failed ({}): {}", addr, e))?;
        let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

        // StartupMessage (Protocol v3.0 = 196608)
        let mut body = Vec::new();
        body.extend_from_slice(&196608i32.to_be_bytes());
        for (k, v) in &[
            ("user", user),
            ("database", dbname),
            ("client_encoding", "UTF8"),
        ] {
            body.extend_from_slice(k.as_bytes());
            body.push(0);
            body.extend_from_slice(v.as_bytes());
            body.push(0);
        }
        body.push(0);

        let total_len = (body.len() + 4) as i32;
        let mut pkt = Vec::with_capacity(body.len() + 4);
        pkt.extend_from_slice(&total_len.to_be_bytes());
        pkt.extend_from_slice(&body);
        stream.write_all(&pkt).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;

        loop {
            let (msg_type, payload) = Self::read_msg(&mut stream)?;
            match msg_type {
                b'R' => {
                    if payload.len() >= 4 {
                        let code =
                            i32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
                        if code == 0 {
                            // AuthenticationOk
                        } else if code == 3 {
                            // CleartextPassword
                            let mut pw = Vec::new();
                            pw.push(b'p');
                            let l = (password.len() + 5) as i32;
                            pw.extend_from_slice(&l.to_be_bytes());
                            pw.extend_from_slice(password.as_bytes());
                            pw.push(0);
                            stream.write_all(&pw).map_err(|e| e.to_string())?;
                            stream.flush().map_err(|e| e.to_string())?;
                        } else {
                            return Err(format!(
                                "Unsupported PG auth code {} (use POSTGRES_HOST_AUTH_METHOD=trust in docker-compose)",
                                code
                            ));
                        }
                    }
                }
                b'E' => return Err(Self::parse_error(&payload)),
                b'Z' => break,
                _ => {}
            }
        }

        Ok(PgClient { stream })
    }

    fn read_exact_bytes(stream: &mut TcpStream, buf: &mut [u8]) -> Result<(), String> {
        let mut offset = 0;
        while offset < buf.len() {
            match stream.read(&mut buf[offset..]) {
                Ok(0) => return Err("Unexpected EOF from PostgreSQL".into()),
                Ok(n) => offset += n,
                Err(e) => return Err(format!("PG read error: {}", e)),
            }
        }
        Ok(())
    }

    fn read_msg(stream: &mut TcpStream) -> Result<(u8, Vec<u8>), String> {
        let mut hdr = [0u8; 5];
        Self::read_exact_bytes(stream, &mut hdr)?;
        let msg_type = hdr[0];
        let len = i32::from_be_bytes([hdr[1], hdr[2], hdr[3], hdr[4]]);
        if len < 4 {
            return Err("Invalid PG message length".into());
        }
        let body_len = (len - 4) as usize;
        let mut payload = vec![0u8; body_len];
        if body_len > 0 {
            Self::read_exact_bytes(stream, &mut payload)?;
        }
        Ok((msg_type, payload))
    }

    fn parse_error(payload: &[u8]) -> String {
        let mut pos = 0;
        let mut msg = String::new();
        while pos < payload.len() && payload[pos] != 0 {
            let field_type = payload[pos];
            pos += 1;
            let start = pos;
            while pos < payload.len() && payload[pos] != 0 {
                pos += 1;
            }
            let val = String::from_utf8_lossy(&payload[start..pos]).to_string();
            if field_type == b'M' || field_type == b'D' {
                if !msg.is_empty() {
                    msg.push_str(" — ");
                }
                msg.push_str(&val);
            }
            pos += 1;
        }
        if msg.is_empty() {
            "PostgreSQL error".into()
        } else {
            msg
        }
    }

    fn query(&mut self, sql: &str) -> Result<Vec<HashMap<String, String>>, String> {
        let mut pkt = Vec::with_capacity(sql.len() + 6);
        pkt.push(b'Q');
        let len = (sql.len() + 5) as i32;
        pkt.extend_from_slice(&len.to_be_bytes());
        pkt.extend_from_slice(sql.as_bytes());
        pkt.push(0);
        self.stream.write_all(&pkt).map_err(|e| e.to_string())?;
        self.stream.flush().map_err(|e| e.to_string())?;

        let mut col_names: Vec<String> = Vec::new();
        let mut rows: Vec<HashMap<String, String>> = Vec::new();
        let mut err_msg: Option<String> = None;

        loop {
            let (msg_type, payload) = Self::read_msg(&mut self.stream)?;
            match msg_type {
                b'T' => {
                    col_names.clear();
                    if payload.len() >= 2 {
                        let num_fields = i16::from_be_bytes([payload[0], payload[1]]) as usize;
                        let mut pos = 2;
                        for _ in 0..num_fields {
                            let start = pos;
                            while pos < payload.len() && payload[pos] != 0 {
                                pos += 1;
                            }
                            let name = String::from_utf8_lossy(&payload[start..pos]).to_string();
                            col_names.push(name);
                            pos += 1;
                            pos += 18;
                        }
                    }
                }
                b'D' => {
                    if payload.len() >= 2 {
                        let num_cols = i16::from_be_bytes([payload[0], payload[1]]) as usize;
                        let mut pos = 2;
                        let mut row_map = HashMap::new();
                        for c_idx in 0..num_cols {
                            if pos + 4 > payload.len() {
                                break;
                            }
                            let col_len = i32::from_be_bytes([
                                payload[pos],
                                payload[pos + 1],
                                payload[pos + 2],
                                payload[pos + 3],
                            ]);
                            pos += 4;
                            let val_str = if col_len < 0 {
                                String::new()
                            } else {
                                let end = (pos + col_len as usize).min(payload.len());
                                let s = String::from_utf8_lossy(&payload[pos..end]).to_string();
                                pos = end;
                                s
                            };
                            if let Some(cname) = col_names.get(c_idx) {
                                row_map.insert(cname.clone(), val_str);
                            }
                        }
                        rows.push(row_map);
                    }
                }
                b'E' => {
                    err_msg = Some(Self::parse_error(&payload));
                }
                b'Z' => break,
                _ => {}
            }
        }

        if let Some(e) = err_msg {
            return Err(e);
        }
        Ok(rows)
    }
}

impl Drop for PgClient {
    fn drop(&mut self) {
        let term = [b'X', 0, 0, 0, 4];
        let _ = self.stream.write_all(&term);
        let _ = self.stream.flush();
    }
}

fn sql_str(s: &str) -> String {
    let cleaned = s.replace('\0', "");
    format!("'{}'", cleaned.replace('\'', "''"))
}

// ---------------------------------------------------------------------------
// Minimal, Fast JSON Value & Parser/Serializer
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
enum JsonVal {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<JsonVal>),
    Obj(Vec<(String, JsonVal)>),
}

impl JsonVal {
    fn as_str(&self) -> Option<&str> {
        if let JsonVal::Str(s) = self {
            Some(s.as_str())
        } else {
            None
        }
    }

    fn get_str(&self, key: &str) -> String {
        self.get(key)
            .and_then(|v| match v {
                JsonVal::Str(s) => Some(s.clone()),
                JsonVal::Num(n) => Some(format!("{}", n)),
                _ => None,
            })
            .unwrap_or_default()
    }

    fn get_i64(&self, key: &str) -> i64 {
        self.get(key)
            .and_then(|v| match v {
                JsonVal::Num(n) => Some(*n as i64),
                JsonVal::Str(s) => s.parse::<i64>().ok(),
                _ => None,
            })
            .unwrap_or(0)
    }

    fn get(&self, key: &str) -> Option<&JsonVal> {
        if let JsonVal::Obj(entries) = self {
            for (k, v) in entries {
                if k == key {
                    return Some(v);
                }
            }
        }
        None
    }

    fn to_json_string(&self, indent: Option<usize>) -> String {
        let mut out = String::new();
        self.write_json(&mut out, indent, 0);
        out
    }

    fn write_json(&self, out: &mut String, indent: Option<usize>, depth: usize) {
        match self {
            JsonVal::Null => out.push_str("null"),
            JsonVal::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            JsonVal::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    out.push_str(&format!("{}", *n as i64));
                } else {
                    out.push_str(&format!("{}", n));
                }
            }
            JsonVal::Str(s) => {
                out.push('"');
                for ch in s.chars() {
                    match ch {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        '\r' => out.push_str("\\r"),
                        '\t' => out.push_str("\\t"),
                        c if (c as u32) < 0x20 => {
                            out.push_str(&format!("\\u{:04x}", c as u32));
                        }
                        c => out.push(c),
                    }
                }
                out.push('"');
            }
            JsonVal::Arr(items) => {
                if items.is_empty() {
                    out.push_str("[]");
                    return;
                }
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if let Some(ind) = indent {
                        out.push('\n');
                        out.push_str(&" ".repeat((depth + 1) * ind));
                    }
                    item.write_json(out, indent, depth + 1);
                    if i + 1 < items.len() {
                        out.push(',');
                    }
                }
                if let Some(ind) = indent {
                    out.push('\n');
                    out.push_str(&" ".repeat(depth * ind));
                }
                out.push(']');
            }
            JsonVal::Obj(entries) => {
                if entries.is_empty() {
                    out.push_str("{}");
                    return;
                }
                out.push('{');
                for (i, (k, v)) in entries.iter().enumerate() {
                    if let Some(ind) = indent {
                        out.push('\n');
                        out.push_str(&" ".repeat((depth + 1) * ind));
                    }
                    JsonVal::Str(k.clone()).write_json(out, None, 0);
                    out.push(':');
                    if indent.is_some() {
                        out.push(' ');
                    }
                    v.write_json(out, indent, depth + 1);
                    if i + 1 < entries.len() {
                        out.push(',');
                    }
                }
                if let Some(ind) = indent {
                    out.push('\n');
                    out.push_str(&" ".repeat(depth * ind));
                }
                out.push('}');
            }
        }
    }
}

struct JsonParser<'a> {
    chars: Vec<char>,
    pos: usize,
    _marker: std::marker::PhantomData<&'a ()>,
}

impl<'a> JsonParser<'a> {
    fn parse(input: &'a str) -> Result<JsonVal, String> {
        let mut p = JsonParser {
            chars: input.chars().collect(),
            pos: 0,
            _marker: std::marker::PhantomData,
        };
        p.skip_ws();
        p.parse_val()
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn next(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.pos += 1;
        Some(c)
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_whitespace() || c == '\u{feff}' {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn parse_val(&mut self) -> Result<JsonVal, String> {
        self.skip_ws();
        match self.peek() {
            Some('"') => Ok(JsonVal::Str(self.parse_string()?)),
            Some('{') => self.parse_obj(),
            Some('[') => self.parse_arr(),
            Some('t') => {
                self.expect_word("true")?;
                Ok(JsonVal::Bool(true))
            }
            Some('f') => {
                self.expect_word("false")?;
                Ok(JsonVal::Bool(false))
            }
            Some('n') => {
                self.expect_word("null")?;
                Ok(JsonVal::Null)
            }
            Some(c) if c == '-' || c.is_ascii_digit() => self.parse_num(),
            other => Err(format!("Unexpected char {:?} at {}", other, self.pos)),
        }
    }

    fn expect_word(&mut self, word: &str) -> Result<(), String> {
        for wc in word.chars() {
            if self.next() != Some(wc) {
                return Err(format!("Expected {}", word));
            }
        }
        Ok(())
    }

    fn parse_string(&mut self) -> Result<String, String> {
        if self.next() != Some('"') {
            return Err("Expected '\"'".into());
        }
        let mut out = String::new();
        while let Some(c) = self.next() {
            if c == '"' {
                return Ok(out);
            }
            if c == '\\' {
                let esc = self.next().ok_or("Unterminated escape")?;
                match esc {
                    '"' => out.push('"'),
                    '\\' => out.push('\\'),
                    '/' => out.push('/'),
                    'b' => out.push('\u{0008}'),
                    'f' => out.push('\u{000c}'),
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    'u' => {
                        let mut hex = String::new();
                        for _ in 0..4 {
                            hex.push(self.next().ok_or("Invalid \\u escape")?);
                        }
                        let code = u16::from_str_radix(&hex, 16)
                            .map_err(|_| "Invalid hex in \\u escape")?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            if self.peek() == Some('\\') {
                                let saved = self.pos;
                                self.next();
                                if self.next() == Some('u') {
                                    let mut hex2 = String::new();
                                    for _ in 0..4 {
                                        if let Some(hc) = self.next() {
                                            hex2.push(hc);
                                        }
                                    }
                                    if let Ok(low) = u16::from_str_radix(&hex2, 16) {
                                        if (0xDC00..=0xDFFF).contains(&low) {
                                            let combined = 0x10000
                                                + (((code as u32 - 0xD800) << 10)
                                                    | (low as u32 - 0xDC00));
                                            if let Some(ch) = char::from_u32(combined) {
                                                out.push(ch);
                                                continue;
                                            }
                                        }
                                    }
                                }
                                self.pos = saved;
                            }
                        }
                        if let Some(ch) = char::from_u32(code as u32) {
                            out.push(ch);
                        }
                    }
                    other => out.push(other),
                }
            } else {
                out.push(c);
            }
        }
        Err("Unterminated string".into())
    }

    fn parse_num(&mut self) -> Result<JsonVal, String> {
        let mut s = String::new();
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' {
                s.push(c);
                self.pos += 1;
            } else {
                break;
            }
        }
        let n = s
            .parse::<f64>()
            .map_err(|_| format!("Invalid number: {}", s))?;
        Ok(JsonVal::Num(n))
    }

    fn parse_arr(&mut self) -> Result<JsonVal, String> {
        self.next();
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(']') {
            self.next();
            return Ok(JsonVal::Arr(items));
        }
        loop {
            items.push(self.parse_val()?);
            self.skip_ws();
            match self.peek() {
                Some(',') => {
                    self.next();
                    self.skip_ws();
                    if self.peek() == Some(']') {
                        self.next();
                        break;
                    }
                }
                Some(']') => {
                    self.next();
                    break;
                }
                other => return Err(format!("Expected ',' or ']', got {:?}", other)),
            }
        }
        Ok(JsonVal::Arr(items))
    }

    fn parse_obj(&mut self) -> Result<JsonVal, String> {
        self.next();
        let mut entries = Vec::new();
        self.skip_ws();
        if self.peek() == Some('}') {
            self.next();
            return Ok(JsonVal::Obj(entries));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.skip_ws();
            if self.next() != Some(':') {
                return Err("Expected ':' in object".into());
            }
            let val = self.parse_val()?;
            entries.push((key, val));
            self.skip_ws();
            match self.peek() {
                Some(',') => {
                    self.next();
                    self.skip_ws();
                    if self.peek() == Some('}') {
                        self.next();
                        break;
                    }
                }
                Some('}') => {
                    self.next();
                    break;
                }
                other => return Err(format!("Expected ',' or '}}', got {:?}", other)),
            }
        }
        Ok(JsonVal::Obj(entries))
    }
}

// ---------------------------------------------------------------------------
// GraphQL Lexer & Parser
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
enum GqlTok {
    Punc(char),
    Spread,
    Name(String),
    Str(String),
    Num(f64),
}

fn tokenize_gql(src: &str) -> Result<Vec<GqlTok>, String> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut tokens = Vec::new();

    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() || c == ',' {
            i += 1;
            continue;
        }
        if c == '#' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '.' && i + 2 < chars.len() && chars[i + 1] == '.' && chars[i + 2] == '.' {
            tokens.push(GqlTok::Spread);
            i += 3;
            continue;
        }
        if "!$:()=@[]{}".contains(c) {
            tokens.push(GqlTok::Punc(c));
            i += 1;
            continue;
        }
        if c == '"' {
            i += 1;
            let mut s = String::new();
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    i += 1;
                    match chars[i] {
                        'n' => s.push('\n'),
                        'r' => s.push('\r'),
                        't' => s.push('\t'),
                        '"' => s.push('"'),
                        '\\' => s.push('\\'),
                        other => s.push(other),
                    }
                } else {
                    s.push(chars[i]);
                }
                i += 1;
            }
            i += 1;
            tokens.push(GqlTok::Str(s));
            continue;
        }
        if c == '-' || c.is_ascii_digit() {
            let mut s = String::new();
            while i < chars.len()
                && (chars[i].is_ascii_digit()
                    || chars[i] == '.'
                    || chars[i] == '-'
                    || chars[i] == '+'
                    || chars[i] == 'e'
                    || chars[i] == 'E')
            {
                s.push(chars[i]);
                i += 1;
            }
            let n = s.parse::<f64>().unwrap_or(0.0);
            tokens.push(GqlTok::Num(n));
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut s = String::new();
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                s.push(chars[i]);
                i += 1;
            }
            tokens.push(GqlTok::Name(s));
            continue;
        }
        i += 1;
    }
    Ok(tokens)
}

#[derive(Clone, Debug)]
struct GqlField {
    alias: String,
    name: String,
    args: HashMap<String, JsonVal>,
    selections: Vec<GqlField>,
}

#[derive(Clone, Debug)]
struct GqlOp {
    op_type: String,
    name: Option<String>,
    selections: Vec<GqlField>,
}

struct GqlParser {
    tokens: Vec<GqlTok>,
    pos: usize,
    variables: HashMap<String, JsonVal>,
}

impl GqlParser {
    fn peek(&self) -> Option<&GqlTok> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<GqlTok> {
        let t = self.tokens.get(self.pos)?.clone();
        self.pos += 1;
        Some(t)
    }

    fn parse_doc(&mut self) -> Result<Vec<GqlOp>, String> {
        let mut ops = Vec::new();
        while self.pos < self.tokens.len() {
            match self.peek() {
                Some(GqlTok::Punc('{')) => {
                    let sels = self.parse_selection_set()?;
                    ops.push(GqlOp {
                        op_type: "query".into(),
                        name: None,
                        selections: sels,
                    });
                }
                Some(GqlTok::Name(n)) if n == "query" || n == "mutation" => {
                    let op_type = if let Some(GqlTok::Name(s)) = self.next() {
                        s
                    } else {
                        "query".into()
                    };
                    let mut op_name = None;
                    if let Some(GqlTok::Name(_)) = self.peek() {
                        if let Some(GqlTok::Name(nm)) = self.next() {
                            op_name = Some(nm);
                        }
                    }
                    if self.peek() == Some(&GqlTok::Punc('(')) {
                        self.skip_parens();
                    }
                    let sels = self.parse_selection_set()?;
                    ops.push(GqlOp {
                        op_type,
                        name: op_name,
                        selections: sels,
                    });
                }
                _ => {
                    self.pos += 1;
                }
            }
        }
        Ok(ops)
    }

    fn skip_parens(&mut self) {
        if self.peek() != Some(&GqlTok::Punc('(')) {
            return;
        }
        self.next();
        let mut depth = 1;
        while depth > 0 && self.pos < self.tokens.len() {
            match self.next() {
                Some(GqlTok::Punc('(')) => depth += 1,
                Some(GqlTok::Punc(')')) => depth -= 1,
                _ => {}
            }
        }
    }

    fn parse_selection_set(&mut self) -> Result<Vec<GqlField>, String> {
        if self.next() != Some(GqlTok::Punc('{')) {
            return Err("Expected '{'".into());
        }
        let mut fields = Vec::new();
        while self.pos < self.tokens.len() && self.peek() != Some(&GqlTok::Punc('}')) {
            if self.peek() == Some(&GqlTok::Spread) {
                self.next();
                if let Some(GqlTok::Name(n)) = self.peek() {
                    if n == "on" {
                        self.next();
                        self.next();
                    } else {
                        self.next();
                    }
                }
                if self.peek() == Some(&GqlTok::Punc('{')) {
                    let sub = self.parse_selection_set()?;
                    fields.extend(sub);
                }
                continue;
            }
            fields.push(self.parse_field()?);
        }
        if self.peek() == Some(&GqlTok::Punc('}')) {
            self.next();
        }
        Ok(fields)
    }

    fn parse_field(&mut self) -> Result<GqlField, String> {
        let first = match self.next() {
            Some(GqlTok::Name(s)) => s,
            other => return Err(format!("Expected field name, got {:?}", other)),
        };

        let (alias, name) = if self.peek() == Some(&GqlTok::Punc(':')) {
            self.next();
            let real_name = match self.next() {
                Some(GqlTok::Name(s)) => s,
                other => return Err(format!("Expected field name after alias, got {:?}", other)),
            };
            (first, real_name)
        } else {
            (first.clone(), first)
        };

        let mut args = HashMap::new();
        if self.peek() == Some(&GqlTok::Punc('(')) {
            args = self.parse_args()?;
        }

        while self.peek() == Some(&GqlTok::Punc('@')) {
            self.next();
            self.next();
            if self.peek() == Some(&GqlTok::Punc('(')) {
                self.skip_parens();
            }
        }

        let selections = if self.peek() == Some(&GqlTok::Punc('{')) {
            self.parse_selection_set()?
        } else {
            Vec::new()
        };

        Ok(GqlField {
            alias,
            name,
            args,
            selections,
        })
    }

    fn parse_args(&mut self) -> Result<HashMap<String, JsonVal>, String> {
        self.next();
        let mut map = HashMap::new();
        while self.pos < self.tokens.len() && self.peek() != Some(&GqlTok::Punc(')')) {
            let k = match self.next() {
                Some(GqlTok::Name(s)) => s,
                other => return Err(format!("Expected arg name, got {:?}", other)),
            };
            if self.next() != Some(GqlTok::Punc(':')) {
                return Err("Expected ':' in argument".into());
            }
            let v = self.parse_val()?;
            map.insert(k, v);
        }
        if self.peek() == Some(&GqlTok::Punc(')')) {
            self.next();
        }
        Ok(map)
    }

    fn parse_val(&mut self) -> Result<JsonVal, String> {
        match self.next() {
            Some(GqlTok::Punc('$')) => {
                if let Some(GqlTok::Name(var_name)) = self.next() {
                    Ok(self
                        .variables
                        .get(&var_name)
                        .cloned()
                        .unwrap_or(JsonVal::Null))
                } else {
                    Ok(JsonVal::Null)
                }
            }
            Some(GqlTok::Str(s)) => Ok(JsonVal::Str(s)),
            Some(GqlTok::Num(n)) => Ok(JsonVal::Num(n)),
            Some(GqlTok::Name(n)) => match n.as_str() {
                "true" => Ok(JsonVal::Bool(true)),
                "false" => Ok(JsonVal::Bool(false)),
                "null" => Ok(JsonVal::Null),
                _ => Ok(JsonVal::Str(n)),
            },
            _ => Ok(JsonVal::Null),
        }
    }
}

// ---------------------------------------------------------------------------
// PostgreSQL Database Storage & Initial JSON Seed Migration
// ---------------------------------------------------------------------------

fn sanitize_keyword(kw: &str) -> String {
    let mut out = String::new();
    for c in kw.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() || c == '_' || ('\u{0E00}'..='\u{0E7F}').contains(&c) {
            out.push(c);
        }
    }
    if out.is_empty() {
        "products".to_string()
    } else {
        out
    }
}

fn upsert_product_to_pg(
    pg: &mut PgClient,
    platform: &str,
    keyword: &str,
    raw: &JsonVal,
) -> Result<(), String> {
    let link = raw.get_str("link");
    if link.is_empty() {
        return Ok(());
    }
    let name = raw.get_str("name");
    let price = raw.get_str("price");
    let rating = raw.get_str("rating");
    let raw_img = raw.get_str("img");
    let img = if raw_img.starts_with("data:image") {
        String::new()
    } else {
        raw_img
    };
    let shipping = raw.get_str("shipping");
    let location = raw.get_str("location");
    let category = raw.get_str("category");
    let description = raw.get_str("description");
    let total_rating = raw.get_i64("total_rating").max(raw.get_i64("totalRating"));

    let dr_json = raw
        .get("detailed_rating")
        .or_else(|| raw.get("detailedRating"))
        .map(|v| v.to_json_string(None))
        .unwrap_or_else(|| "{}".to_string());

    let comments_json = raw
        .get("comments")
        .map(|v| v.to_json_string(None))
        .unwrap_or_else(|| "[]".to_string());

    let sql = format!(
        "INSERT INTO products (platform, keyword, link, name, price, rating, img, shipping, location, category, description, total_rating, detailed_rating, comments, updated_at)
         VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}::jsonb, {}::jsonb, NOW())
         ON CONFLICT (platform, keyword, link) DO UPDATE SET
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           rating = EXCLUDED.rating,
           img = CASE WHEN EXCLUDED.img <> '' THEN EXCLUDED.img ELSE products.img END,
           shipping = CASE WHEN EXCLUDED.shipping <> '' THEN EXCLUDED.shipping ELSE products.shipping END,
           location = CASE WHEN EXCLUDED.location <> '' THEN EXCLUDED.location ELSE products.location END,
           category = CASE WHEN EXCLUDED.category <> '' THEN EXCLUDED.category ELSE products.category END,
           description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE products.description END,
           total_rating = CASE WHEN EXCLUDED.total_rating > 0 THEN EXCLUDED.total_rating ELSE products.total_rating END,
           detailed_rating = CASE WHEN EXCLUDED.detailed_rating <> '{{}}'::jsonb THEN EXCLUDED.detailed_rating ELSE products.detailed_rating END,
           comments = CASE WHEN jsonb_array_length(EXCLUDED.comments) > 0 THEN EXCLUDED.comments ELSE products.comments END,
           updated_at = NOW();",
        sql_str(platform),
        sql_str(keyword),
        sql_str(&link),
        sql_str(&name),
        sql_str(&price),
        sql_str(&rating),
        sql_str(&img),
        sql_str(&shipping),
        sql_str(&location),
        sql_str(&category),
        sql_str(&description),
        total_rating,
        sql_str(&dr_json),
        sql_str(&comments_json)
    );

    pg.query(&sql)?;
    Ok(())
}

fn init_postgres_and_seed(_base_dir: &Path) {
    let mut pg = match PgClient::connect() {
        Ok(c) => c,
        Err(e) => {
            println!("PostgreSQL not yet reachable ({}). Run `docker compose up -d` to start PostgreSQL.", e);
            return;
        }
    };

    let create_sql = "
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            platform VARCHAR(32) NOT NULL DEFAULT 'shopee',
            keyword VARCHAR(255) NOT NULL,
            link TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            price TEXT NOT NULL DEFAULT '',
            rating TEXT NOT NULL DEFAULT '',
            img TEXT NOT NULL DEFAULT '',
            shipping TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            total_rating BIGINT NOT NULL DEFAULT 0,
            detailed_rating JSONB NOT NULL DEFAULT '{}'::jsonb,
            comments JSONB NOT NULL DEFAULT '[]'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (platform, keyword, link)
        );
        CREATE INDEX IF NOT EXISTS idx_products_platform_keyword ON products (platform, keyword);
        CREATE INDEX IF NOT EXISTS idx_products_link ON products (link);
    ";

    if let Err(e) = pg.query(create_sql) {
        println!("Failed to initialize products table: {}", e);
        return;
    }

    println!("Connected to PostgreSQL (127.0.0.1:5433/store_explorer).");
}

fn normalize_review_obj(raw: &JsonVal, prod_name: &str, prod_link: &str) -> JsonVal {
    let author = raw.get_str("author");
    let rating = raw.get_i64("rating");
    let time = raw.get_str("time");
    let content = raw.get_str("content");
    let seller_respond = {
        let s1 = raw.get_str("seller_respond");
        if !s1.is_empty() {
            s1
        } else {
            raw.get_str("sellerRespond")
        }
    };
    let like_count = {
        let l1 = raw.get_i64("like_count");
        if l1 != 0 {
            l1
        } else {
            raw.get_i64("likeCount")
        }
    };
    let sentiment = raw.get("sentiment").cloned().unwrap_or(JsonVal::Null);

    JsonVal::Obj(vec![
        ("__typename".into(), JsonVal::Str("Review".into())),
        ("author".into(), JsonVal::Str(author)),
        ("rating".into(), JsonVal::Num(rating as f64)),
        ("time".into(), JsonVal::Str(time)),
        ("content".into(), JsonVal::Str(content)),
        ("sellerRespond".into(), JsonVal::Str(seller_respond.clone())),
        ("seller_respond".into(), JsonVal::Str(seller_respond)),
        ("likeCount".into(), JsonVal::Num(like_count as f64)),
        ("like_count".into(), JsonVal::Num(like_count as f64)),
        ("sentiment".into(), sentiment),
        ("productName".into(), JsonVal::Str(prod_name.to_string())),
        ("productLink".into(), JsonVal::Str(prod_link.to_string())),
    ])
}

fn row_to_product_obj(row: &HashMap<String, String>) -> JsonVal {
    let platform = row
        .get("platform")
        .cloned()
        .unwrap_or_else(|| "shopee".into());
    let keyword = row.get("keyword").cloned().unwrap_or_default();
    let link = row.get("link").cloned().unwrap_or_default();
    let name = row.get("name").cloned().unwrap_or_default();
    let price = row.get("price").cloned().unwrap_or_default();
    let rating = row.get("rating").cloned().unwrap_or_default();
    let raw_img = row.get("img").cloned().unwrap_or_default();
    let img = if raw_img.starts_with("data:image") {
        String::new()
    } else {
        raw_img
    };
    let shipping = row.get("shipping").cloned().unwrap_or_default();
    let location = row.get("location").cloned().unwrap_or_default();
    let category = row.get("category").cloned().unwrap_or_default();
    let description = row.get("description").cloned().unwrap_or_default();
    let total_rating = row
        .get("total_rating")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let dr_raw = row
        .get("detailed_rating")
        .and_then(|s| JsonParser::parse(s).ok())
        .unwrap_or(JsonVal::Obj(vec![]));

    let comments_vec: Vec<JsonVal> = row
        .get("comments")
        .and_then(|s| JsonParser::parse(s).ok())
        .and_then(|v| match v {
            JsonVal::Arr(arr) => Some(
                arr.iter()
                    .map(|r| normalize_review_obj(r, &name, &link))
                    .collect(),
            ),
            _ => None,
        })
        .unwrap_or_default();

    let dr_obj = JsonVal::Obj(vec![
        ("__typename".into(), JsonVal::Str("DetailedRating".into())),
        ("all".into(), JsonVal::Num(dr_raw.get_i64("all") as f64)),
        (
            "fiveStar".into(),
            JsonVal::Num(dr_raw.get_i64("5_star") as f64),
        ),
        (
            "fourStar".into(),
            JsonVal::Num(dr_raw.get_i64("4_star") as f64),
        ),
        (
            "threeStar".into(),
            JsonVal::Num(dr_raw.get_i64("3_star") as f64),
        ),
        (
            "twoStar".into(),
            JsonVal::Num(dr_raw.get_i64("2_star") as f64),
        ),
        (
            "oneStar".into(),
            JsonVal::Num(dr_raw.get_i64("1_star") as f64),
        ),
        (
            "commented".into(),
            JsonVal::Num(dr_raw.get_i64("commented") as f64),
        ),
        ("media".into(), JsonVal::Num(dr_raw.get_i64("media") as f64)),
    ]);

    let comment_count = comments_vec.len() as f64;
    let final_total = if total_rating > 0 {
        total_rating as f64
    } else {
        comment_count
    };

    JsonVal::Obj(vec![
        ("__typename".into(), JsonVal::Str("Product".into())),
        ("platform".into(), JsonVal::Str(platform)),
        ("keyword".into(), JsonVal::Str(keyword)),
        ("link".into(), JsonVal::Str(link)),
        ("name".into(), JsonVal::Str(name)),
        ("price".into(), JsonVal::Str(price)),
        ("rating".into(), JsonVal::Str(rating)),
        ("img".into(), JsonVal::Str(img)),
        ("shipping".into(), JsonVal::Str(shipping)),
        ("location".into(), JsonVal::Str(location)),
        ("category".into(), JsonVal::Str(category)),
        ("description".into(), JsonVal::Str(description)),
        ("totalRating".into(), JsonVal::Num(final_total)),
        ("total_rating".into(), JsonVal::Num(final_total)),
        ("commentCount".into(), JsonVal::Num(comment_count)),
        ("detailedRating".into(), dr_obj.clone()),
        ("detailed_rating".into(), dr_obj),
        ("comments".into(), JsonVal::Arr(comments_vec)),
    ])
}

// ---------------------------------------------------------------------------
// GraphQL Query & Mutation Execution (Backed by PostgreSQL)
// ---------------------------------------------------------------------------

fn eval_selections(val: &JsonVal, selections: &[GqlField]) -> JsonVal {
    match val {
        JsonVal::Null => JsonVal::Null,
        JsonVal::Arr(items) => JsonVal::Arr(
            items
                .iter()
                .map(|item| eval_selections(item, selections))
                .collect(),
        ),
        JsonVal::Obj(_) => {
            if selections.is_empty() {
                return val.clone();
            }
            let mut out = Vec::new();
            for sel in selections {
                if sel.name == "__typename" {
                    let tname = val.get_str("__typename");
                    out.push((
                        sel.alias.clone(),
                        JsonVal::Str(if tname.is_empty() {
                            "Object".into()
                        } else {
                            tname
                        }),
                    ));
                    continue;
                }

                let mut field_val = val.get(&sel.name).cloned().unwrap_or(JsonVal::Null);

                if sel.name == "comments" {
                    if let JsonVal::Arr(mut arr) = field_val {
                        if let Some(JsonVal::Num(star)) = sel.args.get("star") {
                            let target_star = *star as i64;
                            arr.retain(|r| r.get_i64("rating") == target_star);
                        }
                        if let Some(JsonVal::Num(lim)) = sel.args.get("limit") {
                            let l = (*lim as usize).min(arr.len());
                            arr.truncate(l);
                        }
                        field_val = JsonVal::Arr(arr);
                    }
                }

                if !sel.selections.is_empty() {
                    field_val = eval_selections(&field_val, &sel.selections);
                }
                out.push((sel.alias.clone(), field_val));
            }
            JsonVal::Obj(out)
        }
        other => other.clone(),
    }
}

fn execute_root_field(field: &GqlField, is_mutation: bool, base_dir: &Path) -> Result<JsonVal, String> {
    let mut pg = PgClient::connect()?;

    if !is_mutation {
        match field.name.as_str() {
            "__typename" => Ok(JsonVal::Str("Query".into())),
            "datasets" => {
                let sql = "
                    SELECT
                        platform,
                        keyword,
                        COUNT(*)::bigint AS product_count,
                        COALESCE(SUM(jsonb_array_length(comments)), 0)::bigint AS review_count
                    FROM products
                    GROUP BY platform, keyword
                    ORDER BY keyword ASC, platform ASC;
                ";
                let rows = pg.query(sql)?;
                let mut list = Vec::new();
                for r in rows {
                    let plat = r.get("platform").cloned().unwrap_or_else(|| "shopee".into());
                    let kw = r.get("keyword").cloned().unwrap_or_default();
                    let p_cnt = r
                        .get("product_count")
                        .and_then(|s| s.parse::<f64>().ok())
                        .unwrap_or(0.0);
                    let r_cnt = r
                        .get("review_count")
                        .and_then(|s| s.parse::<f64>().ok())
                        .unwrap_or(0.0);
                    let ds_obj = JsonVal::Obj(vec![
                        ("__typename".into(), JsonVal::Str("Dataset".into())),
                        ("platform".into(), JsonVal::Str(plat.clone())),
                        ("keyword".into(), JsonVal::Str(kw.clone())),
                        ("file".into(), JsonVal::Str(format!("pg:{}:{}", plat, kw))),
                        ("productCount".into(), JsonVal::Num(p_cnt)),
                        ("reviewCount".into(), JsonVal::Num(r_cnt)),
                    ]);
                    list.push(eval_selections(&ds_obj, &field.selections));
                }
                Ok(JsonVal::Arr(list))
            }
            "products" => {
                let mut conditions = vec!["1=1".to_string()];

                if let Some(plat) = field.args.get("platform").and_then(|v| v.as_str()) {
                    let p = plat.to_lowercase();
                    if !p.is_empty() && p != "all" && p != "both" {
                        conditions.push(format!("platform = {}", sql_str(&p)));
                    }
                }
                if let Some(kw) = field.args.get("keyword").and_then(|v| v.as_str()) {
                    let norm = sanitize_keyword(kw);
                    if !norm.is_empty() && kw != "" {
                        conditions.push(format!("keyword ILIKE {}", sql_str(&format!("%{}%", norm))));
                    }
                }
                if let Some(search) = field.args.get("search").and_then(|v| v.as_str()) {
                    if !search.trim().is_empty() {
                        conditions.push(format!(
                            "name ILIKE {}",
                            sql_str(&format!("%{}%", search.trim()))
                        ));
                    }
                }

                let offset = field
                    .args
                    .get("offset")
                    .and_then(|v| match v {
                        JsonVal::Num(n) => Some(*n as usize),
                        _ => None,
                    })
                    .unwrap_or(0);
                let limit = field
                    .args
                    .get("limit")
                    .and_then(|v| match v {
                        JsonVal::Num(n) => Some(*n as usize),
                        _ => None,
                    })
                    .unwrap_or(300);

                let sql = format!(
                    "SELECT platform, keyword, link, name, price, rating, img, shipping, location, category, description, total_rating, detailed_rating::text, comments::text
                     FROM products
                     WHERE {}
                     ORDER BY id ASC
                     LIMIT {} OFFSET {};",
                    conditions.join(" AND "),
                    limit,
                    offset
                );

                let rows = pg.query(&sql)?;
                let out: Vec<JsonVal> = rows
                    .iter()
                    .map(|r| {
                        let norm = row_to_product_obj(r);
                        eval_selections(&norm, &field.selections)
                    })
                    .collect();
                Ok(JsonVal::Arr(out))
            }
            "product" => {
                let target_link = field
                    .args
                    .get("link")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let sql = format!(
                    "SELECT platform, keyword, link, name, price, rating, img, shipping, location, category, description, total_rating, detailed_rating::text, comments::text
                     FROM products
                     WHERE link = {}
                     LIMIT 1;",
                    sql_str(target_link)
                );
                let rows = pg.query(&sql)?;
                if let Some(first) = rows.first() {
                    let norm = row_to_product_obj(first);
                    return Ok(eval_selections(&norm, &field.selections));
                }
                Ok(JsonVal::Null)
            }
            "reviews" => {
                let mut conditions = vec!["jsonb_array_length(comments) > 0".to_string()];
                if let Some(kw) = field.args.get("keyword").and_then(|v| v.as_str()) {
                    let norm = sanitize_keyword(kw);
                    if !norm.is_empty() && !kw.is_empty() {
                        conditions.push(format!("keyword ILIKE {}", sql_str(&format!("%{}%", norm))));
                    }
                }
                if let Some(lf) = field.args.get("productLink").and_then(|v| v.as_str()) {
                    if !lf.is_empty() {
                        conditions.push(format!("link = {}", sql_str(lf)));
                    }
                }

                let star_filter = field.args.get("star").and_then(|v| match v {
                    JsonVal::Num(n) => Some(*n as i64),
                    _ => None,
                });
                let search_filter = field
                    .args
                    .get("search")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase());
                let offset = field
                    .args
                    .get("offset")
                    .and_then(|v| match v {
                        JsonVal::Num(n) => Some(*n as usize),
                        _ => None,
                    })
                    .unwrap_or(0);
                let limit = field.args.get("limit").and_then(|v| match v {
                    JsonVal::Num(n) => Some(*n as usize),
                    _ => None,
                });

                let sql = format!(
                    "SELECT name, link, comments::text FROM products WHERE {} ORDER BY id ASC;",
                    conditions.join(" AND ")
                );
                let rows = pg.query(&sql)?;
                let mut revs = Vec::new();
                for r in rows {
                    let p_name = r.get("name").cloned().unwrap_or_default();
                    let p_link = r.get("link").cloned().unwrap_or_default();
                    if let Some(c_str) = r.get("comments") {
                        if let Ok(JsonVal::Arr(arr)) = JsonParser::parse(c_str) {
                            for c in arr {
                                let rev = normalize_review_obj(&c, &p_name, &p_link);
                                if let Some(sf) = star_filter {
                                    if rev.get_i64("rating") != sf {
                                        continue;
                                    }
                                }
                                if let Some(ref q) = search_filter {
                                    if !q.is_empty()
                                        && !rev.get_str("content").to_lowercase().contains(q)
                                    {
                                        continue;
                                    }
                                }
                                revs.push(rev);
                            }
                        }
                    }
                }

                let sliced: Vec<JsonVal> = revs
                    .into_iter()
                    .skip(offset)
                    .take(limit.unwrap_or(usize::MAX))
                    .map(|r| eval_selections(&r, &field.selections))
                    .collect();
                Ok(JsonVal::Arr(sliced))
            }
            other => Err(format!("Unknown Query field '{}'", other)),
        }
    } else {
        match field.name.as_str() {
            "saveScrapedProducts" => {
                let raw_plat = field
                    .args
                    .get("platform")
                    .and_then(|v| v.as_str())
                    .unwrap_or("shopee");
                let platform = if raw_plat.eq_ignore_ascii_case("lazada") {
                    "lazada"
                } else {
                    "shopee"
                };
                let raw_kw = field
                    .args
                    .get("keyword")
                    .and_then(|v| v.as_str())
                    .unwrap_or("products");
                let norm_kw = sanitize_keyword(raw_kw);
                let products_json_str = field
                    .args
                    .get("productsJson")
                    .and_then(|v| v.as_str())
                    .unwrap_or("[]");

                let incoming = match JsonParser::parse(products_json_str)? {
                    JsonVal::Arr(a) => a,
                    _ => Vec::new(),
                };

                // Single-active-search mode: remove any previous keyword from PostgreSQL
                // and replace existing rows for the current (platform, keyword)
                let cleanup_sql = format!(
                    "DELETE FROM products WHERE keyword <> {} OR (platform = {} AND keyword = {});",
                    sql_str(&norm_kw),
                    sql_str(platform),
                    sql_str(&norm_kw)
                );
                let _ = pg.query(&cleanup_sql);

                for prod in &incoming {
                    let item_plat = {
                        let p = prod.get_str("platform");
                        if p.eq_ignore_ascii_case("lazada") || prod.get_str("link").contains("lazada.") {
                            "lazada"
                        } else if !p.is_empty() {
                            "shopee"
                        } else {
                            platform
                        }
                    };
                    upsert_product_to_pg(&mut pg, item_plat, &norm_kw, prod)?;
                }

                let sql = format!(
                    "SELECT platform, keyword, link, name, price, rating, img, shipping, location, category, description, total_rating, detailed_rating::text, comments::text
                     FROM products
                     WHERE platform = {} AND keyword = {}
                     ORDER BY id ASC;",
                    sql_str(platform),
                    sql_str(&norm_kw)
                );
                let rows = pg.query(&sql)?;
                let out_list: Vec<JsonVal> = rows
                    .iter()
                    .map(|r| {
                        let norm = row_to_product_obj(r);
                        eval_selections(&norm, &field.selections)
                    })
                    .collect();

                Ok(JsonVal::Arr(out_list))
            }
            "saveProductDetails" => {
                let target_link = field
                    .args
                    .get("link")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let detail_json_str = field
                    .args
                    .get("detailJson")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");

                let detail_val = JsonParser::parse(detail_json_str)?;
                let category = detail_val.get_str("category");
                let description = detail_val.get_str("description");
                let total_rating = detail_val
                    .get_i64("total_rating")
                    .max(detail_val.get_i64("totalRating"));
                let dr_json = detail_val
                    .get("detailed_rating")
                    .or_else(|| detail_val.get("detailedRating"))
                    .map(|v| v.to_json_string(None))
                    .unwrap_or_else(|| "{}".to_string());
                let comments_json = detail_val
                    .get("comments")
                    .map(|v| v.to_json_string(None))
                    .unwrap_or_else(|| "[]".to_string());

                let update_sql = format!(
                    "UPDATE products
                     SET category = {},
                         description = {},
                         total_rating = {},
                         detailed_rating = {}::jsonb,
                         comments = {}::jsonb,
                         updated_at = NOW()
                     WHERE link = {}
                     RETURNING platform, keyword, link, name, price, rating, img, shipping, location, category, description, total_rating, detailed_rating::text, comments::text;",
                    sql_str(&category),
                    sql_str(&description),
                    total_rating,
                    sql_str(&dr_json),
                    sql_str(&comments_json),
                    sql_str(target_link)
                );

                let rows = pg.query(&update_sql)?;
                if let Some(first) = rows.first() {
                    let norm = row_to_product_obj(first);
                    return Ok(eval_selections(&norm, &field.selections));
                }
                Ok(JsonVal::Null)
            }
            "clearDatabase" => {
                let plat_opt = field
                    .args
                    .get("platform")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_lowercase());
                let kw_opt = field
                    .args
                    .get("keyword")
                    .and_then(|v| v.as_str())
                    .map(|s| sanitize_keyword(s.trim()));

                let has_plat = plat_opt
                    .as_ref()
                    .map(|p| !p.is_empty() && p != "all" && p != "both")
                    .unwrap_or(false);
                let has_kw = field
                    .args
                    .get("keyword")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);

                if !has_plat && !has_kw {
                    pg.query("TRUNCATE TABLE products RESTART IDENTITY;")?;
                    if let Ok(entries) = fs::read_dir(base_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                                if (fname.starts_with("shopee_") || fname.starts_with("lazada_"))
                                    && fname.ends_with(".json")
                                {
                                    let _ = fs::remove_file(path);
                                }
                            }
                        }
                    }
                } else {
                    let mut conds = Vec::new();
                    if has_plat {
                        if let Some(ref p) = plat_opt {
                            conds.push(format!("platform = {}", sql_str(p)));
                        }
                    }
                    if has_kw {
                        if let Some(ref k) = kw_opt {
                            conds.push(format!("keyword = {}", sql_str(k)));
                            for prefix in &["shopee", "lazada"] {
                                if !has_plat || plat_opt.as_deref() == Some(*prefix) {
                                    let fpath = base_dir.join(format!("{}_{}.json", prefix, k));
                                    let _ = fs::remove_file(fpath);
                                }
                            }
                        }
                    }
                    let sql = format!("DELETE FROM products WHERE {};", conds.join(" AND "));
                    pg.query(&sql)?;
                }

                Ok(JsonVal::Bool(true))
            }
            "deleteProduct" => {
                let target_link = field
                    .args
                    .get("link")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !target_link.is_empty() {
                    let sql = format!("DELETE FROM products WHERE link = {};", sql_str(target_link));
                    pg.query(&sql)?;
                }
                Ok(JsonVal::Bool(true))
            }
            other => Err(format!("Unknown Mutation field '{}'", other)),
        }
    }
}

fn execute_graphql_request(
    query: &str,
    variables: HashMap<String, JsonVal>,
    op_name: Option<String>,
    base_dir: &Path,
) -> JsonVal {
    let tokens = match tokenize_gql(query) {
        Ok(t) => t,
        Err(e) => {
            return JsonVal::Obj(vec![(
                "errors".into(),
                JsonVal::Arr(vec![JsonVal::Obj(vec![("message".into(), JsonVal::Str(e))])]),
            )])
        }
    };

    let mut parser = GqlParser {
        tokens,
        pos: 0,
        variables,
    };

    let ops = match parser.parse_doc() {
        Ok(o) if !o.is_empty() => o,
        Ok(_) => {
            return JsonVal::Obj(vec![(
                "errors".into(),
                JsonVal::Arr(vec![JsonVal::Obj(vec![(
                    "message".into(),
                    JsonVal::Str("No GraphQL operation found".into()),
                )])]),
            )])
        }
        Err(e) => {
            return JsonVal::Obj(vec![(
                "errors".into(),
                JsonVal::Arr(vec![JsonVal::Obj(vec![("message".into(), JsonVal::Str(e))])]),
            )])
        }
    };

    let target_op = if let Some(ref target_name) = op_name {
        ops.iter()
            .find(|op| op.name.as_ref() == Some(target_name))
            .unwrap_or(&ops[0])
    } else {
        &ops[0]
    };

    let is_mutation = target_op.op_type == "mutation";
    let mut data_entries = Vec::new();
    let mut errors = Vec::new();

    for field in &target_op.selections {
        match execute_root_field(field, is_mutation, base_dir) {
            Ok(v) => data_entries.push((field.alias.clone(), v)),
            Err(err_msg) => errors.push(JsonVal::Obj(vec![(
                "message".into(),
                JsonVal::Str(err_msg),
            )])),
        }
    }

    let mut resp = vec![("data".into(), JsonVal::Obj(data_entries))];
    if !errors.is_empty() {
        resp.push(("errors".into(), JsonVal::Arr(errors)));
    }
    JsonVal::Obj(resp)
}

// ---------------------------------------------------------------------------
// HTTP Server (Port 8000) serving Vue Dashboard (/) & GraphQL (/graphql)
// ---------------------------------------------------------------------------

const GRAPHIQL_PLAYGROUND_HTML: &str = r#"<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>Store Explorer — Rust GraphQL + PostgreSQL Playground</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      font-feature-settings: "calt" 1, "kern" 1, "liga" 1, "ss03" 1;
      background: #07080a;
      color: #cdcdcd;
      height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }
    header {
      background: #07080a;
      border-bottom: 1px solid #242728;
      height: 56px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 500; font-size: 14px; color: #f4f4f6; letter-spacing: 0.2px; }
    .badge { background: #101111; color: rgba(255,255,255,0.72); border: 1px solid #242728; font-size: 12px; padding: 2px 6px; border-radius: 4px; }
    .toolbar { display: flex; gap: 8px; align-items: center; }
    a.btn {
      background: transparent;
      color: #ffffff;
      border: 1px solid rgba(255,255,255,0.16);
      padding: 6px 14px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    button.run {
      background: #ffffff;
      color: #000000;
      border: none;
      padding: 8px 16px;
      height: 36px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.2px;
    }
    button.run:active { background: #e8e8e8; }
    main { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #242728; overflow: hidden; }
    .pane { background: #0d0d0d; display: flex; flex-direction: column; overflow: hidden; }
    .pane-header {
      background: #101111;
      border-bottom: 1px solid #242728;
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 500;
      color: #9c9c9d;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      display: flex;
      justify-content: space-between;
    }
    textarea {
      flex: 1;
      width: 100%;
      background: #0d0d0d;
      color: #f4f4f6;
      border: none;
      padding: 16px;
      font-family: "JetBrains Mono", Consolas, monospace;
      font-size: 13.5px;
      line-height: 1.6;
      resize: none;
      outline: none;
    }
    pre {
      flex: 1;
      padding: 16px;
      overflow: auto;
      font-family: "JetBrains Mono", Consolas, monospace;
      font-size: 13.5px;
      line-height: 1.6;
      color: #59d499;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
      <span>Store Explorer GraphQL</span>
      <span class="badge">PostgreSQL 16 · Port 5433</span>
    </div>
    <div class="toolbar">
      <a href="/" class="btn">Back to Store Explorer</a>
      <button class="run" onclick="runQuery()">Run Query</button>
    </div>
  </header>
  <main>
    <div class="pane">
      <div class="pane-header"><span>GraphQL Query</span></div>
      <textarea id="query" spellcheck="false">query GetBestSellingProducts {
  datasets {
    platform
    keyword
    file
    productCount
    reviewCount
  }
  products(limit: 20) {
    platform
    keyword
    name
    price
    rating
    shipping
    location
    img
    link
    commentCount
    comments(limit: 5) {
      author
      rating
      time
      content
    }
  }
}</textarea>
    </div>
    <div class="pane">
      <div class="pane-header"><span>Response</span><span id="status"></span></div>
      <pre id="response"></pre>
    </div>
  </main>
  <script>
    async function runQuery() {
      const query = document.getElementById("query").value;
      const t0 = performance.now();
      const res = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const json = await res.json();
      document.getElementById("status").textContent = `${res.status} OK (${Math.round(performance.now() - t0)} ms)`;
      document.getElementById("response").textContent = JSON.stringify(json, null, 2);
    }
    runQuery();
  </script>
</body>
</html>"#;

fn send_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nConnection: close\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle_client(mut stream: TcpStream, base_dir: PathBuf) {
    let mut buf = Vec::new();
    let mut temp = [0u8; 8192];
    let mut header_end = None;
    let mut content_length = 0usize;

    loop {
        match stream.read(&mut temp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&temp[..n]);
                if header_end.is_none() {
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let end_pos = pos + 4;
                        header_end = Some(end_pos);
                        let header_str = String::from_utf8_lossy(&buf[..pos]);
                        for line in header_str.lines() {
                            if line.to_lowercase().starts_with("content-length:") {
                                if let Some(val) = line.split(':').nth(1) {
                                    content_length = val.trim().parse::<usize>().unwrap_or(0);
                                }
                            }
                        }
                    }
                }
                if let Some(end_pos) = header_end {
                    if buf.len() >= end_pos + content_length {
                        break;
                    }
                }
            }
            Err(_) => break,
        }
    }

    if buf.is_empty() {
        return;
    }

    let end_pos = header_end.unwrap_or(buf.len());
    let header_str = String::from_utf8_lossy(&buf[..end_pos]);
    let first_line = header_str.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }
    let method = parts[0];
    let raw_path = parts[1];
    let path_only = raw_path.split('?').next().unwrap_or("/");

    if method == "OPTIONS" {
        send_http_response(&mut stream, "204 No Content", "text/plain", b"");
        return;
    }

    if path_only == "/graphql" {
        if method == "GET" {
            send_http_response(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                GRAPHIQL_PLAYGROUND_HTML.as_bytes(),
            );
            return;
        } else if method == "POST" {
            let body_bytes = &buf[end_pos..];
            let body_str = String::from_utf8_lossy(body_bytes);
            let payload = JsonParser::parse(&body_str).unwrap_or(JsonVal::Obj(vec![]));
            let query = payload.get_str("query");
            let op_name = payload
                .get("operationName")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut vars = HashMap::new();
            if let Some(JsonVal::Obj(entries)) = payload.get("variables") {
                for (k, v) in entries {
                    vars.insert(k.clone(), v.clone());
                }
            }

            let gql_resp = execute_graphql_request(&query, vars, op_name, &base_dir);
            let resp_str = gql_resp.to_json_string(Some(2));
            send_http_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                resp_str.as_bytes(),
            );
            return;
        }
    }

    if path_only == "/api/db-config" {
        let cfg_path = base_dir.join("db_config.json");
        if method == "GET" {
            let mut engine = "postgresql".to_string();
            let mut mode = "fields".to_string();
            let mut host = env::var("PGHOST").unwrap_or_else(|_| "127.0.0.1".to_string());
            let mut port = env::var("PGPORT").unwrap_or_else(|_| "5433".to_string());
            let mut user = env::var("PGUSER").unwrap_or_else(|_| "postgres".to_string());
            let mut password = env::var("PGPASSWORD").unwrap_or_else(|_| "postgres".to_string());
            let mut dbname = env::var("PGDATABASE").unwrap_or_else(|_| "store_explorer".to_string());
            let mut uri = String::new();
            let mut ssl_mode = "disable".to_string();

            if let Ok(cfg_str) = fs::read_to_string(&cfg_path) {
                if let Ok(cfg) = JsonParser::parse(&cfg_str) {
                    let e = cfg.get_str("engine");
                    let m = cfg.get_str("mode");
                    let h = cfg.get_str("host");
                    let p = cfg.get_str("port");
                    let u = cfg.get_str("user");
                    let pw = cfg.get_str("password");
                    let db = cfg.get_str("dbname");
                    let ur = cfg.get_str("uri");
                    let sm = cfg.get_str("sslMode");
                    if !e.is_empty() { engine = e; }
                    if !m.is_empty() { mode = m; }
                    if !h.is_empty() { host = h; }
                    if !p.is_empty() { port = p; }
                    if !u.is_empty() { user = u; }
                    if !pw.is_empty() { password = pw; }
                    if !db.is_empty() { dbname = db; }
                    if !ur.is_empty() { uri = ur; }
                    if !sm.is_empty() { ssl_mode = sm; }
                }
            }

            let connected = PgClient::connect_custom(&host, &port, &user, &password, &dbname).is_ok();
            let resp = JsonVal::Obj(vec![
                ("ok".into(), JsonVal::Bool(true)),
                ("connected".into(), JsonVal::Bool(connected)),
                ("engine".into(), JsonVal::Str(engine)),
                ("mode".into(), JsonVal::Str(mode)),
                ("host".into(), JsonVal::Str(host)),
                ("port".into(), JsonVal::Str(port)),
                ("user".into(), JsonVal::Str(user)),
                ("password".into(), JsonVal::Str(password)),
                ("dbname".into(), JsonVal::Str(dbname)),
                ("uri".into(), JsonVal::Str(uri)),
                ("sslMode".into(), JsonVal::Str(ssl_mode)),
            ]);
            let s = resp.to_json_string(Some(2));
            send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", s.as_bytes());
            return;
        } else if method == "POST" {
            let body_bytes = &buf[end_pos..];
            let body_str = String::from_utf8_lossy(body_bytes);
            let payload = JsonParser::parse(&body_str).unwrap_or(JsonVal::Obj(vec![]));
            let action = payload.get_str("action");
            let engine = {
                let e = payload.get_str("engine");
                if e.is_empty() { "postgresql".to_string() } else { e }
            };
            let mode = {
                let m = payload.get_str("mode");
                if m.is_empty() { "fields".to_string() } else { m }
            };
            let mut host = payload.get_str("host");
            let mut port = payload.get_str("port");
            let mut user = payload.get_str("user");
            let mut password = payload.get_str("password");
            let mut dbname = payload.get_str("dbname");
            let uri = payload.get_str("uri");
            let ssl_mode = {
                let s = payload.get_str("sslMode");
                if s.is_empty() { "disable".to_string() } else { s }
            };

            // Parse URI if mode == "uri" and uri starts with postgres
            if mode == "uri" && !uri.trim().is_empty() {
                let mut rest = uri.trim();
                if let Some(idx) = rest.find("://") {
                    rest = &rest[idx + 3..];
                }
                if let Some(q_idx) = rest.find('?') {
                    rest = &rest[..q_idx];
                }
                let (auth_host, db_part) = if let Some(s_idx) = rest.find('/') {
                    (&rest[..s_idx], &rest[s_idx + 1..])
                } else {
                    (rest, "store_explorer")
                };
                if !db_part.is_empty() {
                    dbname = db_part.to_string();
                }
                let host_port = if let Some(at_idx) = auth_host.rfind('@') {
                    let cred = &auth_host[..at_idx];
                    if let Some(c_idx) = cred.find(':') {
                        user = cred[..c_idx].to_string();
                        password = cred[c_idx + 1..].to_string();
                    } else {
                        user = cred.to_string();
                    }
                    &auth_host[at_idx + 1..]
                } else {
                    auth_host
                };
                if let Some(c_idx) = host_port.rfind(':') {
                    host = host_port[..c_idx].to_string();
                    port = host_port[c_idx + 1..].to_string();
                } else if !host_port.is_empty() {
                    host = host_port.to_string();
                }
            }

            if host.is_empty() { host = "127.0.0.1".into(); }
            if port.is_empty() { port = "5433".into(); }
            if user.is_empty() { user = "postgres".into(); }
            if dbname.is_empty() { dbname = "store_explorer".into(); }

            let conn_res = PgClient::connect_custom(&host, &port, &user, &password, &dbname);
            let (connected, msg) = match conn_res {
                Ok(_) => (
                    true,
                    format!("เชื่อมต่อสำเร็จ: {}@{}:{}/{}", user, host, port, dbname),
                ),
                Err(e) => (false, format!("เชื่อมต่อไม่สำเร็จ: {}", e)),
            };

            if action == "save" {
                let save_obj = JsonVal::Obj(vec![
                    ("engine".into(), JsonVal::Str(engine.clone())),
                    ("mode".into(), JsonVal::Str(mode.clone())),
                    ("host".into(), JsonVal::Str(host.clone())),
                    ("port".into(), JsonVal::Str(port.clone())),
                    ("user".into(), JsonVal::Str(user.clone())),
                    ("password".into(), JsonVal::Str(password.clone())),
                    ("dbname".into(), JsonVal::Str(dbname.clone())),
                    ("uri".into(), JsonVal::Str(uri.clone())),
                    ("sslMode".into(), JsonVal::Str(ssl_mode.clone())),
                ]);
                let _ = fs::write(&cfg_path, save_obj.to_json_string(Some(2)));
                env::set_var("PGHOST", &host);
                env::set_var("PGPORT", &port);
                env::set_var("PGUSER", &user);
                env::set_var("PGPASSWORD", &password);
                env::set_var("PGDATABASE", &dbname);
                if connected {
                    init_postgres_and_seed(&base_dir);
                }
            }

            let resp = JsonVal::Obj(vec![
                ("ok".into(), JsonVal::Bool(connected)),
                ("connected".into(), JsonVal::Bool(connected)),
                ("message".into(), JsonVal::Str(msg)),
                ("engine".into(), JsonVal::Str(engine)),
                ("mode".into(), JsonVal::Str(mode)),
                ("host".into(), JsonVal::Str(host)),
                ("port".into(), JsonVal::Str(port)),
                ("user".into(), JsonVal::Str(user)),
                ("dbname".into(), JsonVal::Str(dbname)),
            ]);
            let s = resp.to_json_string(Some(2));
            send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", s.as_bytes());
            return;
        }
    }

    if path_only == "/api/ext-version" {
        let body = format!("{{\"version\":\"{}\"}}", EMBEDDED_EXT_VERSION);
        send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", body.as_bytes());
        return;
    }

    if path_only == "/api/launch-browser" {
        let ext_dir = get_managed_extension_dir(&base_dir);
        sync_extension_files(&ext_dir);
        let launched = launch_browsers_with_extension(&ext_dir, 8000);
        let body = format!(
            "{{\"ok\":true,\"version\":\"{}\",\"launchedCount\":{}}}",
            EMBEDDED_EXT_VERSION,
            launched.len()
        );
        send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", body.as_bytes());
        return;
    }

    if path_only == "/astronot.json" {
        let lottie_path = base_dir.join("frontend").join("src").join("astronot.json");
        if let Ok(json_bytes) = fs::read(&lottie_path) {
            send_http_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                &json_bytes,
            );
            return;
        }
    }

    let dist_index = base_dir.join("frontend").join("dist").join("index.html");
    if let Ok(html_bytes) = fs::read(&dist_index) {
        send_http_response(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            &html_bytes,
        );
    } else {
        send_http_response(
            &mut stream,
            "200 OK",
            "text/html; charset=utf-8",
            EMBEDDED_INDEX_HTML,
        );
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut port = 8000u16;
    for i in 0..args.len() {
        if (args[i] == "--port" || args[i] == "-p") && i + 1 < args.len() {
            if let Ok(p) = args[i + 1].parse::<u16>() {
                port = p;
            }
        }
    }

    let base_dir = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    init_postgres_and_seed(&base_dir);

    // Automatically provision or update obfuscated extension files on version change
    let managed_ext_dir = get_managed_extension_dir(&base_dir);
    let was_updated = sync_extension_files(&managed_ext_dir);
    let local_ext_dir = base_dir.join("extension");
    let _ = sync_extension_files(&local_ext_dir);

    if was_updated {
        let _ = launch_browsers_with_extension(&managed_ext_dir, port);
    }

    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).expect("Failed to bind port 8000");

    println!("============================================================");
    println!(" Store Explorer — Rust GraphQL + PostgreSQL + Vue 3 UI");
    println!(" Web UI (Search & Products): http://127.0.0.1:{}/", port);
    println!(" GraphQL Playground & API:   http://127.0.0.1:{}/graphql", port);
    println!(" PostgreSQL Database:        127.0.0.1:5433/store_explorer");
    println!("============================================================");

    for stream in listener.incoming() {
        if let Ok(s) = stream {
            let dir_clone = base_dir.clone();
            thread::spawn(move || {
                handle_client(s, dir_clone);
            });
        }
    }
}
