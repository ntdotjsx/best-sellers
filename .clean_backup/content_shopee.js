// Content script running on Shopee (*.shopee.co.th, *.shopee.vn, etc.)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedPage() {
  const url = window.location.href.toLowerCase();
  return (
    url.includes("/buyer/login") ||
    url.includes("/verify/") ||
    url.includes("captcha")
  );
}

function dismissLanguagePopup() {
  try {
    const buttons = document.querySelectorAll(
      ".language-selection__list-item button, .shopee-popup__close-btn"
    );
    if (buttons.length > 0) {
      buttons[0].click();
    }
  } catch (_) {}
}

function getCapturedApiProducts(maxItems = 30) {
  try {
    const raw = document.documentElement.getAttribute("data-shopee-api-products");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.slice(0, maxItems);
    }
  } catch (_) {}
  return [];
}

function extractProductsFromDOM(maxItems = 30) {
  const cards = Array.from(
    document.querySelectorAll(
      'ul.shopee-search-item-result__items > li, li[data-sqe="item"], section ul > li'
    )
  );

  let elements = cards;
  if (elements.length === 0) {
    const anchors = Array.from(
      document.querySelectorAll('a.contents, a[data-sqe="link"], a[href*="-i."], a[href*="/product/"]')
    );
    elements = anchors.map((a) => a.closest("li") || a);
  }

  const results = [];
  const seen = new Set();

  for (const el of elements) {
    if (results.length >= maxItems) break;
    const anchor =
      el.tagName.toLowerCase() === "a"
        ? el
        : el.querySelector('a.contents, a[data-sqe="link"], a[href*="-i."], a[href*="/product/"], a[href]');
    if (!anchor) continue;

    const href = anchor.href || anchor.getAttribute("href") || "";
    if (!href || seen.has(href)) continue;

    // Normalize relative URLs
    const fullLink = href.startsWith("http")
      ? href
      : `${window.location.origin}${href.startsWith("/") ? "" : "/"}${href}`;
    seen.add(fullLink);

    // Image URL (prefer susercontent.com/file/ product photo over overlay frame/placeholder)
    let imgUrl = "";
    const imgs = Array.from(el.querySelectorAll("img"));
    for (const img of imgs) {
      const src =
        img.currentSrc ||
        img.src ||
        img.getAttribute("src") ||
        img.getAttribute("data-src") ||
        "";
      if (
        src &&
        src.includes("susercontent.com/file/") &&
        !src.startsWith("data:image")
      ) {
        imgUrl = src;
        break;
      }
    }
    if (!imgUrl) {
      for (const img of imgs) {
        const src =
          img.currentSrc ||
          img.src ||
          img.getAttribute("src") ||
          img.getAttribute("data-src") ||
          "";
        if (
          src &&
          (src.includes("susercontent.com") || src.includes("shopee")) &&
          !src.startsWith("data:image") &&
          !src.includes("deo.shopeemobile.com")
        ) {
          imgUrl = src;
          break;
        }
      }
    }

    // Product Name
    let name = "";
    const nameEl = el.querySelector(
      'div.line-clamp-2, [data-sqe="name"] > div, [data-sqe="name"]'
    );
    if (nameEl && nameEl.innerText.trim()) {
      name = nameEl.innerText.trim();
    } else {
      const altImg = imgs.find((i) => i.alt && i.alt.trim().length > 3);
      if (altImg) name = altImg.alt.trim();
    }

    // Price
    let price = "";
    const priceContainer = el.querySelector("div.truncate.flex.items-baseline");
    if (priceContainer && priceContainer.innerText.trim()) {
      price = priceContainer.innerText.replace(/\s+/g, " ").trim();
    } else {
      const spans = Array.from(el.querySelectorAll("span"));
      const currencySpan = spans.find((s) =>
        /^[฿₫$RpRM₱]/.test(s.innerText.trim())
      );
      if (currencySpan && currencySpan.parentElement) {
        price = currencySpan.parentElement.innerText.replace(/\s+/g, "").trim();
      }
    }

    // Rating
    let rating = "";
    const leafNodes = Array.from(el.querySelectorAll("div, span")).filter(
      (n) => n.children.length === 0
    );
    const ratingNode = leafNodes.find((n) =>
      /^[1-5]\.\d$/.test((n.innerText || "").trim())
    );
    if (ratingNode) {
      rating = ratingNode.innerText.trim();
    }

    // Sold count / Shipping info
    let shipping = "";
    const fullCardText = el.innerText || "";
    const soldMatch = fullCardText.match(
      /(?:ขายแล้ว|ขายได้|Sold|Terjual|Đã bán)\s*[\d.,]+\s*(?:พัน|หมื่น|แสน|ล้าน|k|m|rb)?\s*(?:ชิ้น|\+)?/i
    );
    if (soldMatch) {
      shipping = soldMatch[0].trim();
    } else {
      const soldLeaf = leafNodes.find((n) =>
        /(?:ขายแล้ว|ขายได้|Sold)/i.test((n.innerText || "").trim())
      );
      if (soldLeaf) {
        shipping = soldLeaf.innerText.trim();
      }
    }

    // Location
    let location = "";
    const locEl = el.querySelector('[class*="text-shopee-black54"]');
    if (locEl && locEl.innerText.trim()) {
      location = locEl.innerText.trim();
    }

    if (name || imgUrl) {
      results.push({
        platform: "shopee",
        link: fullLink,
        name: name || "Shopee Product",
        price: price || "-",
        rating: rating || "-",
        img: imgUrl,
        shipping: shipping || "",
        location: location || "",
      });
    }
  }

  return results;
}

async function enrichDomShopeeStoreNames(items) {
  const shopIds = new Set();
  for (const p of items) {
    const ids = parseShopAndItemId(p.link || "");
    if (ids && ids.shopId) {
      p.__shopId = ids.shopId;
      if (!p.category || p.category.startsWith("Shopee Store #")) {
        shopIds.add(ids.shopId);
      }
    }
  }
  const map = new Map();
  await Promise.all(
    Array.from(shopIds)
      .slice(0, 30)
      .map(async (sid) => {
        try {
          const res = await fetch(
            `${window.location.origin}/api/v4/product/get_shop_info?shopid=${sid}`,
            { credentials: "include" }
          );
          if (res.ok) {
            const json = await res.json();
            const d = json?.data;
            const sName = d?.name || d?.account?.username || "";
            const sLoc = d?.shop_location || d?.place || "";
            if (sName) map.set(sid, { name: sName, loc: sLoc });
          }
        } catch (_) {}
      })
  );
  for (const p of items) {
    const sid = p.__shopId;
    const info = sid ? map.get(sid) : null;
    const finalShop =
      info?.name ||
      p.category ||
      p.shopName ||
      (sid ? `Shopee Store #${sid.slice(-5)}` : "Shopee Store");
    p.category = finalShop;
    p.shopName = finalShop;
    if (!p.location && info?.loc) {
      p.location = info.loc;
    }
    delete p.__shopId;
  }
  return items;
}

async function scrollAndCollectSearchProducts(limit = 20, maxWaitMs = 9500) {
  dismissLanguagePopup();
  if (isBlockedPage()) {
    return {
      needsManualAction: true,
      error:
        "หน้าเว็บ Shopee ต้องการการล็อกอินหรือยืนยันตัวตน กรุณาดำเนินการในแท็บ Shopee แล้วกดค้นหาอีกครั้ง",
      products: [],
    };
  }

  // Check if MAIN world API interceptor already captured products
  const immediateApi = getCapturedApiProducts(limit);
  if (immediateApi.length >= limit) {
    const enriched = await enrichDomShopeeStoreNames(immediateApi.slice(0, limit));
    return { needsManualAction: false, products: enriched };
  }

  let products = [];
  let scrollPos = 0;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    dismissLanguagePopup();
    if (isBlockedPage()) {
      return {
        needsManualAction: true,
        error:
          "หน้าเว็บ Shopee ต้องการการล็อกอินหรือยืนยันตัวตน กรุณาดำเนินการในแท็บ Shopee แล้วกดค้นหาอีกครั้ง",
        products: [],
      };
    }

    // Check API-intercepted items first
    const apiItems = getCapturedApiProducts(limit);
    if (apiItems.length >= limit) {
      const enriched = await enrichDomShopeeStoreNames(apiItems.slice(0, limit));
      return { needsManualAction: false, products: enriched };
    }

    // Instant scroll (works in both active and background tabs, unlike behavior: "smooth")
    scrollPos += 750;
    window.scrollTo(0, scrollPos);
    if (document.documentElement) document.documentElement.scrollTop = scrollPos;
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));

    await sleep(600);

    const domItems = extractProductsFromDOM(limit);
    const domWithImg = domItems.filter((p) => p.img && p.img.startsWith("http"));
    if (domWithImg.length >= limit || domItems.length >= limit) {
      products = domItems;
      break;
    }
    if (apiItems.length > domItems.length) {
      products = apiItems;
    } else if (domItems.length > products.length) {
      products = domItems;
    }

    if (scrollPos > 4500) {
      scrollPos = 0;
    }
  }

  window.scrollTo(0, 0);
  const finalSlice = await enrichDomShopeeStoreNames(products.slice(0, limit));
  return { needsManualAction: false, products: finalSlice };
}

function parseShopAndItemId(url) {
  // Pattern 1: ...-i.<shopid>.<itemid>
  let m = url.match(/-i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  // Pattern 2: /product/<shopid>/<itemid>
  m = url.match(/\/product\/(\d+)\/(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  return null;
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

async function extractProductDetailsAndReviews(productLink, reviewLimit = 30) {
  if (isBlockedPage()) {
    return {
      needsManualAction: true,
      error: "กรุณาล็อกอินหรือยืนยันตัวตนบนหน้า Shopee ก่อน",
    };
  }

  window.scrollBy({ top: 700, behavior: "smooth" });
  await sleep(1200);

  let category = "";
  let description = "";

  // Extract Category & Description from DOM
  try {
    const sections = document.querySelectorAll("section");
    for (const sec of sections) {
      const text = sec.innerText || "";
      if (
        text.includes("หมวดหมู่") ||
        text.includes("Danh mục") ||
        text.includes("Category")
      ) {
        category = text.replace(/\n+/g, " > ").trim();
      } else if (
        text.includes("รายละเอียดสินค้า") ||
        text.includes("Mô tả sản phẩm") ||
        text.includes("Product Description")
      ) {
        description = text.trim();
      }
    }
  } catch (_) {}

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
  let totalRating = 0;
  const comments = [];

  // Primary method: Fetch Shopee's item/get_ratings endpoint inside the same origin session
  const ids = parseShopAndItemId(productLink || window.location.href);
  if (ids) {
    try {
      const batchSize = Math.min(reviewLimit, 50);
      const apiUrl = `${window.location.origin}/api/v2/item/get_ratings?exclude_filter=1&filter=0&filter_size=0&flag=1&fold_filter=0&itemid=${ids.itemId}&limit=${batchSize}&offset=0&relevant_reviews=false&request_source=2&shopid=${ids.shopId}&tag_filter=&type=0&variation_filters=`;
      const resp = await fetch(apiUrl, { credentials: "include" });
      if (resp.ok) {
        const json = await resp.json();
        const summary = json?.data?.item_rating_summary;
        if (summary) {
          totalRating = summary.rating_total || 0;
          detailedRating.all = totalRating;
          const counts = summary.rating_count || [];
          detailedRating["1_star"] = counts[0] || 0;
          detailedRating["2_star"] = counts[1] || 0;
          detailedRating["3_star"] = counts[2] || 0;
          detailedRating["4_star"] = counts[3] || 0;
          detailedRating["5_star"] = counts[4] || 0;
          detailedRating.commented = summary.rcount_with_context || 0;
          detailedRating.media = summary.rcount_with_image || 0;
        }
        const ratings = json?.data?.ratings || [];
        for (const r of ratings.slice(0, reviewLimit)) {
          comments.push({
            author: r.author_username || "Shopee User",
            rating: r.rating_star || 5,
            time: formatUnixTimestamp(r.ctime),
            content: r.comment || "",
            seller_respond: r.ItemRatingReply?.comment || "",
            like_count: r.like_count || 0,
          });
        }
      }
    } catch (_) {}
  }

  // Fallback to DOM reviews if API returned none
  if (comments.length === 0) {
    window.scrollTo({ top: document.body.scrollHeight * 0.65, behavior: "smooth" });
    await sleep(1500);
    const items = document.querySelectorAll(".shopee-product-rating__main");
    for (const item of Array.from(items).slice(0, reviewLimit)) {
      const author =
        item.querySelector(".shopee-product-rating__author-name")?.innerText.trim() || "";
      const time =
        item.querySelector(".shopee-product-rating__time")?.innerText.trim() || "";
      const stars = item.querySelectorAll(".icon-rating-solid--active").length || 5;
      const content =
        item.querySelector('div[style*="word-break"]')?.innerText.trim() || "";
      comments.push({
        author,
        rating: stars,
        time,
        content,
        seller_respond: "",
        like_count: 0,
      });
    }
  }

  return {
    needsManualAction: false,
    detail: {
      category,
      description,
      total_rating: totalRating || comments.length,
      detailed_rating: detailedRating,
      comments,
    },
  };
}

window.__shopeeSearchHandler = scrollAndCollectSearchProducts;
window.__shopeeDetailHandler = extractProductDetailsAndReviews;

if (!window.__SHOPEE_LISTENER_REGISTERED__) {
  window.__SHOPEE_LISTENER_REGISTERED__ = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message.action === "EXTRACT_SEARCH_RESULTS") {
        const { limit = 20, maxWaitMs = 8500 } = message.payload || {};
        const res = await window.__shopeeSearchHandler(limit, maxWaitMs);
        sendResponse(res);
        return;
      }
      if (message.action === "EXTRACT_PRODUCT_DETAILS") {
        const { productLink, reviewLimit = 30 } = message.payload || {};
        const res = await window.__shopeeDetailHandler(productLink, reviewLimit);
        sendResponse(res);
        return;
      }
    })();
    return true;
  });
}

// Floating Sync Button on Shopee Search Pages
function injectFloatingSyncButton() {
  if (document.getElementById("shopee-rust-sync-btn")) return;
  const btn = document.createElement("button");
  btn.id = "shopee-rust-sync-btn";
  const defaultHtml = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Sync Shopee to Store Explorer</span>`;
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
    btn.innerHTML = `<span>Syncing Shopee products...</span>`;
    const params = new URLSearchParams(window.location.search);
    const keyword = params.get("keyword") || "shopee_sync";
    const res = await scrollAndCollectSearchProducts(30);
    if (res.products && res.products.length > 0) {
      chrome.runtime.sendMessage(
        {
          action: "SYNC_FROM_SHOPEE_TAB",
          payload: { platform: "shopee", keyword, products: res.products },
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
  document.addEventListener("DOMContentLoaded", injectFloatingSyncButton);
} else {
  injectFloatingSyncButton();
}
