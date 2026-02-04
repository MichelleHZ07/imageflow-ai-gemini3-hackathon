/**
 * Spreadsheet Results Routes
 * 
 * Handles saving and retrieving generated image results for spreadsheet products.
 * These results are stored as an "overlay" layer in Firestore, separate from the
 * original uploaded spreadsheet data.
 * 
 * File location: backend/routes/spreadsheetResults.js
 * 
 * Firestore structure:
 *   /users/{userId}/spreadsheetResults/{templateId}/scenarios/{scenarioId}
 * 
 * Phase 2 (Cross-Spreadsheet Save):
 *   - POST /results now accepts optional targetTemplateId to save to a different template
 *   - POST /export-overrides now accepts optional sourceTemplateId for audit trail
 *   - When cross-saving, data is stored under the target template's spreadsheetResults
 *   - sourceTemplateId is recorded for audit/debugging purposes
 * 
 * ✅ Storage Migration: Now reads spreadsheet files from Firebase Storage instead of local filesystem
 */

import { Router } from "express";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import XLSX from "xlsx";
import { parse as csvParse } from "csv-parse/sync";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { getSpreadsheetById } from "../utils/spreadsheetStore.js";

// ✅ 新增: 导入 Storage 服务
import {
  downloadSpreadsheetFromStorage,
} from "../services/spreadsheetStorageService.js";

const router = Router();
const db = admin.firestore();

// ============ Helper Functions ============

/**
 * Parse spreadsheet buffer into 2D array
 * ✅ 修改: 从 parseSpreadsheetFile 改为 parseSpreadsheetBuffer
 */
function parseSpreadsheetBuffer(buffer, fileType) {
  if (fileType === "Excel") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  } else {
    const csvContent = buffer.toString("utf-8");
    return csvParse(csvContent, {
      skip_empty_lines: true,
      relax_column_count: true,
    });
  }
}

/**
 * Find column index by role
 */
function findColumnIndexByRole(columns, role) {
  return columns.findIndex((c) => c.role === role);
}

/**
 * Convert category token to column name.
 * Token format: "col:Column Name" -> "Column Name"
 */
function getCategoryFromToken(token) {
  if (!token) return "Image";
  
  // Handle column-based token format: "col:Column Name"
  if (token.startsWith("col:")) {
    return token.substring(4);
  }
  
  // Token is already a column name
  return token;
}

/**
 * Check if an export override represents a new product
 * New products have isNewProduct: true, productId, sku, and addPosition
 */
function isNewProductOverride(override) {
  return override && 
    override.isNewProduct === true && 
    override.productId && 
    override.sku;
}

/**
 * Create a new row for a new product (PER_PRODUCT mode)
 * @param {Array} headerRow - The header row for column count reference
 * @param {Array} columns - Template column definitions
 * @param {Object} override - The new product override data
 * @param {Array} imageUrlColumns - Array of image column info
 * @param {Object} descTypeToColumnIdx - Map of description type to column index
 * @param {Object} descriptionOverrides - Description overrides map
 */
function createNewProductRow(headerRow, columns, override, imageUrlColumns, descTypeToColumnIdx, descriptionOverrides) {
  // Create empty row with same column count as header
  const row = new Array(headerRow.length).fill("");
  
  // Set product_id
  const productIdIdx = findColumnIndexByRole(columns, "product_id");
  if (productIdIdx >= 0) {
    row[productIdIdx] = override.productId;
  }
  
  // Set SKU
  const skuIdx = findColumnIndexByRole(columns, "sku");
  if (skuIdx >= 0) {
    row[skuIdx] = override.sku;
  }
  
  // Set images by category
  const images = override.images || [];
  const categories = override.categories || [];
  
  // Group images by category (column name)
  const imagesByColumn = {};
  for (const { columnName } of imageUrlColumns) {
    imagesByColumn[columnName] = [];
  }
  
  for (let i = 0; i < images.length; i++) {
    const category = getCategoryFromToken(categories[i]);
    if (imagesByColumn[category] !== undefined) {
      imagesByColumn[category].push(images[i]);
    } else if (imageUrlColumns.length > 0) {
      imagesByColumn[imageUrlColumns[0].columnName].push(images[i]);
    }
  }
  
  // Write to each image column
  for (const { colIndex, columnName, separator } of imageUrlColumns) {
    const urls = imagesByColumn[columnName] || [];
    row[colIndex] = urls.join(separator || ",") || "";
  }
  
  // Apply description overrides
  const productKey = `${override.productId}::${override.sku}`;
  const descOverride = descriptionOverrides[productKey];
  if (descOverride) {
    for (const [descType, content] of Object.entries(descOverride)) {
      if (content && typeof content === 'string') {
        const colIdx = descTypeToColumnIdx[descType];
        if (colIdx !== undefined && colIdx >= 0) {
          row[colIdx] = content;
        }
      }
    }
  }
  
  return row;
}

/**
 * Get product key from row data based on column mappings
 * (Legacy function - use getProductKeyForExport for PER_IMAGE mode)
 */
function getProductKeyFromRow(rowData, columns) {
  const skuIdx = findColumnIndexByRole(columns, "sku");
  const productIdIdx = findColumnIndexByRole(columns, "product_id");
  
  if (skuIdx >= 0 && rowData[skuIdx]) {
    return String(rowData[skuIdx]).trim();
  }
  if (productIdIdx >= 0 && rowData[productIdIdx]) {
    return String(rowData[productIdIdx]).trim();
  }
  return null;
}

/**
 * Get product key for PER_IMAGE mode export - matches frontend logic
 * Uses groupByField to determine how to build the key:
 * - If groupByField is 'product_id': use product_id only
 * - If groupByField is 'sku': use sku only  
 * - Otherwise (or if groupByField maps to sku): use product_id::sku format
 */
function getProductKeyForExport(rowData, columns, groupByField) {
  const skuIdx = findColumnIndexByRole(columns, "sku");
  const productIdIdx = findColumnIndexByRole(columns, "product_id");
  
  const productId = productIdIdx >= 0 ? String(rowData[productIdIdx] || "").trim() : "";
  const sku = skuIdx >= 0 ? String(rowData[skuIdx] || "").trim() : "";
  
  // Match frontend logic for building productKey
  if (groupByField === "product_id") {
    // Group by product_id only
    return productId || null;
  } else if (groupByField === "sku") {
    // If groupByField is sku, we need product_id::sku format to distinguish products
    // This matches frontend behavior where sku-based grouping still uses composite key
    if (productId && sku) {
      return `${productId}::${sku}`;
    }
    return sku || productId || null;
  } else {
    // Default: use product_id::sku format if both exist
    if (productId && sku) {
      return `${productId}::${sku}`;
    }
    return productId || sku || null;
  }
}

/**
 * Apply scenarios to get final image URLs for a product
 */
function applyScenarios(originalUrls, scenarios) {
  if (!scenarios || scenarios.length === 0) {
    return [...originalUrls];
  }

  // Sort by createdAt ascending (oldest first)
  const sorted = [...scenarios].sort((a, b) => a.createdAt - b.createdAt);

  let result = [...originalUrls];

  for (const scenario of sorted) {
    const newImages = scenario.imageUrls || [];

    if (scenario.mode === "REPLACE_ALL_IMAGES_PER_PRODUCT" ||
        scenario.mode === "REPLACE_ALL_ROWS_PER_IMAGE") {
      result = [...newImages];
    } else if (scenario.mode === "APPEND_IMAGES_PER_PRODUCT" ||
               scenario.mode === "APPEND_ROWS_PER_IMAGE") {
      result = [...result, ...newImages];
    }
  }

  return result;
}

/**
 * CSV-safe encoding
 */
function csvSafe(value) {
  const v = String(value ?? "");
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * Update template's updatedAt timestamp
 * Called when scenarios, export-overrides, or description-overrides are saved
 * This ensures the template list sorts correctly by most recent activity
 */
async function updateTemplateTimestamp(userId, templateId) {
  try {
    const templateRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheets")
      .doc(templateId);
    
    await templateRef.update({
      updatedAt: Date.now(),
    });
    
    console.log(`[SpreadsheetResults] Updated template timestamp for ${templateId}`);
  } catch (err) {
    // Log but don't fail the main operation
    console.warn(`[SpreadsheetResults] Failed to update template timestamp for ${templateId}:`, err.message);
  }
}

/**
 * Generate real BIFF8 .xls file using Python xlwt
 * This avoids the 255 character cell limit that SheetJS has
 * 
 * @param {Array<Array>} rows - 2D array of data (including header row)
 * @returns {Buffer} - XLS file buffer
 */
function generateRealXls(rows) {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  const jsonPath = path.join(tempDir, `xls_data_${timestamp}.json`);
  const xlsPath = path.join(tempDir, `output_${timestamp}.xls`);
  
  try {
    // Write data to JSON file
    fs.writeFileSync(jsonPath, JSON.stringify({ rows }), 'utf-8');
    
    // Get the path to the Python script (same directory as this file)
    const scriptPath = path.join(__dirname, 'generate_xls.py');
    
    console.log(`[generateRealXls] Looking for Python script at: ${scriptPath}`);
    
    // Check if Python script exists
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Python script not found at ${scriptPath}. Please ensure generate_xls.py is in the routes directory.`);
    }
    
    // Execute Python script
    const result = execSync(`python3 "${scriptPath}" "${jsonPath}" "${xlsPath}"`, {
      encoding: 'utf-8',
      timeout: 30000, // 30 second timeout
    });
    
    console.log(`[generateRealXls] Python output: ${result.trim()}`);
    
    // Read the generated XLS file
    const xlsBuffer = fs.readFileSync(xlsPath);
    
    return xlsBuffer;
  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
      if (fs.existsSync(xlsPath)) fs.unlinkSync(xlsPath);
    } catch (cleanupErr) {
      console.error('[generateRealXls] Cleanup error:', cleanupErr);
    }
  }
}

// ============ Routes ============

/**
 * POST /api/spreadsheets/:templateId/results
 * 
 * Save generated images for a product in the spreadsheet overlay.
 */
router.post("/spreadsheets/:templateId/results", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: "Missing templateId",
      });
    }

    const {
      productKey,
      rowMode,
      mode,
      imageUrls,
      rowIndices,
      generationId,
      // Phase 2: Cross-spreadsheet save support
      targetTemplateId,  // Optional: save to different spreadsheet
      writeMode,         // Optional: "add" | "override"
    } = req.body;

    if (!productKey || typeof productKey !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid productKey",
      });
    }

    if (!rowMode || !["PER_PRODUCT", "PER_IMAGE"].includes(rowMode)) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid rowMode",
      });
    }

    const validModes = [
      "REPLACE_ALL_IMAGES_PER_PRODUCT",
      "APPEND_IMAGES_PER_PRODUCT",
      "REPLACE_ALL_ROWS_PER_IMAGE",
      "APPEND_ROWS_PER_IMAGE",
    ];
    if (!mode || !validModes.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid mode",
      });
    }

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "imageUrls must be a non-empty array",
      });
    }

    // Phase 2: Determine effective template ID for storage
    const isCrossSave = targetTemplateId && targetTemplateId !== templateId;
    const effectiveTemplateId = targetTemplateId || templateId;

    // Validate target template exists if cross-save
    if (isCrossSave) {
      const targetTemplate = await getSpreadsheetById(userId, targetTemplateId);
      if (!targetTemplate) {
        return res.status(404).json({
          success: false,
          error: "Target spreadsheet not found",
        });
      }
      console.log(`[SpreadsheetResults] Cross-save from ${templateId} to ${targetTemplateId}`);
    }

    const scenarioData = {
      templateId: effectiveTemplateId,  // Store under target template
      userId,
      productKey,
      rowMode,
      mode,
      imageUrls,
      createdAt: Date.now(),
      ...(rowIndices && { rowIndices }),
      ...(generationId && { generationId }),
      // Phase 2: Track cross-save info for audit
      ...(isCrossSave && {
        sourceTemplateId: templateId,
        writeMode: writeMode || "add",
      }),
    };

    // Save to effective (target) template's scenarios collection
    const scenariosRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(effectiveTemplateId)
      .collection("scenarios");

    const docRef = await scenariosRef.add(scenarioData);

    const scenario = {
      id: docRef.id,
      ...scenarioData,
    };

    console.log(
      `[SpreadsheetResults] Saved scenario ${docRef.id} for product ${productKey} in template ${effectiveTemplateId}` +
      (isCrossSave ? ` (cross-save from ${templateId})` : "")
    );

    // Update template timestamp so it sorts to top in template list
    await updateTemplateTimestamp(userId, effectiveTemplateId);

    return res.status(201).json({
      success: true,
      id: docRef.id,
      scenario,
      ...(isCrossSave && { 
        sourceTemplateId: templateId,
        targetTemplateId: effectiveTemplateId,
      }),
    });

  } catch (err) {
    console.error("[SpreadsheetResults] POST error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * GET /api/spreadsheets/:templateId/results
 * 
 * Get all saved result scenarios for a spreadsheet template.
 */
router.get("/spreadsheets/:templateId/results", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];
    const { productKey } = req.query;

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    if (!templateId) {
      return res.status(400).json({
        success: false,
        error: "Missing templateId",
      });
    }

    let query = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId)
      .collection("scenarios")
      .orderBy("createdAt", "desc");

    if (productKey && typeof productKey === "string") {
      query = query.where("productKey", "==", productKey);
    }

    const snapshot = await query.get();

    const scenarios = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.log(`[SpreadsheetResults] Retrieved ${scenarios.length} scenarios for template ${templateId}`);

    return res.json({
      success: true,
      scenarios,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] GET error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * DELETE /api/spreadsheets/:templateId/results/:scenarioId
 * 
 * Delete a specific result scenario.
 */
router.delete("/spreadsheets/:templateId/results/:scenarioId", async (req, res) => {
  try {
    const { templateId, scenarioId } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId)
      .collection("scenarios")
      .doc(scenarioId);

    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: "Scenario not found",
      });
    }

    await docRef.delete();

    console.log(`[SpreadsheetResults] Deleted scenario ${scenarioId} from template ${templateId}`);

    return res.json({
      success: true,
      deleted: scenarioId,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] DELETE error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * DELETE /api/spreadsheets/:templateId/results?productKey=XXX
 * 
 * Delete all scenarios for a specific product (restore to original).
 */
router.delete("/spreadsheets/:templateId/results", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { productKey } = req.query;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    if (!productKey || typeof productKey !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid productKey query parameter",
      });
    }

    const scenariosRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId)
      .collection("scenarios");

    const snapshot = await scenariosRef
      .where("productKey", "==", productKey)
      .get();

    if (snapshot.empty) {
      return res.json({
        success: true,
        deleted: 0,
        message: "No scenarios found for this product",
      });
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    const deletedCount = snapshot.docs.length;
    console.log(`[SpreadsheetResults] Restored product ${productKey}: deleted ${deletedCount} scenarios from template ${templateId}`);

    return res.json({
      success: true,
      deleted: deletedCount,
      productKey,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] DELETE by productKey error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * POST /api/spreadsheets/:templateId/export
 * 
 * Export spreadsheet with results as CSV.
 * Maintains original table structure, only updates image-related columns.
 * 
 * ✅ 修改: 从 Firebase Storage 读取文件
 * 
 * Body:
 *   {
 *     onlyUpdated?: boolean,       // Only export products with updates
 *     dedupeImages?: boolean,      // Remove duplicate image URLs
 *     exportOverrides?: {          // Frontend-specified image overrides
 *       [productKey: string]: string[]
 *     }
 *   }
 */
router.post("/spreadsheets/:templateId/export", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const {
      onlyUpdated = false,
      dedupeImages = false,
      exportOverrides = {},
    } = req.body || {};

    // 1. Load template
    const template = await getSpreadsheetById(userId, templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: "Spreadsheet template not found",
      });
    }

    const columns = template.columns || [];
    const rowMode = template.rowMode || "PER_PRODUCT";
    const groupByField = template.groupByField || "product_id";

    // 1.5 Load description overrides from Firestore
    let descriptionOverrides = {};
    try {
      const resultsDoc = await db
        .collection("users")
        .doc(userId)
        .collection("spreadsheetResults")
        .doc(templateId)
        .get();
      
      if (resultsDoc.exists) {
        descriptionOverrides = resultsDoc.data().descriptionOverrides || {};
      }
    } catch (err) {
      console.error("[Export] Failed to load descriptionOverrides:", err);
    }

    // ✅ 修改: 从 Firebase Storage 下载文件（替代本地文件系统）
    let fileBuffer;
    try {
      fileBuffer = await downloadSpreadsheetFromStorage(template.storagePath);
    } catch (err) {
      console.error(`[Export] Failed to download spreadsheet: ${template.storagePath}`, err.message);
      return res.status(404).json({
        success: false,
        error: "Spreadsheet file not found in storage. Please re-upload.",
      });
    }

    const rawData = parseSpreadsheetBuffer(fileBuffer, template.fileType);
    if (rawData.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Spreadsheet has no data rows",
      });
    }

    const headerRow = rawData[0];
    const dataRows = rawData.slice(1);

    // 3. Load all scenarios
    const scenariosSnapshot = await db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId)
      .collection("scenarios")
      .get();

    const scenarios = scenariosSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Group scenarios by productKey
    const scenariosByProduct = new Map();
    for (const scenario of scenarios) {
      if (!scenariosByProduct.has(scenario.productKey)) {
        scenariosByProduct.set(scenario.productKey, []);
      }
      scenariosByProduct.get(scenario.productKey).push(scenario);
    }

    // 4. Find column indices
    // NEW: Find all image_url columns (unified image format)
    const imageUrlColumns = columns
      .map((col, idx) => ({ col, idx }))
      .filter(({ col }) => col.role === "image_url")
      .map(({ col, idx }) => ({ 
        colIndex: idx, 
        columnName: col.name,  // Use original column name as category
        multiValue: col.multiValue || false,
        separator: col.separator || ",",
      }));
    
    const imagePositionIdx = findColumnIndexByRole(columns, "image_position");
    
    // Description column indices
    const seoDescIdx = findColumnIndexByRole(columns, "seo_description");
    const geoDescIdx = findColumnIndexByRole(columns, "geo_description");
    const gsoDescIdx = findColumnIndexByRole(columns, "gso_description");
    // Phase 2: Extended description field indices
    const tagsIdx = findColumnIndexByRole(columns, "tags");
    const seoTitleIdx = findColumnIndexByRole(columns, "seo_title");
    const metaTitleIdx = findColumnIndexByRole(columns, "meta_title");
    const metaDescIdx = findColumnIndexByRole(columns, "meta_description");
    
    // Build a map from descriptionType to column index for dynamic field support
    // This includes both standard fields and any custom fields mapped in the template
    const descTypeToColumnIdx = {};
    // Standard fields mapping (descriptionType -> role)
    const standardDescTypeRoles = {
      seo: "seo_description",
      geo: "geo_description", 
      gso: "gso_description",
      tags: "tags",
      seo_title: "seo_title",
      meta_title: "meta_title",
      meta_description: "meta_description",
    };
    // Add standard fields
    for (const [descType, role] of Object.entries(standardDescTypeRoles)) {
      const idx = findColumnIndexByRole(columns, role);
      if (idx >= 0) {
        descTypeToColumnIdx[descType] = idx;
      }
    }
    // Add custom fields (role is used directly as descType)
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col.role && !Object.values(standardDescTypeRoles).includes(col.role)) {
        // This is a custom field, map role directly to column index
        descTypeToColumnIdx[col.role] = i;
      }
    }
    console.log("[Export] descTypeToColumnIdx:", descTypeToColumnIdx);

    // 5. Build export rows based on rowMode
    const exportRows = [];
    
    // Global dedupe set - tracks URLs across ALL products
    const globalSeen = new Set();

    if (rowMode === "PER_PRODUCT") {
      // ============ PER_PRODUCT MODE ============
      // Each row is one product, update image columns with final URLs
      // For PER_PRODUCT, use row-based key (row-2, row-3, etc.) to match frontend
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = [...dataRows[i]]; // Clone row
        
        // For PER_PRODUCT mode, use row-based key to match frontend's getProductKey()
        // rowIndex = i + 2 because: row 0 = header, row 1 would be index 0 in dataRows
        // but frontend uses 1-indexed rows, so first data row is row-2
        const rowIndex = i + 2;
        const productKey = `row-${rowIndex}`;
        
        // Also get SKU for fallback lookup (in case old data uses SKU as key)
        const skuKey = getProductKeyFromRow(row, columns);

        const hasScenarios = scenariosByProduct.has(productKey) || (skuKey && scenariosByProduct.has(skuKey));
        const hasOverride = (productKey in exportOverrides) || (skuKey && skuKey in exportOverrides);

        // Skip if onlyUpdated and no changes
        if (onlyUpdated && !hasScenarios && !hasOverride) {
          continue;
        }

        // Get original images from row - track counts per category for position-based export
        // For image_url columns: { columnName: urls[] }
        const originalUrlsByColumnName = {};
        
        // Read from image_url columns
        for (const { colIndex, columnName, multiValue, separator } of imageUrlColumns) {
          const cellVal = String(row[colIndex] || "").trim();
          if (cellVal) {
            if (multiValue && separator) {
              originalUrlsByColumnName[columnName] = cellVal.split(separator).map(s => s.trim()).filter(Boolean);
            } else {
              originalUrlsByColumnName[columnName] = [cellVal];
            }
          } else {
            originalUrlsByColumnName[columnName] = [];
          }
        }
        
        // Flatten all URLs (preserve order by column index)
        const originalUrls = imageUrlColumns.flatMap(({ columnName }) => originalUrlsByColumnName[columnName] || []);

        // Calculate final URLs for PER_PRODUCT mode
        // Try row-based key first, then fall back to SKU key for backward compatibility
        // exportOverrides can be either:
        // - Old format: { [key]: string[] }
        // - New format: { [key]: { images: string[], categories: string[] } }
        let finalUrls;
        let savedCategories = null;  // If we have saved categories, use them for splitting
        
        const getOverrideData = (key) => {
          const data = exportOverrides[key];
          if (!data) return null;
          // New format: { images, categories }
          if (data.images && Array.isArray(data.images)) {
            return {
              urls: data.images,
              categories: data.categories || null,
            };
          }
          // Old format: string[]
          if (Array.isArray(data)) {
            return {
              urls: data,
              categories: null,
            };
          }
          return null;
        };
        
        let overrideData = getOverrideData(productKey);
        if (!overrideData && skuKey) {
          overrideData = getOverrideData(skuKey);
          if (overrideData) {
            console.log(`[Export] Using SKU key "${skuKey}" for row ${rowIndex} (fallback)`);
          }
        }
        
        if (overrideData) {
          finalUrls = overrideData.urls;
          savedCategories = overrideData.categories;
        } else if (scenariosByProduct.has(productKey)) {
          finalUrls = applyScenarios(originalUrls, scenariosByProduct.get(productKey));
        } else if (skuKey && scenariosByProduct.has(skuKey)) {
          console.log(`[Export] Using SKU key "${skuKey}" scenarios for row ${rowIndex} (fallback)`);
          finalUrls = applyScenarios(originalUrls, scenariosByProduct.get(skuKey));
        } else {
          finalUrls = originalUrls;
        }

        // Apply GLOBAL dedupe if enabled - each URL only appears once across entire spreadsheet
        // Note: dedupe removes from saved categories order, so we need to update categories too
        if (dedupeImages) {
          const filtered = [];
          const filteredCategories = savedCategories ? [] : null;
          for (let i = 0; i < finalUrls.length; i++) {
            const url = finalUrls[i];
            if (!url) continue;
            if (globalSeen.has(url)) continue; // Skip if already used by another product
            globalSeen.add(url);
            filtered.push(url);
            if (filteredCategories && savedCategories[i]) {
              filteredCategories.push(savedCategories[i]);
            }
          }
          finalUrls = filtered;
          savedCategories = filteredCategories;
        }

        // Update row with final URLs
        // If we have saved categories, use them to distribute images
        // Otherwise, use position-based assignment with original sizes
        
        // Use imageUrlColumns and category tokens (col:ColumnName)
        const finalUrlsByColumnName = {};
        
        // Initialize all columns
        for (const { columnName } of imageUrlColumns) {
          finalUrlsByColumnName[columnName] = [];
        }
        
        if (savedCategories && savedCategories.length === finalUrls.length) {
          // Use saved categories to distribute images
          for (let i = 0; i < finalUrls.length; i++) {
            const url = finalUrls[i];
            const category = getCategoryFromToken(savedCategories[i]); // Returns column name
            
            if (finalUrlsByColumnName[category] !== undefined) {
              // Direct column name match
              finalUrlsByColumnName[category].push(url);
            } else {
              // Fallback: put in first column
              const firstColName = imageUrlColumns[0]?.columnName;
              if (firstColName) {
                finalUrlsByColumnName[firstColName].push(url);
              }
            }
          }
          console.log(`[Export] Row ${rowIndex}: Using saved categories -`, 
            Object.entries(finalUrlsByColumnName).map(([k, v]) => `${k}: ${v.length}`).join(', '));
        } else {
          // Position-based: distribute by original column sizes
          let offset = 0;
          for (const { columnName } of imageUrlColumns) {
            const originalCount = originalUrlsByColumnName[columnName]?.length || 0;
            finalUrlsByColumnName[columnName] = finalUrls.slice(offset, offset + originalCount);
            offset += originalCount;
          }
          // Any remaining go to last column
          if (offset < finalUrls.length && imageUrlColumns.length > 0) {
            const lastColName = imageUrlColumns[imageUrlColumns.length - 1].columnName;
            finalUrlsByColumnName[lastColName] = [
              ...(finalUrlsByColumnName[lastColName] || []),
              ...finalUrls.slice(offset)
            ];
          }
        }
        
        // Write to each image_url column
        for (const { colIndex, columnName, separator } of imageUrlColumns) {
          const urls = finalUrlsByColumnName[columnName] || [];
          row[colIndex] = urls.join(separator || ",") || "";
        }

        // Apply description overrides
        // Try row-based key first, then fall back to SKU key
        const descOverride = descriptionOverrides[productKey] || (skuKey && descriptionOverrides[skuKey]) || null;
        if (descOverride) {
          // Apply all description overrides dynamically (both standard and custom fields)
          for (const [descType, content] of Object.entries(descOverride)) {
            if (content && typeof content === 'string') {
              const colIdx = descTypeToColumnIdx[descType];
              if (colIdx !== undefined && colIdx >= 0) {
                row[colIdx] = content;
                console.log(`[Export] Applied ${descType} override to column ${colIdx}`);
              }
            }
          }
        }

        exportRows.push(row);
      }

      // === Stage 20: Insert new products (PER_PRODUCT mode) ===
      const newProducts = [];
      for (const [npKey, override] of Object.entries(exportOverrides)) {
        if (isNewProductOverride(override)) {
          newProducts.push({ productKey: npKey, override });
        }
      }
      
      if (newProducts.length > 0) {
        console.log(`[Export] Found ${newProducts.length} new products to insert`);
        
        // Separate by position
        const beforeProducts = newProducts.filter(np => np.override.addPosition === "before");
        const lastProducts = newProducts
          .filter(np => np.override.addPosition === "last" || !np.override.addPosition)
          .sort((a, b) => (a.override.updatedAt || 0) - (b.override.updatedAt || 0));
        
        // Build map of original row keys to their position
        const rowKeyToIndex = new Map();
        for (let i = 0; i < dataRows.length; i++) {
          const rowIndex = i + 2;
          rowKeyToIndex.set(`row-${rowIndex}`, i);
        }
        
        // Process "before" products
        const inserts = [];
        for (const { productKey: npKey, override } of beforeProducts) {
          const insertBeforeKey = override.insertBeforeProductKey;
          let insertIndex = exportRows.length;
          
          if (insertBeforeKey && rowKeyToIndex.has(insertBeforeKey)) {
            const originalIndex = rowKeyToIndex.get(insertBeforeKey);
            // Find corresponding position in exportRows
            let exportIndex = 0;
            for (let i = 0; i < originalIndex; i++) {
              const key = `row-${i + 2}`;
              const hasData = (key in exportOverrides) || scenariosByProduct.has(key);
              if (!onlyUpdated || hasData) {
                exportIndex++;
              }
            }
            insertIndex = Math.min(exportIndex, exportRows.length);
          }
          
          const newRow = createNewProductRow(
            headerRow, columns, override, imageUrlColumns, descTypeToColumnIdx, descriptionOverrides
          );
          inserts.push({ index: insertIndex, row: newRow, productKey: npKey });
          console.log(`[Export] New product "${npKey}" to insert at index ${insertIndex}`);
        }
        
        // Insert in reverse order to maintain indices
        inserts.sort((a, b) => b.index - a.index);
        for (const { index, row, productKey: npKey } of inserts) {
          exportRows.splice(index, 0, row);
          console.log(`[Export] Inserted new product "${npKey}"`);
        }
        
        // Append "last" products at the end
        for (const { productKey: npKey, override } of lastProducts) {
          const newRow = createNewProductRow(
            headerRow, columns, override, imageUrlColumns, descTypeToColumnIdx, descriptionOverrides
          );
          exportRows.push(newRow);
          console.log(`[Export] Appended new product "${npKey}" at end`);
        }
      }

    } else {
      // ============ PER_IMAGE MODE ============
      // Multiple rows per product, one image per row
      // Need to handle row expansion/contraction based on final image count

      // Group original rows by productKey (using groupByField to match frontend)
      const rowsByProduct = new Map();
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const productKey = getProductKeyForExport(row, columns, groupByField);
        
        if (!productKey) {
          // No key, this row gets exported as-is if not onlyUpdated
          if (!onlyUpdated) {
            exportRows.push([...row]);
          }
          continue;
        }

        if (!rowsByProduct.has(productKey)) {
          rowsByProduct.set(productKey, []);
        }
        rowsByProduct.get(productKey).push({ index: i, data: row });
      }
      
      // Debug: log keys being used
      console.log(`[Export] PER_IMAGE mode: groupByField=${groupByField}, product keys:`, Array.from(rowsByProduct.keys()));
      console.log(`[Export] exportOverrides keys:`, Object.keys(exportOverrides));

      // Process each product
      for (const [productKey, productRows] of rowsByProduct) {
        const hasScenarios = scenariosByProduct.has(productKey);
        const hasOverride = productKey in exportOverrides;

        // Skip if onlyUpdated and no changes
        if (onlyUpdated && !hasScenarios && !hasOverride) {
          continue;
        }

        // Get first image column for PER_IMAGE mode
        const firstImageCol = imageUrlColumns[0];
        const firstImageColIdx = firstImageCol?.colIndex ?? -1;

        // Get original images from all rows
        const originalUrls = [];
        for (const { data: row } of productRows) {
          if (firstImageColIdx >= 0) {
            const val = String(row[firstImageColIdx] || "").trim();
            if (val) originalUrls.push(val);
          }
        }

        // Calculate final URLs
        // PER_IMAGE mode: no categories needed, just use images array
        let finalUrls;
        if (hasOverride) {
          const overrideData = exportOverrides[productKey];
          // Handle both old format (string[]) and new format ({ images, categories })
          if (overrideData.images && Array.isArray(overrideData.images)) {
            finalUrls = overrideData.images;
          } else if (Array.isArray(overrideData)) {
            finalUrls = overrideData;
          } else {
            finalUrls = originalUrls;
          }
        } else if (hasScenarios) {
          finalUrls = applyScenarios(originalUrls, scenariosByProduct.get(productKey));
        } else {
          finalUrls = originalUrls;
        }

        // Apply GLOBAL dedupe if enabled - each URL only appears once across entire spreadsheet
        if (dedupeImages) {
          const filtered = [];
          for (const url of finalUrls) {
            if (!url) continue;
            if (globalSeen.has(url)) continue; // Skip if already used by another product
            globalSeen.add(url);
            filtered.push(url);
          }
          finalUrls = filtered;
        }

        // Generate output rows
        const numOriginalRows = productRows.length;
        const numFinalImages = finalUrls.length;

        // Get description override for this product
        const descOverride = descriptionOverrides[productKey];

        for (let i = 0; i < Math.max(numOriginalRows, numFinalImages); i++) {
          let row;

          if (i < numOriginalRows) {
            // Use existing row as base
            row = [...productRows[i].data];
          } else {
            // Need extra row - clone first row of this product
            row = [...productRows[0].data];
          }

          if (i < numFinalImages) {
            // Set image URL in first image column
            if (firstImageColIdx >= 0) {
              row[firstImageColIdx] = finalUrls[i];
            }
            // Set image position
            if (imagePositionIdx >= 0) {
              row[imagePositionIdx] = String(i + 1);
            }
          } else {
            // Extra original rows - clear image data
            if (firstImageColIdx >= 0) {
              row[firstImageColIdx] = "";
            }
            if (imagePositionIdx >= 0) {
              row[imagePositionIdx] = "";
            }
          }

          // Apply description overrides (same for all rows of this product)
          if (descOverride) {
            // Apply all description overrides dynamically (both standard and custom fields)
            for (const [descType, content] of Object.entries(descOverride)) {
              if (content && typeof content === 'string') {
                const colIdx = descTypeToColumnIdx[descType];
                if (colIdx !== undefined && colIdx >= 0) {
                  row[colIdx] = content;
                }
              }
            }
          }

          exportRows.push(row);
        }
      }

      // === Stage 20: Insert new products (PER_IMAGE mode) ===
      const newProductsPIM = [];
      for (const [npKey, override] of Object.entries(exportOverrides)) {
        if (isNewProductOverride(override)) {
          newProductsPIM.push({ productKey: npKey, override });
        }
      }
      
      if (newProductsPIM.length > 0) {
        console.log(`[Export PER_IMAGE] Found ${newProductsPIM.length} new products to insert`);
        
        // Separate by position
        const beforeProductsPIM = newProductsPIM.filter(np => np.override.addPosition === "before");
        const lastProductsPIM = newProductsPIM
          .filter(np => np.override.addPosition === "last" || !np.override.addPosition)
          .sort((a, b) => (a.override.updatedAt || 0) - (b.override.updatedAt || 0));
        
        // Helper to create rows for a new product
        const createNewProductRowsPIM = (override) => {
          const images = override.images || [];
          const productIdIdx = findColumnIndexByRole(columns, "product_id");
          const skuIdx = findColumnIndexByRole(columns, "sku");
          const firstImageColIdx = imageUrlColumns[0]?.colIndex ?? -1;
          const newRows = [];
          
          for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
            const row = new Array(headerRow.length).fill("");
            
            if (productIdIdx >= 0) row[productIdIdx] = override.productId;
            if (skuIdx >= 0) row[skuIdx] = override.sku;
            if (firstImageColIdx >= 0) row[firstImageColIdx] = images[imgIdx];
            if (imagePositionIdx >= 0) row[imagePositionIdx] = String(imgIdx + 1);
            
            // Apply description overrides - try both composite and simple key formats
            const compositeKey = `${override.productId}::${override.sku}`;
            const simpleKey = override.productId;
            const descOverridePIM = descriptionOverrides[compositeKey] || descriptionOverrides[simpleKey];
            if (descOverridePIM) {
              for (const [descType, content] of Object.entries(descOverridePIM)) {
                if (content && typeof content === 'string') {
                  const colIdx = descTypeToColumnIdx[descType];
                  if (colIdx !== undefined && colIdx >= 0) {
                    row[colIdx] = content;
                  }
                }
              }
            }
            
            newRows.push(row);
          }
          return newRows;
        };
        
        // Process "before" products - need to find insert position in exportRows
        if (beforeProductsPIM.length > 0) {
          // Build a map of productKey -> first row index in exportRows
          const productKeyToFirstIndex = new Map();
          for (let i = 0; i < exportRows.length; i++) {
            const row = exportRows[i];
            const rowProductKey = getProductKeyForExport(row, columns, groupByField);
            if (rowProductKey && !productKeyToFirstIndex.has(rowProductKey)) {
              productKeyToFirstIndex.set(rowProductKey, i);
            }
          }
          
          // Collect inserts
          const insertsPIM = [];
          for (const { productKey: npKey, override } of beforeProductsPIM) {
            const insertBeforeKey = override.insertBeforeProductKey;
            let insertIndex = exportRows.length;
            
            if (insertBeforeKey && productKeyToFirstIndex.has(insertBeforeKey)) {
              insertIndex = productKeyToFirstIndex.get(insertBeforeKey);
            }
            
            const newRows = createNewProductRowsPIM(override);
            insertsPIM.push({ index: insertIndex, rows: newRows, productKey: npKey });
            console.log(`[Export PER_IMAGE] New product "${npKey}" (${newRows.length} rows) to insert at index ${insertIndex}`);
          }
          
          // Insert in reverse order to maintain indices
          insertsPIM.sort((a, b) => b.index - a.index);
          for (const { index, rows, productKey: npKey } of insertsPIM) {
            exportRows.splice(index, 0, ...rows);
            console.log(`[Export PER_IMAGE] Inserted new product "${npKey}"`);
          }
        }
        
        // Append "last" products at the end
        for (const { productKey: npKey, override } of lastProductsPIM) {
          const newRows = createNewProductRowsPIM(override);
          exportRows.push(...newRows);
          console.log(`[Export PER_IMAGE] Appended new product "${npKey}" (${newRows.length} rows) at end`);
        }
      }
    }

    // 6. Build output based on original file extension
    // Export format matches original: .xls -> real BIFF8/OLE, .xlsx -> OOXML, .csv -> CSV
    const originalExt = path.extname(template.originalFileName || template.storagePath || "").toLowerCase();
    const timestamp = Date.now();
    const allRows = [headerRow, ...exportRows];

    console.log(`[SpreadsheetResults] Export debug:`);
    console.log(`  - originalFileName: ${template.originalFileName}`);
    console.log(`  - storagePath: ${template.storagePath}`);
    console.log(`  - originalExt: ${originalExt}`);
    console.log(`  - fileType: ${template.fileType}`);
    console.log(`  - allRows count: ${allRows.length}`);
    
    // Log sample of long content to verify no truncation in data
    for (const row of allRows.slice(0, 3)) {
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (cell && String(cell).length > 100) {
          console.log(`  - Long cell [row][${i}]: ${String(cell).length} chars`);
        }
      }
    }

    if (originalExt === ".xls") {
      // === Real BIFF8 XLS export using Python xlwt ===
      // SheetJS has a 255 char limit for xls cells, so we use Python xlwt instead
      const filename = `${template.templateName}-export-${timestamp}.xls`;

      console.log(`[SpreadsheetResults] Generating real BIFF8 XLS using Python xlwt...`);

      try {
        const xlsBuffer = generateRealXls(allRows);
        
        console.log(`[SpreadsheetResults] XLS buffer size: ${xlsBuffer.length} bytes`);

        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        console.log(`[SpreadsheetResults] Exported ${exportRows.length} rows as real BIFF8 XLS for template ${templateId}`);

        return res.send(xlsBuffer);
      } catch (pythonErr) {
        console.error(`[SpreadsheetResults] Python xlwt failed:`, pythonErr.message);
        // Fallback to SheetJS (with 255 char limit warning)
        console.log(`[SpreadsheetResults] Falling back to SheetJS (may have 255 char limit)`);
        
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet(allRows);
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        const wbBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
        
        res.setHeader("Content-Type", "application/vnd.ms-excel");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        
        return res.send(wbBuffer);
      }
    } else if (originalExt === ".xlsx") {
      // === XLSX export using SheetJS ===
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(allRows);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

      const filename = `${template.templateName}-export-${timestamp}.xlsx`;

      console.log(`[SpreadsheetResults] Writing XLSX with SheetJS...`);

      const wbBuffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      });

      console.log(`[SpreadsheetResults] XLSX buffer size: ${wbBuffer.length} bytes`);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      console.log(`[SpreadsheetResults] Exported ${exportRows.length} rows as XLSX for template ${templateId}`);

      return res.send(wbBuffer);
    } else {
      // === CSV export ===
      const csvLines = [];
      
      // Header row
      csvLines.push(headerRow.map(csvSafe).join(","));
      
      // Data rows
      for (const row of exportRows) {
        const cells = headerRow.map((_, idx) => csvSafe(row[idx] ?? ""));
        csvLines.push(cells.join(","));
      }

      const csvContent = csvLines.join("\n");

      const filename = `${template.templateName}-export-${timestamp}.csv`;
      
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      
      console.log(`[SpreadsheetResults] Exported ${exportRows.length} rows as CSV for template ${templateId}`);
      
      return res.send(csvContent);
    }

  } catch (err) {
    console.error("[SpreadsheetResults] Export error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Export failed",
    });
  }
});

/**
 * GET /api/spreadsheets/:templateId/export (legacy - redirects to POST)
 */
router.get("/spreadsheets/:templateId/export", async (req, res) => {
  return res.status(400).json({
    success: false,
    error: "Use POST method for export with body parameters",
  });
});

// ============ Export Overrides (Persistent Storage) ============

/**
 * GET /api/spreadsheets/:templateId/export-overrides
 * 
 * Get saved export overrides for a template.
 * Returns: { overrides: { [productKey]: { images: string[], categories: string[] } } }
 * 
 * Handles backward compatibility:
 * - Old format: { [productKey]: string[] } -> converts to { images: [...], categories: [] }
 * - New format: { [productKey]: { images: [...], categories: [...] } } -> returns as-is
 */
router.get("/spreadsheets/:templateId/export-overrides", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];

    console.log(`[SpreadsheetResults] GET export-overrides for template ${templateId}`);

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    const doc = await docRef.get();
    
    if (!doc.exists) {
      console.log(`[SpreadsheetResults] No export-overrides doc exists for template ${templateId}`);
      return res.json({
        success: true,
        overrides: {},
      });
    }

    const data = doc.data();
    const rawOverrides = data.exportOverrides || {};
    
    // Normalize all overrides to new format
    const normalizedOverrides = {};
    for (const [key, value] of Object.entries(rawOverrides)) {
      if (Array.isArray(value)) {
        // Old format: string[] -> convert to { images, categories: [] }
        normalizedOverrides[key] = {
          images: value,
          categories: [],  // No saved categories, will use position-based
        };
      } else if (value && typeof value === 'object' && 'images' in value) {
        // New format: { images, categories }
        normalizedOverrides[key] = value;
      }
    }
    
    const overrideKeys = Object.keys(normalizedOverrides);
    console.log(`[SpreadsheetResults] Retrieved ${overrideKeys.length} export-overrides for template ${templateId}: ${overrideKeys.join(', ')}`);
    
    return res.json({
      success: true,
      overrides: normalizedOverrides,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] GET export-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * POST /api/spreadsheets/:templateId/export-overrides
 * 
 * Save export override for a specific product.
 * Body: { 
 *   productKey: string, 
 *   imageUrls: string[], 
 *   categories?: string[], 
 *   sourceTemplateId?: string,
 *   // Stage 20: New product fields
 *   isNewProduct?: boolean,
 *   productId?: string,
 *   sku?: string,
 *   addPosition?: "last" | "before",
 *   insertBeforeProductKey?: string,
 * }
 * 
 * New format stores: { images: string[], categories: string[], sourceTemplateId?: string, ... }
 * This preserves both the image order AND the category assignment for each image.
 * 
 * Phase 2: sourceTemplateId is optional and used for audit trail when cross-saving
 * from a different spreadsheet template.
 * 
 * Stage 20: For new products, also stores isNewProduct, productId, sku, addPosition,
 * and optionally insertBeforeProductKey (when addPosition === "before").
 */
router.post("/spreadsheets/:templateId/export-overrides", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];
    const { 
      productKey, 
      imageUrls, 
      categories,
      // Phase 2: Cross-save audit info
      sourceTemplateId,  // Optional: original template (for audit trail)
      // Stage 20: New product fields
      isNewProduct,
      productId,
      sku,
      addPosition,
      insertBeforeProductKey,
    } = req.body;

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    if (!productKey || typeof productKey !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid productKey",
      });
    }

    if (!Array.isArray(imageUrls)) {
      return res.status(400).json({
        success: false,
        error: "imageUrls must be an array",
      });
    }

    // Stage 20: Validate new product fields if isNewProduct is true
    if (isNewProduct) {
      if (!productId || typeof productId !== "string") {
        return res.status(400).json({
          success: false,
          error: "productId is required for new products",
        });
      }
      if (!sku || typeof sku !== "string") {
        return res.status(400).json({
          success: false,
          error: "sku is required for new products",
        });
      }
      if (!addPosition || !["last", "before"].includes(addPosition)) {
        return res.status(400).json({
          success: false,
          error: "addPosition must be 'last' or 'before' for new products",
        });
      }
      if (addPosition === "before" && !insertBeforeProductKey) {
        return res.status(400).json({
          success: false,
          error: "insertBeforeProductKey is required when addPosition is 'before'",
        });
      }
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    // Read existing data first (dot notation doesn't work with special chars in keys)
    const doc = await docRef.get();
    const existingOverrides = doc.exists ? (doc.data().exportOverrides || {}) : {};
    
    // Build the override entry
    // Save with new format: { images, categories, updatedAt, sourceTemplateId?, ...newProductFields? }
    // categories is optional for backward compatibility
    // updatedAt is used by frontend to determine most recently updated product
    // sourceTemplateId is optional and used for cross-save audit trail
    const overrideEntry = {
      images: imageUrls,
      categories: categories || [],  // Empty array if not provided
      updatedAt: Date.now(),  // Track when this product was last updated
      // Phase 2: Track source template for cross-save audit
      ...(sourceTemplateId && { sourceTemplateId }),
      // Stage 20: New product fields
      ...(isNewProduct && {
        isNewProduct: true,
        productId,
        sku,
        addPosition,
        ...(insertBeforeProductKey && { insertBeforeProductKey }),
      }),
    };
    
    existingOverrides[productKey] = overrideEntry;

    // Save entire object
    await docRef.set({
      exportOverrides: existingOverrides,
      updatedAt: Date.now(),
    }, { merge: true });

    const isCrossSave = sourceTemplateId && sourceTemplateId !== templateId;
    console.log(
      `[SpreadsheetResults] Saved export override for ${productKey} in template ${templateId}` +
      ` (total: ${Object.keys(existingOverrides).length}, categories: ${categories?.length || 0})` +
      (isNewProduct ? ` [NEW PRODUCT: ${productId}::${sku}, position: ${addPosition}]` : "") +
      (isCrossSave ? ` [cross-save from ${sourceTemplateId}]` : "")
    );

    // Update template timestamp so it sorts to top in template list
    await updateTemplateTimestamp(userId, templateId);

    return res.json({
      success: true,
      productKey,
      imageCount: imageUrls.length,
      ...(isNewProduct && { isNewProduct: true }),
      ...(isCrossSave && { sourceTemplateId }),
    });

  } catch (err) {
    console.error("[SpreadsheetResults] POST export-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * DELETE /api/spreadsheets/:templateId/export-overrides/:productKey
 * 
 * Delete export override for a specific product.
 */
router.delete("/spreadsheets/:templateId/export-overrides/:productKey", async (req, res) => {
  try {
    const { templateId, productKey } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    // Read existing data first (dot notation doesn't work with special chars in keys)
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.json({ success: true, deleted: productKey });
    }
    
    const existingOverrides = doc.data().exportOverrides || {};
    delete existingOverrides[productKey];

    // Save entire object back
    await docRef.set({
      exportOverrides: existingOverrides,
      updatedAt: Date.now(),
    }, { merge: true });

    console.log(`[SpreadsheetResults] Deleted export override for ${productKey} in template ${templateId}`);

    return res.json({
      success: true,
      deleted: productKey,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] DELETE export-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * DELETE /api/spreadsheets/:templateId/export-overrides
 * 
 * Delete all export overrides for a template.
 */
router.delete("/spreadsheets/:templateId/export-overrides", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    // Check if doc exists first
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.json({ success: true });
    }

    // Set exportOverrides to empty object
    await docRef.set({
      exportOverrides: {},
      updatedAt: Date.now(),
    }, { merge: true });

    console.log(`[SpreadsheetResults] Deleted all export overrides for template ${templateId}`);

    return res.json({
      success: true,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] DELETE all export-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

// ============ Description Overrides ============

/**
 * GET /api/spreadsheets/:templateId/description-overrides
 * 
 * Get saved description overrides for a template.
 * Returns: { overrides: { [productKey]: { seo?: string, geo?: string, gso?: string } } }
 */
router.get("/spreadsheets/:templateId/description-overrides", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.json({
        success: true,
        overrides: {},
      });
    }

    const data = doc.data();
    const overrides = data.descriptionOverrides || {};
    
    console.log(`[SpreadsheetResults] Retrieved description-overrides for template ${templateId}`);
    
    return res.json({
      success: true,
      overrides,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] GET description-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * POST /api/spreadsheets/:templateId/description-overrides
 * 
 * Save description override for a specific product.
 * Body: { productKey: string, descriptionType: string, content: string }
 * descriptionType can be standard (seo, geo, gso, tags, seo_title, meta_title, meta_description)
 * or any custom field role (e.g., category, title, vendor)
 */
router.post("/spreadsheets/:templateId/description-overrides", async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.headers["x-user-id"];
    const { productKey, descriptionType, content } = req.body;

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    if (!productKey || typeof productKey !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid productKey",
      });
    }

    // Support any field name (standard + custom fields with enableGeneration)
    // Standard types: seo, geo, gso, tags, seo_title, meta_title, meta_description
    // Custom types: any valid field role string (e.g., category, title, vendor)
    if (!descriptionType || typeof descriptionType !== "string" || descriptionType.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid descriptionType (must be a non-empty string)",
      });
    }

    if (typeof content !== "string") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid content",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    // Read existing data first
    const doc = await docRef.get();
    const existingOverrides = doc.exists ? (doc.data().descriptionOverrides || {}) : {};
    
    // Initialize product entry if needed
    if (!existingOverrides[productKey]) {
      existingOverrides[productKey] = {};
    }
    
    // Set the specific description type and update timestamp
    existingOverrides[productKey][descriptionType] = content;
    existingOverrides[productKey].updatedAt = Date.now();  // Track when this product was last updated

    // Save entire object
    await docRef.set({
      descriptionOverrides: existingOverrides,
      updatedAt: Date.now(),
    }, { merge: true });

    console.log(`[SpreadsheetResults] Saved ${descriptionType} description for ${productKey} in template ${templateId}`);

    // Update template timestamp so it sorts to top in template list
    await updateTemplateTimestamp(userId, templateId);

    return res.json({
      success: true,
      productKey,
      descriptionType,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] POST description-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

/**
 * DELETE /api/spreadsheets/:templateId/description-overrides/:productKey
 * 
 * Delete all description overrides for a specific product.
 */
router.delete("/spreadsheets/:templateId/description-overrides/:productKey", async (req, res) => {
  try {
    const { templateId, productKey } = req.params;
    const userId = req.headers["x-user-id"];

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid X-User-Id header",
      });
    }

    const docRef = db
      .collection("users")
      .doc(userId)
      .collection("spreadsheetResults")
      .doc(templateId);

    const doc = await docRef.get();
    if (!doc.exists) {
      return res.json({ success: true, deleted: productKey });
    }
    
    const existingOverrides = doc.data().descriptionOverrides || {};
    delete existingOverrides[productKey];

    await docRef.set({
      descriptionOverrides: existingOverrides,
      updatedAt: Date.now(),
    }, { merge: true });

    console.log(`[SpreadsheetResults] Deleted description overrides for ${productKey} in template ${templateId}`);

    return res.json({
      success: true,
      deleted: productKey,
    });

  } catch (err) {
    console.error("[SpreadsheetResults] DELETE description-overrides error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

export default router;