import { formatEur, type Cents } from '@core/money';
import { StoreId, type Offer } from '@core/offers';

// How each store writes its answers. Five stores, five shapes, so each scout has real parsing
// to do (fix 4). Keep these fixed once the tools parse them: src/tools/ mirrors every shape.
//
//   A  clean JSON, prices in integer cents          GET /stores/a/products
//   B  paged JSON, prices as "585.00" strings       GET /stores/b/catalog?page=N
//   C  one line of messy text per product, "€599,00" GET /stores/c/listings
//   D  nested JSON, price objects; fees only at checkout  GET /stores/d/api/v2/catalog
//   E  an HTML-ish deal list, "EUR 559.00"          GET /stores/e/deals

/** Store B's page size: 8 offers make 3 pages. */
export const STORE_B_PAGE_SIZE = 3;

/** Each store's own way of writing an amount; price history and checkout use it too. */
export function formatStoreMoney(storeId: StoreId, amount: Cents): unknown {
  const plain = formatEur(amount).slice(1); // "585.00"
  switch (storeId) {
    case StoreId.A:
      return amount;
    case StoreId.B:
      return plain;
    case StoreId.C:
      return `€${plain.replace('.', ',')}`;
    case StoreId.D:
      return { amount, currency: 'EUR' };
    case StoreId.E:
      return `EUR ${plain}`;
  }
}

/** 2026-11-20 -> 20.11.2026, the way store C writes dates. */
function dottedDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

export function storeAProducts(offers: readonly Offer[]) {
  return {
    products: offers.map((o) => ({
      recordId: o.recordId,
      id: o.offerId,
      title: o.title,
      category: o.category,
      screenInches: o.screenInches ?? null,
      priceCents: o.price,
      wasPriceCents: o.wasPrice ?? null,
      saleStartsOn: o.reductionStart ?? null,
      stock: o.stockLabel ?? null,
    })),
  };
}

export function storeBCatalogPage(offers: readonly Offer[], page: number) {
  const totalPages = Math.max(1, Math.ceil(offers.length / STORE_B_PAGE_SIZE));
  const start = (page - 1) * STORE_B_PAGE_SIZE;
  return {
    page,
    totalPages,
    items: offers.slice(start, start + STORE_B_PAGE_SIZE).map((o) => ({
      ref: o.recordId,
      sku: o.offerId,
      name: o.title,
      type: o.category,
      ...(o.screenInches === undefined ? {} : { size_in: o.screenInches }),
      price_eur: formatStoreMoney(StoreId.B, o.price),
      ...(o.wasPrice === undefined
        ? {}
        : { list_price_eur: formatStoreMoney(StoreId.B, o.wasPrice) }),
      ...(o.reductionStart === undefined ? {} : { sale_from: o.reductionStart }),
      availability: o.stockLabel ?? '',
    })),
  };
}

export function storeCListings(offers: readonly Offer[]) {
  return {
    listings: offers.map((o) => {
      const price = String(formatStoreMoney(StoreId.C, o.price));
      const priceText =
        o.wasPrice === undefined || o.reductionStart === undefined
          ? price
          : `NOW ${price} (was ${String(formatStoreMoney(StoreId.C, o.wasPrice))}) since ${dottedDate(o.reductionStart)}`;
      const parts = [
        o.title,
        ...(o.screenInches === undefined ? [] : [`${o.screenInches} in`]),
        priceText,
        o.stockLabel ?? '',
      ];
      return { ref: o.recordId, sku: o.offerId, cat: o.category, text: parts.join(' | ') };
    }),
  };
}

export function storeDCatalog(offers: readonly Offer[]) {
  return {
    data: {
      products: offers.map((o) => ({
        offer_id: o.offerId,
        record_id: o.recordId,
        label: o.title,
        kind: o.category,
        inches: o.screenInches ?? null,
        price: formatStoreMoney(StoreId.D, o.price),
        compare_at: o.wasPrice === undefined ? null : formatStoreMoney(StoreId.D, o.wasPrice),
        promo_start: o.reductionStart ?? null,
        stock_note: o.stockLabel ?? null,
      })),
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function storeEDealsHtml(offers: readonly Offer[]): string {
  const items = offers.map((o) => {
    const attrs = [
      `data-offer="${o.offerId}"`,
      `data-record="${o.recordId}"`,
      `data-cat="${escapeHtml(o.category)}"`,
      ...(o.screenInches === undefined ? [] : [`data-inches="${o.screenInches}"`]),
    ].join(' ');
    const body = [
      `<h3>${escapeHtml(o.title)}</h3>`,
      `<span class="price">${String(formatStoreMoney(StoreId.E, o.price))}</span>`,
      ...(o.wasPrice === undefined
        ? []
        : [`<s class="was">${String(formatStoreMoney(StoreId.E, o.wasPrice))}</s>`]),
      ...(o.reductionStart === undefined ? [] : [`<time class="since">${o.reductionStart}</time>`]),
      `<b class="stock">${escapeHtml(o.stockLabel ?? '')}</b>`,
    ].join('');
    return `  <li class="deal" ${attrs}>${body}</li>`;
  });
  return `<!doctype html>\n<html><body>\n<h1>MegaFlash Outlet: today's deals</h1>\n<ul>\n${items.join('\n')}\n</ul>\n</body></html>\n`;
}
