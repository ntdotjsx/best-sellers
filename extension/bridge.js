(function(){const _0x4d1a=["eXtQQUw=","DBovLBPn4sbeyYa4hZWbbw==","LDQWDlH6/szA2K/6gYmKJnFLQUstNQoW5A==","PCcXCg==","LDQWDlH6/szA2K/6gYmKJm5AQEwlNgg=","Gx0tPznMyebo6ZWVtri6TF0=","DQ02MC7M1+fp","Yg==","JTARHB3u8w==","Gx0tPznMyfXl+JWWtKE=","GBwsKCPMzvf185meq78=","GBwsKCPL0Q==","DQ02MCzG2OQ=","DQ02MC7MxfP/85mS","DQ02MDnbxOzi"];const _0x9f2e=function(_0x1c){const _0x2b=atob(_0x4d1a[_0x1c]);const _0x3e=new Uint8Array(_0x2b.length);for(let _0x4f=0;_0x4f<_0x2b.length;_0x4f++){_0x3e[_0x4f]=_0x2b.charCodeAt(_0x4f)^((0x48+_0x4f*0xd)&0xff);}return new TextDecoder().decode(_0x3e);};
const EXT_VERSION = _0x9f2e(0x0);
window.addEventListener(_0x9f2e(0x1), () => {
document.documentElement.setAttribute(_0x9f2e(0x2), _0x9f2e(0x3));
document.documentElement.setAttribute(_0x9f2e(0x4), EXT_VERSION);
window.postMessage(
{ source: _0x9f2e(0x5), type: _0x9f2e(0x6), version: EXT_VERSION },
_0x9f2e(0x7)
);
});
document.documentElement.setAttribute(_0x9f2e(0x2), _0x9f2e(0x3));
document.documentElement.setAttribute(_0x9f2e(0x4), EXT_VERSION);
window.addEventListener(_0x9f2e(0x8), async (event) => {
if (event.source !== window || !event.data || event.data.source !== _0x9f2e(0x9)) {
return;
}
const { action, payload, requestId } = event.data;
if (action === _0x9f2e(0xa)) {
try {
const pong = await chrome.runtime.sendMessage({
action: _0x9f2e(0xb),
expectedVersion: payload?.expectedVersion || EXT_VERSION,
});
window.postMessage(
{
source: _0x9f2e(0x5),
type: _0x9f2e(0xc),
version: pong?.version || EXT_VERSION,
reloading: Boolean(pong?.reloading),
requestId,
},
_0x9f2e(0x7)
);
} catch (_) {
window.postMessage(
{
source: _0x9f2e(0x5),
type: _0x9f2e(0xc),
version: EXT_VERSION,
requestId,
},
_0x9f2e(0x7)
);
}
return;
}
try {
const response = await chrome.runtime.sendMessage({ action, payload });
window.postMessage(
{
source: _0x9f2e(0x5),
type: _0x9f2e(0xd),
requestId,
response,
},
_0x9f2e(0x7)
);
} catch (err) {
window.postMessage(
{
source: _0x9f2e(0x5),
type: _0x9f2e(0xe),
requestId,
error: err?.message || String(err),
},
_0x9f2e(0x7)
);
}
});
})();