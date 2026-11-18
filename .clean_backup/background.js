const GRAPHQL_ENDPOINT = "http://127.0.0.1:8000/graphql";
const BG_VERSION = "1.2.0";

function waitForTabComplete(tabId, timeoutMs = 22000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
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
    if (ch === "\\") {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
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
    if (link.startsWith("//")) link = "https:" + link;
    else if (link.startsWith("/")) link = "https://www.lazada.co.th" + link;

    let img = item.image || "";
    if (
      (!img || img.startsWith("data:image")) &&
      Array.isArray(item.thumbs) &&
      item.thumbs.length > 0
    ) {
      img = item.thumbs[0].image || "";
    }
    if (img.startsWith("//")) img = "https:" + img;
    if (img.startsWith("data:image")) img = "";

    const rating = item.ratingScore
      ? Number(item.ratingScore).toFixed(1)
      : "-";
    const shopName =
      item.sellerName || item.brandName || "Lazada Official Store";
    let shopUrl = item.shopUrl || item.sellerUrl || "";
    if (shopUrl.startsWith("//")) shopUrl = "https:" + shopUrl;
    else if (shopUrl.startsWith("/")) shopUrl = "https://www.lazada.co.th" + shopUrl;

    return {
      platform: "lazada",
      link,
      name: item.name || "Lazada Product",
      price: item.priceShow || (item.price ? `฿${item.price}` : "-"),
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

// Fast Zero-Tab Lazada Fetch directly from Service Worker
async function fetchLazadaTabless(searchUrl, limit) {
  try {
    // 1. Try Lazada JSON ajax endpoint first
    const ajaxUrl = searchUrl.includes("?")
      ? `${searchUrl}&ajax=true`
      : `${searchUrl}?ajax=true`;
    const ajaxRes = await fetch(ajaxUrl, {
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    if (ajaxRes.ok) {
      const contentType = ajaxRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await ajaxRes.json();
        const items = mapLazadaListItems(json?.mods?.listItems, limit);
        if (items.length > 0) return items;
      }
    }

    // 2. Fallback: Fetch HTML and parse window.pageData without opening any tab
    const htmlRes = await fetch(searchUrl, {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const match = html.match(/window\.pageData\s*=\s*\{/);
      if (match && match.index !== undefined) {
        const braceStart = html.indexOf("{", match.index);
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
      world: "MAIN",
      args: [limit],
      func: (maxItems) => {
        try {
          const listItems = window.pageData?.mods?.listItems;
          if (!Array.isArray(listItems) || listItems.length === 0) {
            return [];
          }
          return listItems.slice(0, maxItems).map((item) => {
            let link = item.itemUrl || item.productUrl || "";
            if (link.startsWith("//")) link = "https:" + link;
            else if (link.startsWith("/")) link = window.location.origin + link;

            let img = item.image || "";
            if (
              (!img || img.startsWith("data:image")) &&
              Array.isArray(item.thumbs) &&
              item.thumbs.length > 0
            ) {
              img = item.thumbs[0].image || "";
            }
            if (img.startsWith("//")) img = "https:" + img;

            const rating = item.ratingScore
              ? Number(item.ratingScore).toFixed(1)
              : "-";
            const shopName =
              item.sellerName || item.brandName || "Lazada Official Store";
            let shopUrl = item.shopUrl || item.sellerUrl || "";
            if (shopUrl.startsWith("//")) shopUrl = "https:" + shopUrl;
            else if (shopUrl.startsWith("/")) shopUrl = window.location.origin + shopUrl;

            return {
              platform: "lazada",
              link,
              name: item.name || "Lazada Product",
              price: item.priceShow || (item.price ? `฿${item.price}` : "-"),
              rating,
              img: img.startsWith("data:image") ? "" : img,
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
    platform === "lazada" ? "content_lazada.js" : "content_shopee.js";
  // Always ensure the latest content script from disk is injected
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
      world: "MAIN",
      injectImmediately: true,
      files: ["content_shopee_main.js"],
    });
  } catch (_) {}
}

async function sendToGraphQL(query, variables) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  platform = "shopee",
  keyword = "Raspberry Pi",
  limit = 20,
  sortBy = "sales",
}) {
  const encodedKw = encodeURIComponent(keyword.trim());
  let searchUrl;
  if (platform === "lazada") {
    let lazSort = "";
    if (sortBy === "price_asc") lazSort = "&sort=priceasc";
    else if (sortBy === "price_desc") lazSort = "&sort=pricedesc";
    searchUrl = `https://www.lazada.co.th/catalog/?q=${encodedKw}${lazSort}`;
  } else {
    searchUrl = `https://shopee.co.th/search?keyword=${encodedKw}&page=0&sortBy=${sortBy}`;
  }

  let products = [];

  // 1. For Lazada: try Zero-Tab background fetch first (no tab created at all!)
  if (platform === "lazada") {
    products = await fetchLazadaTabless(searchUrl, limit);
  }

  // 2. If tab is needed (Shopee, or Lazada fallback), create background tab (active: false)
  //    and AUTOMATICALLY close it as soon as extraction finishes!
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

      if (platform === "shopee") {
        onUpdListener = (updatedTabId, changeInfo) => {
          if (
            updatedTabId === tempTabId &&
            (changeInfo.status === "loading" || changeInfo.status === "complete")
          ) {
            injectShopeeMainShim(tempTabId);
          }
        };
        chrome.tabs.onUpdated.addListener(onUpdListener);
        await injectShopeeMainShim(tempTabId);
      }

      await waitForTabComplete(tempTabId);
      if (platform === "shopee") {
        await injectShopeeMainShim(tempTabId);
      }
      await new Promise((r) => setTimeout(r, 1800));

      if (platform === "lazada") {
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
            action: "EXTRACT_SEARCH_RESULTS",
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
          img: p.img && p.img.startsWith("data:image") ? "" : p.img || "",
          platform,
        }));

        // Fallback for Shopee: if Chromium suppressed layout/rendering in the
        // unfocused background tab and returned 0 items, briefly render the tab,
        // extract the products, restore caller tab focus, and close tempTabId!
        if (products.length === 0 && platform === "shopee") {
          await chrome.tabs.update(tempTabId, { active: true });
          await new Promise((r) => setTimeout(r, 1200));
          extractRes = await sendMessageWithScriptFallback(
            tempTabId,
            platform,
            {
              action: "EXTRACT_SEARCH_RESULTS",
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
            img: p.img && p.img.startsWith("data:image") ? "" : p.img || "",
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
      // Automatically close the temporary tab so no extra tabs remain!
      if (tempTabId !== null) {
        await safeRemoveTab(tempTabId);
      }
    }
  }

  if (products.length > 0 && platform === "shopee") {
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
            credentials: "include",
            headers: { Accept: "application/json" },
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
      (sid ? `Shopee Store #${sid.slice(-5)}` : "Shopee Store");
    p.category = resolvedName;
    p.shopName = resolvedName;
    if ((!p.location || p.location === "<Location>") && info?.loc) {
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
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch (_) {
    return "";
  }
}

// Fast Zero-Tab Shopee Reviews Fetch directly from Service Worker
async function fetchShopeeRatingsTabless(productLink, reviewLimit = 30) {
  const ids = parseShopeeIds(productLink);
  if (!ids) return null;
  try {
    const batchSize = Math.min(reviewLimit, 50);
    const apiUrl = `https://shopee.co.th/api/v2/item/get_ratings?exclude_filter=1&filter=0&filter_size=0&flag=1&fold_filter=0&itemid=${ids.itemId}&limit=${batchSize}&offset=0&relevant_reviews=false&request_source=2&shopid=${ids.shopId}&tag_filter=&type=0&variation_filters=`;
    const resp = await fetch(apiUrl, { credentials: "include" });
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
      author: r.author_username || "Shopee User",
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
        "http://127.0.0.1:8000/*",
        "http://localhost:8000/*",
        "http://127.0.0.1:5173/*",
        "http://localhost:5173/*",
      ],
    });
    for (const t of tabs) {
      if (t.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: t.id },
            files: ["bridge.js"],
          });
        } catch (_) {}
      }
    }
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === "PING_BG") {
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

      if (message.action === "SEARCH_PRODUCTS") {
        const {
          platform = "shopee",
          keyword = "Raspberry Pi",
          limit = 20,
          sortBy = "sales",
        } = message.payload || {};

        // Always clear previous search results in PostgreSQL before saving a new search
        try {
          await sendToGraphQL(`mutation { clearDatabase }`, {});
        } catch (_) {}

        if (platform === "both") {
          const [shopeeRes, lazadaRes] = await Promise.all([
            scrapeSinglePlatformSearch({
              platform: "shopee",
              keyword,
              limit,
              sortBy,
            }),
            scrapeSinglePlatformSearch({
              platform: "lazada",
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

      if (message.action === "FETCH_PRODUCT_DETAILS") {
        const {
          platform = "shopee",
          keyword = "default",
          productLink,
          reviewLimit = 30,
        } = message.payload || {};

        if (!productLink) {
          sendResponse({ ok: false, error: "Missing productLink" });
          return;
        }

        const detectedPlatform = productLink.includes("lazada.")
          ? "lazada"
          : platform;

        let detailObj = null;

        // 1. For Shopee: try zero-tab API fetch first!
        if (detectedPlatform === "shopee") {
          detailObj = await fetchShopeeRatingsTabless(productLink, reviewLimit);
        }

        // 2. Fallback: open temporary background tab and close it immediately after extraction
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
                action: "EXTRACT_PRODUCT_DETAILS",
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

        sendResponse({ ok: false, error: "Could not extract product details" });
        return;
      }

      if (message.action === "SYNC_FROM_SHOPEE_TAB") {
        const { platform = "shopee", keyword, products } = message.payload || {};
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
        sendResponse({ ok: false, error: "No products found on page" });
        return;
      }

      sendResponse({ ok: false, error: "Unknown action: " + message.action });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
