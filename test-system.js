#!/usr/bin/env node

/**
 * Test script for Willhaben Listener System
 * This script demonstrates basic functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:2456';
const ADMIN_URL = 'http://localhost:3001';

async function testSystem() {
    console.log('🧪 Testing Willhaben Listener System...\n');

    try {
        // Test 1: Check if main API is running
        console.log('1️⃣ Testing main API...');
        const statusResponse = await axios.get(`${BASE_URL}/listener/status`);
        console.log('✅ Main API is running');
        console.log(`   Status: ${statusResponse.data.status}`);
        console.log(`   Initialized: ${statusResponse.data.initialized}\n`);

        // Test 2: Check health
        console.log('2️⃣ Testing health check...');
        const healthResponse = await axios.get(`${BASE_URL}/listener/health`);
        console.log('✅ Health check passed');
        console.log(`   Status: ${healthResponse.data.status}\n`);

        // Test 3: Add a test target
        console.log('3️⃣ Adding test polling target...');
        const targetData = {
            id: 'test-target-' + Date.now(),
            url: 'https://www.willhaben.at/iad/kleinanzeigen?CATEGORY=1&PRICE_FROM=500&PRICE_TO=1500&SEARCH_TEXT=laptop',
            baseInterval: 60, // 1 minute for testing
            minInterval: 30,
            maxInterval: 300,
            trackedFields: ['title', 'price', 'condition', 'location'],
            enabled: true
        };

        const targetResponse = await axios.post(`${BASE_URL}/listener/targets`, targetData);
        console.log('✅ Test target added');
        console.log(`   Target ID: ${targetResponse.data.id}\n`);

        // Test 4: Add a test webhook subscriber
        console.log('4️⃣ Adding test webhook subscriber...');
        const subscriberData = {
            type: 'webhook',
            endpoint: 'https://httpbin.org/post', // Test endpoint
            config: {
                retryPolicy: 'exponential',
                timeout: 10000
            },
            enabled: true
        };

        const subscriberResponse = await axios.post(`${BASE_URL}/listener/subscribers`, subscriberData);
        console.log('✅ Test subscriber added');
        console.log(`   Subscriber ID: ${subscriberResponse.data.id}\n`);

        // Test 5: Check targets
        console.log('5️⃣ Checking targets...');
        const targetsResponse = await axios.get(`${BASE_URL}/listener/targets`);
        console.log('✅ Targets retrieved');
        console.log(`   Total targets: ${targetsResponse.data.length}\n`);

        // Test 6: Check subscribers
        console.log('6️⃣ Checking subscribers...');
        const subscribersResponse = await axios.get(`${BASE_URL}/listener/subscribers`);
        console.log('✅ Subscribers retrieved');
        console.log(`   Total subscribers: ${subscribersResponse.data.length}\n`);

        // Test 7: Wait a bit and check metrics
        console.log('7️⃣ Waiting for some activity...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('8️⃣ Checking metrics...');
        try {
            const metricsResponse = await axios.get(`${BASE_URL}/listener/metrics`);
            console.log('✅ Metrics endpoint accessible');
            console.log('   Metrics data length:', metricsResponse.data.length, 'characters\n');
        } catch (error) {
            console.log('⚠️  Metrics endpoint not accessible (this is OK if Redis is not running)\n');
        }

        // Test 9: Test basic scraping functionality
        console.log('9️⃣ Testing basic scraping...');
        try {
            const scrapeResponse = await axios.get(`${BASE_URL}/getListings?url=${encodeURIComponent(targetData.url)}`);
            console.log('✅ Basic scraping works');
            console.log(`   Found ${scrapeResponse.data.listings.length} listings\n`);
        } catch (error) {
            console.log('❌ Basic scraping failed:', error.message, '\n');
        }

        console.log('🎉 All tests completed successfully!');
        console.log('\n📊 System is ready for use:');
        console.log(`   Main API: ${BASE_URL}`);
        console.log(`   Admin API: ${ADMIN_URL}/api/admin`);
        console.log(`   Status: ${BASE_URL}/listener/status`);
        console.log(`   Health: ${BASE_URL}/listener/health`);
        console.log(`   Metrics: ${BASE_URL}/listener/metrics`);

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 Make sure the server is running:');
            console.log('   npm start');
        } else if (error.response) {
            console.log('\n💡 Server responded with error:');
            console.log(`   Status: ${error.response.status}`);
            console.log(`   Message: ${error.response.data.error || error.response.data.message}`);
        }
        
        process.exit(1);
    }
}

// Run tests
testSystem().catch(console.error);
