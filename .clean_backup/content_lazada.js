// Content script running on Lazada (*.lazada.co.th, etc.)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLazadaBlockedPage() {
  const url = window.location.href.toLowerCase();
  const bodyText = document.body?.innerText || "";
  return (
    url.includes("punish") ||
    url.includes("sec.lazada") ||
    bodyText.includes("Slide to verify") ||
    bodyText.includes("เลื่อนเพื่อยืนยัน")
  );
}

function isValidProductImageUrl(src) {
  if (!src || typeof src !== "string") return false;
  const s = src.trim();
  if (!s || s.startsWith("data:image")) return false;
  // Filter out Lazada 1x1 / blank UI icons
  if (
    s.includes("/g/tps/") ||
    s.includes("laz-img-cdn.alicdn.com/tfs/") ||
    s.includes("placeholder")
  ) {
    return false;
  }
  return s.startsWith("http://") || s.startsWith("https://") || s.startsWith("//");
}

function normalizeImageUrl(src) {
  if (!src) return "";
  let s = src.trim();
  if (s.startsWith("//")) s = "https:" + s;
  return isValidProductImageUrl(s) ? s : "";
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

function extractLazadaFromPageData(maxItems = 50) {
  try {
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const txt = s.textContent || "";
      const match = txt.match(/window\.pageData\s*=\s*\{/);
      if (match && match.index !== undefined) {
        const braceStart = txt.indexOf("{", match.index);
        const jsonStr = extractBalancedJson(txt, braceStart);
        if (jsonStr) {
          const pageData = JSON.parse(jsonStr);
          const listItems = pageData?.mods?.listItems || [];
          if (Array.isArray(listItems) && listItems.length > 0) {
            return listItems.slice(0, maxItems).map((item) => {
              let link = item.itemUrl || item.productUrl || "";
              if (link.startsWith("//")) link = "https:" + link;
              else if (link.startsWith("/")) link = window.location.origin + link;

              let img = normalizeImageUrl(item.image);
              if (!img && Array.isArray(item.thumbs) && item.thumbs.length > 0) {
                img = normalizeImageUrl(item.thumbs[0].image);
              }

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
                itemId: String(item.itemId || item.nid || ""),
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
        }
      }
    }
  } catch (_) {}
  return [];
}

function extractItemIdFromUrl(url) {
  if (!url) return "";
  const m = url.match(/-i(\d+)(?:-s\d+)?\.html/i);
  return m ? m[1] : "";
}

function extractLazadaFromDOM(maxItems = 50, pageDataMap = new Map()) {
  const cards = Array.from(
    document.querySelectorAll(
      '[data-qa-locator="product-item"], div.Bm3ON, div[data-tracking="product-card"]'
    )
  );

  let elements = cards;
  if (elements.length === 0) {
    const anchors = Array.from(document.querySelectorAll('a[href*="/products/"]'));
    elements = anchors.map(
      (a) =>
        a.closest('[data-qa-locator="product-item"]') ||
        a.parentElement?.parentElement ||
        a
    );
  }

  const results = [];
  const seen = new Set();

  for (const el of elements) {
    if (results.length >= maxItems) break;

    const anchor =
      el.tagName.toLowerCase() === "a"
        ? el
        : el.querySelector('a[href*="/products/"], a[href]');
    if (!anchor) continue;

    let href = anchor.href || anchor.getAttribute("href") || "";
    if (!href) continue;
    if (href.startsWith("//")) href = "https:" + href;
    else if (href.startsWith("/")) href = window.location.origin + href;

    const cleanKey = href.split("?")[0];
    if (seen.has(cleanKey)) continue;
    seen.add(cleanKey);

    const itemId = extractItemIdFromUrl(cleanKey);
    const pdItem = itemId ? pageDataMap.get(itemId) : null;

    // Image extraction: never accept data:image base64 placeholders
    let imgUrl = pdItem?.img || "";
    if (!imgUrl) {
      const imgs = el.querySelectorAll('img[type="product"], img');
      for (const img of imgs) {
        const candidates = [
          img.currentSrc,
          img.src,
          img.getAttribute("data-src"),
          img.getAttribute("data-ks-lazyload"),
          img.getAttribute("data-original"),
          (img.getAttribute("srcset") || "").split(/\s+/)[0],
        ];
        for (const c of candidates) {
          const valid = normalizeImageUrl(c);
          if (valid) {
            imgUrl = valid;
            break;
          }
        }
        if (imgUrl) break;
      }
    }

    // Name
    let name = pdItem?.name || "";
    if (!name) {
      const titleAnchor = el.querySelector(
        'a[title], div.RfADt a, [class*="title"] a'
      );
      const imgs = el.querySelectorAll("img[alt]");
      if (titleAnchor) {
        name = (
          titleAnchor.getAttribute("title") ||
          titleAnchor.innerText ||
          ""
        ).trim();
      } else if (imgs.length > 0) {
        name = (imgs[0].getAttribute("alt") || "").trim();
      }
    }

    // Price
    let price = pdItem?.price || "";
    if (!price || price === "-") {
      const priceEl = el.querySelector('span.ooOxS, [class*="price"] span');
      if (priceEl && priceEl.innerText.trim()) {
        price = priceEl.innerText.trim();
      } else {
        const spans = Array.from(el.querySelectorAll("span"));
        const cur = spans.find(
          (s) => /฿|\d/.test(s.innerText.trim()) && s.innerText.includes("฿")
        );
        if (cur) price = cur.innerText.trim();
      }
    }

    // Sold count
    let shipping = pdItem?.shipping || "";
    if (!shipping) {
      const soldEl = Array.from(el.querySelectorAll("span")).find((s) =>
        /(ชิ้น|sold|ขายแล้ว)/i.test(s.innerText.trim())
      );
      if (soldEl) {
        shipping = soldEl.innerText.trim();
      }
    }

    // Rating
    let rating = pdItem?.rating || "-";
    if (rating === "-") {
      const fullStars = el.querySelectorAll('i._9-ogB.Dy1nx, [class*="star"]');
      if (fullStars.length > 0 && fullStars.length <= 5) {
        rating = "5.0";
      }
    }

    // Location
    let location = pdItem?.location || "";
    if (!location) {
      const locEl = el.querySelector('span.oa6ri, [class*="location"]');
      if (locEl && locEl.innerText.trim()) {
        location = locEl.innerText.trim();
      }
    }

    const shopName =
      pdItem?.category || pdItem?.shopName || "Lazada Official Store";

    if (name || imgUrl) {
      results.push({
        platform: "lazada",
        link: href,
        name: name || "Lazada Product",
        price: price || "-",
        rating,
        img: imgUrl,
        shipping,
        location,
        category: shopName,
        shopName,
      });
    }
  }

  return results;
}

async function scrollAndCollectLazadaProducts(limit = 20) {
  if (isLazadaBlockedPage()) {
    return {
      needsManualAction: true,
      error:
        "หน้าเว็บ Lazada ต้องการการยืนยันตัวตน กรุณาเลื่อนยืนยันในแท็บ Lazada แล้วกดค้นหาอีกครั้ง",
      products: [],
    };
  }

  // 1. Extract from window.pageData first (contains all 40 items + real image URLs immediately)
  const pageDataItems = extractLazadaFromPageData(Math.max(limit, 40));
  const pageDataMap = new Map();
  for (const item of pageDataItems) {
    if (item.itemId) {
      pageDataMap.set(item.itemId, item);
    }
  }

  if (
    pageDataItems.length >= limit &&
    pageDataItems.every((p) => isValidProductImageUrl(p.img))
  ) {
    return {
      needsManualAction: false,
      products: pageDataItems.slice(0, limit),
    };
  }

  // 2. Scroll cards into view to trigger lazy-loaded DOM images and merge with pageDataMap
  const cards = Array.from(
    document.querySelectorAll('[data-qa-locator="product-item"], div.Bm3ON')
  ).slice(0, limit);

  for (let i = 0; i < cards.length; i += 4) {
    cards[i].scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(350);
  }

  const domProducts = extractLazadaFromDOM(limit, pageDataMap);

  // Merge: prefer pageDataItems if domProducts is missing images
  const finalProducts =
    domProducts.length > 0 ? domProducts : pageDataItems.slice(0, limit);

  window.scrollTo({ top: 0, behavior: "instant" });
  return {
    needsManualAction: false,
    products: finalProducts.slice(0, limit),
  };
}

async function extractLazadaDetailsAndReviews(reviewLimit = 30) {
  if (isLazadaBlockedPage()) {
    return {
      needsManualAction: true,
      error: "กรุณายืนยันตัวตนบนหน้า Lazada ก่อน",
    };
  }

  window.scrollTo({ top: document.body.scrollHeight * 0.45, behavior: "smooth" });
  await sleep(1200);
  window.scrollTo({ top: document.body.scrollHeight * 0.65, behavior: "smooth" });
  await sleep(1500);

  let category = "";
  const crumbs = Array.from(
    document.querySelectorAll(".breadcrumb_item_anchor span, .breadcrumb a")
  )
    .map((el) => el.innerText.trim())
    .filter(Boolean);
  if (crumbs.length > 0) {
    category = crumbs.join(" > ");
  }

  let description = "";
  const descEl = document.querySelector(
    ".pdp-product-desc, .detail-content, #module_product_detail"
  );
  if (descEl) {
    description = descEl.innerText.trim();
  }

  const detailedRating = {
    all: 0,
    "5_star": 0,
    "4_star": 0,
    "3_star": 0,
    "2_star": 0,
    "1_star": 0,
    commented: 0,
    media: 0,
  };

  const comments = [];
  const reviewItems = document.querySelectorAll(".mod-reviews .item, .review-item");
  for (const item of Array.from(reviewItems).slice(0, reviewLimit)) {
    const author =
      item.querySelector(".middle span, .reviewer")?.innerText.trim() ||
      "Lazada Buyer";
    const time =
      item.querySelector(".top .title.right, .time")?.innerText.trim() || "";
    const content =
      item.querySelector(".item-content .content, .review-content")?.innerText.trim() ||
      "";
    const stars =
      item.querySelectorAll('img[src*="TB19ZvEgfDH8KJjy1Xc"], .starCtn .star')
        .length || 5;
    const sellerRespond =
      item.querySelector(".seller-reply-wrapper, .reply-content")?.innerText.trim() ||
      "";

    comments.push({
      author,
      rating: stars,
      time,
      content,
      seller_respond: sellerRespond,
      like_count: 0,
    });
  }

  detailedRating.all = comments.length;
  return {
    needsManualAction: false,
    detail: {
      category,
      description,
      total_rating: comments.length,
      detailed_rating: detailedRating,
      comments,
    },
  };
}

window.__lazadaSearchHandler = scrollAndCollectLazadaProducts;
window.__lazadaDetailHandler = extractLazadaDetailsAndReviews;

if (!window.__LAZADA_LISTENER_REGISTERED__) {
  window.__LAZADA_LISTENER_REGISTERED__ = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message.action === "EXTRACT_SEARCH_RESULTS") {
        const { limit = 20 } = message.payload || {};
        const res = await window.__lazadaSearchHandler(limit);
        sendResponse(res);
        return;
      }
      if (message.action === "EXTRACT_PRODUCT_DETAILS") {
        const { reviewLimit = 30 } = message.payload || {};
        const res = await window.__lazadaDetailHandler(reviewLimit);
        sendResponse(res);
        return;
      }
    })();
    return true;
  });
}

function injectLazadaSyncButton() {
  if (document.getElementById("lazada-rust-sync-btn")) return;
  const btn = document.createElement("button");
  btn.id = "lazada-rust-sync-btn";
  const defaultHtml = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Sync Lazada to Store Explorer</span>`;
  btn.innerHTML = defaultHtml;
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "999999",
    background: "#0d0d0d",
    color: "#ffffff",
    border: "1px solid #242728",
    borderRadius: "8px",
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: "500",
    display: "inline-flex",
    alignItems: "center",
    cursor: "pointer",
    fontFamily: "Inter, system-ui, sans-serif",
  });

  btn.addEventListener("click", async () => {
    btn.innerHTML = `<span>Syncing Lazada products...</span>`;
    const params = new URLSearchParams(window.location.search);
    const keyword = params.get("q") || "lazada_sync";
    const res = await scrollAndCollectLazadaProducts(30);
    if (res.products && res.products.length > 0) {
      chrome.runtime.sendMessage(
        {
          action: "SYNC_FROM_SHOPEE_TAB",
          payload: { platform: "lazada", keyword, products: res.products },
        },
        (reply) => {
          if (reply && reply.ok) {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#59d499" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="20 6 9 17 4 12"/></svg><span>Synced ${reply.count} items</span>`;
            setTimeout(() => {
              btn.innerHTML = defaultHtml;
            }, 3000);
          } else {
            btn.innerHTML = `<span>Port 8000 unreachable</span>`;
          }
        }
      );
    } else {
      btn.innerHTML = `<span>No items found</span>`;
      setTimeout(() => {
        btn.innerHTML = defaultHtml;
      }, 3000);
    }
  });

  document.body.appendChild(btn);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectLazadaSyncButton);
} else {
  injectLazadaSyncButton();
}
