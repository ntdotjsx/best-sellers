const fs = require("fs");
const path = require("path");

function obfuscateExtensionJs(code, seed = 0x5a) {
  let out = "";
  let i = 0;
  const n = code.length;
  const strings = [];

  function encodeStr(str) {
    const buf = Buffer.from(str, "utf8");
    const xored = Buffer.alloc(buf.length);
    for (let j = 0; j < buf.length; j++) {
      xored[j] = buf[j] ^ ((seed + j * 13) & 0xff);
    }
    const b64 = xored.toString("base64");
    let idx = strings.indexOf(b64);
    if (idx === -1) {
      idx = strings.length;
      strings.push(b64);
    }
    return `_0x9f2e(0x${idx.toString(16)})`;
  }

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && code[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "`") {
      let lit = "`";
      i++;
      while (i < n) {
        if (code[i] === "\\") {
          lit += code[i] + (code[i + 1] || "");
          i += 2;
          continue;
        }
        if (code[i] === "`") {
          lit += "`";
          i++;
          break;
        }
        lit += code[i++];
      }
      out += lit;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let raw = "";
      i++;
      let hasSpecial = false;
      while (i < n) {
        const c = code[i];
        if (c === "\\") {
          const esc = code[i + 1];
          if (esc === "n") raw += "\n";
          else if (esc === "r") raw += "\r";
          else if (esc === "t") raw += "\t";
          else if (esc === '"' || esc === "'" || esc === "\\") raw += esc;
          else {
            hasSpecial = true;
            raw += "\\" + esc;
          }
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        raw += c;
        i++;
      }
      let k = i;
      while (k < n && /\s/.test(code[k])) k++;
      const isObjKey = code[k] === ":";
      if (!hasSpecial && !isObjKey && raw.length > 0) {
        out += encodeStr(raw);
      } else {
        out += JSON.stringify(raw);
      }
      continue;
    }

    out += ch;
    i++;
  }

  const minified = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  const header = `(function(){const _0x4d1a=${JSON.stringify(strings)};const _0x9f2e=function(_0x1c){const _0x2b=atob(_0x4d1a[_0x1c]);const _0x3e=new Uint8Array(_0x2b.length);for(let _0x4f=0;_0x4f<_0x2b.length;_0x4f++){_0x3e[_0x4f]=_0x2b.charCodeAt(_0x4f)^((0x${seed.toString(16)}+_0x4f*0xd)&0xff);}return new TextDecoder().decode(_0x3e);};\n`;
  const footer = `\n})();`;
  return header + minified + footer;
}

function obfuscateFrontendHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptStartTag = "<script>\n      window.__ASTRONOT_LOTTIE__";
  const sIdx = html.indexOf(scriptStartTag);
  const eIdx = html.lastIndexOf("</script>");
  if (sIdx === -1 || eIdx === -1) {
    console.log("Frontend script already obfuscated or tag not found");
    return;
  }

  const headAndBodyHtml = html.slice(0, sIdx);
  const tailHtml = html.slice(eIdx + "</script>".length);
  const appJs = html.slice(sIdx + "<script>".length, eIdx);

  const antiInspectJs = `
    (function(){
      document.addEventListener('contextmenu', function(e){ e.preventDefault(); }, true);
      document.addEventListener('keydown', function(e){
        if (
          e.key === 'F12' ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i','j','c','k'].includes(e.key.toLowerCase())) ||
          ((e.ctrlKey || e.metaKey) && ['u','s'].includes(e.key.toLowerCase()))
        ) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }, true);
    })();
  `;

  const combinedJs = antiInspectJs + "\n" + appJs;
  const rawBuf = Buffer.from(combinedJs, "utf8");
  const key = 0x73;
  for (let i = 0; i < rawBuf.length; i++) {
    rawBuf[i] = rawBuf[i] ^ ((key + (i & 0x1f)) & 0xff);
  }
  const encodedPayload = rawBuf.toString("base64");

  const loaderScript = `<script id="_0x0a">
(function(_0x8b,_0x3k){
  try {
    var _0xd = atob(_0x8b);
    var _0xu = new Uint8Array(_0xd.length);
    for (var _0xi = 0; _0xi < _0xd.length; _0xi++) {
      _0xu[_0xi] = _0xd.charCodeAt(_0xi) ^ ((_0x3k + (_0xi & 0x1f)) & 0xff);
    }
    var _0xs = new TextDecoder().decode(_0xu);
    (new Function(_0xs))();
    var _0xel = document.getElementById('_0x0a');
    if (_0xel && _0xel.parentNode) _0xel.parentNode.removeChild(_0xel);
  } catch (_0xe) {}
})("${encodedPayload}", 0x${key.toString(16)});
</script>`;

  const finalHtml = headAndBodyHtml + loaderScript + tailHtml;
  fs.writeFileSync(htmlPath, finalHtml, "utf8");
  console.log("Obfuscated frontend/dist/index.html successfully!");
}

const backupDir = path.join(process.cwd(), ".clean_backup");
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const extFiles = [
  "background.js",
  "bridge.js",
  "content_shopee.js",
  "content_shopee_main.js",
  "content_lazada.js",
];

for (let idx = 0; idx < extFiles.length; idx++) {
  const f = extFiles[idx];
  const srcPath = path.join(process.cwd(), "extension", f);
  const bakPath = path.join(backupDir, f);
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(srcPath, bakPath);
  }
  const cleanCode = fs.readFileSync(bakPath, "utf8");
  const obf = obfuscateExtensionJs(cleanCode, 0x41 + idx * 7);
  fs.writeFileSync(srcPath, obf, "utf8");
  console.log(`Obfuscated extension/${f}`);
}

const htmlPath = path.join(process.cwd(), "frontend", "dist", "index.html");
const htmlBakPath = path.join(backupDir, "index.html");
if (!fs.existsSync(htmlBakPath)) {
  fs.copyFileSync(htmlPath, htmlBakPath);
}
fs.copyFileSync(htmlBakPath, htmlPath);
obfuscateFrontendHtml(htmlPath);
