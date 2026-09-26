import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { GoogleMapsScraper } from './scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// State Management
let currentScraper = null;
let isScraping = false;
let leads = [];
let logs = [];
let sseClients = new Set();

/**
 * Broadcast event to all connected Server-Sent Events clients
 */
function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

function appendLog(logObj) {
  logs.push(logObj);
  // Keep last 300 logs in memory
  if (logs.length > 300) logs.shift();
  broadcast('log', logObj);
}

// SSE Stream Endpoint
app.get('/api/scrape/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  sseClients.add(res);

  // Send initial state to newly connected client
  res.write(`event: init\ndata: ${JSON.stringify({
    isScraping,
    leads,
    logs: logs.slice(-50)
  })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Start Scraping Endpoint
app.post('/api/scrape/start', async (req, res) => {
  if (isScraping) {
    return res.status(400).json({ error: 'A scraping job is already running.' });
  }

  const { keyword, location, maxResults = 20, deepEmailExtraction = false } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'Keyword is required (e.g., "Dentist").' });
  }
  if (!location || !location.trim()) {
    return res.status(400).json({ error: 'Location is required (e.g., "Casablanca").' });
  }

  // Reset leads and logs for fresh job
  leads = [];
  logs = [];
  isScraping = true;

  broadcast('status', { isScraping: true, message: 'Scraping started' });

  currentScraper = new GoogleMapsScraper({
    keyword,
    location,
    maxResults: parseInt(maxResults, 10) || 20,
    deepEmailExtraction: !!deepEmailExtraction,
    headless: true
  });

  currentScraper.on('log', (logObj) => {
    appendLog(logObj);
  });

  currentScraper.on('lead', (lead) => {
    leads.push(lead);
    broadcast('lead', lead);
  });

  currentScraper.on('progress', (progress) => {
    broadcast('progress', progress);
  });

  currentScraper.on('done', (result) => {
    isScraping = false;
    broadcast('status', { isScraping: false, message: result.reason, total: result.total });
    currentScraper = null;
  });

  currentScraper.on('error', (err) => {
    isScraping = false;
    broadcast('status', { isScraping: false, error: err.message });
    currentScraper = null;
  });

  // Run asynchronously without blocking response
  currentScraper.run().catch((err) => {
    appendLog({
      timestamp: new Date().toLocaleTimeString(),
      message: `Fatal error during execution: ${err.message}`,
      type: 'error'
    });
    isScraping = false;
    broadcast('status', { isScraping: false, error: err.message });
    currentScraper = null;
  });

  res.json({ success: true, message: 'Scraper started successfully.' });
});

// Stop Scraping Endpoint
app.post('/api/scrape/stop', async (req, res) => {
  if (!isScraping || !currentScraper) {
    return res.status(400).json({ error: 'No active scraping job to stop.' });
  }

  appendLog({
    timestamp: new Date().toLocaleTimeString(),
    message: 'Stopping scraper as requested by user...',
    type: 'warn'
  });

  try {
    await currentScraper.stop();
  } catch (err) {
    // Ignore stop errors
  }

  isScraping = false;
  currentScraper = null;
  broadcast('status', { isScraping: false, message: 'Scraping stopped by user' });

  res.json({ success: true, message: 'Scraper stopped.' });
});

// Get leads endpoint
app.get('/api/leads', (req, res) => {
  res.json({
    isScraping,
    count: leads.length,
    leads
  });
});

// CSV Export Endpoint (RFC 4180 compliant with UTF-8 BOM for Excel & Sheets)
app.get('/api/export/csv', (req, res) => {
  if (leads.length === 0) {
    return res.status(400).json({ error: 'No leads available to export.' });
  }

  const cleanKeyword = (req.query.keyword || 'leads').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'leads';
  const cleanLocation = (req.query.location || 'gmap').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'gmap';
  const filename = `${cleanKeyword}_${cleanLocation}_${Date.now()}.csv`;

  const headers = ['#', 'Name', 'Category', 'Phone', 'Website', 'Email', 'Rating', 'Reviews', 'Address', 'Status'];
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const cleanStr = String(val).replace(/[\r\n]+/g, ' ').trim();
    return `"${cleanStr.replace(/"/g, '""')}"`;
  };

  const csvRows = [];
  csvRows.push(headers.map(h => `"${h}"`).join(','));

  leads.forEach((l, idx) => {
    csvRows.push([
      idx + 1,
      escapeCsv(l.name),
      escapeCsv(l.category),
      escapeCsv(l.phone),
      escapeCsv(l.website),
      escapeCsv(l.email),
      escapeCsv(l.rating),
      escapeCsv(l.reviews),
      escapeCsv(l.address),
      escapeCsv(l.status)
    ].join(','));
  });

  const BOM = '\uFEFF';
  const csvContent = BOM + csvRows.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(Buffer.from(csvContent, 'utf-8'));
});

// Native Formatted Excel (.xlsx) Export Endpoint
app.get('/api/export/excel', async (req, res) => {
  if (leads.length === 0) {
    return res.status(400).json({ error: 'No leads available to export.' });
  }

  const cleanKeyword = (req.query.keyword || 'leads').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'leads';
  const cleanLocation = (req.query.location || 'gmap').toString().trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'gmap';
  const filename = `${cleanKeyword}_${cleanLocation}_${Date.now()}.xlsx`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GMap Leads Scraper';
  workbook.created = new Date();

  // Create sheet with frozen header row
  const sheet = workbook.addWorksheet('GMap Leads', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  // Setup Column Definitions & Widths
  sheet.columns = [
    { header: '#', key: 'index', width: 8 },
    { header: 'Business Name', key: 'name', width: 36 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Phone Number', key: 'phone', width: 20 },
    { header: 'Website', key: 'website', width: 34 },
    { header: 'Email Address', key: 'email', width: 32 },
    { header: 'Rating', key: 'rating', width: 12 },
    { header: 'Reviews', key: 'reviews', width: 12 },
    { header: 'Address', key: 'address', width: 45 },
    { header: 'Status', key: 'status', width: 18 }
  ];

  // Professional Slate Header Styling
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Slate-800
    };
    cell.font = {
      name: 'Segoe UI',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true
    };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } }
    };
  });

  // Enable AutoFilter dropdowns
  sheet.autoFilter = {
    from: 'A1',
    to: 'J1'
  };

  // Add Formatted Data Rows
  leads.forEach((l, idx) => {
    const isEven = idx % 2 === 1;
    const row = sheet.addRow({
      index: idx + 1,
      name: l.name || 'N/A',
      category: l.category || 'N/A',
      phone: l.phone || 'N/A',
      website: l.website && l.website !== 'N/A' ? { text: l.website, hyperlink: l.website } : 'N/A',
      email: l.email && l.email !== 'N/A' ? { text: l.email, hyperlink: `mailto:${l.email}` } : 'N/A',
      rating: l.rating && l.rating !== 'N/A' ? `★ ${l.rating}` : '-',
      reviews: l.reviews && l.reviews !== 'N/A' ? parseInt(l.reviews, 10) || l.reviews : '0',
      address: (l.address || 'N/A').replace(/[\r\n]+/g, ' ').trim(),
      status: l.status || 'Verified'
    });

    row.height = 24;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      // Alternating row background for clean scanning
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }

      // Base borders and font
      cell.font = cell.font || { name: 'Segoe UI', size: 10, color: { argb: 'FF1E293B' } };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFF1F5F9' } }
      };

      // Column-specific alignments
      if (colNumber === 1) {
        // Index column (#)
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF64748B' } };
      } else if (colNumber === 2) {
        // Business Name
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      } else if (colNumber === 4 || colNumber === 7 || colNumber === 8 || colNumber === 10) {
        // Phone, Rating, Reviews, Status
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }

      // Clickable Website Hyperlink Style
      if (colNumber === 5 && l.website && l.website !== 'N/A') {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF2563EB' }, underline: true };
      }

      // Clickable Email Hyperlink Style
      if (colNumber === 6 && l.email && l.email !== 'N/A') {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF059669' }, underline: true };
      }

      // Status Badge Color
      if (colNumber === 10) {
        if (l.status === 'Email Found') {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF047857' } };
        } else if (l.status === 'Phone Found') {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF1D4ED8' } };
        }
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(Buffer.from(buffer));
});

// Start Express Server
const server = app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 GMap Leads Scraper GUI is running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use by another process.`);
    console.error(`💡 To run on a different port, set the PORT environment variable:`);
    console.error(`   $env:PORT=3001; npm start   (PowerShell)`);
    console.error(`   set PORT=3001 && npm start  (CMD)\n`);
  } else {
    console.error(`❌ Server error:`, err);
  }
  process.exit(1);
});
