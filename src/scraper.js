import { chromium } from 'playwright';
import { EventEmitter } from 'events';
import { findEmailFromWebsite } from './emailFinder.js';

export class GoogleMapsScraper extends EventEmitter {
  constructor(options = {}) {
    super();
    this.keyword = options.keyword?.trim() || '';
    this.location = options.location?.trim() || '';
    this.maxResults = parseInt(options.maxResults, 10) || 20;
    this.deepEmailExtraction = !!options.deepEmailExtraction;
    this.headless = options.headless !== undefined ? options.headless : true;
    
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isStopped = false;
    this.scrapedCount = 0;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('log', { timestamp, message, type });
  }

  async stop() {
    this.isStopped = true;
    this.log('Stop signal received. Cleaning up browser resources...', 'warn');
    await this.cleanup();
  }

  async cleanup() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    } catch (err) {
      // Ignore cleanup errors
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async sleepJitter(minMs = 1000, maxMs = 2000) {
    const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await this.sleep(jitter);
  }

  /**
   * Handle cookie consent banners if present
   */
  async handleConsent(page) {
    try {
      // Check for common consent buttons
      const consentSelectors = [
        'button[aria-label="Accept all"]',
        'button:has-text("Accept all")',
        'button:has-text("Tout accepter")',
        'button:has-text("I agree")',
        'button:has-text("Acepto todo")',
        'form[action*="consent"] button',
        'button[jsname="b3VHJd"]'
      ];

      for (const selector of consentSelectors) {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          this.log('Detected cookie consent dialog, accepting...', 'info');
          await btn.click();
          await page.waitForTimeout(1500);
          break;
        }
      }
    } catch (err) {
      // Non-critical, proceed
    }
  }

  /**
   * Extract business details strictly from the active place side panel
   */
  async extractPlaceDetails(page, expectedName = null) {
    return await page.evaluate((expected) => {
      // In Google Maps, the place title is uniquely 'h1.DUwDvf'
      // Generic 'h1' or 'div[role="main"] h1' matches the search feed header: "Results"!
      const duwEl = document.querySelector('h1.DUwDvf');
      let name = duwEl ? duwEl.textContent.trim() : null;
      
      // If DUwDvf is not found or is "Results", fallback to expected name from listing card
      if (!name || name.toLowerCase() === 'results') {
        name = expected || null;
      }
      
      // Never allow "Results" to be treated as a business lead
      if (!name || name.toLowerCase() === 'results') {
        return null;
      }

      // Detail container around the active business
      const container = duwEl ? (duwEl.closest('div[role="main"]') || duwEl.closest('div.m6QErb') || document) : document;

      // Website - STRICTLY authority link of the active place
      let website = null;
      const authorityLink = container.querySelector('a[data-item-id="authority"]');
      if (authorityLink) {
        const href = authorityLink.getAttribute('href');
        if (href && !href.includes('google.com/maps') && !href.startsWith('/')) {
          website = href.trim();
        }
      }

      // Phone - STRICTLY scoped to container
      let phone = null;
      const phoneBtn = container.querySelector('button[data-item-id^="phone:"]');
      if (phoneBtn) {
        const idAttr = phoneBtn.getAttribute('data-item-id') || '';
        phone = idAttr.replace(/^phone:tel:/, '').trim() || phoneBtn.textContent.trim();
        // Strip out unicode telephone glyphs
        phone = phone.replace(/[^\d\s\+\(\)\-\.]/g, '').trim();
      }

      // Address - STRICTLY scoped to container
      let address = null;
      const addressBtn = container.querySelector('button[data-item-id^="address"]');
      if (addressBtn) {
        const ariaAddr = addressBtn.getAttribute('aria-label') || '';
        address = ariaAddr.replace(/^(Address|Adresse):\s*/i, '').trim() || addressBtn.textContent.trim();
        address = address.replace(/[\r\n]+/g, ' ').trim();
      }

      // Rating & Reviews - STRICTLY scoped to container
      let rating = null;
      let reviewCount = null;
      const ratingEl = container.querySelector('div.F7nice span[aria-hidden="true"]');
      if (ratingEl) {
        rating = ratingEl.textContent.trim();
      }
      const reviewEl = container.querySelector('div.F7nice span[aria-label*="review" i], div.F7nice span[aria-label*="avis" i]');
      if (reviewEl) {
        const text = reviewEl.getAttribute('aria-label') || reviewEl.textContent || '';
        const match = text.match(/\d[\d,.]*/);
        if (match) reviewCount = match[0].replace(/,/g, '');
      }

      // Category - STRICTLY scoped to container
      let category = null;
      const categoryBtn = container.querySelector('button[jsaction*="pane.rating.category"]') || 
                          container.querySelector('div.fontBodyMedium button.DkEaL');
      if (categoryBtn) {
        category = categoryBtn.textContent.trim();
      }

      return {
        name,
        phone,
        website,
        address,
        rating,
        reviewCount,
        category
      };
    }, expectedName);
  }

  async run() {
    this.isStopped = false;
    this.scrapedCount = 0;

    const fullQuery = `${this.keyword} in ${this.location}`.trim();
    this.log(`Initializing Chromium automation for: "${fullQuery}"...`, 'info');

    try {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-default-browser-check'
        ]
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 850 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US'
      });

      this.page = await this.context.newPage();

      // Navigate to Google Maps search with English locale
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(fullQuery)}?hl=en`;
      this.log(`Navigating to Google Maps...`, 'info');
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      // Handle cookie consent dialog
      await this.handleConsent(this.page);

      if (this.isStopped) return;

      // Check if we immediately landed on a single business detail view
      const isSinglePlace = await this.page.$('h1.DUwDvf');
      const hasFeed = await this.page.$('div[role="feed"]');

      if (!hasFeed && isSinglePlace) {
        this.log('Single place result detected. Extracting details...', 'info');
        const placeData = await this.extractPlaceDetails(this.page);
        if (placeData && placeData.name) {
          let email = null;
          if (placeData.website) {
            this.log(`Scanning website for email: ${placeData.website}`, 'info');
            const emailResult = await findEmailFromWebsite(placeData.website, this.deepEmailExtraction, (msg) => this.log(msg, 'info'));
            email = emailResult.email;
          }

          const lead = {
            id: 'lead-1',
            name: placeData.name,
            phone: placeData.phone || 'N/A',
            website: placeData.website || 'N/A',
            email: email || 'N/A',
            address: placeData.address || 'N/A',
            rating: placeData.rating || 'N/A',
            reviews: placeData.reviewCount || '0',
            category: placeData.category || this.keyword,
            status: 'Verified'
          };

          this.scrapedCount++;
          this.emit('lead', lead);
          this.emit('progress', { count: this.scrapedCount, max: this.maxResults });
        }
        this.emit('done', { total: this.scrapedCount, reason: 'Completed single result' });
        return;
      }

      // Wait for feed container
      try {
        await this.page.waitForSelector('div[role="feed"]', { timeout: 15000 });
      } catch (err) {
        this.log('Results feed not found or no results returned for query.', 'warn');
        this.emit('done', { total: 0, reason: 'No results found' });
        return;
      }

      this.log('Results feed loaded. Beginning scroll and extraction loop...', 'info');

      const processedUrls = new Set();
      let scrollAttempts = 0;
      const maxScrollAttempts = 35;
      let lastItemCount = 0;

      while (this.scrapedCount < this.maxResults && !this.isStopped) {
        // Collect current listing elements in feed
        const listings = await this.page.$$('div[role="feed"] a[href*="/maps/place/"]');
        this.log(`Found ${listings.length} listings in feed (Scraped: ${this.scrapedCount}/${this.maxResults})`, 'info');

        let newlyProcessedInThisPass = 0;

        for (const listing of listings) {
          if (this.scrapedCount >= this.maxResults || this.isStopped) break;

          const href = await listing.getAttribute('href').catch(() => null);
          if (!href) continue;

          // Deduplicate based on base place URL
          const placeKey = href.split('?')[0];
          if (processedUrls.has(placeKey)) continue;
          processedUrls.add(placeKey);
          newlyProcessedInThisPass++;

          // Extract business name from the listing link's aria-label in the feed
          const targetName = await listing.getAttribute('aria-label').catch(() => null);

          try {
            // Scroll listing into view and click
            await listing.scrollIntoViewIfNeeded().catch(() => {});
            await listing.click().catch(() => {});

            // Wait for place details panel (h1.DUwDvf)
            await this.page.waitForSelector('h1.DUwDvf', { timeout: 6000 }).catch(() => {});

            // If targetName is known, wait for h1.DUwDvf to reflect the clicked place
            if (targetName) {
              await this.page.waitForFunction(
                (expected) => {
                  const h1 = document.querySelector('h1.DUwDvf');
                  if (!h1 || !h1.textContent) return false;
                  const cur = h1.textContent.trim().toLowerCase();
                  const exp = expected.trim().toLowerCase();
                  return cur.includes(exp) || exp.includes(cur);
                },
                targetName,
                { timeout: 3500 }
              ).catch(() => {});
            }

            // Jitter delay between 1-2s for anti-detection and DOM stabilization
            await this.sleepJitter(1000, 1800);

            if (this.isStopped) break;

            const placeData = await this.extractPlaceDetails(this.page, targetName);
            if (!placeData || !placeData.name) {
              continue;
            }

            this.log(`Extracted: "${placeData.name}" | Phone: ${placeData.phone || 'N/A'}`, 'info');

            let email = null;
            if (placeData.website) {
              try {
                this.log(`Checking email on ${placeData.website}...`, 'info');
                const emailResult = await findEmailFromWebsite(
                  placeData.website, 
                  this.deepEmailExtraction, 
                  (msg) => this.log(msg, 'info')
                );
                email = emailResult.email;
                if (email) {
                  this.log(`Email found: ${email}`, 'success');
                }
              } catch (e) {
                // Ignore website crawl errors
              }
            }

            this.scrapedCount++;
            const lead = {
              id: `lead-${this.scrapedCount}`,
              name: placeData.name,
              phone: placeData.phone || 'N/A',
              website: placeData.website || 'N/A',
              email: email || 'N/A',
              address: placeData.address || 'N/A',
              rating: placeData.rating || 'N/A',
              reviews: placeData.reviewCount || '0',
              category: placeData.category || this.keyword,
              status: email ? 'Email Found' : (placeData.phone ? 'Phone Found' : 'Basic Info')
            };

            this.emit('lead', lead);
            this.emit('progress', { count: this.scrapedCount, max: this.maxResults });

          } catch (err) {
            this.log(`Error parsing listing: ${err.message}`, 'warn');
          }
        }

        if (this.scrapedCount >= this.maxResults || this.isStopped) break;

        // Scroll feed to load more listings
        this.log('Scrolling feed for more leads...', 'info');
        const feed = await this.page.$('div[role="feed"]');
        if (feed) {
          await feed.evaluate((el) => {
            el.scrollBy(0, 1500);
          });
        }
        await this.sleep(1500);

        // Check if reached end of list
        const reachedEnd = await this.page.evaluate(() => {
          const endText = document.body.innerText;
          return endText.includes("You've reached the end of the list") ||
                 endText.includes("Vous êtes arrivé à la fin de la liste");
        });

        if (reachedEnd) {
          this.log("Reached the end of Google Maps results.", 'info');
          break;
        }

        if (listings.length === lastItemCount && newlyProcessedInThisPass === 0) {
          scrollAttempts++;
          if (scrollAttempts >= 4) {
            this.log("No new listings appeared after multiple scrolls. Ending search.", 'warn');
            break;
          }
        } else {
          scrollAttempts = 0;
        }
        lastItemCount = listings.length;
      }

      const finishReason = this.isStopped ? 'Cancelled by user' : 'Completed successfully';
      this.log(`Scraping finished. Total leads collected: ${this.scrapedCount}. (${finishReason})`, 'success');
      this.emit('done', { total: this.scrapedCount, reason: finishReason });

    } catch (error) {
      if (!this.isStopped) {
        this.log(`Scraper encountered error: ${error.message}`, 'error');
        this.emit('error', error);
      }
    } finally {
      await this.cleanup();
    }
  }
}
