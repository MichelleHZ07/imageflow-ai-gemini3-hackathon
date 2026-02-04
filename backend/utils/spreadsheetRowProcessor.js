// backend/utils/spreadsheetRowProcessor.js
/**
 * Pure functions for spreadsheet row processing
 * Extracted from /api/spreadsheets/:id/rows route for testability
 * 
 * This module contains no I/O - all functions are pure and take data as input.
 * 
 * IMPORTANT: Existing field roles must NOT be renamed or removed
 * Only ADD new field handling as needed
 */

/**
 * @typedef {Object} SpreadsheetColumnMeta
 * @property {string} name - Column header name
 * @property {string|null} role - Field role (e.g., "sku", "product_title", "image_url", "image_position")
 * @property {boolean} [multiValue] - Whether column contains multiple values
 * @property {string|null} [separator] - Separator for multi-value columns
 */

/**
 * @typedef {'PER_PRODUCT'|'PER_IMAGE'} RowMode
 */

/**
 * @typedef {Object} SpreadsheetTemplateLite
 * @property {RowMode} rowMode - Row structure mode
 * @property {SpreadsheetColumnMeta[]} columns - Column definitions
 */

/**
 * @typedef {Object} RowsQuery
 * @property {number} page - Page number (1-indexed)
 * @property {number} pageSize - Items per page
 * @property {string} [search] - Search query string
 */

/**
 * @typedef {Object} NormalizedRowFields
 * @property {string} [product_id]
 * @property {string} [sku]
 * @property {string} [product_title]
 * @property {string} [description]
 * @property {string} [category]
 * @property {string} [tags]
 * @property {string} [vendor_name]
 * @property {string} [vendor_link]
 * @property {string} [vendor_sku]
 * @property {number|null} [vendor_price]
 * @property {number|null} [price]
 * @property {number|null} [compare_at_price]
 * @property {number|null} [cost]
 * @property {number|null} [quantity]
 * @property {number|null} [shipping_weight_grams]
 * @property {string} [shipping_weight_unit]
 * @property {string} [attr_color]
 * @property {string} [attr_size]
 * @property {string} [attr_material]
 * @property {string} [attr_style]
 * @property {Array<{url: string, label: string, colIndex: number}>} [images] - Unified image array with original column name as label
 * @property {number|null} [image_position] - Image position for PER_IMAGE mode
 * @property {string} [seo_title]
 * @property {string} [seo_description]
 * @property {string} [geo_description]
 * @property {string} [gso_description]
 * @property {string} [ai_seo_description]
 * @property {string} [ai_geo_description]
 * @property {string} [ai_gso_description]
 * @property {string} [gso_category]
 * @property {string} [gso_gender]
 * @property {string} [gso_age_group]
 * @property {string} [gso_mpn]
 * @property {string} [gso_condition]
 * @property {string|boolean} [gso_is_custom]
 * @property {string} [gso_gtin]
 * @property {string} [gso_brand]
 * @property {string} [meta_title]
 * @property {string} [meta_description]
 * @property {string} [url_handle]
 * @property {Object.<string, string>} [attributes]
 * @property {number} sourceRowIndex
 */

/**
 * @typedef {Object} RowResultItem
 * @property {number} [rowIndex] - For PER_PRODUCT mode
 * @property {string} [key] - For PER_IMAGE mode: sku or product_id
 * @property {number[]} [rowIndices] - For PER_IMAGE mode: all underlying row indices
 * @property {NormalizedRowFields} fields
 */

/**
 * @typedef {Object} RowsResult
 * @property {number} page
 * @property {number} pageSize
 * @property {number} total
 * @property {RowMode} rowMode
 * @property {RowResultItem[]} items
 */

/**
 * Parse a cell value that may contain multiple values separated by a delimiter
 * @param {string} value - Cell value
 * @param {SpreadsheetColumnMeta} column - Column metadata
 * @returns {string[]} - Array of parsed values
 */
export function parseMultiValue(value, column) {
  const v = (value || "").trim();
  if (!v) return [];
  if (!column.multiValue) return [v];

  const sep = column.separator || ",";
  return v
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalize a single row to standard fields
 * SKU is always a first-class field
 * 
 * DO NOT remove existing case handlers - only ADD new ones
 * 
 * @param {string[]} rowData - Array of cell values for this row
 * @param {SpreadsheetColumnMeta[]} columns - Column definitions
 * @param {number} rowIndex - 1-indexed row number in the spreadsheet (including header)
 * @returns {NormalizedRowFields}
 */
export function normalizeRow(rowData, columns, rowIndex) {
  const fields = {
    sourceRowIndex: rowIndex,
  };

  columns.forEach((col, colIdx) => {
    const value = rowData[colIdx] !== undefined ? String(rowData[colIdx]).trim() : "";
    const role = col.role;

    if (!role || role === "ignore") return;

    switch (role) {
      // ============ EXISTING ROLES (DO NOT MODIFY) ============
      
      // Identity fields - SKU is first-class
      case "product_id":
        fields.product_id = value;
        break;
      case "sku":
        fields.sku = value;
        break;

      // Basic product info
      case "product_title":
        fields.product_title = value;
        break;
      case "description":
        fields.description = value;
        break;
      case "category":
        fields.category = value;
        break;
      case "tags":
        fields.tags = value;
        break;

      // Vendor / sourcing
      case "vendor_name":
        fields.vendor_name = value;
        break;
      case "vendor_link":
        fields.vendor_link = value;
        break;
      case "vendor_sku":
        fields.vendor_sku = value;
        break;
      case "vendor_price":
        fields.vendor_price = value ? parseFloat(value) || null : null;
        break;

      // Pricing
      case "price":
        fields.price = value ? parseFloat(value) || null : null;
        break;
      case "compare_at_price":
        fields.compare_at_price = value ? parseFloat(value) || null : null;
        break;
      case "cost":
        fields.cost = value ? parseFloat(value) || null : null;
        break;

      // Inventory
      case "quantity":
        fields.quantity = value ? parseInt(value, 10) || null : null;
        break;

      // Shipping
      case "shipping_weight_grams":
        fields.shipping_weight_grams = value ? parseFloat(value) || null : null;
        break;
      case "shipping_weight_unit":
        fields.shipping_weight_unit = value;
        break;

      // Attributes
      case "attr_color":
        fields.attr_color = value;
        break;
      case "attr_size":
        fields.attr_size = value;
        break;
      case "attr_material":
        fields.attr_material = value;
        break;
      case "attr_style":
        fields.attr_style = value;
        break;

      // Images - unified image_url role
      // Stores in images[] array with label (original column name) and colIndex
      case "image_url": {
        const urls = parseMultiValue(value, col);
        if (urls.length > 0) {
          if (!fields.images) fields.images = [];
          
          // Add to unified images array
          urls.forEach((url) => {
            fields.images.push({
              url: url,
              label: col.name,    // Original column name as category label
              colIndex: colIdx,   // Column position in spreadsheet
            });
          });
        }
        break;
      }

      // Image position (for PER_IMAGE mode)
      case "image_position":
        fields.image_position = value ? parseInt(value, 10) || null : null;
        break;

      // SEO (existing)
      case "seo_title":
        fields.seo_title = value;
        break;
      case "seo_description":
        fields.seo_description = value;
        break;

      // ============ NEW ROLES (Stage 5 Extension) ============

      // GEO/GSO descriptions (AI search & shopping)
      case "geo_description":
        fields.geo_description = value;
        break;
      case "gso_description":
        fields.gso_description = value;
        break;

      // AI-generated description outputs
      case "ai_seo_description":
        fields.ai_seo_description = value;
        break;
      case "ai_geo_description":
        fields.ai_geo_description = value;
        break;
      case "ai_gso_description":
        fields.ai_gso_description = value;
        break;

      // Google Shopping / GSO structured attributes
      case "gso_category":
        fields.gso_category = value;
        break;
      case "gso_brand":
        fields.gso_brand = value;
        break;
      case "gso_gtin":
        fields.gso_gtin = value;
        break;
      case "gso_mpn":
        fields.gso_mpn = value;
        break;
      case "gso_gender":
        fields.gso_gender = value;
        break;
      case "gso_age_group":
        fields.gso_age_group = value;
        break;
      case "gso_condition":
        fields.gso_condition = value;
        break;
      case "gso_is_custom":
        // Store as boolean if possible, otherwise as string
        if (value.toLowerCase() === "true" || value.toLowerCase() === "yes" || value === "1") {
          fields.gso_is_custom = true;
        } else if (value.toLowerCase() === "false" || value.toLowerCase() === "no" || value === "0") {
          fields.gso_is_custom = false;
        } else {
          fields.gso_is_custom = value || null;
        }
        break;

      // Additional SEO fields
      case "meta_title":
        fields.meta_title = value;
        break;
      case "meta_description":
        fields.meta_description = value;
        break;
      case "url_handle":
        fields.url_handle = value;
        break;

      // Fallback: store in attributes
      default:
        if (!fields.attributes) fields.attributes = {};
        fields.attributes[role] = value;
    }
  });

  return fields;
}

/**
 * Check if normalized fields match a search query
 * @param {NormalizedRowFields} fields - Normalized row fields
 * @param {string} query - Search query string
 * @returns {boolean}
 */
export function matchesSearch(fields, query) {
  if (!query) return true;

  const searchLower = query.toLowerCase();
  const searchableFields = [
    fields.sku,
    fields.product_id,
    fields.product_title,
    fields.category,
    fields.vendor_name,
    fields.tags,
    fields.attr_color,
    fields.attr_size,
    fields.attr_material,
    fields.attr_style,
    // New searchable fields
    fields.gso_brand,
    fields.gso_mpn,
    fields.gso_gtin,
    fields.url_handle,
  ];

  return searchableFields.some(
    (val) => val && String(val).toLowerCase().includes(searchLower)
  );
}

/**
 * List of all text fields that should be merged in PER_IMAGE mode
 * Add new text fields here as they are added to the schema
 */
const TEXT_FIELDS_TO_MERGE = [
  "product_title",
  "description",
  "category",
  "tags",
  "vendor_name",
  "vendor_link",
  "vendor_sku",
  "vendor_price",
  "price",
  "compare_at_price",
  "cost",
  "quantity",
  "shipping_weight_grams",
  "shipping_weight_unit",
  "attr_color",
  "attr_size",
  "attr_material",
  "attr_style",
  "seo_title",
  "seo_description",
  // New fields (Stage 5)
  "geo_description",
  "gso_description",
  "ai_seo_description",
  "ai_geo_description",
  "ai_gso_description",
  "gso_category",
  "gso_brand",
  "gso_gtin",
  "gso_mpn",
  "gso_gender",
  "gso_age_group",
  "gso_condition",
  "gso_is_custom",
  "meta_title",
  "meta_description",
  "url_handle",
];

/**
 * Aggregate multiple rows into a single product (for PER_IMAGE mode)
 * @param {Map<string, Object>} groups - Existing groups map
 * @param {NormalizedRowFields} fields - Fields from current row
 * @param {number} rowIndex - Row index
 * @param {string} groupByField - Field to group by: 'sku' or 'product_id'
 * @returns {void} - Mutates groups map
 */
export function aggregateRowIntoProduct(groups, fields, rowIndex, groupByField = "product_id") {
  // Use the specified groupByField to determine the grouping key
  // Default to product_id (which includes handle) for product-level grouping
  let key;
  const productId = fields.product_id || "";
  const sku = fields.sku || "";
  
  if (groupByField === "sku") {
    // Group by product_id + sku combination
    // This ensures variants from different products are NOT merged together
    // Example: "161349490278150753::银色" and "161349490278150791::银色" are DIFFERENT
    if (productId && sku) {
      key = `${productId}::${sku}`;
    } else {
      // Fallback: use whichever is available
      key = sku || productId;
    }
  } else {
    // groupByField === "product_id" (default)
    // Group all variants under the same product_id
    key = productId || sku;
  }

  if (!key) {
    // Skip rows without a grouping key
    return;
  }

  let agg = groups.get(key);

  if (!agg) {
    // First row for this product - use as base
    agg = {
      key,
      rowIndices: [],
      fields: { ...fields },
    };
    // Keep the original sku value from fields, don't overwrite with key
    // (key might be "product_id::sku" format which shouldn't be stored as sku)
    groups.set(key, agg);
  } else {
    // Merge images array from subsequent rows
    agg.fields.images = [
      ...(agg.fields.images || []),
      ...(fields.images || []),
    ];

    // Fill missing non-image fields from subsequent rows
    TEXT_FIELDS_TO_MERGE.forEach((fieldName) => {
      if (!agg.fields[fieldName] && fields[fieldName] !== undefined && fields[fieldName] !== null) {
        agg.fields[fieldName] = fields[fieldName];
      }
    });

    // Merge attributes
    if (fields.attributes) {
      agg.fields.attributes = {
        ...(agg.fields.attributes || {}),
        ...fields.attributes,
      };
    }
  }

  agg.rowIndices.push(rowIndex);
}

/**
 * Process raw spreadsheet data and return normalized, paginated results
 * 
 * @param {SpreadsheetTemplateLite} template - Template with rowMode and columns
 * @param {string[][]} rawRows - Raw data rows (WITHOUT header row)
 * @param {RowsQuery} query - Query parameters for filtering and pagination
 * @returns {RowsResult}
 */
export function getRowsForTemplate(template, rawRows, query) {
  const { page = 1, pageSize = 20, search = "" } = query;
  const columns = template.columns || [];
  const rowMode = template.rowMode || "PER_PRODUCT";
  const searchQuery = (search || "").trim();

  let items = [];
  let total = 0;

  if (rowMode === "PER_PRODUCT") {
    // ============ PER_PRODUCT MODE ============
    // Each row is one product, normalize and return directly
    const normalizedRows = rawRows.map((row, idx) => ({
      rowIndex: idx + 2, // +2 because: 0-indexed + skip header
      fields: normalizeRow(row, columns, idx + 2),
    }));

    // Filter by search
    const filteredRows = searchQuery
      ? normalizedRows.filter((item) => matchesSearch(item.fields, searchQuery))
      : normalizedRows;

    total = filteredRows.length;

    // Paginate
    const startIdx = (page - 1) * pageSize;
    items = filteredRows.slice(startIdx, startIdx + pageSize);

  } else {
    // ============ PER_IMAGE MODE ============
    // Multiple rows per product, aggregate by specified groupByField
    const groups = new Map();
    const groupByField = template.groupByField || "product_id";

    rawRows.forEach((row, idx) => {
      const rowIndex = idx + 2;
      const fields = normalizeRow(row, columns, rowIndex);
      aggregateRowIntoProduct(groups, fields, rowIndex, groupByField);
    });

    // Convert to array
    const aggregatedProducts = Array.from(groups.values());

    // Filter by search
    const filteredProducts = searchQuery
      ? aggregatedProducts.filter((item) => matchesSearch(item.fields, searchQuery))
      : aggregatedProducts;

    total = filteredProducts.length;

    // Paginate
    const startIdx = (page - 1) * pageSize;
    items = filteredProducts.slice(startIdx, startIdx + pageSize);
  }

  return {
    page,
    pageSize,
    total,
    rowMode,
    items,
  };
}

/**
 * Get raw rows grouped by product key (for export purposes)
 * Returns original row data without normalization
 * 
 * @param {string[][]} rawRows - Raw data rows (WITHOUT header row)
 * @param {SpreadsheetColumnMeta[]} columns - Column definitions
 * @returns {Map<string, Array<{index: number, data: string[]}>>}
 */
export function groupRawRowsByProductKey(rawRows, columns) {
  const groups = new Map();
  
  // Find key column indices
  const skuIdx = columns.findIndex((c) => c.role === "sku");
  const productIdIdx = columns.findIndex((c) => c.role === "product_id");

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    
    // Get product key
    let key = null;
    if (skuIdx >= 0 && row[skuIdx]) {
      key = String(row[skuIdx]).trim();
    } else if (productIdIdx >= 0 && row[productIdIdx]) {
      key = String(row[productIdIdx]).trim();
    }

    if (!key) {
      // Row without key - store separately
      if (!groups.has("__NO_KEY__")) {
        groups.set("__NO_KEY__", []);
      }
      groups.get("__NO_KEY__").push({ index: i, data: row });
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push({ index: i, data: row });
  }

  return groups;
}

/**
 * Find column index by role
 * Utility for export operations
 * 
 * @param {SpreadsheetColumnMeta[]} columns - Column definitions
 * @param {string} role - Role to find
 * @returns {number} - Column index or -1 if not found
 */
export function findColumnIndexByRole(columns, role) {
  return columns.findIndex((c) => c.role === role);
}

/**
 * Get all roles that are mapped in a template
 * @param {SpreadsheetColumnMeta[]} columns - Column definitions
 * @returns {string[]} - Array of mapped roles
 */
export function getMappedRoles(columns) {
  return columns
    .map((c) => c.role)
    .filter((role) => role && role !== "ignore");
}

/**
 * Check if a template has a specific role mapped
 * @param {SpreadsheetColumnMeta[]} columns - Column definitions
 * @param {string} role - Role to check
 * @returns {boolean}
 */
export function hasRole(columns, role) {
  return columns.some((c) => c.role === role);
}

export default {
  parseMultiValue,
  normalizeRow,
  matchesSearch,
  aggregateRowIntoProduct,
  getRowsForTemplate,
  groupRawRowsByProductKey,
  findColumnIndexByRole,
  getMappedRoles,
  hasRole,
};