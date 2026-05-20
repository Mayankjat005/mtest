const express = require('express');
const { chromium } = require('playwright');
const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// In-memory cache
// ─────────────────────────────────────────────
let cachedData = {
    token: null,
    lastUpdated: null,
    nextRefresh: null,
    status: 'Initializing...'
};

// ─────────────────────────────────────────────
// Core Scraper
// ─────────────────────────────────────────────
async function fetchNewToken() {
    console.log(`[${new Date().toISOString()}] 🔄 Fetching new token...`);
    let browser = null;

    try {
        // chromium.executablePath() auto-detects correct path
        // in BOTH local and Docker (mcr.microsoft.com/playwright) environments
        const execPath = chromium.executablePath();
        console.log('Chrome path:', execPath);

        browser = await chromium.launch({
            executablePath: execPath,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-extensions'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();
        let foundToken = null;

        // Intercept API calls made by the player to steal the token
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('/api/extract/') && !foundToken) {
                try {
                    const t = new URL(url).searchParams.get('_t');
                    if (t) {
                        foundToken = t;
                        console.log('✅ Token intercepted:', t.substring(0, 40) + '...');
                    }
                } catch (_) {}
            }
        });

        // Load the embed page — this triggers the player to call /api/extract/
        await page.goto('https://vidlux.xyz/embed/movie/550', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Wait max 10s for token
        const start = Date.now();
        while (!foundToken && Date.now() - start < 10000) {
            await page.waitForTimeout(200);
        }

        if (foundToken) {
            const nextRefresh = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            cachedData = {
                token: foundToken,
                lastUpdated: new Date().toISOString(),
                nextRefresh,
                status: 'Success'
            };
            console.log(`✅ Token cached. Next refresh at ${nextRefresh}`);
        } else {
            cachedData.status = 'Failed: Token not found in network requests';
            console.error('❌ Token not found');
        }

    } catch (err) {
        cachedData.status = `Error: ${err.message}`;
        console.error('❌ Scraper crashed:', err.message);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

// ─────────────────────────────────────────────
// Scheduler — refresh every 60 minutes
// ─────────────────────────────────────────────
const REFRESH_INTERVAL = 60 * 60 * 1000; // 60 min

function scheduleRefresh() {
    setTimeout(async () => {
        await fetchNewToken().catch(err => console.error('Scheduled refresh error:', err.message));
        scheduleRefresh(); // Re-schedule after done
    }, REFRESH_INTERVAL);
}

// ─────────────────────────────────────────────
// Express Routes
// ─────────────────────────────────────────────

// Root health check
app.get('/', (req, res) => {
    res.json({
        service: 'VidLux Token API',
        uptime: Math.floor(process.uptime()) + 's',
        token_status: cachedData.status,
        endpoints: {
            token: '/token',
            health: '/health'
        }
    });
});

// Main token endpoint
app.get('/token', (req, res) => {
    res.json(cachedData);
});

// Health check for Docker HEALTHCHECK and uptime monitors
app.get('/health', (req, res) => {
    const ok = cachedData.status === 'Success';
    res.status(ok ? 200 : 503).json({
        healthy: ok,
        status: cachedData.status,
        lastUpdated: cachedData.lastUpdated
    });
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT, async () => {
    console.log(`🚀 VidLux Token API running on port ${PORT}`);
    // Initial fetch after 1s delay
    setTimeout(async () => {
        await fetchNewToken().catch(err => console.error('Initial fetch error:', err.message));
        scheduleRefresh();
    }, 1000);
});
