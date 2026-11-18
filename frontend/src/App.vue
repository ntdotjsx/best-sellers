<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";

const searchInputRef = ref(null);
const searchPlatform = ref("both");
const searchKeyword = ref("Raspberry Pi");
const searchLimit = ref(20);
const searchSortBy = ref("sales");

const datasets = ref([]);
const activeDataset = ref("");
const activePlatformFilter = ref("all");
const products = ref([]);
const localFilter = ref("");
const localSort = ref("default");

const isLoading = ref(false);
const isScraping = ref(false);
const statusMessage = ref("");
const errorMessage = ref("");

const extConnected = ref(false);
const extVersion = ref("");
const showExtGuide = ref(false);

const selectedProduct = ref(null);
const isFetchingDetails = ref(false);
const reviewStarFilter = ref(0);

let reqCounter = 0;
const pendingRequests = new Map();

function callExtension(action, payload, timeoutMs = 55000) {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++reqCounter}_${Date.now()}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("หมดเวลารอข้อมูลจาก Extension (กรุณาตรวจสอบแท็บ Shopee / Lazada ที่เปิดอยู่)"));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    window.postMessage({ source: "SHOPEE_VUE_APP", action, payload, requestId }, "*");
  });
}

function handleWindowMessage(event) {
  if (!event.data || event.data.source !== "SHOPEE_EXT_BRIDGE") return;
  const { type, requestId, response, error } = event.data;

  if (type === "EXT_READY" || type === "EXT_PONG") {
    extConnected.value = true;
    if (event.data.version) {
      extVersion.value = event.data.version;
    }
    if (requestId && pendingRequests.has(requestId)) {
      pendingRequests.get(requestId).resolve(true);
      pendingRequests.delete(requestId);
    }
    return;
  }

  if (type === "EXT_RESPONSE" && requestId && pendingRequests.has(requestId)) {
    const handler = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);
    handler.resolve(response);
  } else if (type === "EXT_ERROR" && requestId && pendingRequests.has(requestId)) {
    const handler = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);
    handler.reject(new Error(error || "Extension error"));
  }
}

function checkExtensionInstalled() {
  if (document.documentElement.getAttribute("data-shopee-ext-installed") === "true") {
    extConnected.value = true;
  }
  const attrVer = document.documentElement.getAttribute("data-shopee-ext-version");
  if (attrVer) {
    extVersion.value = attrVer;
  }
  window.postMessage(
    { source: "SHOPEE_VUE_APP", action: "PING_EXTENSION", requestId: "ping" },
    "*"
  );
}

async function graphqlFetch(query, variables = {}) {
  const res = await fetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

async function loadDatasetsAndProducts(targetKeyword = null) {
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const dsData = await graphqlFetch(`
      query GetDatasets {
        datasets {
          platform
          keyword
          file
          productCount
          reviewCount
        }
      }
    `);
    datasets.value = dsData.datasets || [];

    if (targetKeyword !== null) {
      activeDataset.value = targetKeyword;
    } else if (!activeDataset.value && datasets.value.length > 0) {
      activeDataset.value = datasets.value[0].keyword;
    }

    await fetchProductsFromGraphQL(activeDataset.value);
  } catch (err) {
    errorMessage.value = `ไม่สามารถเชื่อมต่อ Rust GraphQL Server: ${err.message}`;
  } finally {
    isLoading.value = false;
  }
}

async function fetchProductsFromGraphQL(keyword = "") {
  isLoading.value = true;
  try {
    const data = await graphqlFetch(
      `
      query GetProducts($keyword: String) {
        products(keyword: $keyword, limit: 300) {
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
          comments(limit: 100) {
            author
            rating
            time
            content
            sellerRespond
            likeCount
          }
        }
      }
    `,
      { keyword: keyword || null }
    );
    products.value = data.products || [];
  } catch (err) {
    errorMessage.value = err.message;
  } finally {
    isLoading.value = false;
  }
}

async function handleSearchAndScrape() {
  const kw = searchKeyword.value.trim();
  if (!kw) return;

  errorMessage.value = "";
  checkExtensionInstalled();

  if (!extConnected.value) {
    showExtGuide.value = true;
    errorMessage.value =
      "กรุณาเปิดใช้งาน Extension ในโฟลเดอร์ extension/ บน Brave/Chrome ก่อน เพื่อให้ดึงข้อมูลจากแท็บ Shopee / Lazada ได้";
    return;
  }

  if (extVersion.value !== "1.2.0" && searchPlatform.value !== "shopee") {
    showExtGuide.value = true;
    errorMessage.value =
      "Extension ในเบราว์เซอร์ยังเป็นเวอร์ชันเก่า (v1.0.0) ที่รองรับแค่ Shopee — กรุณาไปที่หน้า brave://extensions แล้วกดปุ่ม Reload ที่ตัว Extension 1 ครั้ง แล้วรีเฟรชหน้านี้ครับ!";
    return;
  }

  activePlatformFilter.value =
    searchPlatform.value === "both" ? "all" : searchPlatform.value;

  const normKw = kw.toLowerCase().replace(/[^a-z0-9_\u0E00-\u0E7F]+/g, "");
  activeDataset.value = normKw;
  products.value = [];
  datasets.value = [];
  selectedProduct.value = null;
  localFilter.value = "";

  isScraping.value = true;
  const platLabel =
    searchPlatform.value === "both"
      ? "Shopee + Lazada"
      : searchPlatform.value === "lazada"
      ? "Lazada"
      : "Shopee";
  statusMessage.value = `กำลังล้างผลค้นหาเดิมและดึงข้อมูล "${kw}" จาก ${platLabel}...`;

  try {
    try {
      await graphqlFetch(`mutation { clearDatabase }`);
    } catch (_) {}

    const res = await callExtension("SEARCH_PRODUCTS", {
      platform: searchPlatform.value,
      keyword: kw,
      limit: Number(searchLimit.value),
      sortBy: searchSortBy.value,
    });

    if (!res || !res.ok) {
      errorMessage.value =
        res?.error || "ไม่สามารถดึงข้อมูลสินค้าได้ กรุณาตรวจสอบแท็บ Shopee / Lazada";
      return;
    }

    statusMessage.value = `ดึงสินค้าจาก ${platLabel} สำเร็จ ${res.count} รายการ! บันทึกลง Rust GraphQL Server แล้ว`;
    if (res.products && res.products.length > 0) {
      products.value = res.products;
    }
    await loadDatasetsAndProducts(normKw);
  } catch (err) {
    errorMessage.value = err.message;
  } finally {
    isScraping.value = false;
    setTimeout(() => {
      statusMessage.value = "";
    }, 5000);
  }
}

function openProductModal(prod) {
  selectedProduct.value = prod;
  reviewStarFilter.value = 0;
}

async function fetchLiveDetailsForProduct(prod) {
  if (!prod || !prod.link) return;
  checkExtensionInstalled();
  if (!extConnected.value) {
    showExtGuide.value = true;
    return;
  }

  isFetchingDetails.value = true;
  errorMessage.value = "";
  try {
    const res = await callExtension("FETCH_PRODUCT_DETAILS", {
      platform: prod.platform || (prod.link.includes("lazada.") ? "lazada" : "shopee"),
      keyword: prod.keyword || activeDataset.value || searchKeyword.value,
      productLink: prod.link,
      reviewLimit: 30,
    });

    if (!res || !res.ok) {
      errorMessage.value = res?.error || "ดึงรีวิวไม่สำเร็จ";
      return;
    }

    await fetchProductsFromGraphQL(activeDataset.value);
    const updated = products.value.find((p) => p.link === prod.link);
    if (updated) {
      selectedProduct.value = updated;
    }
  } catch (err) {
    errorMessage.value = err.message;
  } finally {
    isFetchingDetails.value = false;
  }
}

function parsePriceNumber(priceStr) {
  if (!priceStr) return 0;
  const nums = priceStr.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return nums ? parseFloat(nums[0]) : 0;
}

const filteredProducts = computed(() => {
  let list = [...products.value];
  if (activePlatformFilter.value !== "all") {
    list = list.filter((p) => (p.platform || "shopee") === activePlatformFilter.value);
  }
  const q = localFilter.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.location && p.location.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }

  if (localSort.value === "price_asc") {
    list.sort((a, b) => parsePriceNumber(a.price) - parsePriceNumber(b.price));
  } else if (localSort.value === "price_desc") {
    list.sort((a, b) => parsePriceNumber(b.price) - parsePriceNumber(a.price));
  } else if (localSort.value === "rating_desc") {
    list.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));
  } else if (localSort.value === "reviews_desc") {
    list.sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0));
  }

  return list;
});

const filteredModalComments = computed(() => {
  const comments = selectedProduct.value?.comments || [];
  if (!reviewStarFilter.value) return comments;
  return comments.filter((c) => Number(c.rating) === Number(reviewStarFilter.value));
});

function handleGlobalKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInputRef.value?.focus();
  } else if (e.key === "Escape") {
    selectedProduct.value = null;
    showExtGuide.value = false;
  }
}

onMounted(() => {
  window.addEventListener("message", handleWindowMessage);
  window.addEventListener("keydown", handleGlobalKeydown);
  checkExtensionInstalled();
  setTimeout(checkExtensionInstalled, 600);
  loadDatasetsAndProducts();
});

onUnmounted(() => {
  window.removeEventListener("message", handleWindowMessage);
  window.removeEventListener("keydown", handleGlobalKeydown);
});
</script>

<template>
  <div class="min-h-screen flex flex-col" style="background-color: #07080a; color: #cdcdcd">
    <!-- Primary Nav ({component.primary-nav}: 56px, #07080a, 1px #242728 bottom rule) -->
    <header
      class="sticky top-0 z-30 h-[56px] flex items-center"
      style="background-color: #07080a; border-bottom: 1px solid #242728"
    >
      <div class="max-w-[1240px] w-full mx-auto px-6 flex items-center justify-between gap-4">
        <!-- Wordmark -->
        <div class="flex items-center gap-3">
          <div
            class="w-7 h-7 rounded-[6px] flex items-center justify-center text-[13px] font-semibold"
            style="background-color: #121212; border: 1px solid #242728; color: #f4f4f6"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          </div>
          <span style="color: #f4f4f6; font-size: 14px; font-weight: 500; letter-spacing: 0.2px">
            Store Explorer
          </span>
          <span
            class="px-1.5 py-0.5 rounded-[4px] text-[12px]"
            style="background-color: #101111; color: rgba(255,255,255,0.72); border: 1px solid #242728"
          >
            Rust · GraphQL
          </span>
        </div>

        <!-- Centered Nav Cluster -->
        <nav class="hidden md:flex items-center gap-6 text-[14px] font-medium" style="letter-spacing: 0.2px">
          <button
            @click="activePlatformFilter = 'all'"
            class="cursor-pointer bg-transparent border-0"
            :style="{ color: activePlatformFilter === 'all' ? '#ffffff' : '#9c9c9d' }"
          >
            All Stores
          </button>
          <button
            @click="activePlatformFilter = 'shopee'"
            class="cursor-pointer bg-transparent border-0"
            :style="{ color: activePlatformFilter === 'shopee' ? '#ffffff' : '#9c9c9d' }"
          >
            Shopee.co.th
          </button>
          <button
            @click="activePlatformFilter = 'lazada'"
            class="cursor-pointer bg-transparent border-0"
            :style="{ color: activePlatformFilter === 'lazada' ? '#ffffff' : '#9c9c9d' }"
          >
            Lazada.co.th
          </button>
          <a href="/graphql" target="_blank" style="color: #9c9c9d; text-decoration: none">
            GraphQL API
          </a>
        </nav>

        <!-- Right Cluster -->
        <div class="flex items-center gap-3">
          <button
            @click="showExtGuide = true"
            class="install-button"
          >
            <span
              class="w-2 h-2 rounded-full"
              :style="{ backgroundColor: extConnected ? '#59d499' : '#ffc533' }"
            ></span>
            <span>{{ extConnected ? "Extension Ready" : "Connect Extension" }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Hero Band ({component.hero-stripe-band} — used once per page) -->
    <section class="hero-stripe-band pt-16 pb-12 px-6">
      <div class="max-w-[1240px] mx-auto relative z-10">
        <!-- Headline Block -->
        <div class="max-w-[760px] mb-8">
          <div class="inline-flex items-center gap-2 mb-4">
            <span
              class="px-2 py-0.5 rounded-[4px] text-[12px]"
              style="background-color: rgba(87,193,255,0.15); color: #57c1ff; letter-spacing: 0.4px"
            >
              LIVE GRAPHQL BRIDGE
            </span>
            <span style="color: #9c9c9d; font-size: 13px">
              Shopee.co.th &amp; Lazada.co.th Best-Seller Intelligence
            </span>
          </div>
          <h1 class="display-xl mb-4">
            Search best-selling products at command speed.
          </h1>
          <p style="font-size: 18px; line-height: 1.6; color: #cdcdcd; margin: 0">
            พิมพ์คำค้นหาเพื่อดึงข้อมูลสินค้าขายดี รูปภาพ ราคา ยอดขาย และรีวิวจากทั้ง Shopee และ Lazada เข้าสู่ Rust GraphQL Server
          </p>
        </div>

        <!-- Command Palette Container ({component.command-palette-card}: #0d0d0d, 1px #242728, rounded 16px) -->
        <div
          class="rounded-[16px] overflow-hidden"
          style="background-color: #0d0d0d; border: 1px solid #242728"
        >
          <!-- Top macOS traffic-light bar + Search Input -->
          <div
            class="px-4 py-3 flex items-center justify-between gap-3"
            style="border-bottom: 1px solid #242728; background-color: #0d0d0d"
          >
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full" style="background-color: #242728"></span>
              <span class="w-3 h-3 rounded-full" style="background-color: #242728"></span>
              <span class="w-3 h-3 rounded-full" style="background-color: #242728"></span>
              <span class="ml-2 text-[13px]" style="color: #9c9c9d">
                Command Palette — Best-Seller Query
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[12px]" style="color: #9c9c9d">Focus</span>
              <span class="keycap">⌘ K</span>
            </div>
          </div>

          <!-- Command Palette Search Form -->
          <form @submit.prevent="handleSearchAndScrape" class="p-4 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <!-- Store Search Bar ({component.store-search-bar}: 44px height) -->
              <div class="md:col-span-5 relative flex items-center">
                <input
                  ref="searchInputRef"
                  v-model="searchKeyword"
                  type="text"
                  placeholder="Search the store... (e.g. Raspberry Pi, SSD, Keyboard)"
                  class="store-search-bar w-full"
                />
              </div>

              <!-- Platform Selector -->
              <div class="md:col-span-2">
                <select v-model="searchPlatform" class="store-search-bar w-full">
                  <option value="both">Shopee + Lazada</option>
                  <option value="shopee">Shopee.co.th</option>
                  <option value="lazada">Lazada.co.th</option>
                </select>
              </div>

              <!-- Sort Selector -->
              <div class="md:col-span-2">
                <select v-model="searchSortBy" class="store-search-bar w-full">
                  <option value="sales">Sort: Best Sellers</option>
                  <option value="relevancy">Sort: Relevancy</option>
                  <option value="price_asc">Price: Low → High</option>
                  <option value="price_desc">Price: High → Low</option>
                </select>
              </div>

              <!-- Limit Selector -->
              <div class="md:col-span-1">
                <select v-model="searchLimit" class="store-search-bar w-full">
                  <option :value="10">10</option>
                  <option :value="20">20</option>
                  <option :value="30">30</option>
                  <option :value="50">50</option>
                </select>
              </div>

              <!-- Primary White CTA ({component.button-primary}: #ffffff bg, #000000 text — universal primary action) -->
              <div class="md:col-span-2 flex justify-end">
                <button
                  type="submit"
                  :disabled="isScraping"
                  class="btn-primary w-full"
                  style="height: 44px"
                >
                  <span>{{ isScraping ? "Syncing..." : "Search Store" }}</span>
                  <span v-if="!isScraping" class="text-[12px] opacity-70">⏎</span>
                </button>
              </div>
            </div>

            <!-- Filter & Dataset Strip ({component.pill-tab} + {component.pill-tab-active}) -->
            <div
              class="pt-3 flex flex-wrap items-center justify-between gap-3"
              style="border-top: 1px solid #242728"
            >
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-[12px] mr-1" style="color: #9c9c9d; letter-spacing: 0.4px">
                  DATASETS:
                </span>
                <button
                  type="button"
                  @click="
                    activeDataset = '';
                    fetchProductsFromGraphQL('');
                  "
                  class="pill-tab"
                  :class="{ 'pill-tab-active': activeDataset === '' }"
                >
                  All Saved
                </button>
                <button
                  v-for="ds in datasets"
                  :key="ds.file"
                  type="button"
                  @click="
                    activeDataset = ds.keyword;
                    fetchProductsFromGraphQL(ds.keyword);
                  "
                  class="pill-tab"
                  :class="{ 'pill-tab-active': activeDataset === ds.keyword }"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{
                      backgroundColor: ds.platform === 'lazada' ? '#57c1ff' : '#ffc533',
                    }"
                  ></span>
                  <span>{{ ds.keyword }}</span>
                  <span
                    class="px-1.5 py-0.2 rounded-[4px] text-[12px]"
                    style="background-color: #121212; color: #9c9c9d"
                  >
                    {{ ds.productCount }}
                  </span>
                </button>
              </div>

              <!-- Local Filter & Sort -->
              <div class="flex items-center gap-2 flex-wrap">
                <input
                  v-model="localFilter"
                  type="text"
                  placeholder="Filter results..."
                  class="text-input text-[14px]"
                  style="width: 180px"
                />
                <select v-model="localSort" class="text-input text-[14px]">
                  <option value="default">Order: Best Selling</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="rating_desc">Top Rated</option>
                  <option value="reviews_desc">Most Reviewed</option>
                </select>
              </div>
            </div>

            <!-- Status / Error Row -->
            <div
              v-if="statusMessage"
              class="px-3 py-2 rounded-[8px] text-[13px] flex items-center gap-2"
              style="background-color: rgba(89,212,153,0.15); color: #59d499"
            >
              <span>●</span>
              <span>{{ statusMessage }}</span>
            </div>

            <div
              v-if="errorMessage"
              class="px-3 py-2 rounded-[8px] text-[13px] flex items-center justify-between gap-2"
              style="background-color: rgba(255,97,97,0.15); color: #ff6161"
            >
              <span>{{ errorMessage }}</span>
              <button
                type="button"
                @click="showExtGuide = true"
                class="install-button text-[12px]"
                style="height: 26px; padding: 2px 10px"
              >
                Extension Setup
              </button>
            </div>
          </form>

          <!-- Command Palette Footer Bar -->
          <div
            class="px-4 py-2.5 flex items-center justify-between text-[13px]"
            style="background-color: #101111; border-top: 1px solid #242728; color: #9c9c9d"
          >
            <div>
              Showing <strong style="color: #f4f4f6">{{ filteredProducts.length }}</strong> items
            </div>
            <div class="flex items-center gap-3">
              <span class="flex items-center gap-1.5">
                <span>Search</span>
                <span class="keycap">⏎</span>
              </span>
              <span class="flex items-center gap-1.5">
                <span>Close</span>
                <span class="keycap">Esc</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Results Section -->
    <main class="flex-1 max-w-[1240px] mx-auto relative z-10 mb-10">
      <div v-if="isLoading" class="py-16 text-center" style="color: #9c9c9d">
        Loading store items from GraphQL...
      </div>

      <div
        v-else-if="filteredProducts.length === 0"
        class="rounded-[10px] p-12 text-center"
        style="background-color: #0d0d0d; border: 1px solid #242728"
      >
        <div
          class="w-12 h-12 rounded-[8px] mx-auto mb-4 flex items-center justify-center text-[20px]"
          style="background-color: #121212; border: 1px solid #242728; color: #f4f4f6"
        >
          ⌘
        </div>
        <h2 style="font-size: 20px; font-weight: 500; color: #f4f4f6; margin-bottom: 8px">
          No products in current view
        </h2>
        <p style="font-size: 14px; color: #9c9c9d; max-width: 440px; margin: 0 auto">
          Enter a keyword in the command palette above and press
          <span class="keycap mx-1">⏎</span> to sync best-selling products from Shopee.co.th &amp; Lazada.co.th.
        </p>
      </div>

      <!-- Product Grid ({spacing.lg} 16px gap, {component.feature-card-dark}: #0d0d0d, 1px #242728, rounded 10px, 16px padding) -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[16px]">
        <article
          v-for="(prod, idx) in filteredProducts"
          :key="prod.link || idx"
          class="rounded-[10px] p-[16px] flex flex-col justify-between"
          style="background-color: #0d0d0d; border: 1px solid #242728"
        >
          <div>
            <!-- Top Metadata Row -->
            <div class="flex items-center justify-between gap-2 mb-3">
              <div class="flex items-center gap-1.5">
                <!-- Category Accent Pill (Reserved for tile metadata per DESIGN.md) -->
                <span
                  class="px-2 py-0.5 rounded-[4px] text-[12px] font-medium"
                  :style="
                    prod.platform === 'lazada'
                      ? 'background-color: rgba(87,193,255,0.15); color: #57c1ff'
                      : 'background-color: rgba(255,197,51,0.15); color: #ffc533'
                  "
                >
                  {{ prod.platform === "lazada" ? "Lazada" : "Shopee" }}
                </span>
                <span class="keycap">#{{ idx + 1 }}</span>
              </div>

              <span
                v-if="prod.rating && prod.rating !== '<Product rating>' && prod.rating !== '-'"
                class="px-2 py-0.5 rounded-[4px] text-[12px]"
                style="background-color: #101111; color: #f4f4f6; border: 1px solid #242728"
              >
                ★ {{ prod.rating }}
              </span>
            </div>

            <!-- Product Image Container ({colors.surface-card} #121212, {rounded.md} 8px) -->
            <div
              class="aspect-square rounded-[8px] overflow-hidden mb-3 flex items-center justify-center"
              style="background-color: #121212; border: 1px solid #242728"
            >
              <img
                v-if="prod.img && prod.img !== '<Image>' && !prod.img.startsWith('data:image')"
                :src="prod.img"
                :alt="prod.name"
                referrerpolicy="no-referrer"
                loading="lazy"
                class="w-full h-full object-contain"
              />
              <span v-else class="text-[12px]" style="color: #6a6b6c">No image</span>
            </div>

            <!-- Title ({typography.body-sm-strong}: 14px / 500 / 1.6 / #f4f4f6) -->
            <h3
              class="line-clamp-2 mb-2"
              style="font-size: 14px; font-weight: 500; line-height: 1.5; color: #f4f4f6; letter-spacing: 0.2px"
              :title="prod.name"
            >
              {{ prod.name }}
            </h3>
          </div>

          <div class="pt-2 space-y-3">
            <!-- Price & Sold Row -->
            <div class="flex items-baseline justify-between gap-2">
              <span style="font-size: 18px; font-weight: 500; color: #ffffff">
                {{ prod.price && prod.price !== '<Product price>' ? prod.price : '-' }}
              </span>
              <span
                v-if="prod.shipping && prod.shipping !== '<Shipping>'"
                class="px-1.5 py-0.5 rounded-[4px] text-[12px] truncate"
                style="background-color: rgba(89,212,153,0.15); color: #59d499"
              >
                {{ prod.shipping }}
              </span>
            </div>

            <!-- Location & Review Count ({typography.caption-md}: 13px / #9c9c9d) -->
            <div class="flex items-center justify-between text-[13px]" style="color: #9c9c9d">
              <span class="truncate">
                {{ prod.location && prod.location !== '<Location>' ? prod.location : 'Thailand' }}
              </span>
              <span>{{ prod.commentCount || 0 }} reviews</span>
            </div>

            <!-- Card Actions ({component.button-tertiary} + {component.install-button}) -->
            <div
              class="pt-3 grid grid-cols-2 gap-2"
              style="border-top: 1px solid #242728"
            >
              <button
                type="button"
                @click="openProductModal(prod)"
                class="btn-tertiary text-[13px]"
                style="height: 32px; padding: 4px 10px"
              >
                Reviews ({{ prod.commentCount || 0 }})
              </button>
              <a
                :href="prod.link"
                target="_blank"
                rel="noopener noreferrer"
                class="install-button text-[13px]"
              >
                Open Store ↗
              </a>
            </div>
          </div>
        </article>
      </div>
    </main>

    <!-- Footer ({component.footer-section}: #07080a, 1px #242728 top rule) -->
    <footer
      class="py-12 px-6"
      style="background-color: #07080a; border-top: 1px solid #242728; color: #9c9c9d; font-size: 13px"
    >
      <div class="max-w-[1240px] mx-auto flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <span class="keycap">⌘</span>
          <span style="color: #f4f4f6; font-weight: 500">Store Explorer</span>
          <span>— Powered by Rust GraphQL &amp; Vue 3</span>
        </div>
        <div class="flex items-center gap-6">
          <a href="/graphql" target="_blank" style="color: #cdcdcd; text-decoration: none">
            GraphQL Playground
          </a>
          <span>Port 8000</span>
        </div>
      </div>
    </footer>

    <!-- Product Detail & Reviews Modal ({component.command-palette-card} style) -->
    <div
      v-if="selectedProduct"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background-color: rgba(7, 8, 10, 0.82); backdrop-filter: blur(6px)"
      @click.self="selectedProduct = null"
    >
      <div
        class="max-w-[780px] w-full max-h-[86vh] flex flex-col rounded-[16px] overflow-hidden"
        style="background-color: #0d0d0d; border: 1px solid #242728"
      >
        <!-- Modal Top Header -->
        <div
          class="px-5 py-3.5 flex items-center justify-between gap-4"
          style="border-bottom: 1px solid #242728; background-color: #101111"
        >
          <div class="flex items-center gap-2 truncate">
            <span
              class="px-2 py-0.5 rounded-[4px] text-[12px]"
              :style="
                selectedProduct.platform === 'lazada'
                  ? 'background-color: rgba(87,193,255,0.15); color: #57c1ff'
                  : 'background-color: rgba(255,197,51,0.15); color: #ffc533'
              "
            >
              {{ selectedProduct.platform === "lazada" ? "Lazada" : "Shopee" }}
            </span>
            <h3 class="truncate" style="font-size: 14px; font-weight: 500; color: #f4f4f6; margin: 0">
              {{ selectedProduct.name }}
            </h3>
          </div>
          <button
            @click="selectedProduct = null"
            class="keycap cursor-pointer"
          >
            Esc
          </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 overflow-y-auto space-y-6">
          <div class="flex flex-col sm:flex-row gap-5">
            <div
              class="w-36 h-36 rounded-[8px] overflow-hidden shrink-0 flex items-center justify-center"
              style="background-color: #121212; border: 1px solid #242728"
            >
              <img
                v-if="selectedProduct.img"
                :src="selectedProduct.img"
                referrerpolicy="no-referrer"
                class="w-full h-full object-contain"
              />
            </div>

            <div class="space-y-3 flex-1">
              <div style="font-size: 24px; font-weight: 500; color: #f4f4f6">
                {{ selectedProduct.price }}
              </div>
              <div class="flex flex-wrap gap-2">
                <span class="keycap">★ {{ selectedProduct.rating || "-" }}</span>
                <span v-if="selectedProduct.shipping" class="keycap">
                  {{ selectedProduct.shipping }}
                </span>
                <span v-if="selectedProduct.location" class="keycap">
                  {{ selectedProduct.location }}
                </span>
              </div>
              <p v-if="selectedProduct.category" style="font-size: 13px; color: #9c9c9d; margin: 0">
                Category: <span style="color: #cdcdcd">{{ selectedProduct.category }}</span>
              </p>

              <div class="pt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  @click="fetchLiveDetailsForProduct(selectedProduct)"
                  :disabled="isFetchingDetails"
                  class="btn-primary"
                >
                  {{ isFetchingDetails ? "Syncing Reviews..." : "Sync Live Reviews & Details" }}
                </button>
                <a
                  :href="selectedProduct.link"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="install-button"
                  style="height: 36px"
                >
                  View on Store ↗
                </a>
              </div>
            </div>
          </div>

          <div
            v-if="selectedProduct.description"
            class="rounded-[8px] p-4 text-[14px] whitespace-pre-line max-h-40 overflow-y-auto"
            style="background-color: #101111; border: 1px solid #242728; color: #cdcdcd"
          >
            {{ selectedProduct.description }}
          </div>

          <!-- Reviews List -->
          <div class="space-y-3">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <span style="font-size: 14px; font-weight: 500; color: #f4f4f6">
                Customer Reviews ({{ selectedProduct.comments?.length || 0 }})
              </span>
              <div class="flex items-center gap-1 flex-wrap">
                <button
                  v-for="star in [0, 5, 4, 3, 2, 1]"
                  :key="star"
                  type="button"
                  @click="reviewStarFilter = star"
                  class="pill-tab"
                  :class="{ 'pill-tab-active': reviewStarFilter === star }"
                >
                  {{ star === 0 ? "All" : `${star} ★` }}
                </button>
              </div>
            </div>

            <div
              v-if="filteredModalComments.length === 0"
              class="rounded-[8px] p-8 text-center text-[14px]"
              style="background-color: #101111; border: 1px solid #242728; color: #9c9c9d"
            >
              No reviews synced yet. Click
              <strong style="color: #ffffff">"Sync Live Reviews &amp; Details"</strong>
              above to pull reviews from the store.
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="(rev, rIdx) in filteredModalComments"
                :key="rIdx"
                class="rounded-[8px] p-4 space-y-1.5"
                style="background-color: #101111; border: 1px solid #242728"
              >
                <div class="flex items-center justify-between text-[13px]">
                  <span style="font-weight: 500; color: #f4f4f6">{{ rev.author || "Customer" }}</span>
                  <span style="color: #ffc533">
                    {{ "★".repeat(Math.max(1, Math.min(5, rev.rating || 5))) }}
                  </span>
                </div>
                <div class="text-[12px]" style="color: #6a6b6c">{{ rev.time }}</div>
                <p style="font-size: 14px; color: #cdcdcd; margin: 0; white-space: pre-line">
                  {{ rev.content || "(No written comment)" }}
                </p>
                <div
                  v-if="rev.sellerRespond"
                  class="mt-2 p-2.5 rounded-[6px] text-[13px]"
                  style="background-color: #121212; border: 1px solid #242728; color: #9c9c9d"
                >
                  <strong style="color: #f4f4f6">Seller reply:</strong> {{ rev.sellerRespond }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Extension Guide Modal -->
    <div
      v-if="showExtGuide"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      style="background-color: rgba(7, 8, 10, 0.82); backdrop-filter: blur(6px)"
      @click.self="showExtGuide = false"
    >
      <div
        class="max-w-[520px] w-full rounded-[16px] p-6 space-y-4"
        style="background-color: #0d0d0d; border: 1px solid #242728"
      >
        <div class="flex items-center justify-between">
          <h3 style="font-size: 18px; font-weight: 500; color: #f4f4f6; margin: 0">
            Connect Browser Extension
          </h3>
          <button @click="showExtGuide = false" class="keycap cursor-pointer">Esc</button>
        </div>
        <ol class="text-[14px] space-y-2.5 list-decimal list-inside" style="color: #cdcdcd">
          <li>
            Open <span class="keycap">brave://extensions</span> or
            <span class="keycap">chrome://extensions</span>
          </li>
          <li>Enable <strong style="color: #f4f4f6">Developer mode</strong> in the top-right corner</li>
          <li>
            Click <strong style="color: #f4f4f6">Load unpacked</strong> (or <strong style="color: #f4f4f6">Reload ↻</strong>) and select:
            <div
              class="mt-1.5 p-2.5 rounded-[6px] font-mono text-[12px] select-all"
              style="background-color: #101111; border: 1px solid #242728; color: #59d499"
            >
              c:\Users\ntdotjsx\Desktop\shopee-scraper\extension
            </div>
          </li>
          <li>Refresh this page and start searching Shopee.co.th &amp; Lazada.co.th.</li>
        </ol>
        <div class="pt-2 flex justify-end">
          <button
            type="button"
            @click="
              checkExtensionInstalled();
              showExtGuide = false;
            "
            class="btn-primary"
          >
            Verify Connection
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
