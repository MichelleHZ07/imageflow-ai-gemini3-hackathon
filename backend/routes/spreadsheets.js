// backend/routes/spreadsheets.js
// ✅ 修改版：使用 Firebase Storage 替代本地文件系统
import express from "express";
import multer from "multer";
import XLSX from "xlsx";
import { parse as csvParse } from "csv-parse/sync";
import { v4 as uuidv4 } from "uuid";
import path from "path";
// ❌ 移除: import fs from "fs"; -- 大部分本地文件操作不再需要
import admin from "firebase-admin";
import {
  getUserSpreadsheets,
  getSpreadsheetById,
  createSpreadsheet,
  updateSpreadsheetMappings,
  updateSpreadsheet,
  deleteSpreadsheet,
  countUserSpreadsheets,
} from "../utils/spreadsheetStore.js";
import { getRowsForTemplate } from "../utils/spreadsheetRowProcessor.js";

// ✅ 新增: 导入 Storage 服务
import {
  uploadSpreadsheetToStorage,
  downloadSpreadsheetFromStorage,
  deleteSpreadsheetFromStorage,
} from "../services/spreadsheetStorageService.js";

const router = express.Router();
const db = admin.firestore();

/* ======================================================
   HELPER: Delete spreadsheetResults and its subcollections
   删除表格时同时清理关联的 results 数据
====================================================== */
async function deleteSpreadsheetResults(uid, templateId) {
  try {
    const resultsDocRef = db
      .collection("users")
      .doc(uid)
      .collection("spreadsheetResults")
      .doc(templateId);

    // 1. 先删除 scenarios 子集合中的所有文档
    const scenariosRef = resultsDocRef.collection("scenarios");
    const scenariosSnapshot = await scenariosRef.get();
    
    if (!scenariosSnapshot.empty) {
      const batch = db.batch();
      scenariosSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`[Spreadsheets] Deleted ${scenariosSnapshot.size} scenarios for template ${templateId}`);
    }

    // 2. 删除 results 文档本身（包含 exportOverrides 和 descriptionOverrides）
    const resultsDoc = await resultsDocRef.get();
    if (resultsDoc.exists) {
      await resultsDocRef.delete();
      console.log(`[Spreadsheets] Deleted spreadsheetResults document for template ${templateId}`);
    }

  } catch (err) {
    // 记录错误但不阻止主删除操作
    console.warn(`[Spreadsheets] Failed to delete spreadsheetResults for ${templateId}:`, err.message);
  }
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = [".csv", ".xls", ".xlsx"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only CSV, XLS, and XLSX are allowed."));
    }
  },
});

/* ======================================================
   HELPER: Parse spreadsheet file from disk or buffer
   Supports CSV and Excel (XLS/XLSX) formats
   Returns 2D array including header row
====================================================== */
function parseSpreadsheetBuffer(buffer, fileType) {
  if (fileType === "Excel") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  } else {
    // CSV
    const csvContent = buffer.toString("utf-8");
    return csvParse(csvContent, {
      skip_empty_lines: true,
      relax_column_count: true,
    });
  }
}

// ❌ 移除: parseSpreadsheetFile 函数 -- 不再需要从本地磁盘读取

/* ======================================================
   HELPER: Normalize column name for matching
   - Lowercase
   - Trim whitespace
   - Remove extra spaces
   - Remove content in parentheses (e.g., "Body (HTML)" -> "body")
   - Remove special characters
====================================================== */
function normalizeColumnName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*/g, "") // Remove parentheses and content
    .replace(/[_\-\s]+/g, " ")       // Normalize separators to space
    .replace(/\s+/g, " ")            // Collapse multiple spaces
    .trim();
}

/* ======================================================
   HELPER: Detect image URL columns
   Returns true if column name looks like an image URL column
   Matches: Image, 图片, 主图, Image1, 主图2, gallery, etc.
====================================================== */
function isImageUrlColumn(columnName) {
  if (!columnName) return false;
  
  const normalized = columnName.toLowerCase().trim();
  
  // Direct matches for common image column names
  const imageKeywords = [
    "image", "img", "pic", "photo", "picture", "gallery",
    "图片", "主图", "附图", "商品图", "产品图", "图"
  ];
  
  // Check if column name contains any image keyword
  for (const keyword of imageKeywords) {
    if (normalized.includes(keyword)) {
      return true;
    }
  }
  
  // Also match URL patterns that suggest images
  if (normalized.includes("url") && (normalized.includes("image") || normalized.includes("img"))) {
    return true;
  }
  
  return false;
}

/* ======================================================
   GET /api/spreadsheets
   Get all spreadsheet templates for a user
====================================================== */
router.get("/spreadsheets", async (req, res) => {
  try {
    const { uid } = req.query;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: "Missing uid parameter",
      });
    }

    const spreadsheets = await getUserSpreadsheets(uid);

    return res.json({
      success: true,
      spreadsheets,
    });
  } catch (err) {
    console.error("Error fetching spreadsheets:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch spreadsheets",
    });
  }
});

/* ======================================================
   GET /api/spreadsheets/:id
   Get a single spreadsheet template
====================================================== */
router.get("/spreadsheets/:id", async (req, res) => {
  try {
    const { uid } = req.query;
    const { id } = req.params;

    if (!uid || !id) {
      return res.status(400).json({
        success: false,
        error: "Missing uid or spreadsheet id",
      });
    }

    const spreadsheet = await getSpreadsheetById(uid, id);

    if (!spreadsheet) {
      return res.status(404).json({
        success: false,
        error: "Spreadsheet not found",
      });
    }

    return res.json({
      success: true,
      spreadsheet,
    });
  } catch (err) {
    console.error("Error fetching spreadsheet:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch spreadsheet",
    });
  }
});

/* ======================================================
   GET /api/spreadsheets/:id/rows
   Get normalized rows with pagination and search
   
   Uses the pure getRowsForTemplate function from 
   spreadsheetRowProcessor.js for all normalization,
   aggregation, filtering and pagination logic.
   
   Supports:
   - PER_PRODUCT mode: Each row is one product
   - PER_IMAGE mode: Multiple rows per product (aggregated by SKU/product_id)
   - Multi-value columns for image URLs
   - Search across key fields
   - Pagination
   
   ✅ 修改: 从 Firebase Storage 读取文件
====================================================== */
router.get("/spreadsheets/:id/rows", async (req, res) => {
  try {
    const { uid, page = "1", pageSize = "20", search = "" } = req.query;
    const { id } = req.params;

    // Validate required parameters
    if (!uid || !id) {
      return res.status(400).json({
        success: false,
        error: "Missing uid or spreadsheet id",
      });
    }

    // Parse and validate pagination parameters
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const searchQuery = (search || "").trim();

    // Load template document from store (Firestore or local)
    const template = await getSpreadsheetById(uid, id);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: "Spreadsheet not found",
      });
    }

    // ✅ 修改: 从 Firebase Storage 下载文件（替代本地文件系统）
    let fileBuffer;
    try {
      fileBuffer = await downloadSpreadsheetFromStorage(template.storagePath);
    } catch (err) {
      console.error(`Failed to download spreadsheet: ${template.storagePath}`, err.message);
      return res.status(404).json({
        success: false,
        error: "Spreadsheet file not found in storage. Please re-upload the file.",
      });
    }

    // Parse the file into 2D array (includes header row)
    const rawData = parseSpreadsheetBuffer(fileBuffer, template.fileType);

    // Handle empty file
    if (rawData.length < 2) {
      return res.json({
        success: true,
        spreadsheetId: id,
        templateName: template.templateName,
        rowMode: template.rowMode || "PER_PRODUCT",
        page: pageNum,
        pageSize: size,
        total: 0,
        items: [],
      });
    }

    // Extract data rows (skip header row at index 0)
    const dataRows = rawData.slice(1);

    // Build template object for processor
    const templateForProcessor = {
      rowMode: template.rowMode || "PER_PRODUCT",
      columns: template.columns || [],
      groupByField: template.groupByField || "product_id",
    };

    // Call the pure processor function
    // This handles: normalization, multi-value parsing, aggregation (PER_IMAGE),
    // search filtering, and pagination
    const result = getRowsForTemplate(templateForProcessor, dataRows, {
      page: pageNum,
      pageSize: size,
      search: searchQuery,
    });

    // Return response with consistent shape
    return res.json({
      success: true,
      spreadsheetId: id,
      templateName: template.templateName,
      rowMode: result.rowMode,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      items: result.items,
    });
  } catch (err) {
    console.error("Error fetching spreadsheet rows:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to fetch spreadsheet rows",
    });
  }
});

/* ======================================================
   POST /api/spreadsheets/upload
   Upload and parse a spreadsheet file
   Sets status = "uploaded"
   
   ✅ 修改: 上传到 Firebase Storage
====================================================== */
const MAX_SPREADSHEET_TEMPLATES = 10;

router.post("/spreadsheets/upload", upload.single("file"), async (req, res) => {
  try {
    const { uid, templateName, platform } = req.body;
    const file = req.file;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: "Missing uid",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded",
      });
    }

    if (!templateName) {
      return res.status(400).json({
        success: false,
        error: "Missing templateName",
      });
    }

    // Check spreadsheet limit before proceeding
    const currentCount = await countUserSpreadsheets(uid);
    if (currentCount >= MAX_SPREADSHEET_TEMPLATES) {
      console.log(`[Spreadsheets] User ${uid} has reached the limit of ${MAX_SPREADSHEET_TEMPLATES} templates`);
      return res.status(200).json({
        success: false,
        code: "SPREADSHEET_LIMIT_REACHED",
        error: `You can create up to ${MAX_SPREADSHEET_TEMPLATES} spreadsheet templates. Please delete one before uploading a new file.`,
      });
    }

    const ext = path.extname(file.originalname).toLowerCase();
    const isExcel = ext === ".xlsx" || ext === ".xls";
    const fileType = isExcel ? "Excel" : "CSV";

    let headers = [];
    let sampleRows = [];
    let rowCount = 0;

    // Parse the file using helper
    const rawData = parseSpreadsheetBuffer(file.buffer, fileType);

    if (rawData.length > 0) {
      headers = rawData[0].map((h) => String(h || "").trim());
      rowCount = rawData.length - 1; // Exclude header row

      // Get sample rows (first 3 data rows)
      sampleRows = rawData.slice(1, 4).map((row) =>
        headers.map((_, idx) => String(row[idx] || ""))
      );
    }

    if (headers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Could not parse file headers. Make sure the file has data.",
      });
    }

    // ============================================================
    // AUTO-MAPPING: Load mappings from same-platform templates
    // ============================================================
    let platformMappings = {}; // columnName -> { role, multiValue, separator }
    let autoRowMode = "PER_PRODUCT"; // Default, will be overridden if found
    
    try {
      const existingTemplates = await getUserSpreadsheets(uid);
      
      // Filter same-platform templates that are mapped
      let samePlatformTemplates = existingTemplates.filter(
        (t) => t.platform === (platform || "Generic") && 
               t.status === "mapped" && 
               t.columns && 
               Array.isArray(t.columns)
      );
      
      // Sort by updatedAt descending (most recently updated first)
      samePlatformTemplates.sort((a, b) => {
        const timeA = a.updatedAt || a.createdAt || 0;
        const timeB = b.updatedAt || b.createdAt || 0;
        return timeB - timeA;
      });
      
      console.log(`[Auto-Map] Found ${samePlatformTemplates.length} mapped ${platform || "Generic"} template(s)`);
      
      // Get rowMode from the most recently updated same-platform template
      if (samePlatformTemplates.length > 0) {
        autoRowMode = samePlatformTemplates[0].rowMode || "PER_PRODUCT";
        console.log(`[Auto-Map] Using rowMode "${autoRowMode}" from template "${samePlatformTemplates[0].templateName}" (updated: ${samePlatformTemplates[0].updatedAt || samePlatformTemplates[0].createdAt})`);
      }
      
      // Build mapping from existing templates (most recent first)
      for (const template of samePlatformTemplates) {
        for (const col of template.columns) {
          if (col.role && col.name) {
            // Normalize column name for matching:
            // - lowercase
            // - trim whitespace
            // - remove extra spaces
            // - remove special characters like parentheses content
            const normalizedName = normalizeColumnName(col.name);
            
            // Only add if not already mapped (first match wins = most recent template)
            if (!platformMappings[normalizedName]) {
              platformMappings[normalizedName] = {
                role: col.role,
                multiValue: col.multiValue || false,
                separator: col.separator || ",",
              };
            }
          }
        }
      }
      
      if (Object.keys(platformMappings).length > 0) {
        console.log(`[Auto-Map] Found ${Object.keys(platformMappings).length} column mappings`);
        console.log(`[Auto-Map] Mappings:`, Object.keys(platformMappings).map(k => `"${k}" -> ${platformMappings[k].role}`).join(', '));
      }
    } catch (err) {
      console.warn("[Auto-Map] Could not load platform mappings:", err.message);
      // Continue without auto-mapping
    }

    // Build columns array with auto-mapped roles
    const columns = headers.map((name, idx) => {
      const normalizedName = normalizeColumnName(name);
      const existingMapping = platformMappings[normalizedName];
      
      // 1. First check existing platform mappings
      if (existingMapping) {
        console.log(`[Auto-Map] Column "${name}" (normalized: "${normalizedName}") -> role: ${existingMapping.role}`);
        return {
          name,
          sampleValues: sampleRows.map((row) => row[idx] || "").filter(Boolean).slice(0, 3),
          role: existingMapping.role,
          multiValue: existingMapping.multiValue,
          separator: existingMapping.separator,
        };
      }
      
      // 2. Check if it's an image URL column (Image, 图片, Image1, 主图2, gallery, etc.)
      if (isImageUrlColumn(name)) {
        console.log(`[Auto-Map] Column "${name}" -> image_url (auto-detected)`);
        return {
          name,
          sampleValues: sampleRows.map((row) => row[idx] || "").filter(Boolean).slice(0, 3),
          role: "image_url",
          multiValue: false,
          separator: ",",
        };
      }
      
      // 3. No mapping found
      return {
        name,
        sampleValues: sampleRows.map((row) => row[idx] || "").filter(Boolean).slice(0, 3),
        role: null,
        multiValue: false,
        separator: ",",
      };
    });

    // Check if all required fields are auto-mapped (to set correct status)
    const mappedCount = columns.filter((c) => c.role !== null).length;
    const hasRequiredFields = columns.some((c) => 
      c.role === "sku" || c.role === "product_id" || c.role === "handle"
    );

    // Generate spreadsheet ID
    const spreadsheetId = uuidv4();

    // ✅ 修改: 上传到 Firebase Storage（替代本地文件系统）
    const storagePath = await uploadSpreadsheetToStorage(
      uid,
      spreadsheetId,
      file.buffer,
      ext
    );

    // Create template document
    // If auto-mapping found all required fields, set status to "mapped"
    const autoMappedStatus = hasRequiredFields && mappedCount > 0 ? "mapped" : "uploaded";
    
    const templateData = {
      templateName,
      platform: platform || "Generic",
      fileType,
      originalFileName: file.originalname,
      storagePath,  // ✅ 现在是 Firebase Storage 路径
      rowCount,
      headers,
      columns,
      rowMode: autoRowMode, // Use auto-detected rowMode from same-platform templates
      // Status: if auto-mapped with required fields, mark as "mapped"
      ...(autoMappedStatus === "mapped" ? { status: "mapped" } : {}),
    };

    const saved = await createSpreadsheet(uid, spreadsheetId, templateData);

    const autoMapInfo = mappedCount > 0 
      ? `, auto-mapped: ${mappedCount}/${columns.length} columns, rowMode: ${autoRowMode}` 
      : "";
    console.log(`Spreadsheet uploaded: ${templateName} (${rowCount} rows, ${headers.length} columns, status: ${saved.status}${autoMapInfo})`);

    return res.json({
      success: true,
      spreadsheet: saved,
      autoMapped: mappedCount > 0,
      autoMappedCount: mappedCount,
    });
  } catch (err) {
    console.error("Error uploading spreadsheet:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to upload spreadsheet",
    });
  }
});

/* ======================================================
   PUT /api/spreadsheets/:id/mappings
   Update field mappings for a spreadsheet
   Sets status = "mapped" or "partial"
   Includes rowMode, groupByField, and column-level multiValue/separator
====================================================== */
router.put("/spreadsheets/:id/mappings", async (req, res) => {
  try {
    const { uid, columns, rowMode, groupByField } = req.body;
    const { id } = req.params;

    if (!uid || !id) {
      return res.status(400).json({
        success: false,
        error: "Missing uid or spreadsheet id",
      });
    }

    if (!columns || !Array.isArray(columns)) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid columns array",
      });
    }

    // Validate PER_IMAGE mode requirements
    if (rowMode === "PER_IMAGE") {
      const hasSkuMapped = columns.some((c) => c.role === "sku");
      const hasProductIdMapped = columns.some((c) => c.role === "product_id");

      if (!hasSkuMapped && !hasProductIdMapped) {
        return res.status(400).json({
          success: false,
          error: "PER_IMAGE mode requires either SKU or Product ID to be mapped for grouping rows.",
        });
      }
      
      // Validate groupByField matches a mapped column
      const effectiveGroupBy = groupByField || "product_id";
      if (effectiveGroupBy === "sku" && !hasSkuMapped) {
        return res.status(400).json({
          success: false,
          error: "Group by SKU requires SKU column to be mapped.",
        });
      }
      if (effectiveGroupBy === "product_id" && !hasProductIdMapped) {
        return res.status(400).json({
          success: false,
          error: "Group by Product ID requires Product ID column to be mapped.",
        });
      }
    }

    const updated = await updateSpreadsheetMappings(uid, id, columns, rowMode, groupByField);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: "Spreadsheet not found",
      });
    }

    console.log(`Spreadsheet mappings updated: ${id} (status: ${updated.status}, rowMode: ${rowMode || "PER_PRODUCT"}, groupByField: ${groupByField || "product_id"})`);

    return res.json({
      success: true,
      spreadsheet: updated,
    });
  } catch (err) {
    console.error("Error updating mappings:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to update mappings",
    });
  }
});

/* ======================================================
   PUT /api/spreadsheets/:id
   Update spreadsheet metadata (name, platform, etc.)
====================================================== */
router.put("/spreadsheets/:id", async (req, res) => {
  try {
    const { uid, templateName, platform, columns, rowMode } = req.body;
    const { id } = req.params;

    if (!uid || !id) {
      return res.status(400).json({
        success: false,
        error: "Missing uid or spreadsheet id",
      });
    }

    // Get existing spreadsheet to preserve data
    const existing = await getSpreadsheetById(uid, id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Spreadsheet not found",
      });
    }

    const updates = {};
    if (templateName) updates.templateName = templateName;
    if (platform) updates.platform = platform;
    if (columns) updates.columns = columns;
    if (rowMode) updates.rowMode = rowMode;

    const updated = await updateSpreadsheet(uid, id, updates);

    console.log(`Spreadsheet updated: ${id}`);

    return res.json({
      success: true,
      spreadsheet: updated,
    });
  } catch (err) {
    console.error("Error updating spreadsheet:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to update spreadsheet",
    });
  }
});

/* ======================================================
   DELETE /api/spreadsheets/:id
   Delete a spreadsheet template
   
   ✅ 修改: 从 Firebase Storage 删除文件
   ✅ 新增: 同时删除 spreadsheetResults 中的关联数据
====================================================== */
router.delete("/spreadsheets/:id", async (req, res) => {
  try {
    const { uid } = req.query;
    const { id } = req.params;

    if (!uid || !id) {
      return res.status(400).json({
        success: false,
        error: "Missing uid or spreadsheet id",
      });
    }

    // Get spreadsheet to find storage path
    const spreadsheet = await getSpreadsheetById(uid, id);

    // ✅ 修改: 从 Firebase Storage 删除文件（替代本地文件系统）
    if (spreadsheet && spreadsheet.storagePath) {
      await deleteSpreadsheetFromStorage(spreadsheet.storagePath);
    }

    // ✅ 新增: 删除关联的 spreadsheetResults 数据
    await deleteSpreadsheetResults(uid, id);

    const deleted = await deleteSpreadsheet(uid, id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: "Spreadsheet not found",
      });
    }

    console.log(`Spreadsheet deleted: ${id} (including results and storage file)`);

    return res.json({
      success: true,
      message: "Spreadsheet deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting spreadsheet:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to delete spreadsheet",
    });
  }
});

export default router;