// Runs in MAIN world at document_start on Shopee (*.shopee.co.th, etc.)
// Ensures background tabs (active: false) still render React components,
// fire IntersectionObserver callbacks, and capture /api/v4/search/search_items JSON.

(function () {
  if (window.__SHOPEE_MAIN_SHIM_INSTALLED__) return;
  window.__SHOPEE_MAIN_SHIM_INSTALLED__ = true;

  // 1. Force Page Visibility API to report visible even in background tabs
  try {
    Object.defineProperty(document, "hidden", {
      get: () => false,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });
    Object.defineProperty(document, "webkitHidden", {
      get: () => false,
      configurable: true,
    });
    window.addEventListener(
      "visibilitychange",
      (e) => e.stopImmediatePropagation(),
      true
    );
    document.addEventListener(
      "visibilitychange",
      (e) => e.stopImmediatePropagation(),
      true
    );
  } catch (_) {}

  // 2. Keep requestAnimationFrame running in background tabs
  try {
    window.requestAnimationFrame = function (cb) {
      return setTimeout(() => {
        try {
          cb(performance.now());
        } catch (_) {}
      }, 16);
    };
    window.cancelAnimationFrame = function (id) {
      clearTimeout(id);
    };
  } catch (_) {}

  // 3. Patch IntersectionObserver so lazy Shopee product cards & images mount immediately
  try {
    const OrigIO = window.IntersectionObserver;
    if (OrigIO && !OrigIO.__patchedByStoreExplorer) {
      const PatchedIO = function (callback, options) {
        const instance = new OrigIO(callback, options);
        const origObserve = instance.observe.bind(instance);
        instance.observe = function (target) {
          try {
            origObserve(target);
          } catch (_) {}
          setTimeout(() => {
            try {
              const rect =
                target && typeof target.getBoundingClientRect === "function"
                  ? target.getBoundingClientRect()
                  : {
                      top: 10,
                      left: 10,
                      bottom: 210,
                      right: 210,
                      width: 200,
                      height: 200,
                      x: 10,
                      y: 10,
                    };
              callback(
                [
                  {
                    target,
                    isIntersecting: true,
                    intersectionRatio: 1,
                    boundingClientRect: rect,
                    intersectionRect: rect,
                    rootBounds: rect,
                    time: performance.now(),
                  },
                ],
                instance
              );
            } catch (_) {}
          }, 15);
        };
        return instance;
      };
      PatchedIO.prototype = OrigIO.prototype;
      PatchedIO.__patchedByStoreExplorer = true;
      window.IntersectionObserver = PatchedIO;
    }
  } catch (_) {}

  // 4. Intercept Shopee Search API (/api/v4/search/search_items) responses
  function mapShopeeApiItems(rawItems) {
    if (!Array.isArray(rawItems)) return [];
    const out = [];
    for (const entry of rawItems) {
      const b = entry?.item_basic || entry;
      if (!b || (!b.itemid && !b.item_id)) continue;
      const itemid = b.itemid || b.item_id;
      const shopid = b.shopid || b.shop_id || 0;
      const name = b.name || "";
      if (!name) continue;

      const imgHash =
        b.image || (Array.isArray(b.images) && b.images[0]) || "";
      let img = "";
      if (imgHash) {
        img = imgHash.startsWith("http")
          ? imgHash
          : `https://down-th.img.susercontent.com/file/${imgHash}`;
      }

      const rawPrice =
        b.price ||
        b.price_min ||
        b.item_card_display_price?.price ||
        0;
      const priceNum = rawPrice >= 100000 ? rawPrice / 100000 : rawPrice;
      const price =
        priceNum > 0 ? `฿${Math.round(priceNum).toLocaleString()}` : "-";

      const rStar = b.item_rating?.rating_star;
      const rating = rStar && rStar > 0 ? Number(rStar).toFixed(1) : "-";

      const soldCnt = b.historical_sold || b.sold || 0;
      const shipping =
        b.sold_text ||
        b.item_card_display_sold_count?.historical_sold_count_text ||
        b.item_card_display_sold_count?.monthly_sold_count_text ||
        (soldCnt > 0 ? `ขายแล้ว ${soldCnt.toLocaleString()} ชิ้น` : "");

      const location = b.shop_location || "";
      const shopName =
        b.shop_name ||
        (b.brand && b.brand !== "0" && b.brand !== "No Brand" ? b.brand : "") ||
        (shopid ? `Shopee Store #${String(shopid).slice(-5)}` : "Shopee Store");
      const link = `${window.location.origin}/product/${shopid}/${itemid}`;

      out.push({
        platform: "shopee",
        link,
        name,
        price,
        rating,
        img,
        shipping,
        location,
        category: shopName,
        shopName,
      });
    }
    return out;
  }

  function storeCapturedProducts(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    try {
      const existing = window.__SHOPEE_CAPTURED_PRODUCTS__ || [];
      const seen = new Set(existing.map((p) => p.link));
      const merged = [...existing];
      for (const item of items) {
        if (item.link && !seen.has(item.link)) {
          seen.add(item.link);
          merged.push(item);
        }
      }
      window.__SHOPEE_CAPTURED_PRODUCTS__ = merged;
      document.documentElement.setAttribute(
        "data-shopee-api-products",
        JSON.stringify(merged)
      );
    } catch (_) {}
  }

  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function (...args) {
        const res = await origFetch.apply(this, args);
        try {
          const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
          if (
            url.includes("/api/v4/search/search_items") ||
            url.includes("/api/v4/recommend/recommend")
          ) {
            const clone = res.clone();
            clone
              .json()
              .then((json) => {
                const rawList =
                  json?.items ||
                  json?.data?.items ||
                  json?.data?.sections?.[0]?.data?.item ||
                  [];
                const mapped = mapShopeeApiItems(rawList);
                if (mapped.length > 0) {
                  storeCapturedProducts(mapped);
                }
              })
              .catch(() => {});
          }
        } catch (_) {}
        return res;
      };
    }
  } catch (_) {}

  try {
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR) {
      const origOpen = OrigXHR.prototype.open;
      const origSend = OrigXHR.prototype.send;
      OrigXHR.prototype.open = function (method, url, ...rest) {
        this.__shopeeUrl = typeof url === "string" ? url : String(url || "");
        return origOpen.call(this, method, url, ...rest);
      };
      OrigXHR.prototype.send = function (...args) {
        this.addEventListener("load", function () {
          try {
            const u = this.__shopeeUrl || "";
            if (
              u.includes("/api/v4/search/search_items") ||
              u.includes("/api/v4/recommend/recommend")
            ) {
              const json = JSON.parse(this.responseText);
              const rawList =
                json?.items ||
                json?.data?.items ||
                json?.data?.sections?.[0]?.data?.item ||
                [];
              const mapped = mapShopeeApiItems(rawList);
              if (mapped.length > 0) {
                storeCapturedProducts(mapped);
              }
            }
          } catch (_) {}
        });
        return origSend.apply(this, args);
      };
    }
  } catch (_) {}
})();
