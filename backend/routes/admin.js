import express from "express";
import { adminUpdateUser, getUser } from "../services/userStore.js";

const router = express.Router();

/**
 * GET /api/admin/user/:uid
 * 返回用户档案
 */
router.get("/admin/user/:uid", async (req, res) => {
  try {
    const user = await getUser(req.params.uid);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/update-user
 * body: { uid, updates: { credits, status, role, ... } }
 */
router.post("/admin/update-user", async (req, res) => {
  const { uid, updates } = req.body;
  if (!uid || !updates)
    return res.status(400).json({ error: "Missing uid or updates" });

  try {
    await adminUpdateUser(uid, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;