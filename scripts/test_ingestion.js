const axios = require('axios');

async function testIngestion() {
    console.log("--- STARTING INGESTION TESTS ---");

    // 1. Test Sentry Envelope
    try {
        console.log("Testing Sentry Envelope...");
        const sentryBody = '{"event_id":"abc"}\n{"type":"event"}\n{"contexts":{"os":{"name":"Windows"},"browser":{"name":"Chrome"}},"release":"1.0.0"}';
        await axios.post('http://localhost:8080/api/1/envelope/', sentryBody);
        console.log("Sentry [OK]");
    } catch (e) {
        console.error("Sentry [FAILED]", e.message);
    }

    // 2. Test PostHog Capture
    try {
        console.log("Testing PostHog Capture...");
        await axios.post('http://localhost:8080/capture/', {
            api_key: "test_key",
            event: "test_event",
            properties: {
                "$os": "macOS",
                "$browser": "Safari",
                "release": "2.1.0",
                "password": "SHOULD_BE_STRIPPED"
            }
        });
        console.log("PostHog [OK]");
    } catch (e) {
        console.error("PostHog [FAILED]", e.message);
    }

    // 3. Verify in Dashboard
    try {
        console.log("Verifying Dashboard Stats...");
        const res = await axios.get('http://localhost:8080/api/dashboard/stats');
        console.log("Stats:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("Dashboard Verify [FAILED]", e.message);
    }
}

testIngestion();
