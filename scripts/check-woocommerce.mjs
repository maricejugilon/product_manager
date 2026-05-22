import { readFile } from "node:fs/promises";

function parseEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

const env = parseEnv(await readFile(".env.local", "utf8"));
const storeUrl = env.WOOCOMMERCE_STORE_URL?.replace(/\/$/, "");
const key = env.WOOCOMMERCE_CONSUMER_KEY;
const secret = env.WOOCOMMERCE_CONSUMER_SECRET;

if (!storeUrl || !key || !secret) {
  throw new Error("Missing WooCommerce settings in .env.local");
}

const auth = Buffer.from(`${key}:${secret}`).toString("base64");
const url = new URL("/wp-json/wc/v3/products", storeUrl);
url.searchParams.set("per_page", "1");
url.searchParams.set("status", "any");

const response = await fetch(url, {
  headers: {
    Authorization: `Basic ${auth}`
  }
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`WooCommerce returned ${response.status}: ${body || response.statusText}`);
}

const products = await response.json();
console.log(`WooCommerce connection OK. Sample products returned: ${products.length}`);
