const http = require('http');

async function sendRequest(path, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 3000,
            path: path,
            method: method,
            headers: headers
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed, headers: res.headers });
                } catch(e) {
                    resolve({ status: res.statusCode, data: data, headers: res.headers });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(body);
        req.end();
    });
}

async function run() {
    console.log("Logging in as admin...");
    const loginRes = await sendRequest('/api/system/login', 'POST', JSON.stringify({
        username: 'admin',
        password: 'fortenlog2026'
    }), { 'Content-Type': 'application/json' });

    if (loginRes.status !== 200 || !loginRes.data.success) {
        console.error("Login failed:", loginRes.status, loginRes.data);
        process.exit(1);
    }
    const token = loginRes.data.token;
    console.log("Login successful! Fetching project API keys...");

    const projectsRes = await sendRequest('/api/settings/projects', 'GET', null, {
        'Authorization': `Bearer ${token}`,
        'X-FortenLog-Request': 'true'
    });

    if (projectsRes.status !== 200) {
        console.error("Failed to fetch projects list:", projectsRes.status, projectsRes.data);
        process.exit(1);
    }

    const projects = projectsRes.data;
    console.log(`Found projects: ${projects.map(p => p.id).join(', ')}`);
    
    for (const project of projects) {
        const projectId = project.id;
        const projectApiKey = project.api_key;
        console.log(`\n--- Seeding project: ${projectId} (API Key: ${projectApiKey}) ---`);
    
        const issues = [
            {
                type: 'SyntaxError',
                value: 'Unexpected token < in JSON at position 0',
                culprit: 'fetchData() in app.js',
                message: 'SyntaxError: Unexpected token < in JSON at position 0'
            },
            {
                type: 'TypeError',
                value: 'Cannot read properties of undefined (reading "map")',
                culprit: 'renderList() in components.js',
                message: 'TypeError: Cannot read properties of undefined (reading "map")'
            },
            {
                type: 'ReferenceError',
                value: 'React is not defined',
                culprit: 'index.js',
                message: 'ReferenceError: React is not defined'
            },
            {
                type: 'NetworkError',
                value: 'Failed to connect to backend',
                culprit: 'api.js:42',
                message: 'NetworkError: Failed to connect to backend'
            }
        ];

        const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge'];
        const osList = ['Windows 11', 'macOS 14', 'Linux', 'iOS', 'Android'];
        const regions = ['US', 'DE', 'GB', 'FR', 'JP', 'IN', 'BR', 'AU', 'CA', 'UA', 'KZ', 'BY', 'NL', 'IT', 'ES', 'SE'];
        
        // Maps region ISO to an IP address whose octet sum % 16 equals the corresponding region index
        const regionIps = {
            'US': '1.1.1.13', // sum: 16 -> 16 % 16 = 0
            'DE': '1.1.1.14', // sum: 17 -> 17 % 16 = 1
            'GB': '1.1.1.15', // sum: 18 -> 18 % 16 = 2
            'FR': '1.1.1.16', // sum: 19 -> 19 % 16 = 3
            'JP': '1.1.1.17', // sum: 20 -> 20 % 16 = 4
            'IN': '1.1.1.18', // sum: 21 -> 21 % 16 = 5
            'BR': '1.1.1.19', // sum: 22 -> 22 % 16 = 6
            'AU': '1.1.1.20', // sum: 23 -> 23 % 16 = 7
            'CA': '1.1.1.21', // sum: 24 -> 24 % 16 = 8
            'UA': '1.1.1.22', // sum: 25 -> 25 % 16 = 9
            'KZ': '1.1.1.23', // sum: 26 -> 26 % 16 = 10
            'BY': '1.1.1.24', // sum: 27 -> 27 % 16 = 11
            'NL': '1.1.1.25', // sum: 28 -> 28 % 16 = 12
            'IT': '1.1.1.26', // sum: 29 -> 29 % 16 = 13
            'ES': '1.1.1.27', // sum: 30 -> 30 % 16 = 14
            'SE': '1.1.1.28'  // sum: 31 -> 31 % 16 = 15
        };

        let sent = 0;
        
        for (let i = 0; i < 50; i++) {
            const issue = issues[Math.floor(Math.random() * issues.length)];
            const browser = browsers[Math.floor(Math.random() * browsers.length)];
            const os = osList[Math.floor(Math.random() * osList.length)];
            const region = regions[Math.floor(Math.random() * regions.length)];
            const regionIp = regionIps[region] || '1.1.1.13';
            const release = Math.random() > 0.5 ? '1.0.0' : '1.0.1';
            
            const timestamp = new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString();
            const eventId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            
            const payload = {
                event_id: eventId,
                timestamp: timestamp,
                platform: 'javascript',
                level: 'error',
                release: release,
                environment: 'production',
                request: {
                    url: 'https://example.com/app',
                    headers: {
                        'User-Agent': `${browser} / ${os}`
                    }
                },
                exception: {
                    values: [
                        {
                            type: issue.type,
                            value: issue.value,
                            mechanism: { handled: false },
                            stacktrace: {
                                frames: [
                                    {
                                        filename: 'app:///app.js',
                                        function: 'anonymous',
                                        lineno: Math.floor(Math.random() * 100) + 10,
                                        context_line: `    throw new Error("${issue.value}");`,
                                        pre_context: ["function test() {", "  let a = 1;"],
                                        post_context: ["}", ""]
                                    },
                                    {
                                        filename: 'app:///components.js',
                                        function: 'render',
                                        lineno: Math.floor(Math.random() * 200) + 10,
                                        context_line: `    return data.map(d => d.id);`,
                                        pre_context: ["function render(data) {", "  if (!data) return;"],
                                        post_context: ["}", ""]
                                    }
                                ]
                            }
                        }
                    ]
                },
                tags: {
                    browser: browser,
                    os: os,
                    region: region,
                    server_name: `node-${Math.floor(Math.random() * 10)}`
                },
                contexts: {
                    device: {
                        memory_size: Math.floor(Math.random() * 16 + 4) * 1024 * 1024 * 1024,
                        screen_resolution: '1920x1080',
                        cpu_description: 'Intel Core i7'
                    },
                    gpu: {
                        name: Math.random() > 0.5 ? 'NVIDIA GeForce RTX 3080' : 'Apple M1 Max'
                    }
                }
            };

            const envelope = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n{"type":"event","length":${JSON.stringify(payload).length}}\n${JSON.stringify(payload)}`;

            const res = await sendRequest(`/api/${projectId}/envelope/?sentry_key=${projectApiKey}`, 'POST', envelope, { 
                'Content-Type': 'application/x-sentry-envelope',
                'X-Forwarded-For': regionIp
            });
            if (res.status !== 200 && res.status !== 202) {
                console.error(`Failed to send event: HTTP ${res.status}`, res.data);
            }
            sent++;
            if (sent % 10 === 0) console.log(`Sent ${sent} events... (last status: ${res.status})`);
        }
        
        // Send some sessions
        let sessionsSent = 0;
        for (let i = 0; i < 200; i++) {
            const browser = browsers[Math.floor(Math.random() * browsers.length)];
            const os = osList[Math.floor(Math.random() * osList.length)];
            const region = regions[Math.floor(Math.random() * regions.length)];
            const regionIp = regionIps[region] || '1.1.1.13';
            const release = Math.random() > 0.5 ? '1.0.0' : '1.0.1';
            
            const sessionPayload = {
                sid: Math.random().toString(36).substring(2, 15),
                did: Math.random().toString(36).substring(2, 15),
                seq: 0,
                timestamp: new Date().toISOString(),
                init: true,
                status: 'exited',
                errors: Math.random() > 0.8 ? 1 : 0,
                attrs: {
                    release: release,
                    environment: 'production'
                }
            };
            
            const envelope = `${JSON.stringify({ sent_at: new Date().toISOString() })}\n{"type":"session","length":${JSON.stringify(sessionPayload).length}}\n${JSON.stringify(sessionPayload)}`;
            const res = await sendRequest(`/api/${projectId}/envelope/?sentry_key=${projectApiKey}`, 'POST', envelope, { 
                'Content-Type': 'application/x-sentry-envelope',
                'X-Forwarded-For': regionIp
            });
            if (res.status !== 200 && res.status !== 202) {
                console.error(`Failed to send session: HTTP ${res.status}`, res.data);
            }
            sessionsSent++;
        }
        console.log(`Successfully sent ${sessionsSent} session events for ${projectId}.`);
    }
    console.log('\nFinished generating mock data for all projects!');
}

run();
