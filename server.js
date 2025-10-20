const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 2456;

app.use(cors());

// [UNCHANGED] The scrapeWillhabenPage function is the same as before
async function scrapeWillhabenPage(url) {
    try {
        // --- 1. Fetch the HTML content ---
        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            },
        });

        // --- 2. Extract the __NEXT_DATA__ JSON ---
        const jsonString = html.substring(
            html.indexOf('<script id="__NEXT_DATA__" type="application/json">') + '<script id="__NEXT_DATA__" type="application/json">'.length,
            html.indexOf('</script>', html.indexOf('<script id="__NEXT_DATA__" type="application/json">'))
        );
        
        const result = JSON.parse(jsonString);
        
        // --- 3. Navigate to the listings array ---
        const searchResult = result.props.pageProps.searchResult;
        const listings = searchResult.advertSummaryList.advertSummary;

        const formattedListings = [];

        listings.forEach(listing => {
            const formatted = {
                id: listing.id,
                description: listing.description,
                url: `https://www.willhaben.at${listing.contextLinkList.contextLink[0].uri}`,
                image_urls: [],
            };

            // --- 4. Process images ---
            if (listing.advertImageList && listing.advertImageList.advertImage) {
                formatted.image_urls = listing.advertImageList.advertImage.map(img => img.url);
            }

            // --- 5. Flatten the attributes ---
            listing.attributes.attribute.forEach(element => {
                const key = element.name.toLowerCase().replace('/', '_');
                const value = element.values[0];
                formatted[key] = isNaN(value) ? value : Number(value);
            });

            formattedListings.push(formatted);
        });

        return {
            totalListings: searchResult.numFound,
            listingsPerPage: searchResult.rows,
            currentPage: searchResult.page,
            listings: formattedListings,
        };

    } catch (error) {
        console.error('Error during scraping:', error.message);
        throw new Error('Failed to scrape Willhaben page.');
    }
}


// --- [THIS PART IS UPDATED] ---
// We will now intelligently rebuild the URL
app.get('/getListings', async (req, res) => {
    
    // 1. Get the 'url' parameter. This will be the first part,
    // e.g., "https://.../boerse?TRANSMISSION=180004"
    const baseUrl = req.query.url;

    if (!baseUrl) {
        return res.status(400).json({ error: 'A "url" query parameter is required.' });
    }

    // 2. Create an array to hold all the *other* parameters
    // that the browser sent to our server
    const otherParams = [];

    // 3. Loop over all keys in req.query
    for (const key in req.query) {
        // We already have the 'url' part, so skip it
        if (key === 'url') continue;

        // Re-build the "key=value" string.
        // We MUST encode the key (e.g., "ENGINE/FUEL" -> "ENGINE%2FFUEL")
        // and the value, just in case.
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(req.query[key]);
        otherParams.push(`${encodedKey}=${encodedValue}`);
    }

    // 4. Join all the re-assembled parameters with '&'
    const fullUrl = baseUrl + (otherParams.length > 0 ? '&' + otherParams.join('&') : '');

    console.log('Reconstructed URL:', fullUrl); // For debugging

    try {
        // 5. Scrape using the new, complete URL
        const scrapeData = await scrapeWillhabenPage(fullUrl);
        res.status(200).json(scrapeData);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Scraper API running at http://localhost:${PORT}`);
    console.log(`Try visiting: http://localhost:2456/getListings?url=YOUR_WILLHABEN_URL`);
});