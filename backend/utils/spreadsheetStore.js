// backend/utils/spreadsheetStore.js
import fs from "fs";
import path from "path";
import { getDB, isUsingLocal } from "./firebaseAdmin.js";

const LOCAL_PATH = path.join(process.cwd(), "spreadsheets.local.json");

/** Ensure local fallback file exists */
function ensureLocalFile() {
  if (!fs.existsSync(LOCAL_PATH)) {
    fs.writeFileSync(LOCAL_PATH, JSON.stringify({ byUid: {} }, null, 2));
  }
}

/**
 * Normalize column data to ensure multiValue and separator are always present
 * IMPORTANT: Preserve enableGeneration for AI generation settings
 */
function normalizeColumns(columns) {
  if (!columns || !Array.isArray(columns)) return [];
  
  return columns.map((col) => {
    const normalized = {
      name: col.name || "",
      sampleValues: col.sampleValues || [],
      role: col.role || null,
      multiValue: col.multiValue ?? false,
      separator: col.separator ?? ",",
    };
    
    // Preserve enableGeneration for AI generation settings
    if (col.enableGeneration !== undefined) {
      normalized.enableGeneration = col.enableGeneration;
    }
    
    return normalized;
  });
}

/**
 * Normalize spreadsheet document for consistent output
 */
function normalizeSpreadsheetDoc(doc, id) {
  return {
    id: id || doc.id,
    templateName: doc.templateName || "",
    platform: doc.platform || "Generic",
    fileType: doc.fileType || "CSV",
    originalFileName: doc.originalFileName || "",
    storagePath: doc.storagePath || "",
    rowCount: doc.rowCount || 0,
    headers: doc.headers || [],
    columns: normalizeColumns(doc.columns),
    status: doc.status || "uploaded",
    rowMode: doc.rowMode || "PER_PRODUCT",
    groupByField: doc.groupByField || "product_id", // Default to product_id for PER_IMAGE
    createdAt: doc.createdAt || Date.now(),
    updatedAt: doc.updatedAt || Date.now(),
  };
}

/* ======================================================
   Get all spreadsheet templates for a user
====================================================== */
export async function getUserSpreadsheets(uid) {
  if (!uid) return [];

  const db = getDB();
  const usingLocal = isUsingLocal();

  if (!usingLocal && db) {
    try {
      const spreadsheetsRef = db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets");

      const snapshot = await spreadsheetsRef.orderBy("createdAt", "desc").get();

      if (snapshot.empty) return [];

      return snapshot.docs.map((doc) => normalizeSpreadsheetDoc(doc.data(), doc.id));
    } catch (err) {
      console.error("Firestore getUserSpreadsheets failed:", err.message);
      return [];
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const userSpreadsheets = data.byUid[uid] || {};
  return Object.values(userSpreadsheets)
    .map((s) => normalizeSpreadsheetDoc(s, s.id))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* ======================================================
   Count spreadsheet templates for a user (for limit check)
   Returns count, limiting query to 11 docs (we only care if > 10)
====================================================== */
export async function countUserSpreadsheets(uid) {
  if (!uid) return 0;

  const db = getDB();
  const usingLocal = isUsingLocal();

  if (!usingLocal && db) {
    try {
      const snapshot = await db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets")
        .limit(11)
        .get();

      return snapshot.size;
    } catch (err) {
      console.error("Firestore countUserSpreadsheets failed:", err.message);
      return 0;
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const userSpreadsheets = data.byUid[uid] || {};
  return Object.keys(userSpreadsheets).length;
}

/* ======================================================
   Get a single spreadsheet template
====================================================== */
export async function getSpreadsheetById(uid, spreadsheetId) {
  if (!uid || !spreadsheetId) return null;

  const db = getDB();
  const usingLocal = isUsingLocal();

  if (!usingLocal && db) {
    try {
      const docRef = db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets")
        .doc(spreadsheetId);

      const snapshot = await docRef.get();

      if (!snapshot.exists) return null;

      return normalizeSpreadsheetDoc(snapshot.data(), snapshot.id);
    } catch (err) {
      console.error("Firestore getSpreadsheetById failed:", err.message);
      return null;
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const userSpreadsheets = data.byUid[uid] || {};
  const spreadsheet = userSpreadsheets[spreadsheetId];
  
  if (spreadsheet) {
    return normalizeSpreadsheetDoc(spreadsheet, spreadsheetId);
  }
  return null;
}

/* ======================================================
   Create a new spreadsheet template (after upload)
   Sets status = "uploaded"
====================================================== */
export async function createSpreadsheet(uid, spreadsheetId, templateData) {
  if (!uid || !spreadsheetId) {
    console.warn("Missing uid or spreadsheetId, skip create");
    return null;
  }

  const db = getDB();
  const usingLocal = isUsingLocal();

  const now = Date.now();
  const dataToSave = {
    templateName: templateData.templateName || "",
    platform: templateData.platform || "Generic",
    fileType: templateData.fileType || "CSV",
    originalFileName: templateData.originalFileName || "",
    storagePath: templateData.storagePath || "",
    rowCount: templateData.rowCount || 0,
    headers: templateData.headers || [],
    columns: normalizeColumns(templateData.columns),
    status: "uploaded", // Initial status after upload
    rowMode: templateData.rowMode || "PER_PRODUCT",
    createdAt: now,
    updatedAt: now,
  };

  if (!usingLocal && db) {
    try {
      const docRef = db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets")
        .doc(spreadsheetId);

      await docRef.set(dataToSave);

      console.log(
        `[Firestore] Spreadsheet created: users/${uid}/spreadsheets/${spreadsheetId} (status: uploaded, rowMode: ${dataToSave.rowMode})`
      );

      return { id: spreadsheetId, ...dataToSave };
    } catch (err) {
      console.error("Firestore createSpreadsheet failed:", err.message);
      throw err;
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));

  if (!data.byUid[uid]) {
    data.byUid[uid] = {};
  }

  data.byUid[uid][spreadsheetId] = {
    id: spreadsheetId,
    ...dataToSave,
  };

  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
  console.log(`[Local] Spreadsheet created: ${spreadsheetId} (status: uploaded, rowMode: ${dataToSave.rowMode})`);

  return { id: spreadsheetId, ...dataToSave };
}

/* ======================================================
   Update spreadsheet mappings and set status = "mapped"
   Includes rowMode, groupByField, and column-level multiValue/separator
====================================================== */
export async function updateSpreadsheetMappings(uid, spreadsheetId, columns, rowMode, groupByField) {
  if (!uid || !spreadsheetId) {
    console.warn("Missing uid or spreadsheetId, skip update");
    return null;
  }

  const db = getDB();
  const usingLocal = isUsingLocal();

  // Check if all important fields are mapped
  const normalizedColumns = normalizeColumns(columns);
  const mappedRoles = normalizedColumns.filter((c) => c.role && c.role !== "ignore").map((c) => c.role);
  const hasMinimumMapping = mappedRoles.length > 0;

  const updateData = {
    columns: normalizedColumns,
    rowMode: rowMode || "PER_PRODUCT",
    groupByField: groupByField || "product_id", // Default to product_id for PER_IMAGE mode
    status: hasMinimumMapping ? "mapped" : "partial",
    updatedAt: Date.now(),
  };

  if (!usingLocal && db) {
    try {
      const docRef = db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets")
        .doc(spreadsheetId);

      await docRef.update(updateData);

      console.log(
        `[Firestore] Spreadsheet mappings updated: ${spreadsheetId} (status: ${updateData.status}, rowMode: ${updateData.rowMode}, groupByField: ${updateData.groupByField})`
      );

      const updated = await docRef.get();
      return normalizeSpreadsheetDoc(updated.data(), spreadsheetId);
    } catch (err) {
      console.error("Firestore updateSpreadsheetMappings failed:", err.message);
      throw err;
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));

  if (data.byUid[uid] && data.byUid[uid][spreadsheetId]) {
    data.byUid[uid][spreadsheetId] = {
      ...data.byUid[uid][spreadsheetId],
      ...updateData,
    };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
    console.log(`[Local] Spreadsheet mappings updated: ${spreadsheetId} (status: ${updateData.status}, rowMode: ${updateData.rowMode}, groupByField: ${updateData.groupByField})`);
    return normalizeSpreadsheetDoc(data.byUid[uid][spreadsheetId], spreadsheetId);
  }

  return null;
}

/* ======================================================
   Update spreadsheet metadata (name, platform, etc.)
====================================================== */
export async function updateSpreadsheet(uid, spreadsheetId, updates) {
  if (!uid || !spreadsheetId) {
    console.warn("Missing uid or spreadsheetId, skip update");
    return null;
  }

  const db = getDB();
  const usingLocal = isUsingLocal();

  // Normalize columns if provided
  const normalizedUpdates = { ...updates };
  if (normalizedUpdates.columns) {
    normalizedUpdates.columns = normalizeColumns(normalizedUpdates.columns);
  }
  normalizedUpdates.updatedAt = Date.now();

  if (!usingLocal && db) {
    try {
      const docRef = db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets")
        .doc(spreadsheetId);

      await docRef.update(normalizedUpdates);

      console.log(`[Firestore] Spreadsheet updated: ${spreadsheetId}`);

      const updated = await docRef.get();
      return normalizeSpreadsheetDoc(updated.data(), spreadsheetId);
    } catch (err) {
      console.error("Firestore updateSpreadsheet failed:", err.message);
      throw err;
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));

  if (data.byUid[uid] && data.byUid[uid][spreadsheetId]) {
    data.byUid[uid][spreadsheetId] = {
      ...data.byUid[uid][spreadsheetId],
      ...normalizedUpdates,
    };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
    console.log(`[Local] Spreadsheet updated: ${spreadsheetId}`);
    return normalizeSpreadsheetDoc(data.byUid[uid][spreadsheetId], spreadsheetId);
  }

  return null;
}

/* ======================================================
   Delete a spreadsheet template
====================================================== */
export async function deleteSpreadsheet(uid, spreadsheetId) {
  if (!uid || !spreadsheetId) {
    console.warn("Missing uid or spreadsheetId, skip delete");
    return false;
  }

  const db = getDB();
  const usingLocal = isUsingLocal();

  if (!usingLocal && db) {
    try {
      const docRef = db
        .collection("users")
        .doc(uid)
        .collection("spreadsheets")
        .doc(spreadsheetId);

      await docRef.delete();

      console.log(
        `[Firestore] Spreadsheet deleted: users/${uid}/spreadsheets/${spreadsheetId}`
      );

      return true;
    } catch (err) {
      console.error("Firestore deleteSpreadsheet failed:", err.message);
      throw err;
    }
  }

  // Local fallback
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));

  if (data.byUid[uid] && data.byUid[uid][spreadsheetId]) {
    delete data.byUid[uid][spreadsheetId];
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
    console.log(`[Local] Spreadsheet deleted: ${spreadsheetId}`);
    return true;
  }

  return false;
}