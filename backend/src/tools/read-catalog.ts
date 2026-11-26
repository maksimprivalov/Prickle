import { z } from 'zod';
import { Offer, StoreId } from '@core/offers';
import { parseStoreMoney } from './parse-store-money';
import { StoreError, getJson, getText, type StoreClient } from './store-client';

// One reader per store, each for that store's own catalog shape (see src/mock-stores/store-shapes.ts).
// Every reader ends in Offer.parse, so whatever the shape, an agent only ever sees core Offers.

const optional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;
const nonEmpty = (text: string | null | undefined): string | undefined => (text ? text : undefined);

// --- A: clean JSON, prices in cents ----------------------------------------------------------

const StoreAProducts = z.object({
  products: z.array(
    z.object({
      recordId: z.string(),
      id: z.string(),
      title: z.string(),
      category: z.string(),
      screenInches: z.number().nullable(),
      priceCents: z.unknown(),
      wasPriceCents: z.unknown(),
      saleStartsOn: z.string().nullable(),
      stock: z.string().nullable(),
    }),
  ),
});

async function readStoreA(client: StoreClient): Promise<Offer[]> {
  const { products } = StoreAProducts.parse(await getJson(client, '/stores/a/products'));
  return products.map((p) =>
    Offer.parse({
      recordId: p.recordId,
      offerId: p.id,
      storeId: StoreId.A,
      title: p.title,
      category: p.category,
      screenInches: optional(p.screenInches),
      price: parseStoreMoney(StoreId.A, p.priceCents),
      wasPrice: p.wasPriceCents === null ? undefined : parseStoreMoney(StoreId.A, p.wasPriceCents),
      reductionStart: optional(p.saleStartsOn),
      stockLabel: nonEmpty(p.stock),
    }),
  );
}

// --- B: paged JSON, "585.00" strings ---------------------------------------------------------

const StoreBPage = z.object({
  page: z.number().int(),
  totalPages: z.number().int().positive(),
  items: z.array(
    z.object({
      ref: z.string(),
      sku: z.string(),
      name: z.string(),
      type: z.string(),
      size_in: z.number().optional(),
      price_eur: z.unknown(),
      list_price_eur: z.unknown().optional(),
      sale_from: z.string().optional(),
      availability: z.string(),
    }),
  ),
});

/** More pages than this means the store is looping: stop instead of hanging the scout. */
const STORE_B_MAX_PAGES = 20;

async function readStoreB(client: StoreClient): Promise<Offer[]> {
  const offers: Offer[] = [];
  for (let page = 1; ; page++) {
    const body = StoreBPage.parse(await getJson(client, `/stores/b/catalog?page=${page}`));
    for (const item of body.items) {
      offers.push(
        Offer.parse({
          recordId: item.ref,
          offerId: item.sku,
          storeId: StoreId.B,
          title: item.name,
          category: item.type,
          screenInches: item.size_in,
          price: parseStoreMoney(StoreId.B, item.price_eur),
          wasPrice:
            item.list_price_eur === undefined
              ? undefined
              : parseStoreMoney(StoreId.B, item.list_price_eur),
          reductionStart: item.sale_from,
          stockLabel: nonEmpty(item.availability),
        }),
      );
    }
    if (page >= body.totalPages) return offers;
    if (page >= STORE_B_MAX_PAGES) throw new StoreError('store B: too many catalog pages');
  }
}

// --- C: one line of text per product ----------------------------------------------------------

const StoreCListings = z.object({
  listings: z.array(
    z.object({ ref: z.string(), sku: z.string(), cat: z.string(), text: z.string() }),
  ),
});

const C_SIZE = /^(\d+) in$/;
const C_DISCOUNT = /^NOW (€\d+,\d{2}) \(was (€\d+,\d{2})\) since (\d{2})\.(\d{2})\.(\d{4})$/;
const C_PRICE = /^€\d+,\d{2}$/;

/** "Novabright 55\" 4K LED TV | 55 in | NOW €599,00 (was €649,00) since 20.11.2026 | In stock" */
function parseStoreCText(text: string) {
  const parts = text.split(' | ');
  const title = parts[0];
  const stock = parts.at(-1);
  if (!title || stock === undefined || parts.length < 3) {
    throw new StoreError(`store C: cannot read listing "${text}"`);
  }
  const middle = parts.slice(1, -1);
  const size = middle.map((p) => C_SIZE.exec(p)).find((m) => m !== null);
  const priceText = middle.find((p) => p.includes('€'));
  if (!priceText) throw new StoreError(`store C: no price in "${text}"`);
  const discount = C_DISCOUNT.exec(priceText);
  if (discount) {
    const [, now = '', was = '', day, month, year] = discount;
    return {
      title,
      stock,
      screenInches: size ? Number(size[1]) : undefined,
      price: parseStoreMoney(StoreId.C, now),
      wasPrice: parseStoreMoney(StoreId.C, was),
      reductionStart: `${year}-${month}-${day}`,
    };
  }
  if (!C_PRICE.test(priceText)) throw new StoreError(`store C: cannot read price "${priceText}"`);
  return {
    title,
    stock,
    screenInches: size ? Number(size[1]) : undefined,
    price: parseStoreMoney(StoreId.C, priceText),
    wasPrice: undefined,
    reductionStart: undefined,
  };
}

async function readStoreC(client: StoreClient): Promise<Offer[]> {
  const { listings } = StoreCListings.parse(await getJson(client, '/stores/c/listings'));
  return listings.map((l) => {
    const parsed = parseStoreCText(l.text);
    return Offer.parse({
      recordId: l.ref,
      offerId: l.sku,
      storeId: StoreId.C,
      title: parsed.title,
      category: l.cat,
      screenInches: parsed.screenInches,
      price: parsed.price,
      wasPrice: parsed.wasPrice,
      reductionStart: parsed.reductionStart,
      stockLabel: nonEmpty(parsed.stock),
    });
  });
}

// --- D: nested JSON with price objects --------------------------------------------------------

const StoreDCatalog = z.object({
  data: z.object({
    products: z.array(
      z.object({
        offer_id: z.string(),
        record_id: z.string(),
        label: z.string(),
        kind: z.string(),
        inches: z.number().nullable(),
        price: z.unknown(),
        compare_at: z.unknown(),
        promo_start: z.string().nullable(),
        stock_note: z.string().nullable(),
      }),
    ),
  }),
});

async function readStoreD(client: StoreClient): Promise<Offer[]> {
  const { data } = StoreDCatalog.parse(await getJson(client, '/stores/d/api/v2/catalog'));
  return data.products.map((p) =>
    Offer.parse({
      recordId: p.record_id,
      offerId: p.offer_id,
      storeId: StoreId.D,
      title: p.label,
      category: p.kind,
      screenInches: optional(p.inches),
      price: parseStoreMoney(StoreId.D, p.price),
      wasPrice: p.compare_at === null ? undefined : parseStoreMoney(StoreId.D, p.compare_at),
      reductionStart: optional(p.promo_start),
      stockLabel: nonEmpty(p.stock_note),
    }),
  );
}

// --- E: an HTML-ish deal list -----------------------------------------------------------------

const E_ITEM = /<li class="deal" ([^>]*)>(.*?)<\/li>/g;
const E_ATTR = /data-([a-z]+)="([^"]*)"/g;

function unescapeHtml(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function inner(html: string, open: string, close: string): string | undefined {
  const start = html.indexOf(open);
  if (start < 0) return undefined;
  const end = html.indexOf(close, start + open.length);
  return end < 0 ? undefined : unescapeHtml(html.slice(start + open.length, end));
}

async function readStoreE(client: StoreClient): Promise<Offer[]> {
  const html = await getText(client, '/stores/e/deals');
  const offers = [...html.matchAll(E_ITEM)].map(([, attrText = '', body = '']) => {
    const attrMap = new Map<string, string>();
    for (const [, key = '', value = ''] of attrText.matchAll(E_ATTR)) attrMap.set(key, value);
    const attrs = {
      record: attrMap.get('record'),
      offer: attrMap.get('offer'),
      cat: attrMap.get('cat'),
      inches: attrMap.get('inches'),
    };
    const price = inner(body, '<span class="price">', '</span>');
    if (price === undefined) throw new StoreError(`store E: deal without a price: ${body}`);
    const was = inner(body, '<s class="was">', '</s>');
    return Offer.parse({
      recordId: attrs.record,
      offerId: attrs.offer,
      storeId: StoreId.E,
      title: inner(body, '<h3>', '</h3>'),
      category: attrs.cat === undefined ? undefined : unescapeHtml(attrs.cat),
      screenInches: attrs.inches === undefined ? undefined : Number(attrs.inches),
      price: parseStoreMoney(StoreId.E, price),
      wasPrice: was === undefined ? undefined : parseStoreMoney(StoreId.E, was),
      reductionStart: inner(body, '<time class="since">', '</time>'),
      stockLabel: nonEmpty(inner(body, '<b class="stock">', '</b>')),
    });
  });
  if (offers.length === 0) throw new StoreError('store E: no deals found in the page');
  return offers;
}

// ---------------------------------------------------------------------------------------------

const READERS: Record<StoreId, (client: StoreClient) => Promise<Offer[]>> = {
  a: readStoreA,
  b: readStoreB,
  c: readStoreC,
  d: readStoreD,
  e: readStoreE,
};

/** Reads a store's whole catalog in that store's own shape. Throws StoreError or ZodError. */
export function readCatalog(client: StoreClient, storeId: StoreId): Promise<Offer[]> {
  return READERS[storeId](client);
}
