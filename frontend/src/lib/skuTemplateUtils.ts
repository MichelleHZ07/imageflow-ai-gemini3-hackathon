/**
 * SKU Template Firebase Utilities
 * Manages SKU templates in a dedicated subcollection: users/{userId}/skuTemplates/{templateId}
 */

import {
  getFirestore,
  doc,
  collection,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { SkuRule } from "../components/SkuRuleModal";

const db = getFirestore();

/**
 * Get all SKU templates for a user
 */
export async function getUserSkuTemplates(
  userId: string
): Promise<Record<string, SkuRule>> {
  try {
    const templatesRef = collection(db, "users", userId, "skuTemplates");
    const q = query(templatesRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    const templates: Record<string, SkuRule> = {};
    snapshot.forEach((doc) => {
      const data = doc.data();
      templates[data.templateName] = {
        templateName: data.templateName,
        pattern: data.pattern,
        variables: data.variables || [],
        separator: data.separator || "-",
        prefix: data.prefix || "",
        suffix: data.suffix || "",
        seqDigits: data.seqDigits || 3,
        definitions: data.definitions || {},
      };
    });

    return templates;
  } catch (error) {
    console.error("❌ Error loading SKU templates:", error);
    throw error;
  }
}

/**
 * Get a specific SKU template
 */
export async function getSkuTemplate(
  userId: string,
  templateName: string
): Promise<SkuRule | null> {
  try {
    const templateRef = doc(
      db,
      "users",
      userId,
      "skuTemplates",
      templateName
    );
    const snapshot = await getDoc(templateRef);

    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data();
    return {
      templateName: data.templateName,
      pattern: data.pattern,
      variables: data.variables || [],
      separator: data.separator || "-",
      prefix: data.prefix || "",
      suffix: data.suffix || "",
      seqDigits: data.seqDigits || 3,
      definitions: data.definitions || {},
    };
  } catch (error) {
    console.error("❌ Error loading SKU template:", error);
    throw error;
  }
}

/**
 * Save or update an SKU template
 */
export async function saveSkuTemplate(
  userId: string,
  template: SkuRule,
  setAsActive: boolean = true
): Promise<void> {
  try {
    const templateRef = doc(
      db,
      "users",
      userId,
      "skuTemplates",
      template.templateName
    );

    const templateData = {
      ...template,
      updatedAt: Timestamp.now(),
      createdAt: Timestamp.now(), // Will be ignored if document exists
    };

    // Use setDoc with merge to preserve createdAt
    await setDoc(templateRef, templateData, { merge: true });

    // Update the active template reference in the user document
    if (setAsActive) {
      const userRef = doc(db, "users", userId);
      await updateDoc(userRef, {
        activeSkuTemplate: template.templateName,
      });
    }

    console.log(`✅ SKU template "${template.templateName}" saved successfully`);
  } catch (error) {
    console.error("❌ Error saving SKU template:", error);
    throw error;
  }
}

/**
 * Delete an SKU template
 */
export async function deleteSkuTemplate(
  userId: string,
  templateName: string
): Promise<void> {
  try {
    const templateRef = doc(
      db,
      "users",
      userId,
      "skuTemplates",
      templateName
    );
    await deleteDoc(templateRef);

    // If this was the active template, clear it from user doc
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists() && userSnap.data().activeSkuTemplate === templateName) {
      await updateDoc(userRef, {
        activeSkuTemplate: "",
      });
    }

    console.log(`✅ SKU template "${templateName}" deleted successfully`);
  } catch (error) {
    console.error("❌ Error deleting SKU template:", error);
    throw error;
  }
}

/**
 * Set the active template
 */
export async function setActiveTemplate(
  userId: string,
  templateName: string
): Promise<void> {
  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      activeSkuTemplate: templateName,
    });
    console.log(`✅ Active template set to "${templateName}"`);
  } catch (error) {
    console.error("❌ Error setting active template:", error);
    throw error;
  }
}

/**
 * MIGRATION UTILITY: Move templates from user field to subcollection
 * This should be run once to migrate existing data
 */
export async function migrateSkuTemplates(userId: string): Promise<void> {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.log("❌ User document not found");
      return;
    }

    const userData = userSnap.data();
    const oldTemplates = userData.skuTemplates as Record<string, SkuRule>;

    if (!oldTemplates || Object.keys(oldTemplates).length === 0) {
      console.log("ℹ️ No templates to migrate");
      return;
    }

    console.log(`🔄 Migrating ${Object.keys(oldTemplates).length} templates...`);

    // Use batch to migrate all templates atomically
    const batch = writeBatch(db);

    for (const [templateName, template] of Object.entries(oldTemplates)) {
      const templateRef = doc(
        db,
        "users",
        userId,
        "skuTemplates",
        templateName
      );

      batch.set(templateRef, {
        ...template,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }

    // Remove the old field from user document
    batch.update(userRef, {
      skuTemplates: null, // This will delete the field
    });

    await batch.commit();

    console.log(`✅ Successfully migrated ${Object.keys(oldTemplates).length} templates`);
  } catch (error) {
    console.error("❌ Error during migration:", error);
    throw error;
  }
}

/**
 * Get the user's active template name
 */
export async function getActiveTemplateName(userId: string): Promise<string> {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return "";
    }

    return userSnap.data().activeSkuTemplate || "";
  } catch (error) {
    console.error("❌ Error getting active template:", error);
    return "";
  }
}