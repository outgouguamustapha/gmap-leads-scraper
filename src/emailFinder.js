import axios from 'axios';
import * as cheerio from 'cheerio';

// Common file extensions and dummy emails to exclude
const EXCLUDED_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf|eot)$/i;
const EXCLUDED_PATTERNS = [
  'example.com',
  'domain.com',
  'sentry.io',
  'wixpress.com',
  'shopify.com',
  'cloudflare.com',
  'placeholder',
  'noreply',
  'no-reply',
  'yourname',
  'youremail',
  'your-email',
  'votre@',
  'votre-email',
  'john@doe',
  'jane@doe',
  'email@email',
  'email@domain',
  'user@domain',
  'test@test',
  'email@',
  'name@'
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Clean and filter email candidates
 */
function cleanEmails(rawMatches = []) {
  const validEmails = new Set();

  for (let email of rawMatches) {
    if (!email) continue;
    email = email.trim().toLowerCase();
    
    // Remove trailing punctuation or URL encoded junk
    email = email.replace(/^[.<>("]+|[.,>)"]+$/g, '');

    if (EXCLUDED_EXTENSIONS.test(email)) continue;
    if (EXCLUDED_PATTERNS.some(p => email.includes(p))) continue;
    if (email.length < 5 || email.length > 80) continue;
    if (!email.includes('.')) continue;

    validEmails.add(email);
  }

  return Array.from(validEmails);
}

/**
 * Extracts emails from an HTML string using mailto links and regex
 */
function extractFromHtml(html) {
  const emails = [];
  try {
    const $ = cheerio.load(html);

    // 1. Look for mailto: links
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (email) emails.push(email);
    });

    // 2. Regex scan full body
    const bodyText = $('body').text();
    const bodyMatches = bodyText.match(EMAIL_REGEX) || [];
    emails.push(...bodyMatches);

    // 3. Fallback regex on raw html (catches footer script tags or obscured attributes)
    const rawMatches = html.match(EMAIL_REGEX) || [];
    emails.push(...rawMatches);
  } catch (err) {
    // If Cheerio fails, fallback to pure regex
    const matches = html.match(EMAIL_REGEX) || [];
    emails.push(...matches);
  }

  return cleanEmails(emails);
}

/**
 * Fetches a URL with a reasonable timeout and browser-like user agent
 */
async function fetchPage(url, timeout = 7000) {
  return await axios.get(url, {
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8,es;q=0.7',
      'Cache-Control': 'no-cache'
    },
    maxRedirects: 5,
    validateStatus: (status) => status < 400
  });
}

/**
 * Main email extractor function
 * @param {string} websiteUrl 
 * @param {boolean} deepScan - If true, scans contact/about subpages if not found on home page
 * @param {function} logFn - Optional logger callback
 * @returns {Promise<{email: string|null, allEmails: string[]}>}
 */
export async function findEmailFromWebsite(websiteUrl, deepScan = true, logFn = null) {
  if (!websiteUrl) return { email: null, allEmails: [] };

  const log = (msg) => {
    if (logFn) logFn(msg);
  };

  // Ensure protocol
  let targetUrl = websiteUrl.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const parsedUrl = new URL(targetUrl);
    // Ignore social media domains
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname.includes('facebook.com') || hostname.includes('instagram.com') || hostname.includes('twitter.com') || hostname.includes('linkedin.com')) {
      return { email: null, allEmails: [] };
    }

    log(`Probing homepage for emails: ${parsedUrl.origin}`);
    const response = await fetchPage(targetUrl);
    let foundEmails = extractFromHtml(response.data);

    if (foundEmails.length > 0) {
      log(`Found email(s) on homepage: ${foundEmails[0]}`);
      return { email: foundEmails[0], allEmails: foundEmails };
    }

    // Deep scan if enabled
    if (deepScan) {
      const $ = cheerio.load(response.data);
      const candidatePaths = new Set();

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')?.trim();
        if (!href) return;
        const text = $(el).text().toLowerCase();

        if (
          href.includes('contact') || 
          href.includes('about') || 
          text.includes('contact') || 
          text.includes('about') ||
          text.includes('nous contacter') ||
          text.includes('contactez')
        ) {
          try {
            const resolved = new URL(href, targetUrl);
            if (resolved.hostname === parsedUrl.hostname) {
              candidatePaths.add(resolved.href);
            }
          } catch (_) {}
        }
      });

      // Also try standard contact URLs if none discovered in DOM
      if (candidatePaths.size === 0) {
        candidatePaths.add(`${parsedUrl.origin}/contact`);
        candidatePaths.add(`${parsedUrl.origin}/contact-us`);
        candidatePaths.add(`${parsedUrl.origin}/about`);
      }

      // Check up to 2 subpages
      const pathsToCheck = Array.from(candidatePaths).slice(0, 2);
      for (const subUrl of pathsToCheck) {
        try {
          log(`Deep scan checking: ${subUrl}`);
          const subRes = await fetchPage(subUrl, 5000);
          const subEmails = extractFromHtml(subRes.data);
          if (subEmails.length > 0) {
            log(`Found email on subpage: ${subEmails[0]}`);
            return { email: subEmails[0], allEmails: subEmails };
          }
        } catch (e) {
          // Ignore subpage failure
        }
      }
    }

    return { email: null, allEmails: [] };
  } catch (error) {
    log(`Failed to fetch website (${targetUrl}): ${error.message}`);
    return { email: null, allEmails: [] };
  }
}
