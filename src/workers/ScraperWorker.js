const axios = require('axios');

class ScraperWorker {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 15000,
            retries: config.retries || 3,
            retryDelay: config.retryDelay || 1000,
            userAgents: config.userAgents || [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            ...config
        };
    }

    async scrapeTarget(target, fullScan = false) {
        try {
            console.log(`Scraping target: ${target.id} (${target.url})`);
            
            if (fullScan) {
                return await this.scrapeAllPages(target.url);
            } else {
                return await this.scrapeSinglePage(target.url);
            }
        } catch (error) {
            console.error(`Scraping failed for target ${target.id}:`, error);
            throw error;
        }
    }

    async scrapeSinglePage(url) {
        for (let attempt = 1; attempt <= this.config.retries; attempt++) {
            try {
                const userAgent = this.getRandomUserAgent();
                const { data: html } = await axios.get(url, {
                    headers: { 'User-Agent': userAgent },
                    timeout: this.config.timeout
                });

                const listings = this.parseWillhabenPage(html);
                
                return {
                    totalListings: listings.length,
                    listingsPerPage: listings.length,
                    currentPage: 1,
                    listings: listings,
                    scrapedAt: new Date(),
                    source: url
                };
            } catch (error) {
                if (attempt < this.config.retries) {
                    const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
                    console.log(`Retry ${attempt}/${this.config.retries} in ${delay}ms for ${url}`);
                    await this.delay(delay);
                } else {
                    throw new Error(`Failed to scrape after ${this.config.retries} attempts: ${error.message}`);
                }
            }
        }
    }

    async scrapeAllPages(baseUrl) {
        const allListings = new Map();
        let currentPage = 1;
        let totalPages = null;
        let totalListings = 0;

        while (true) {
            try {
                const pageUrl = this.buildUrlWithPage(baseUrl, currentPage);
                const pageData = await this.scrapeSinglePage(pageUrl);

                if (currentPage === 1) {
                    totalListings = pageData.totalListings;
                    const listingsPerPage = pageData.listingsPerPage;
                    totalPages = Math.ceil(totalListings / listingsPerPage);
                }

                pageData.listings.forEach(listing => {
                    if (!allListings.has(listing.id)) {
                        allListings.set(listing.id, listing);
                    }
                });

                if (pageData.listings.length === 0 || (totalPages && currentPage >= totalPages)) break;
                
                currentPage++;
                await this.randomDelay(1000, 3000); // Respectful delay between pages
            } catch (error) {
                if (allListings.size > 0) break;
                else throw error;
            }
        }

        return {
            totalListings,
            scrapedListings: allListings.size,
            pagesScraped: currentPage,
            listings: Array.from(allListings.values()),
            scrapedAt: new Date(),
            source: baseUrl
        };
    }

    parseWillhabenPage(html) {
        try {
            const jsonString = html.substring(
                html.indexOf('<script id="__NEXT_DATA__" type="application/json">') + '<script id="__NEXT_DATA__" type="application/json">'.length,
                html.indexOf('</script>', html.indexOf('<script id="__NEXT_DATA__" type="application/json">'))
            );

            const result = JSON.parse(jsonString);
            const searchResult = result.props.pageProps.searchResult;
            const listings = searchResult.advertSummaryList.advertSummary;

            const formattedListings = listings.map(listing => {
                const formatted = {
                    id: listing.id,
                    description: listing.description,
                    title: listing.description, // Use description as title
                    url: `https://www.willhaben.at${listing.contextLinkList.contextLink[0].uri}`,
                    image_urls: [],
                    imageUrls: []
                };

                if (listing.advertImageList?.advertImage) {
                    formatted.image_urls = listing.advertImageList.advertImage.map(img => img.url);
                    formatted.imageUrls = formatted.image_urls;
                }

                // Parse attributes
                listing.attributes.attribute.forEach(element => {
                    const key = element.name.toLowerCase().replace('/', '_');
                    const value = element.values[0];
                    formatted[key] = isNaN(value) ? value : Number(value);
                });

                // Extract common fields
                formatted.price = formatted.price || formatted.preis;
                formatted.condition = formatted.condition || formatted.zustand;
                formatted.location = formatted.location || formatted.standort;

                return formatted;
            });

            return formattedListings;
        } catch (error) {
            console.error('Failed to parse Willhaben page:', error);
            throw new Error(`Failed to parse page: ${error.message}`);
        }
    }

    buildUrlWithPage(baseUrl, pageNumber) {
        const url = new URL(baseUrl);
        url.searchParams.set('page', pageNumber);
        return url.toString();
    }

    getRandomUserAgent() {
        return this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    randomDelay(min = 1000, max = 3000) {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        return this.delay(ms);
    }
}

module.exports = ScraperWorker;
