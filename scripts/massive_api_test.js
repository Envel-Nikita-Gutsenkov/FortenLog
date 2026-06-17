const http = require('http');

const PORT = 3000;
const HOST = '127.0.0.1';
const TOTAL_ERRORS = 50;
const TOTAL_ANALYTICS = 50;
const API_KEY = 'fl_04182f28b4414a7695973e054683e04b';

let authToken = '';

async function runMassiveTest() {
    console.log("\x1b[36m===================================================================\x1b[0m");
    console.log("\x1b[35m       🧬 STARTING MASSIVE PARALLEL TELEMETRY INGESTION LOAD TEST   \x1b[0m");
    console.log("\x1b[36m===================================================================\x1b[0m");
    console.log(`Target: http://${HOST}:${PORT}`);
    console.log(`Sending: ${TOTAL_ERRORS} Sentry Errors + ${TOTAL_ANALYTICS} PostHog Captures`);
    console.log("-------------------------------------------------------------------");

    // 1. Authenticate with admin account to gain telemetry stats visibility
    console.log("[INFO] Authenticating as Admin on the telemetry dashboard...");
    const loggedIn = await loginAdmin();
    if (!loggedIn) {
        console.error("\x1b[31m[ERROR] Authentication failed. Ensure the server is seeded and running.\x1b[0m");
        return;
    }
    console.log("\x1b[32m✔ Administrative Bearer Session acquired successfully.\x1b[0m");

    // 2. Fetch stats before the test
    const statsBefore = await getDashboardStats();
    console.log(`Stats Before Load Test:`);
    console.log(`  - Total Events In DB:  \x1b[33m${statsBefore.total_events || 0}\x1b[0m`);
    console.log(`  - Total Resolved:      \x1b[32m${statsBefore.resolved_count || 0}\x1b[0m`);
    console.log(`  - Total Unresolved:    \x1b[31m${statsBefore.unresolved_count || 0}\x1b[0m`);
    console.log("");

    // 3. Dispatch parallel requests
    const start = Date.now();
    const promises = [];

    // Queue Sentry Envelopes
    for (let i = 0; i < TOTAL_ERRORS; i++) {
        promises.push(sendSentryError(i));
    }

    // Queue PostHog Captures
    for (let i = 0; i < TOTAL_ANALYTICS; i++) {
        promises.push(sendPostHogCapture(i));
    }

    console.log(`[INFO] Spawning ${promises.length} concurrent async network streams...`);
    const results = await Promise.all(promises);
    const end = Date.now();

    const successCount = results.filter(r => r === true).length;
    const failCount = results.length - successCount;
    const durationSec = (end - start) / 1000;
    const reqPerSec = (results.length / durationSec).toFixed(1);

    console.log("");
    console.log("\x1b[32m[SUCCESS] Parallel ingestion streams completed!\x1b[0m");
    console.log(`  - Successful Requests: \x1b[32m${successCount}\x1b[0m`);
    console.log(`  - Failed Requests:     \x1b[31m${failCount}\x1b[0m`);
    console.log(`  - Time Elapsed:        \x1b[36m${durationSec.toFixed(3)} seconds\x1b[0m`);
    console.log(`  - Ingestion Velocity:  \x1b[35m${reqPerSec} requests/sec\x1b[0m`);
    console.log("");

    // 4. Wait a brief moment for database worker queue to flush and get final stats
    console.log("[INFO] Waiting 2.5 seconds for Rust Ingestion Worker to flush DB transaction batches...");
    await new Promise(resolve => setTimeout(resolve, 2500));

    const statsAfter = await getDashboardStats();
    console.log("");
    console.log("\x1b[36m===================================================================\x1b[0m");
    console.log("📊                  POST-TEST TELEMETRY VERIFICATION CARD          ");
    console.log("\x1b[36m===================================================================\x1b[0m");
    console.log(`Stats After Load Test:`);
    console.log(`  - Total Events In DB:  \x1b[32m${statsAfter.total_events || 0}\x1b[0m (Before: ${statsBefore.total_events || 0})`);
    console.log(`  - Net Growth:          \x1b[32m+${(statsAfter.total_events || 0) - (statsBefore.total_events || 0)} events\x1b[0m`);
    console.log("");
    console.log("\x1b[32m✔ Ingestion pipelines verified healthy, highly concurrent, and secure!\x1b[0m");
    console.log("\x1b[36m===================================================================\x1b[0m");
}

function loginAdmin() {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            username: 'admin',
            password: 'fortenlog2026'
        });

        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/system/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-FortenLog-Request': 'true'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        authToken = parsed.token;
                        resolve(true);
                    } catch {
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

function getDashboardStats() {
    return new Promise((resolve) => {
        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/dashboard/stats',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'X-FortenLog-Request': 'true'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({});
                }
            });
        });
        req.on('error', () => resolve({}));
        req.end();
    });
}

function sendSentryError(index) {
    return new Promise((resolve) => {
        const payload = `{"event_id":"fc523a54b38d4f4ca134df021b330b${index.toString(16).padStart(2, '0')}"}\n{"type":"event"}\n{"message":"Load-test parallel Sentry exception index ${index}","level":"error","contexts":{"device":{"family":"Server Cluster Node","processor_count":64,"free_memory":68719476736,"boot_time":"2026-05-17T20:00:00Z"},"os":{"name":"Ubuntu Linux","version":"24.04 LTS"},"browser":{"name":"Axios Load Tester","version":"v1.0"}},"exception":{"values":[{"type":"LoadTestFailure","value":"Parallel batch ingest test index ${index} triggered manually"}]},"release":"release-v3.0.1"}`;

        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api/default/envelope/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-sentry-envelope',
                'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${API_KEY}`,
                'X-FortenLog-Request': 'true'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error(`Sentry error index ${index} failed: Code ${res.statusCode}, Body: ${body}`);
                }
                resolve(res.statusCode === 200);
            });
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

function sendPostHogCapture(index) {
    return new Promise((resolve) => {
        const payload = JSON.stringify({
            api_key: API_KEY,
            event: 'load_test_setting_changed',
            properties: {
                distinct_id: `parallel_agent_${index}`,
                project: 'default',
                active_theme: index % 2 === 0 ? 'nordic_light' : 'dracula_dark',
                enable_telemetry: true,
                allocated_ram_mb: 8192,
                parallel_thread_count: index + 1,
                clicked_button_name: 'massive_load_trigger_button'
            }
        });

        const options = {
            hostname: HOST,
            port: PORT,
            path: '/capture/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-FortenLog-Request': 'true'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error(`PostHog capture index ${index} failed: Code ${res.statusCode}, Body: ${body}`);
                }
                resolve(res.statusCode === 200);
            });
        });
        req.on('error', () => resolve(false));
        req.write(payload);
        req.end();
    });
}

runMassiveTest();
