(function(){const _0x4d1a=["KTovGE+toK2bge3g89rZNSsmGwh1fTgeGPb70cE=","cGBpRkU=","IiE2GBnn+/k=","HQ==","Yw==","Og==","PA==","bmE=","KTovGAa4","bg==","KTovGAa4oLPewbT+sYuNZXV/BVsqfCsE","JS8vCU/r4v3O0w==","bA==","DS8hCRHjr9PP0KqztIubJEJqREog","LS8hCRHj","DS8hCRHjr8zb2aelvp4=","fg==","KCA4BADm6g==","ID4rBBzh7ujA2a3/t5mYaj0+X109JnAcFef6zoGa7fvL","IiE1HBDs+7Hdz7O1","ID4rBBzh7ujA2a3/t5mYag==","NSsjHFrq+/HFmqKgrYaeZ3BqQlcrfScEDev/i9XXqw==","DA8SJg==","IiE1HBDs+8Pa3qyguI/ZbmI=","IiE1HBDs+8Pa3qyguI+oaXB3RRYvIQ==","EQEIPA==","MiY0GBDn","Ey8oGBfn/e7QlpO5","Mi83DQY=","MTwyCxDd7u/K","Zz00GgG//+7A1aaxrok=","MTwyCxDd6/na1Q==","Zz00GgG//+7A1aa0uJmU","LSE6DBzs6A==","BBYPOjTB28P684KCnqKoVlRNfnQRAQ==","EiY0GBDnr8/d2bG1","fQI0CxT25vPHiA==","cQ==","EiY0GBDnr8na07E=","KTovGE+toK2bge3g89rZNSsmGwh1fXU=","KTovGE+toPDG1aK8tYWEcCsmGwh1fXU=","KTovGE+toK2bge3g89rZNSsrGg92fXU=","KTovGE+toPDG1aK8tYWEcCsrGg92fXU=","IzwyDBLnofba","EQcVLyrAyA==","EgsaOjbK0Mz7+YeFnr6k","IyEvAA==","BwsPKz3d387m8paTibWzQUVfYnQW","JSs9CQDu+w==","DCcoGxzs6LzZxKy0qImDSHhwQA==","LS8hCRHjoQ==","BBYPOjTB28P55IyUiKmjW1Vbf3kMHgw=","AiEuBBGi4fPdlqaoqZiWZ2U+W0oqNioPDab3xdnbrriS","EhcVKyrE3dPk6ZCYkrqyQU5Kano=","DyF7GAft6+nKwrDwu4WCanU+RFZlIj4LHA==","FCAwBhr14bzI1be5soTNJA=="];const _0x9f2e=function(_0x1c){const _0x2b=atob(_0x4d1a[_0x1c]);const _0x3e=new Uint8Array(_0x2b.length);for(let _0x4f=0;_0x4f<_0x2b.length;_0x4f++){_0x3e[_0x4f]=_0x2b.charCodeAt(_0x4f)^((0x41+_0x4f*0xd)&0xff);}return new TextDecoder().decode(_0x3e);};
const GRAPHQL_ENDPOINT = _0x9f2e(0x0);
const BG_VERSION = _0x9f2e(0x1);
function waitForTabComplete(tabId, timeoutMs = 22000) {
return new Promise((resolve) => {
const timer = setTimeout(() => {
chrome.tabs.onUpdated.removeListener(listener);
resolve();
}, timeoutMs);
function listener(updatedTabId, changeInfo) {
if (updatedTabId === tabId && changeInfo.status === _0x9f2e(0x2)) {
clearTimeout(timer);
chrome.tabs.onUpdated.removeListener(listener);
resolve();
}
}
chrome.tabs.onUpdated.addListener(listener);
});
}
function extractBalancedJson(str, startBraceIdx) {
let depth = 0;
let inString = false;
let escape = false;
for (let i = startBraceIdx; i < str.length; i++) {
const ch = str[i];
if (escape) {
escape = false;
continue;
}
if (ch === _0x9f2e(0x3)) {
if (inString) escape = true;
continue;
}
if (ch === _0x9f2e(0x4)) {
inString = !inString;
continue;
}
if (!inString) {
if (ch === _0x9f2e(0x5)) depth++;
else if (ch === _0x9f2e(0x6)) {
depth--;
if (depth === 0) {
return str.slice(startBraceIdx, i + 1);
}
}
}
}
return null;
}
function mapLazadaListItems(listItems, limit) {
if (!Array.isArray(listItems) || listItems.length === 0) return [];
return listItems.slice(0, limit).map((item) => {
let link = item.itemUrl || item.productUrl || "";
if (link.startsWith(_0x9f2e(0x7))) link = _0x9f2e(0x8) + link;
else if (link.startsWith(_0x9f2e(0x9))) link = _0x9f2e(0xa) + link;
let img = item.image || "";
if (
(!img || img.startsWith(_0x9f2e(0xb))) &&
Array.isArray(item.thumbs) &&
item.thumbs.length > 0
) {
img = item.thumbs[0].image || "";
}
if (img.startsWith(_0x9f2e(0x7))) img = _0x9f2e(0x8) + img;
if (img.startsWith(_0x9f2e(0xb))) img = "";
const rating = item.ratingScore
? Number(item.ratingScore).toFixed(1)
: _0x9f2e(0xc);
const shopName =
item.sellerName || item.brandName || _0x9f2e(0xd);
let shopUrl = item.shopUrl || item.sellerUrl || "";
if (shopUrl.startsWith(_0x9f2e(0x7))) shopUrl = _0x9f2e(0x8) + shopUrl;
else if (shopUrl.startsWith(_0x9f2e(0x9))) shopUrl = _0x9f2e(0xa) + shopUrl;
return {
platform: _0x9f2e(0xe),
link,
name: item.name || _0x9f2e(0xf),
price: item.priceShow || (item.price ? `฿${item.price}` : _0x9f2e(0xc)),
rating,
img,
shipping: item.itemSoldCntShow || "",
location: item.location || "",
category: shopName,
description: shopUrl,
shopName,
};
});
}
async function fetchLazadaTabless(searchUrl, limit) {
try {
const ajaxUrl = searchUrl.includes(_0x9f2e(0x10))
? `${searchUrl}&ajax=true`
: `${searchUrl}?ajax=true`;
const ajaxRes = await fetch(ajaxUrl, {
credentials: _0x9f2e(0x11),
headers: { Accept: _0x9f2e(0x12) },
});
if (ajaxRes.ok) {
const contentType = ajaxRes.headers.get(_0x9f2e(0x13)) || "";
if (contentType.includes(_0x9f2e(0x14))) {
const json = await ajaxRes.json();
const items = mapLazadaListItems(json?.mods?.listItems, limit);
if (items.length > 0) return items;
}
}
const htmlRes = await fetch(searchUrl, {
credentials: _0x9f2e(0x11),
headers: { Accept: _0x9f2e(0x15) },
});
if (htmlRes.ok) {
const html = await htmlRes.text();
const match = html.match(/window\.pageData\s*=\s*\{/);
if (match && match.index !== undefined) {
const braceStart = html.indexOf(_0x9f2e(0x5), match.index);
const jsonStr = extractBalancedJson(html, braceStart);
if (jsonStr) {
const pageData = JSON.parse(jsonStr);
const items = mapLazadaListItems(pageData?.mods?.listItems, limit);
if (items.length > 0) return items;
}
}
}
} catch (_) {}
return [];
}
async function extractLazadaMainWorld(tabId, limit) {
try {
const results = await chrome.scripting.executeScript({
target: { tabId },
world: _0x9f2e(0x16),
args: [limit],
func: (maxItems) => {
try {
const listItems = window.pageData?.mods?.listItems;
if (!Array.isArray(listItems) || listItems.length === 0) {
return [];
}
return listItems.slice(0, maxItems).map((item) => {
let link = item.itemUrl || item.productUrl || "";
if (link.startsWith(_0x9f2e(0x7))) link = _0x9f2e(0x8) + link;
else if (link.startsWith(_0x9f2e(0x9))) link = window.location.origin + link;
let img = item.image || "";
if (
(!img || img.startsWith(_0x9f2e(0xb))) &&
Array.isArray(item.thumbs) &&
item.thumbs.length > 0
) {
img = item.thumbs[0].image || "";
}
if (img.startsWith(_0x9f2e(0x7))) img = _0x9f2e(0x8) + img;
const rating = item.ratingScore
? Number(item.ratingScore).toFixed(1)
: _0x9f2e(0xc);
const shopName =
item.sellerName || item.brandName || _0x9f2e(0xd);
let shopUrl = item.shopUrl || item.sellerUrl || "";
if (shopUrl.startsWith(_0x9f2e(0x7))) shopUrl = _0x9f2e(0x8) + shopUrl;
else if (shopUrl.startsWith(_0x9f2e(0x9))) shopUrl = window.location.origin + shopUrl;
return {
platform: _0x9f2e(0xe),
link,
name: item.name || _0x9f2e(0xf),
price: item.priceShow || (item.price ? `฿${item.price}` : _0x9f2e(0xc)),
rating,
img: img.startsWith(_0x9f2e(0xb)) ? "" : img,
shipping: item.itemSoldCntShow || "",
location: item.location || "",
category: shopName,
description: shopUrl,
shopName,
};
});
} catch (_) {
return [];
}
},
});
return results?.[0]?.result || [];
} catch (_) {
return [];
}
}
async function sendMessageWithScriptFallback(tabId, platform, message) {
const scriptFile =
platform === _0x9f2e(0xe) ? "content_lazada.js" : _0x9f2e(0x17);
try {
await chrome.scripting.executeScript({
target: { tabId },
files: [scriptFile],
});
} catch (_) {}
await new Promise((r) => setTimeout(r, 250));
return await chrome.tabs.sendMessage(tabId, message);
}
async function injectShopeeMainShim(tabId) {
try {
await chrome.scripting.executeScript({
target: { tabId },
world: _0x9f2e(0x16),
injectImmediately: true,
files: [_0x9f2e(0x18)],
});
} catch (_) {}
}
async function sendToGraphQL(query, variables) {
const res = await fetch(GRAPHQL_ENDPOINT, {
method: _0x9f2e(0x19),
headers: { "Content-Type": _0x9f2e(0x14) },
body: JSON.stringify({ query, variables }),
});
return await res.json();
}
async function safeRemoveTab(tabId) {
if (!tabId) return;
try {
await chrome.tabs.remove(tabId);
} catch (_) {}
}
async function scrapeSinglePlatformSearch({
platform = _0x9f2e(0x1a),
keyword = _0x9f2e(0x1b),
limit = 20,
sortBy = _0x9f2e(0x1c),
}) {
const encodedKw = encodeURIComponent(keyword.trim());
let searchUrl;
if (platform === _0x9f2e(0xe)) {
let lazSort = "";
if (sortBy === _0x9f2e(0x1d)) lazSort = _0x9f2e(0x1e);
else if (sortBy === _0x9f2e(0x1f)) lazSort = _0x9f2e(0x20);
searchUrl = `https://www.lazada.co.th/catalog/?q=${encodedKw}${lazSort}`;
} else {
searchUrl = `https://shopee.co.th/search?keyword=${encodedKw}&page=0&sortBy=${sortBy}`;
}
let products = [];
if (platform === _0x9f2e(0xe)) {
products = await fetchLazadaTabless(searchUrl, limit);
}
if (products.length === 0) {
let tempTabId = null;
let callerTabId = null;
let onUpdListener = null;
try {
const [activeTab] = await chrome.tabs.query({
active: true,
currentWindow: true,
});
if (activeTab && activeTab.id) {
callerTabId = activeTab.id;
}
const tab = await chrome.tabs.create({ url: searchUrl, active: false });
tempTabId = tab.id;
if (platform === _0x9f2e(0x1a)) {
onUpdListener = (updatedTabId, changeInfo) => {
if (
updatedTabId === tempTabId &&
(changeInfo.status === _0x9f2e(0x21) || changeInfo.status === _0x9f2e(0x2))
) {
injectShopeeMainShim(tempTabId);
}
};
chrome.tabs.onUpdated.addListener(onUpdListener);
await injectShopeeMainShim(tempTabId);
}
await waitForTabComplete(tempTabId);
if (platform === _0x9f2e(0x1a)) {
await injectShopeeMainShim(tempTabId);
}
await new Promise((r) => setTimeout(r, 1800));
if (platform === _0x9f2e(0xe)) {
const mainWorldItems = await extractLazadaMainWorld(tempTabId, limit);
if (mainWorldItems.length > 0) {
products = mainWorldItems;
}
}
if (products.length === 0) {
let extractRes = await sendMessageWithScriptFallback(
tempTabId,
platform,
{
action: _0x9f2e(0x22),
payload: { keyword, limit, maxWaitMs: 3000 },
}
);
if (extractRes && extractRes.needsManualAction) {
await chrome.tabs.update(tempTabId, { active: true });
tempTabId = null;
return {
ok: false,
needsManualAction: true,
error: extractRes.error,
products: [],
};
}
products = (extractRes?.products || []).map((p) => ({
...p,
img: p.img && p.img.startsWith(_0x9f2e(0xb)) ? "" : p.img || "",
platform,
}));
if (products.length === 0 && platform === _0x9f2e(0x1a)) {
await chrome.tabs.update(tempTabId, { active: true });
await new Promise((r) => setTimeout(r, 1200));
extractRes = await sendMessageWithScriptFallback(
tempTabId,
platform,
{
action: _0x9f2e(0x22),
payload: { keyword, limit, maxWaitMs: 8000 },
}
);
if (extractRes && extractRes.needsManualAction) {
tempTabId = null;
return {
ok: false,
needsManualAction: true,
error: extractRes.error,
products: [],
};
}
products = (extractRes?.products || []).map((p) => ({
...p,
img: p.img && p.img.startsWith(_0x9f2e(0xb)) ? "" : p.img || "",
platform,
}));
if (callerTabId) {
try {
await chrome.tabs.update(callerTabId, { active: true });
} catch (_) {}
}
}
}
} finally {
if (onUpdListener) {
try {
chrome.tabs.onUpdated.removeListener(onUpdListener);
} catch (_) {}
}
if (tempTabId !== null) {
await safeRemoveTab(tempTabId);
}
}
}
if (products.length > 0 && platform === _0x9f2e(0x1a)) {
try {
await enrichShopeeShopNames(products);
} catch (_) {}
}
if (products.length > 0) {
const mutation = `
mutation SaveProducts($platform: String!, $keyword: String!, $productsJson: String!) {
saveScrapedProducts(platform: $platform, keyword: $keyword, productsJson: $productsJson) {
platform
keyword
link
name
price
rating
img
shipping
location
category
description
totalRating
commentCount
}
}
`;
await sendToGraphQL(mutation, {
platform,
keyword,
productsJson: JSON.stringify(products),
});
}
return { ok: true, count: products.length, products };
}
function parseShopeeIds(url) {
let m = url.match(/-i\.(\d+)\.(\d+)/);
if (m) return { shopId: m[1], itemId: m[2] };
m = url.match(/\/product\/(\d+)\/(\d+)/);
if (m) return { shopId: m[1], itemId: m[2] };
return null;
}
async function enrichShopeeShopNames(products) {
const shopMap = new Map();
const uniqueShopIds = [];
for (const p of products) {
const ids = parseShopeeIds(p.link || "");
if (ids && ids.shopId) {
p.__shopId = ids.shopId;
if (!p.category && !shopMap.has(ids.shopId)) {
shopMap.set(ids.shopId, null);
uniqueShopIds.push(ids.shopId);
}
}
}
await Promise.all(
uniqueShopIds.slice(0, 30).map(async (shopId) => {
try {
const res = await fetch(
`https://shopee.co.th/api/v4/product/get_shop_info?shopid=${shopId}`,
{
credentials: _0x9f2e(0x11),
headers: { Accept: _0x9f2e(0x14) },
}
);
if (res.ok) {
const json = await res.json();
const d = json?.data;
const sName =
d?.name || d?.account?.username || `Shopee Store #${shopId.slice(-5)}`;
const sLoc = d?.shop_location || d?.place || "";
shopMap.set(shopId, { name: sName, loc: sLoc });
}
} catch (_) {}
})
);
for (const p of products) {
const sid = p.__shopId;
const info = sid ? shopMap.get(sid) : null;
const resolvedName =
p.category ||
p.shopName ||
info?.name ||
(sid ? `Shopee Store #${sid.slice(-5)}` : _0x9f2e(0x23));
p.category = resolvedName;
p.shopName = resolvedName;
if ((!p.location || p.location === _0x9f2e(0x24)) && info?.loc) {
p.location = info.loc;
}
delete p.__shopId;
}
}
function formatUnixTimestamp(ts) {
if (!ts) return "";
try {
const d = new Date(ts * 1000);
const yyyy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, _0x9f2e(0x25));
const dd = String(d.getDate()).padStart(2, _0x9f2e(0x25));
const hh = String(d.getHours()).padStart(2, _0x9f2e(0x25));
const mi = String(d.getMinutes()).padStart(2, _0x9f2e(0x25));
return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
} catch (_) {
return "";
}
}
async function fetchShopeeRatingsTabless(productLink, reviewLimit = 30) {
const ids = parseShopeeIds(productLink);
if (!ids) return null;
try {
const batchSize = Math.min(reviewLimit, 50);
const apiUrl = `https://shopee.co.th/api/v2/item/get_ratings?exclude_filter=1&filter=0&filter_size=0&flag=1&fold_filter=0&itemid=${ids.itemId}&limit=${batchSize}&offset=0&relevant_reviews=false&request_source=2&shopid=${ids.shopId}&tag_filter=&type=0&variation_filters=`;
const resp = await fetch(apiUrl, { credentials: _0x9f2e(0x11) });
if (!resp.ok) return null;
const json = await resp.json();
const summary = json?.data?.item_rating_summary;
const ratings = json?.data?.ratings || [];
if (!summary && ratings.length === 0) return null;
const detailedRating = {
all: summary?.rating_total || ratings.length,
"5_star": summary?.rating_count?.[4] || 0,
"4_star": summary?.rating_count?.[3] || 0,
"3_star": summary?.rating_count?.[2] || 0,
"2_star": summary?.rating_count?.[1] || 0,
"1_star": summary?.rating_count?.[0] || 0,
commented: summary?.rcount_with_context || 0,
media: summary?.rcount_with_image || 0,
};
const comments = ratings.slice(0, reviewLimit).map((r) => ({
author: r.author_username || _0x9f2e(0x26),
rating: r.rating_star || 5,
time: formatUnixTimestamp(r.ctime),
content: r.comment || "",
seller_respond: r.ItemRatingReply?.comment || "",
like_count: r.like_count || 0,
}));
return {
category: "",
description: "",
total_rating: detailedRating.all,
detailed_rating: detailedRating,
comments,
};
} catch (_) {
return null;
}
}
chrome.runtime.onInstalled.addListener(async () => {
try {
const tabs = await chrome.tabs.query({
url: [
_0x9f2e(0x27),
_0x9f2e(0x28),
_0x9f2e(0x29),
_0x9f2e(0x2a),
],
});
for (const t of tabs) {
if (t.id) {
try {
await chrome.scripting.executeScript({
target: { tabId: t.id },
files: [_0x9f2e(0x2b)],
});
} catch (_) {}
}
}
} catch (_) {}
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
(async () => {
try {
if (message.action === _0x9f2e(0x2c)) {
if (
message.expectedVersion &&
message.expectedVersion !== BG_VERSION
) {
sendResponse({
ok: true,
version: message.expectedVersion,
reloading: true,
});
setTimeout(() => {
try {
chrome.runtime.reload();
} catch (_) {}
}, 150);
return;
}
sendResponse({ ok: true, version: BG_VERSION });
return;
}
if (message.action === _0x9f2e(0x2d)) {
const {
platform = _0x9f2e(0x1a),
keyword = _0x9f2e(0x1b),
limit = 20,
sortBy = _0x9f2e(0x1c),
} = message.payload || {};
try {
await sendToGraphQL(`mutation { clearDatabase }`, {});
} catch (_) {}
if (platform === _0x9f2e(0x2e)) {
const [shopeeRes, lazadaRes] = await Promise.all([
scrapeSinglePlatformSearch({
platform: _0x9f2e(0x1a),
keyword,
limit,
sortBy,
}),
scrapeSinglePlatformSearch({
platform: _0x9f2e(0xe),
keyword,
limit,
sortBy,
}),
]);
const combined = [
...(shopeeRes.products || []),
...(lazadaRes.products || []),
];
if (combined.length === 0 && (shopeeRes.error || lazadaRes.error)) {
sendResponse({
ok: false,
error: shopeeRes.error || lazadaRes.error,
});
return;
}
sendResponse({
ok: true,
count: combined.length,
products: combined,
});
return;
}
const singleRes = await scrapeSinglePlatformSearch({
platform,
keyword,
limit,
sortBy,
});
sendResponse(singleRes);
return;
}
if (message.action === _0x9f2e(0x2f)) {
const {
platform = _0x9f2e(0x1a),
keyword = _0x9f2e(0x30),
productLink,
reviewLimit = 30,
} = message.payload || {};
if (!productLink) {
sendResponse({ ok: false, error: _0x9f2e(0x31) });
return;
}
const detectedPlatform = productLink.includes(_0x9f2e(0x32))
? "lazada"
: platform;
let detailObj = null;
if (detectedPlatform === _0x9f2e(0x1a)) {
detailObj = await fetchShopeeRatingsTabless(productLink, reviewLimit);
}
if (!detailObj) {
let tempTabId = null;
try {
const tab = await chrome.tabs.create({
url: productLink,
active: false,
});
tempTabId = tab.id;
await waitForTabComplete(tempTabId);
await new Promise((r) => setTimeout(r, 1800));
const detailRes = await sendMessageWithScriptFallback(
tempTabId,
detectedPlatform,
{
action: _0x9f2e(0x33),
payload: { productLink, reviewLimit },
}
);
if (detailRes && detailRes.needsManualAction) {
await chrome.tabs.update(tempTabId, { active: true });
tempTabId = null;
sendResponse({
ok: false,
needsManualAction: true,
error: detailRes.error,
});
return;
}
detailObj = detailRes?.detail || null;
} finally {
if (tempTabId !== null) {
await safeRemoveTab(tempTabId);
}
}
}
if (detailObj) {
const mutation = `
mutation SaveDetails($platform: String!, $keyword: String!, $link: String!, $detailJson: String!) {
saveProductDetails(platform: $platform, keyword: $keyword, link: $link, detailJson: $detailJson) {
platform
keyword
link
name
price
rating
img
shipping
location
category
description
totalRating
commentCount
detailedRating {
all
fiveStar
fourStar
threeStar
twoStar
oneStar
commented
media
}
comments {
author
rating
time
content
sellerRespond
likeCount
}
}
}
`;
const gqlRes = await sendToGraphQL(mutation, {
platform: detectedPlatform,
keyword,
link: productLink,
detailJson: JSON.stringify(detailObj),
});
sendResponse({
ok: true,
product: gqlRes?.data?.saveProductDetails || detailObj,
});
return;
}
sendResponse({ ok: false, error: _0x9f2e(0x34) });
return;
}
if (message.action === _0x9f2e(0x35)) {
const { platform = _0x9f2e(0x1a), keyword, products } = message.payload || {};
if (products && products.length > 0) {
const mutation = `
mutation SaveProducts($platform: String!, $keyword: String!, $productsJson: String!) {
saveScrapedProducts(platform: $platform, keyword: $keyword, productsJson: $productsJson) {
link
name
}
}
`;
await sendToGraphQL(mutation, {
platform,
keyword: keyword || `${platform}_sync`,
productsJson: JSON.stringify(products),
});
sendResponse({ ok: true, count: products.length });
return;
}
sendResponse({ ok: false, error: _0x9f2e(0x36) });
return;
}
sendResponse({ ok: false, error: _0x9f2e(0x37) + message.action });
} catch (err) {
sendResponse({ ok: false, error: err?.message || String(err) });
}
})();
return true;
});
})();