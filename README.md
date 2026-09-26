# GMap Leads Scraper UI (`gmap-leads-scraper-ui`)

A standalone, single-page local Web GUI for scraping Google Maps business leads using Playwright Chromium automation, Cheerio & Axios deep email discovery, and Express with real-time Server-Sent Events (SSE).

---

## ✨ Features

- **High-Fidelity Google Maps Extraction**:
  - Automatically searches target keyword + location.
  - Handles Google cookie consent modals automatically.
  - Scrolls the listing feed (`div[role="feed"]`).
  - Extracts Business Name, Phone Number, Website, Rating, Review Count, Category, and Address.
  - Realistic jitter delays (1–2 seconds) for resilient anti-detection.
- **Deep Email Discovery**:
  - Uses Axios & Cheerio to probe the business website.
  - Scans homepage and common contact subpages (`/contact`, `/about`) for valid business email addresses using regex and `mailto:` links.
- **Real-Time Streaming Web GUI**:
  - Live Playwright terminal log stream via Server-Sent Events (SSE).
  - Dynamic leads table with live additions and status badges.
  - Live metric counters (Total Leads, Phones, Websites, Emails).
  - Search / filter directly inside results table.
  - Start & Stop controls with immediate browser resource cleanup.
- **One-Click Export (Excel & CSV)**:
  - Native Microsoft Excel (`.xlsx`) export with auto-formatted column widths.
  - RFC 4180 compliant CSV export with UTF-8 BOM.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Start the Server
```bash
npm start
```

### 3. Open in Browser
Navigate to:
```
http://localhost:3000
```

---

## 🛠️ Architecture

- `/public`:
  - `index.html`: Responsive dark-mode single-page interface.
  - `style.css`: Modern glassmorphic styles, status pills, responsive layout.
  - `app.js`: SSE event handler, dynamic table updater, CSV generator.
- `/src`:
  - `server.js`: Express server hosting endpoints (`/api/scrape/start`, `/api/scrape/stop`, `/api/scrape/stream`, `/api/export/csv`).
  - `scraper.js`: Playwright Chromium scraping engine.
  - `emailFinder.js`: Cheerio + Axios website email extractor.
