# ImageFlow AI — Snap to Sell

**The all-in-one AI platform that takes e-commerce sellers from a single product photo to a complete, platform-ready listing — images, copy, and catalog management in one place. Powered by Google Gemini.**

**Built entirely by a solo developer.**

---

## The Problem

**3.5 million small and medium e-commerce sellers** share the same daily struggle: getting a product from a single photo to a live listing takes far too long, and requires constant switching between disconnected tools.

Here's what that workflow actually looks like today:

**1. Image generation is broken.** A seller takes one product photo and opens an AI image generator, hoping to batch-create multiple shots from different angles. But most tools can't understand "multiple images, each from a different angle" — they generate all angles crammed into a single image, making the output unusable. One angle per image, consistently and professionally? Almost no tool gets this right.

**2. File naming is manual labor.** Even when images do come out right, each file needs to be renamed according to the product's SKU before uploading to any platform. Current generation tools just spit out `image_001.png` — sellers are left manually renaming hundreds of files.

**3. Marketing copy is fragmented.** Beyond images, every product listing needs marketing descriptions. Sellers running stores on multiple platforms (Shopify, Amazon, eBay, AliExpress) must research each platform's SEO rules, character limits, and traffic-driving best practices separately, then write tailored copy for each. Even after writing it, they copy-paste each description into spreadsheet cells one by one.

**4. Assets pile up with nowhere to go.** Images and copy accumulate on sellers' computers as loose files and scattered spreadsheets. Listing a single product means manually copying and pasting images, descriptions, tags, and metadata into each platform — over and over. Updating a product's assets is the same painful process all over again.

**5. PIM tools don't solve the root problem.** Some sellers adopt Product Information Management (PIM) software to help with bulk listing. But PIM only handles the *distribution* of assets — it can't *generate or update* the images and copy themselves. When a seller is unhappy with a product photo or description, they're back to square one: switching between an image generator, a copywriting tool, and a PIM system.

**The result:** sellers are trapped switching between apps that each do only one thing — generate images, *or* write copy, *or* manage product data. No tool combines all three into a single, connected workflow.

---

## The Solution

**ImageFlow AI unifies image generation, marketing copywriting, and product information management into one integrated system.** From a single product photo to a platform-ready listing — without leaving the app.

### Two-Layer AI Image Generation

ImageFlow solves the "multiple angles in one image" problem with a unique two-layer pipeline:

- **Layer 1 — Semantic Decomposition (Gemini 3 Flash):** The user writes one prompt (e.g., "generate 4 product shots from different angles on a marble table"). Gemini 3 Flash analyzes the prompt and decomposes it into N separate, specific scene descriptions — understanding that "different angles" means one angle per image, while preserving the shared context (same product, same marble table, same lighting mood).

- **Layer 2 — Parallel Professional Generation (Gemini 3 Pro Image):** Each of the N decomposed prompts is sent simultaneously to Gemini 3 Pro Image for high-fidelity generation at the user's chosen resolution (1K / 2K / 4K) and aspect ratio (10 options). The result: N individual, professional product images — each with a distinct angle or scene, each as a separate file.

### Flexible AI Marketing Copy (Gemini 3 Flash)

Powered by Gemini 3 Flash, ImageFlow generates marketing copy tailored to each platform's rules and high-traffic selling points. When saving to a spreadsheet, users can select which fields they want AI to generate copy for — not just preset SEO descriptions, but any field in their catalog. ImageFlow also provides built-in generation for SEO, GEO (geo-targeted), GSO (Google Shopping), tags, meta titles, and more. Users click to switch between platforms — Shopify, Amazon, eBay, and 9 more — and the copy regenerates accordingly. The entire system is flexibly customizable to match each seller's actual spreadsheet structure. No manual research, no copy-paste.

### Built-In Product Information Management

After generation, all assets — images and copy — flow directly into the seller's product catalog:

- **Download or Save to Spreadsheet:** Users can download files directly (with automatic SKU-based naming), or save everything into a product spreadsheet imported from their merchant platform.
- **CDN-Hosted Images:** Every generated image automatically receives a universally accessible CDN URL during generation. When image URLs are saved into a product spreadsheet and imported into any merchant platform, the images load correctly — they won't be blocked or unreadable because of domain restrictions.
- **In-App Catalog Editing:** Users can organize, update, and manage all spreadsheet data within ImageFlow — then one-click export the updated catalog for direct import into any merchant platform.
- **Cross-Spreadsheet Save:** Generate content and images from one catalog and save or override assets directly into another — a daily workflow for multi-platform sellers who maintain separate source and listing spreadsheets.

### Demo & Platform Compatibility

ImageFlow is currently in hackathon demo stage. While direct API integration with merchant platforms for one-click batch uploading or updating product assets is planned for future development, the spreadsheet-based workflow already supports any platform that accepts CSV/XLSX upload. Most merchant platforms require real business credentials to access their product spreadsheet templates, so the demo includes sample spreadsheets from multiple platforms. The Dianxiaomi ERP platform spreadsheet is real and fully functional for testing product import (no merchant credentials required). Note that Dianxiaomi's website and spreadsheet field names are in Chinese — testers can use Google Chrome's built-in page translation to navigate in English.

---

## Key Features

### AI Image Generation (Gemini 3 Pro)
- Two-layer pipeline: semantic prompt decomposition → parallel image generation
- Up to 8 professional product images per session from a single reference photo
- Support for up to 14 reference images for visual consistency across shots
- 10 aspect ratios (1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 5:4, 4:5, 21:9) and 3 resolution tiers (1K, 2K, 4K)
- Auto/Manual generation strategies — let AI plan the shots, or specify each scene yourself

### AI Content Generation (Gemini 3 Flash)
- **Flexible Field Selection**: When saving to a spreadsheet, users choose which fields to generate AI copy for — fully customizable to match their catalog structure
- **SEO Descriptions**: Platform-specific product descriptions optimized for search across 12 platforms
- **GEO Descriptions**: Geo-targeted marketing copy for regional audiences
- **GSO Descriptions**: Google Shopping-optimized structured content
- **Tags, Meta Titles, Meta Descriptions, SEO Titles**: Complete metadata generation in one click
- **Custom Fields**: Define your own fields beyond the built-in types — ImageFlow generates content for those too

### Product Information Management
- Upload existing product catalogs (CSV, XLS, XLSX) — first-time imports require manual column mapping to avoid errors; once a platform template exists, subsequent imports from the same platform auto-map automatically
- Browse products visually with thumbnail previews
- Edit, organize, and update product data directly in the app
- **Cross-spreadsheet save**: Generate content from Catalog A, save or override assets into Catalog B
- **SKU-Level Grouping (PER_PRODUCT / PER_IMAGE modes):** Automatically groups rows by the finest-level SKU, so users can batch-process images and copy per SKU. Handles spreadsheets where each SKU spans multiple rows (PER_IMAGE) by grouping them into a single navigable unit.
- One-click export for direct import into any merchant platform
- Automatic SKU-based file naming on download — sequence numbers assigned instantly based on download order

### SKU Template Engine
- Pattern-based naming with configurable variables (brand initials, category codes, color, size, custom fields, sequence numbers, and more)
- Sequence numbers are automatically assigned at download time based on download order — no need to manually adjust file names or worry about ordering
- Configurable separators, prefix/suffix, digit padding (e.g., 001 vs 0001)
- Up to 20 templates per account

### Production Infrastructure
- **CDN-hosted images**: Generated images automatically get universally accessible URLs
- **Real-time credits**: Firestore-powered live balance with instant deduction and refund on failure
- **Stripe billing**: Credit packs and monthly subscriptions with full lifecycle management (fully developed; currently in Stripe sandbox mode during the competition period — real payments will be enabled post-competition. Subscription checkout and confirmation emails require authenticated accounts and do not function in anonymous demo mode)
- **Demo mode**: Anonymous login with pre-loaded sample catalogs — try without signing up
- **Image proxy**: Built-in proxy for Chinese CDN anti-hotlinking (Alibaba, 1688, Taobao)
- **HEIC support**: Three-tier iPhone photo conversion (Sharp → heic-convert → sips)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React + TypeScript)        │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  LeftPanel   │  │  PromptCard  │  │  ResultColumn     │  │
│  │  - Upload    │  │  - Prompt    │  │  - Generated imgs │  │
│  │  - Import    │  │  - Settings  │  │  - Descriptions   │  │
│  │  - Target    │  │  - SKU       │  │  - Save/Export    │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘  │
│         └────────────────┼───────────────────┘              │
│                          │ SSE (Server-Sent Events)         │
├──────────────────────────┼──────────────────────────────────┤
│                   Backend (Node.js + Express)               │
│                          │                                  │
│  ┌───────────────────────┼────────────────────────────┐     │
│  │        Two-Layer Generation Pipeline               │     │
│  │  Layer 1: Prompt Decomposition (Gemini 3 Flash)    │     │
│  │  Layer 2: Image Generation (Gemini 3 Pro → fallback)│    │
│  │  + Description Generation (Gemini 3 Flash)         │     │
│  │  + CDN Upload (Firebase Storage)                   │     │
│  │  + Credits & History (Firestore)                   │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Spreadsheet  │  │   Stripe     │  │  Firebase Admin  │  │
│  │ Processing   │  │   Billing    │  │  Auth / Store /  │  │
│  │ (XLSX/CSV)   │  │   Webhooks   │  │  Storage         │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### How the Two-Layer Pipeline Works

1. **User Input** — The user provides a prompt like "Generate 4 product shots from different angles, modern kitchen background" plus one or more reference photos.

2. **Layer 1: Semantic Decomposition** — Gemini 3 Flash analyzes the prompt and images, then decomposes the request into N specific scene descriptions (e.g., "Front view medium shot on marble countertop", "Low angle close-up with morning light", "Side profile wide shot with kitchen island background", "3/4 view highlighting product texture"). It understands that shared context (same kitchen, same product) should be preserved, while each shot gets a unique angle/composition.

3. **Layer 2: Parallel Generation** — Each decomposed prompt is sent simultaneously (in parallel) to Gemini 3 Pro Image with all reference images attached as visual anchors. If Pro fails, automatic fallback to Gemini 2.5 Flash Image. Resolution is clamped per model capability (Pro: up to 4K, Flash: 1K).

4. **Description Generation** — In parallel with image generation, Gemini 3 Flash generates platform-specific marketing copy using full product context from the spreadsheet.

5. **CDN Upload & Save** — Generated images are uploaded to Firebase Storage with public CDN URLs. Users can download (with SKU naming) or save directly to their spreadsheet template.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **AI** | Google Gemini 3 Pro Image (image generation), Gemini 3 Flash (prompt decomposition + descriptions), Gemini 2.5 Flash Image (fallback) |
| **Frontend** | React 18, TypeScript, Vite, styled-components, React Router v6 |
| **Backend** | Node.js, Express, SSE for real-time progress |
| **Database** | Firebase Firestore (user data, spreadsheet templates, generation history, results) |
| **Storage** | Firebase Storage (generated images CDN, spreadsheet files) |
| **Auth** | Firebase Authentication (email/password, Google OAuth, anonymous demo) |
| **Payments** | Stripe (Checkout, Billing Portal, Webhooks for subscriptions + one-time purchases) |
| **Email** | Resend API (purchase confirmations, subscription updates) |
| **Image Processing** | Sharp + heic-convert (HEIC→JPEG conversion), Canvas API (client-side resize) |
| **Spreadsheets** | SheetJS (XLSX/CSV parsing), xlwt via Python (BIFF8 .xls export for long cell values) |
| **Deployment** | Google Cloud Run (backend), Firebase Hosting (frontend) |

---

## Impact

### Eliminating App-Switching
Today's sellers juggle 3+ tools: an image generator, a copywriting app, and a PIM system. ImageFlow replaces all three with a single workflow. The time savings compound across hundreds of products — what used to take a full workday of switching, copy-pasting, and manual renaming becomes a streamlined process within one interface.

### Solving the "Multiple Angles" Problem
By decomposing user intent into separate per-image prompts before generation, ImageFlow produces results that actually match what sellers need: one angle per image, consistent product appearance, ready to use. This semantic decomposition approach is a fundamental UX improvement over existing AI image tools.

### CDN-Ready Output
Generated images aren't just files on a hard drive — they're instantly hosted on a CDN with universally accessible URLs. When these URLs are saved into a product spreadsheet and imported into any merchant platform, the images load correctly without domain restrictions. This eliminates the entire "upload images to a hosting service, copy URLs into spreadsheet" step that sellers currently do manually.

### Cross-Border Accessibility
Built-in support for Chinese e-commerce CDNs (image proxy for anti-hotlinking), bilingual interface considerations, and compatibility with ERP platforms like Dianxiaomi make ImageFlow specifically designed for the cross-border e-commerce market — not just Western sellers.

---

## Quick Start

### Prerequisites
- Node.js 18+
- Firebase project (Auth, Firestore, Storage enabled)
- Google AI Studio API key (Gemini access)
- Stripe account (for billing features)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-repo/imageflow-ai.git

# Backend
cd backend
cp .env.example .env  # Fill in API keys
npm install
npm start             # Runs on port 8080

# Frontend
cd frontend
cp .env.example .env  # Fill in Firebase config + backend URL
npm install
npm run dev           # Runs on port 5173
```

---

## Demo

Try ImageFlow without signing upon the login page. The link is in the testing instruction. You'll get 5,000 credits and two pre-loaded sample catalogs (Shopify jewelry export + Dianxiaomi ERP product catalog) to explore the full workflow.
