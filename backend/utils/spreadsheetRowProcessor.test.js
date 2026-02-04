// backend/tests/spreadsheetRowProcessor.test.js
/**
 * Unit tests for spreadsheet row processing logic
 * 
 * Run with: npm test -- spreadsheetRowProcessor.test.js
 * Or with Jest: jest spreadsheetRowProcessor.test.js
 */

import {
  parseMultiValue,
  normalizeRow,
  matchesSearch,
  aggregateRowIntoProduct,
  getRowsForTemplate,
} from "./spreadsheetRowProcessor.js";

// ============================================================
// Test Data Fixtures
// ============================================================

const SAMPLE_COLUMNS = [
  { name: "Product ID", role: "product_id", multiValue: false },
  { name: "SKU", role: "sku", multiValue: false },
  { name: "Title", role: "product_title", multiValue: false },
  { name: "Category", role: "category", multiValue: false },
  { name: "Price", role: "price", multiValue: false },
  { name: "Main Image", role: "image_main", multiValue: true, separator: "," },
  { name: "Extra Images", role: "image_additional", multiValue: true, separator: ";" },
  { name: "Color", role: "attr_color", multiValue: false },
  { name: "Vendor Link", role: "vendor_link", multiValue: false },
];

const SAMPLE_ROWS_PER_PRODUCT = [
  // Row 2 (after header)
  ["P001", "SKU-001", "Silver Necklace", "Jewelry", "129.99", "https://img.com/a.jpg,https://img.com/b.jpg", "https://img.com/extra1.jpg;https://img.com/extra2.jpg", "Silver", "https://1688.com/p1"],
  // Row 3
  ["P002", "SKU-002", "Gold Ring", "Jewelry", "199.99", "https://img.com/c.jpg", "", "Gold", "https://1688.com/p2"],
  // Row 4
  ["P003", "SKU-003", "Pearl Earrings", "Accessories", "89.99", "https://img.com/d.jpg,https://img.com/e.jpg,https://img.com/f.jpg", "https://img.com/extra3.jpg", "White", "https://1688.com/p3"],
];

// For PER_IMAGE mode: multiple rows per product
const SAMPLE_ROWS_PER_IMAGE = [
  // Row 2: Product 1, Image 1
  ["P001", "SKU-001", "Silver Necklace", "Jewelry", "129.99", "https://img.com/a.jpg", "", "Silver", "https://1688.com/p1"],
  // Row 3: Product 1, Image 2
  ["P001", "SKU-001", "", "", "", "https://img.com/b.jpg", "", "", ""],
  // Row 4: Product 1, Image 3
  ["P001", "SKU-001", "", "", "", "https://img.com/c.jpg", "", "", ""],
  // Row 5: Product 2, Image 1
  ["P002", "SKU-002", "Gold Ring", "Jewelry", "199.99", "https://img.com/d.jpg", "", "Gold", "https://1688.com/p2"],
  // Row 6: Product 2, Image 2
  ["P002", "SKU-002", "", "", "", "https://img.com/e.jpg", "", "", ""],
];

// ============================================================
// parseMultiValue Tests
// ============================================================

describe("parseMultiValue", () => {
  test("returns single value array when multiValue is false", () => {
    const column = { name: "SKU", role: "sku", multiValue: false };
    const result = parseMultiValue("SKU-001", column);
    expect(result).toEqual(["SKU-001"]);
  });

  test("returns empty array for empty string", () => {
    const column = { name: "Image", role: "image_main", multiValue: true, separator: "," };
    const result = parseMultiValue("", column);
    expect(result).toEqual([]);
  });

  test("returns empty array for whitespace-only string", () => {
    const column = { name: "Image", role: "image_main", multiValue: true, separator: "," };
    const result = parseMultiValue("   ", column);
    expect(result).toEqual([]);
  });

  test("splits by comma separator", () => {
    const column = { name: "Image", role: "image_main", multiValue: true, separator: "," };
    const result = parseMultiValue("https://a.jpg,https://b.jpg,https://c.jpg", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg", "https://c.jpg"]);
  });

  test("splits by semicolon separator", () => {
    const column = { name: "Image", role: "image_additional", multiValue: true, separator: ";" };
    const result = parseMultiValue("https://a.jpg;https://b.jpg", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg"]);
  });

  test("trims whitespace from values", () => {
    const column = { name: "Image", role: "image_main", multiValue: true, separator: "," };
    const result = parseMultiValue("  https://a.jpg , https://b.jpg  ,  https://c.jpg  ", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg", "https://c.jpg"]);
  });

  test("filters out empty values after split", () => {
    const column = { name: "Image", role: "image_main", multiValue: true, separator: "," };
    const result = parseMultiValue("https://a.jpg,,https://b.jpg,  ,https://c.jpg", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg", "https://c.jpg"]);
  });

  test("uses comma as default separator when not specified", () => {
    const column = { name: "Image", role: "image_main", multiValue: true };
    const result = parseMultiValue("https://a.jpg,https://b.jpg", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg"]);
  });

  test("handles custom separator like pipe", () => {
    const column = { name: "Image", role: "image_main", multiValue: true, separator: "|" };
    const result = parseMultiValue("https://a.jpg|https://b.jpg|https://c.jpg", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg", "https://c.jpg"]);
  });
});

// ============================================================
// normalizeRow Tests
// ============================================================

describe("normalizeRow", () => {
  test("normalizes a complete row with all fields", () => {
    const result = normalizeRow(SAMPLE_ROWS_PER_PRODUCT[0], SAMPLE_COLUMNS, 2);

    expect(result.sourceRowIndex).toBe(2);
    expect(result.product_id).toBe("P001");
    expect(result.sku).toBe("SKU-001");
    expect(result.product_title).toBe("Silver Necklace");
    expect(result.category).toBe("Jewelry");
    expect(result.price).toBe(129.99);
    expect(result.attr_color).toBe("Silver");
    expect(result.vendor_link).toBe("https://1688.com/p1");
  });

  test("parses multiValue image columns into arrays", () => {
    const result = normalizeRow(SAMPLE_ROWS_PER_PRODUCT[0], SAMPLE_COLUMNS, 2);

    expect(result.image_main_urls).toEqual([
      "https://img.com/a.jpg",
      "https://img.com/b.jpg",
    ]);
    expect(result.image_additional_urls).toEqual([
      "https://img.com/extra1.jpg",
      "https://img.com/extra2.jpg",
    ]);
  });

  test("handles empty multiValue columns", () => {
    const result = normalizeRow(SAMPLE_ROWS_PER_PRODUCT[1], SAMPLE_COLUMNS, 3);

    expect(result.image_main_urls).toEqual(["https://img.com/c.jpg"]);
    expect(result.image_additional_urls).toEqual([]);
  });

  test("parses numeric fields correctly", () => {
    const columns = [
      { name: "Price", role: "price" },
      { name: "Quantity", role: "quantity" },
      { name: "Weight", role: "shipping_weight_grams" },
    ];
    const row = ["129.99", "50", "250.5"];
    const result = normalizeRow(row, columns, 2);

    expect(result.price).toBe(129.99);
    expect(result.quantity).toBe(50);
    expect(result.shipping_weight_grams).toBe(250.5);
  });

  test("returns null for invalid numeric values", () => {
    const columns = [
      { name: "Price", role: "price" },
      { name: "Quantity", role: "quantity" },
    ];
    const row = ["not-a-number", "abc"];
    const result = normalizeRow(row, columns, 2);

    expect(result.price).toBeNull();
    expect(result.quantity).toBeNull();
  });

  test("ignores columns with role=ignore", () => {
    const columns = [
      { name: "Title", role: "product_title" },
      { name: "Notes", role: "ignore" },
      { name: "SKU", role: "sku" },
    ];
    const row = ["My Product", "Internal notes here", "SKU-001"];
    const result = normalizeRow(row, columns, 2);

    expect(result.product_title).toBe("My Product");
    expect(result.sku).toBe("SKU-001");
    expect(result.notes).toBeUndefined();
  });

  test("ignores columns with null role", () => {
    const columns = [
      { name: "Title", role: "product_title" },
      { name: "Unknown", role: null },
    ];
    const row = ["My Product", "Some value"];
    const result = normalizeRow(row, columns, 2);

    expect(result.product_title).toBe("My Product");
    expect(Object.keys(result)).not.toContain("Unknown");
  });

  test("stores unknown roles in attributes", () => {
    const columns = [
      { name: "Title", role: "product_title" },
      { name: "Custom Field", role: "custom_field" },
    ];
    const row = ["My Product", "Custom Value"];
    const result = normalizeRow(row, columns, 2);

    expect(result.product_title).toBe("My Product");
    expect(result.attributes).toEqual({ custom_field: "Custom Value" });
  });

  test("handles missing cells gracefully", () => {
    const columns = [
      { name: "SKU", role: "sku" },
      { name: "Title", role: "product_title" },
      { name: "Price", role: "price" },
    ];
    const row = ["SKU-001"]; // Missing title and price
    const result = normalizeRow(row, columns, 2);

    expect(result.sku).toBe("SKU-001");
    expect(result.product_title).toBe("");
    expect(result.price).toBeNull();
  });
});

// ============================================================
// matchesSearch Tests
// ============================================================

describe("matchesSearch", () => {
  const sampleFields = {
    sku: "SKU-001",
    product_id: "P001",
    product_title: "Silver Necklace with Pearls",
    category: "Jewelry",
    vendor_name: "Acme Supplier",
    tags: "silver,necklace,gift",
    attr_color: "Silver",
    attr_material: "Sterling Silver",
    sourceRowIndex: 2,
  };

  test("returns true when query is empty", () => {
    expect(matchesSearch(sampleFields, "")).toBe(true);
    expect(matchesSearch(sampleFields, null)).toBe(true);
    expect(matchesSearch(sampleFields, undefined)).toBe(true);
  });

  test("matches SKU case-insensitively", () => {
    expect(matchesSearch(sampleFields, "sku-001")).toBe(true);
    expect(matchesSearch(sampleFields, "SKU-001")).toBe(true);
    expect(matchesSearch(sampleFields, "sku")).toBe(true);
  });

  test("matches product_id", () => {
    expect(matchesSearch(sampleFields, "P001")).toBe(true);
    expect(matchesSearch(sampleFields, "p001")).toBe(true);
  });

  test("matches product_title partially", () => {
    expect(matchesSearch(sampleFields, "Silver")).toBe(true);
    expect(matchesSearch(sampleFields, "Necklace")).toBe(true);
    expect(matchesSearch(sampleFields, "Pearls")).toBe(true);
    expect(matchesSearch(sampleFields, "silver neck")).toBe(true);
  });

  test("matches category", () => {
    expect(matchesSearch(sampleFields, "jewelry")).toBe(true);
    expect(matchesSearch(sampleFields, "Jewelry")).toBe(true);
  });

  test("matches vendor_name", () => {
    expect(matchesSearch(sampleFields, "Acme")).toBe(true);
    expect(matchesSearch(sampleFields, "supplier")).toBe(true);
  });

  test("matches tags", () => {
    expect(matchesSearch(sampleFields, "gift")).toBe(true);
    expect(matchesSearch(sampleFields, "silver")).toBe(true);
  });

  test("matches attr_color", () => {
    expect(matchesSearch(sampleFields, "silver")).toBe(true);
  });

  test("returns false for non-matching query", () => {
    expect(matchesSearch(sampleFields, "gold")).toBe(false);
    expect(matchesSearch(sampleFields, "xyz123")).toBe(false);
    expect(matchesSearch(sampleFields, "bracelet")).toBe(false);
  });

  test("handles fields with undefined values", () => {
    const sparseFields = {
      sku: "SKU-001",
      sourceRowIndex: 2,
    };
    expect(matchesSearch(sparseFields, "SKU-001")).toBe(true);
    expect(matchesSearch(sparseFields, "something")).toBe(false);
  });
});

// ============================================================
// aggregateRowIntoProduct Tests
// ============================================================

describe("aggregateRowIntoProduct", () => {
  test("creates new group for first row with SKU", () => {
    const groups = new Map();
    const fields = {
      sku: "SKU-001",
      product_id: "P001",
      product_title: "Silver Necklace",
      image_main_urls: ["https://img.com/a.jpg"],
      sourceRowIndex: 2,
    };

    aggregateRowIntoProduct(groups, fields, 2);

    expect(groups.size).toBe(1);
    expect(groups.has("SKU-001")).toBe(true);

    const agg = groups.get("SKU-001");
    expect(agg.key).toBe("SKU-001");
    expect(agg.rowIndices).toEqual([2]);
    expect(agg.fields.product_title).toBe("Silver Necklace");
    expect(agg.fields.image_main_urls).toEqual(["https://img.com/a.jpg"]);
  });

  test("uses product_id as fallback when SKU is missing", () => {
    const groups = new Map();
    const fields = {
      product_id: "P001",
      product_title: "Silver Necklace",
      sourceRowIndex: 2,
    };

    aggregateRowIntoProduct(groups, fields, 2);

    expect(groups.size).toBe(1);
    expect(groups.has("P001")).toBe(true);
  });

  test("skips rows without SKU or product_id", () => {
    const groups = new Map();
    const fields = {
      product_title: "Orphan Product",
      sourceRowIndex: 2,
    };

    aggregateRowIntoProduct(groups, fields, 2);

    expect(groups.size).toBe(0);
  });

  test("merges image arrays from subsequent rows", () => {
    const groups = new Map();

    // First row
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      product_title: "Silver Necklace",
      image_main_urls: ["https://img.com/a.jpg"],
      sourceRowIndex: 2,
    }, 2);

    // Second row - same SKU
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      image_main_urls: ["https://img.com/b.jpg"],
      sourceRowIndex: 3,
    }, 3);

    // Third row - same SKU
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      image_main_urls: ["https://img.com/c.jpg"],
      sourceRowIndex: 4,
    }, 4);

    const agg = groups.get("SKU-001");
    expect(agg.rowIndices).toEqual([2, 3, 4]);
    expect(agg.fields.image_main_urls).toEqual([
      "https://img.com/a.jpg",
      "https://img.com/b.jpg",
      "https://img.com/c.jpg",
    ]);
  });

  test("fills missing fields from subsequent rows", () => {
    const groups = new Map();

    // First row - missing some fields
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      product_title: "Silver Necklace",
      sourceRowIndex: 2,
    }, 2);

    // Second row - has category
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      category: "Jewelry",
      sourceRowIndex: 3,
    }, 3);

    // Third row - has price
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      price: 129.99,
      sourceRowIndex: 4,
    }, 4);

    const agg = groups.get("SKU-001");
    expect(agg.fields.product_title).toBe("Silver Necklace");
    expect(agg.fields.category).toBe("Jewelry");
    expect(agg.fields.price).toBe(129.99);
  });

  test("does not overwrite existing fields", () => {
    const groups = new Map();

    // First row with title
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      product_title: "Original Title",
      sourceRowIndex: 2,
    }, 2);

    // Second row with different title
    aggregateRowIntoProduct(groups, {
      sku: "SKU-001",
      product_title: "Different Title",
      sourceRowIndex: 3,
    }, 3);

    const agg = groups.get("SKU-001");
    expect(agg.fields.product_title).toBe("Original Title");
  });

  test("ensures SKU is set on aggregated product", () => {
    const groups = new Map();

    aggregateRowIntoProduct(groups, {
      product_id: "P001",
      product_title: "Product",
      sourceRowIndex: 2,
    }, 2);

    const agg = groups.get("P001");
    expect(agg.fields.sku).toBe("P001");
  });
});

// ============================================================
// getRowsForTemplate Tests - PER_PRODUCT Mode
// ============================================================

describe("getRowsForTemplate - PER_PRODUCT mode", () => {
  const template = {
    rowMode: "PER_PRODUCT",
    columns: SAMPLE_COLUMNS,
  };

  test("returns all rows with default pagination", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 20,
    });

    expect(result.rowMode).toBe("PER_PRODUCT");
    expect(result.total).toBe(3);
    expect(result.items.length).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  test("each item has rowIndex and fields", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 20,
    });

    expect(result.items[0].rowIndex).toBe(2);
    expect(result.items[0].fields.sku).toBe("SKU-001");
    expect(result.items[0].fields.product_title).toBe("Silver Necklace");

    expect(result.items[1].rowIndex).toBe(3);
    expect(result.items[1].fields.sku).toBe("SKU-002");

    expect(result.items[2].rowIndex).toBe(4);
    expect(result.items[2].fields.sku).toBe("SKU-003");
  });

  test("paginates correctly", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 2,
    });

    expect(result.total).toBe(3);
    expect(result.items.length).toBe(2);
    expect(result.items[0].fields.sku).toBe("SKU-001");
    expect(result.items[1].fields.sku).toBe("SKU-002");

    const result2 = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 2,
      pageSize: 2,
    });

    expect(result2.total).toBe(3);
    expect(result2.items.length).toBe(1);
    expect(result2.items[0].fields.sku).toBe("SKU-003");
  });

  test("filters by search query", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 20,
      search: "Gold",
    });

    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0].fields.product_title).toBe("Gold Ring");
  });

  test("search is case-insensitive", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 20,
      search: "JEWELRY",
    });

    expect(result.total).toBe(2); // Silver Necklace and Gold Ring
  });

  test("search filters by SKU", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 20,
      search: "SKU-002",
    });

    expect(result.total).toBe(1);
    expect(result.items[0].fields.sku).toBe("SKU-002");
  });

  test("returns empty items for no matches", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_PRODUCT, {
      page: 1,
      pageSize: 20,
      search: "nonexistent",
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });

  test("handles empty data", () => {
    const result = getRowsForTemplate(template, [], {
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });
});

// ============================================================
// getRowsForTemplate Tests - PER_IMAGE Mode
// ============================================================

describe("getRowsForTemplate - PER_IMAGE mode", () => {
  const template = {
    rowMode: "PER_IMAGE",
    columns: SAMPLE_COLUMNS,
  };

  test("aggregates multiple rows by SKU", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_IMAGE, {
      page: 1,
      pageSize: 20,
    });

    expect(result.rowMode).toBe("PER_IMAGE");
    expect(result.total).toBe(2); // 2 unique products
    expect(result.items.length).toBe(2);
  });

  test("each item has key, rowIndices, and fields", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_IMAGE, {
      page: 1,
      pageSize: 20,
    });

    const product1 = result.items.find((item) => item.key === "SKU-001");
    expect(product1).toBeDefined();
    expect(product1.key).toBe("SKU-001");
    expect(product1.rowIndices).toEqual([2, 3, 4]);
    expect(product1.fields.product_title).toBe("Silver Necklace");
    expect(product1.fields.sku).toBe("SKU-001");

    const product2 = result.items.find((item) => item.key === "SKU-002");
    expect(product2).toBeDefined();
    expect(product2.rowIndices).toEqual([5, 6]);
    expect(product2.fields.product_title).toBe("Gold Ring");
  });

  test("merges image URLs from multiple rows", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_IMAGE, {
      page: 1,
      pageSize: 20,
    });

    const product1 = result.items.find((item) => item.key === "SKU-001");
    expect(product1.fields.image_main_urls).toEqual([
      "https://img.com/a.jpg",
      "https://img.com/b.jpg",
      "https://img.com/c.jpg",
    ]);
  });

  test("filters aggregated products by search", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_IMAGE, {
      page: 1,
      pageSize: 20,
      search: "Gold",
    });

    expect(result.total).toBe(1);
    expect(result.items[0].fields.product_title).toBe("Gold Ring");
  });

  test("paginates aggregated products", () => {
    const result = getRowsForTemplate(template, SAMPLE_ROWS_PER_IMAGE, {
      page: 1,
      pageSize: 1,
    });

    expect(result.total).toBe(2);
    expect(result.items.length).toBe(1);

    const result2 = getRowsForTemplate(template, SAMPLE_ROWS_PER_IMAGE, {
      page: 2,
      pageSize: 1,
    });

    expect(result2.items.length).toBe(1);
    expect(result2.items[0].key).not.toBe(result.items[0].key);
  });

  test("ensures SKU is set even when using product_id as key", () => {
    const columnsWithoutSku = [
      { name: "Product ID", role: "product_id" },
      { name: "Title", role: "product_title" },
      { name: "Image", role: "image_main", multiValue: false },
    ];
    const rows = [
      ["P001", "Product 1", "https://img.com/a.jpg"],
      ["P001", "", "https://img.com/b.jpg"],
    ];

    const result = getRowsForTemplate(
      { rowMode: "PER_IMAGE", columns: columnsWithoutSku },
      rows,
      { page: 1, pageSize: 20 }
    );

    expect(result.items[0].key).toBe("P001");
    expect(result.items[0].fields.sku).toBe("P001");
  });
});

// ============================================================
// Edge Cases and Integration Tests
// ============================================================

describe("Edge Cases", () => {
  test("handles rows with only whitespace values", () => {
    const columns = [
      { name: "SKU", role: "sku" },
      { name: "Title", role: "product_title" },
    ];
    const rows = [["  ", "   "]];

    const result = getRowsForTemplate(
      { rowMode: "PER_PRODUCT", columns },
      rows,
      { page: 1, pageSize: 20 }
    );

    expect(result.items[0].fields.sku).toBe("");
    expect(result.items[0].fields.product_title).toBe("");
  });

  test("handles very long multiValue strings", () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://img.com/${i}.jpg`);
    const column = { name: "Images", role: "image_main", multiValue: true, separator: "," };

    const result = parseMultiValue(urls.join(","), column);
    expect(result.length).toBe(50);
    expect(result[0]).toBe("https://img.com/0.jpg");
    expect(result[49]).toBe("https://img.com/49.jpg");
  });

  test("handles special characters in separator", () => {
    const column = { name: "Images", role: "image_main", multiValue: true, separator: "||" };
    const result = parseMultiValue("https://a.jpg||https://b.jpg||https://c.jpg", column);
    expect(result).toEqual(["https://a.jpg", "https://b.jpg", "https://c.jpg"]);
  });

  test("handles unicode in values", () => {
    const columns = [
      { name: "Title", role: "product_title" },
      { name: "Category", role: "category" },
    ];
    const rows = [["S925纯银项链", "珠宝首饰"]];

    const result = getRowsForTemplate(
      { rowMode: "PER_PRODUCT", columns },
      rows,
      { page: 1, pageSize: 20, search: "纯银" }
    );

    expect(result.total).toBe(1);
    expect(result.items[0].fields.product_title).toBe("S925纯银项链");
  });

  test("defaults to PER_PRODUCT when rowMode is missing", () => {
    const columns = [{ name: "SKU", role: "sku" }];
    const rows = [["SKU-001"], ["SKU-002"]];

    const result = getRowsForTemplate(
      { columns }, // No rowMode specified
      rows,
      { page: 1, pageSize: 20 }
    );

    expect(result.rowMode).toBe("PER_PRODUCT");
    expect(result.items[0].rowIndex).toBeDefined();
  });

  test("handles empty columns array", () => {
    const result = getRowsForTemplate(
      { rowMode: "PER_PRODUCT", columns: [] },
      [["value1", "value2"]],
      { page: 1, pageSize: 20 }
    );

    expect(result.items.length).toBe(1);
    expect(result.items[0].fields.sourceRowIndex).toBe(2);
  });
});