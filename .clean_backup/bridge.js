// Injected on our local Vue Dashboard (http://127.0.0.1:8000 & :5173)
// Bridges window.postMessage <-> chrome.runtime.sendMessage

const EXT_VERSION = "1.2.0";

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.setAttribute("data-shopee-ext-installed", "true");
  document.documentElement.setAttribute("data-shopee-ext-version", EXT_VERSION);
  window.postMessage(
    { source: "SHOPEE_EXT_BRIDGE", type: "EXT_READY", version: EXT_VERSION },
    "*"
  );
});

document.documentElement.setAttribute("data-shopee-ext-installed", "true");
document.documentElement.setAttribute("data-shopee-ext-version", EXT_VERSION);

window.addEventListener("message", async (event) => {
  if (event.source !== window || !event.data || event.data.source !== "SHOPEE_VUE_APP") {
    return;
  }

  const { action, payload, requestId } = event.data;

  if (action === "PING_EXTENSION") {
    try {
      const pong = await chrome.runtime.sendMessage({
        action: "PING_BG",
        expectedVersion: payload?.expectedVersion || EXT_VERSION,
      });
      window.postMessage(
        {
          source: "SHOPEE_EXT_BRIDGE",
          type: "EXT_PONG",
          version: pong?.version || EXT_VERSION,
          reloading: Boolean(pong?.reloading),
          requestId,
        },
        "*"
      );
    } catch (_) {
      window.postMessage(
        {
          source: "SHOPEE_EXT_BRIDGE",
          type: "EXT_PONG",
          version: EXT_VERSION,
          requestId,
        },
        "*"
      );
    }
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ action, payload });
    window.postMessage(
      {
        source: "SHOPEE_EXT_BRIDGE",
        type: "EXT_RESPONSE",
        requestId,
        response,
      },
      "*"
    );
  } catch (err) {
    window.postMessage(
      {
        source: "SHOPEE_EXT_BRIDGE",
        type: "EXT_ERROR",
        requestId,
        error: err?.message || String(err),
      },
      "*"
    );
  }
});
