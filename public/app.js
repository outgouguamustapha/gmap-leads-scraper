document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const scraperForm = document.getElementById('scraperForm');
  const keywordInput = document.getElementById('keywordInput');
  const locationInput = document.getElementById('locationInput');
  const maxResultsInput = document.getElementById('maxResultsInput');
  const deepEmailToggle = document.getElementById('deepEmailToggle');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadExcelBtn = document.getElementById('downloadExcelBtn');
  const downloadCsvBtn = document.getElementById('downloadCsvBtn');
  const clearTerminalBtn = document.getElementById('clearTerminalBtn');
  const autoScrollToggle = document.getElementById('autoScrollToggle');

  const systemStatusDot = document.getElementById('systemStatusDot');
  const systemStatusText = document.getElementById('systemStatusText');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const progressPercent = document.getElementById('progressPercent');

  const statTotalLeads = document.getElementById('statTotalLeads');
  const statPhones = document.getElementById('statPhones');
  const statWebsites = document.getElementById('statWebsites');
  const statEmails = document.getElementById('statEmails');
  const tableCountBadge = document.getElementById('tableCountBadge');

  const terminalLogs = document.getElementById('terminalLogs');
  const leadsTableBody = document.getElementById('leadsTableBody');
  const emptyTableRow = document.getElementById('emptyTableRow');
  const tableFilterInput = document.getElementById('tableFilterInput');

  // Application State
  let leads = [];
  let isScraping = false;
  let totalRequested = 20;
  let eventSource = null;

  // Initialize SSE Connection
  function setupEventSource() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/scrape/stream');

    eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.isScraping) {
          setScrapingState(true);
        }
        if (Array.isArray(data.leads) && data.leads.length > 0) {
          leads = data.leads;
          renderAllLeads();
        }
        if (Array.isArray(data.logs) && data.logs.length > 0) {
          terminalLogs.innerHTML = '';
          data.logs.forEach(appendTerminalLog);
        }
      } catch (err) {
        console.error('Failed to parse init event:', err);
      }
    });

    eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        setScrapingState(data.isScraping);
        if (data.message) {
          appendTerminalLog({
            timestamp: new Date().toLocaleTimeString(),
            type: data.isScraping ? 'info' : 'success',
            message: data.message
          });
        }
        if (data.error) {
          appendTerminalLog({
            timestamp: new Date().toLocaleTimeString(),
            type: 'error',
            message: data.error
          });
        }
      } catch (err) {
        console.error('Failed to parse status event:', err);
      }
    });

    eventSource.addEventListener('log', (e) => {
      try {
        const logObj = JSON.parse(e.data);
        appendTerminalLog(logObj);
      } catch (err) {
        console.error('Failed to parse log event:', err);
      }
    });

    eventSource.addEventListener('lead', (e) => {
      try {
        const lead = JSON.parse(e.data);
        leads.push(lead);
        appendLeadToTable(lead);
        updateStats();
      } catch (err) {
        console.error('Failed to parse lead event:', err);
      }
    });

    eventSource.addEventListener('progress', (e) => {
      try {
        const progress = JSON.parse(e.data);
        updateProgress(progress.count, progress.max);
      } catch (err) {
        console.error('Failed to parse progress event:', err);
      }
    });

    eventSource.onerror = () => {
      console.warn('SSE connection lost. Reconnecting in 3s...');
      setTimeout(setupEventSource, 3000);
    };
  }

  // Update Scraping State & UI Controls
  function setScrapingState(scraping) {
    isScraping = scraping;
    if (scraping) {
      systemStatusDot.className = 'status-dot active';
      systemStatusText.textContent = 'Scraping Active';
      startBtn.disabled = true;
      stopBtn.disabled = false;
      startBtn.querySelector('span').textContent = 'Scraping in progress...';
    } else {
      systemStatusDot.className = 'status-dot';
      systemStatusText.textContent = 'Ready';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      startBtn.querySelector('span').textContent = 'Start Scraping';
    }
  }

  // Append a log entry to the terminal
  function appendTerminalLog(log) {
    const line = document.createElement('div');
    line.className = 'terminal-line';

    const type = (log.type || 'info').toLowerCase();
    const tagClass = `tag-${type}`;

    line.innerHTML = `
      <span class="log-time">[${log.timestamp || new Date().toLocaleTimeString()}]</span>
      <span class="log-tag ${tagClass}">${type.toUpperCase()}</span>
      <span class="log-msg">${escapeHtml(log.message || '')}</span>
    `;

    terminalLogs.appendChild(line);

    if (autoScrollToggle.checked) {
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }
  }

  // Update Progress Bar
  function updateProgress(current, max) {
    const target = max || totalRequested || 20;
    const percentage = Math.min(100, Math.round((current / target) * 100));
    progressBar.style.width = `${percentage}%`;
    progressLabel.textContent = `Scraping progress: ${current} / ${target} leads`;
    progressPercent.textContent = `${percentage}%`;
  }

  // Update Dashboard Counters
  function updateStats() {
    statTotalLeads.textContent = leads.length;
    tableCountBadge.textContent = `${leads.length} records`;

    const phones = leads.filter(l => l.phone && l.phone !== 'N/A').length;
    const websites = leads.filter(l => l.website && l.website !== 'N/A').length;
    const emails = leads.filter(l => l.email && l.email !== 'N/A').length;

    statPhones.textContent = phones;
    statWebsites.textContent = websites;
    statEmails.textContent = emails;
  }

  // Append a single lead row to table
  function appendLeadToTable(lead) {
    if (emptyTableRow && emptyTableRow.parentNode) {
      emptyTableRow.remove();
    }

    const index = leads.length;
    const tr = document.createElement('tr');
    tr.id = `row-${lead.id || index}`;

    // Website link format
    let websiteHtml = '<span style="color:#64748b">N/A</span>';
    if (lead.website && lead.website !== 'N/A') {
      let displayUrl = lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      if (displayUrl.length > 25) displayUrl = displayUrl.substring(0, 22) + '...';
      websiteHtml = `<a href="${lead.website}" target="_blank" rel="noopener noreferrer" class="cell-link" title="${lead.website}">${escapeHtml(displayUrl)} ↗</a>`;
    }

    // Phone link format
    let phoneHtml = '<span style="color:#64748b">N/A</span>';
    if (lead.phone && lead.phone !== 'N/A') {
      phoneHtml = `<a href="tel:${lead.phone}" class="cell-link">${escapeHtml(lead.phone)}</a>`;
    }

    // Email link format
    let emailHtml = '<span style="color:#64748b">N/A</span>';
    if (lead.email && lead.email !== 'N/A') {
      emailHtml = `<a href="mailto:${lead.email}" class="badge-email" title="Send email to ${lead.email}">✉ ${escapeHtml(lead.email)}</a>`;
    }

    // Rating format
    let ratingHtml = '<span style="color:#64748b">-</span>';
    if (lead.rating && lead.rating !== 'N/A') {
      ratingHtml = `<span class="badge-rating">★ ${escapeHtml(lead.rating)} <small style="color:#94a3b8">(${lead.reviews || 0})</small></span>`;
    }

    // Status format
    let statusBadgeClass = 'status-basic';
    if (lead.email && lead.email !== 'N/A') {
      statusBadgeClass = 'status-email';
    } else if (lead.phone && lead.phone !== 'N/A') {
      statusBadgeClass = 'status-phone';
    }

    tr.innerHTML = `
      <td style="color:#64748b">${index}</td>
      <td>
        <div class="lead-name">
          <span>${escapeHtml(lead.name || 'Unknown')}</span>
          <span class="lead-category">${escapeHtml(lead.category || '')}</span>
        </div>
      </td>
      <td>${phoneHtml}</td>
      <td>${websiteHtml}</td>
      <td>${emailHtml}</td>
      <td>${ratingHtml}</td>
      <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(lead.address || '')}">
        ${escapeHtml(lead.address || 'N/A')}
      </td>
      <td>
        <span class="badge-status ${statusBadgeClass}">${escapeHtml(lead.status || 'Verified')}</span>
      </td>
    `;

    leadsTableBody.appendChild(tr);
  }

  // Render all leads (useful on initial reload)
  function renderAllLeads() {
    leadsTableBody.innerHTML = '';
    if (leads.length === 0) {
      leadsTableBody.appendChild(emptyTableRow);
      return;
    }
    leads.forEach((l) => appendLeadToTable(l));
    updateStats();
  }

  // Escape HTML helper
  function escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  // Form Submit: Start Scraping
  scraperForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const keyword = keywordInput.value.trim();
    const location = locationInput.value.trim();
    const maxResults = parseInt(maxResultsInput.value, 10) || 20;
    const deepEmailExtraction = deepEmailToggle.checked;

    if (!keyword || !location) {
      alert('Please provide both Keyword and Location.');
      return;
    }

    totalRequested = maxResults;
    leads = [];
    leadsTableBody.innerHTML = '';
    leadsTableBody.appendChild(emptyTableRow);
    updateStats();
    updateProgress(0, maxResults);

    appendTerminalLog({
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: `Initiating scraping request for "${keyword}" in "${location}" (Target: ${maxResults} leads)...`
    });

    try {
      setScrapingState(true);
      const res = await fetch('/api/scrape/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          location,
          maxResults,
          deepEmailExtraction
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start scraper');
      }
    } catch (err) {
      setScrapingState(false);
      appendTerminalLog({
        timestamp: new Date().toLocaleTimeString(),
        type: 'error',
        message: err.message
      });
      alert(`Error starting scraper: ${err.message}`);
    }
  });

  // Stop Scraping Button
  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    stopBtn.querySelector('span').textContent = 'Stopping...';
    try {
      const res = await fetch('/api/scrape/stop', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to stop scraper');
      }
    } catch (err) {
      console.error(err);
    } finally {
      stopBtn.querySelector('span').textContent = 'Stop Scraping';
    }
  });

  // Download Excel (.xlsx) Handler
  if (downloadExcelBtn) {
    downloadExcelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (leads.length === 0) {
        alert('No leads available to export yet. Start scraping first!');
        return;
      }

      const cleanKeyword = encodeURIComponent(keywordInput.value.trim() || 'leads');
      const cleanLocation = encodeURIComponent(locationInput.value.trim() || 'gmap');

      appendTerminalLog({
        timestamp: new Date().toLocaleTimeString(),
        type: 'info',
        message: `Exporting ${leads.length} leads to native Microsoft Excel (.xlsx)...`
      });

      // Direct browser download via server attachment (Guarantees proper .xlsx extension)
      window.location.href = `/api/export/excel?keyword=${cleanKeyword}&location=${cleanLocation}`;
    });
  }

  // Download CSV Handler (RFC 4180 Compliant with UTF-8 BOM)
  downloadCsvBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (leads.length === 0) {
      alert('No leads available to export yet. Start scraping first!');
      return;
    }

    const cleanKeyword = encodeURIComponent(keywordInput.value.trim() || 'leads');
    const cleanLocation = encodeURIComponent(locationInput.value.trim() || 'gmap');

    appendTerminalLog({
      timestamp: new Date().toLocaleTimeString(),
      type: 'info',
      message: `Exporting ${leads.length} leads to CSV (.csv)...`
    });

    // Direct browser download via server attachment (Guarantees proper .csv extension)
    window.location.href = `/api/export/csv?keyword=${cleanKeyword}&location=${cleanLocation}`;
  });

  // Table Filter Input
  tableFilterInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const rows = leadsTableBody.querySelectorAll('tr:not(#emptyTableRow)');

    let visibleCount = 0;
    rows.forEach((row) => {
      const text = row.innerText.toLowerCase();
      if (text.includes(term)) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    tableCountBadge.textContent = term ? `${visibleCount} of ${leads.length} filtered` : `${leads.length} records`;
  });

  // Quick Preset Chips
  document.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      keywordInput.value = chip.getAttribute('data-keyword');
      locationInput.value = chip.getAttribute('data-location');
    });
  });

  // Clear Terminal Button
  clearTerminalBtn.addEventListener('click', () => {
    terminalLogs.innerHTML = `
      <div class="terminal-line log-system">
        <span class="log-time">[${new Date().toLocaleTimeString()}]</span>
        <span class="log-tag tag-info">CLEARED</span>
        <span class="log-msg">Terminal console cleared.</span>
      </div>
    `;
  });

  // Connect SSE on load
  setupEventSource();
});
