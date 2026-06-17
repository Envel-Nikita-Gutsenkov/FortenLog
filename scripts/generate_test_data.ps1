$baseUrl = "http://localhost:3000/api"
$projects = @("test-project", "alpha-dev", "beta-prod")

foreach ($projId in $projects) {
    Write-Host "Generating data for $projId..."
    $url = "$baseUrl/$projId/envelope/"
    
    # 1. Standard Error
    $envelope1 = @'
{"event_id":"e1","sent_at":"2026-05-13T10:00:00Z"}
{"type":"event"}
{"exception":{"values":[{"type":"TypeError","value":"cannot read property 'id' of undefined","stacktrace":{"frames":[{"filename":"app.js","function":"render","lineno":10}]}}]},"release":"1.0.0","environment":"production"}
'@
    
    # 2. Same error from different user (HWID)
    $envelope2 = @'
{"event_id":"e2","sent_at":"2026-05-13T10:05:00Z"}
{"type":"event"}
{"exception":{"values":[{"type":"TypeError","value":"cannot read property 'id' of undefined","stacktrace":{"frames":[{"filename":"app.js","function":"render","lineno":10}]}}]},"release":"1.0.0","environment":"production","contexts":{"device":{"id":"hw-user-2"}}}
'@

    # 3. Rich error with breadcrumbs and contexts
    $envelope3 = @'
{"event_id":"e3","sent_at":"2026-05-13T10:10:00Z"}
{"type":"event"}
{
  "exception": {"values": [{"type": "RuntimeError", "value": "Database connection lost", "stacktrace": {"frames": [{"filename": "db.js", "function": "connect", "lineno": 42, "context_line": "throw new Error('Database connection lost')", "pre_context": ["const conn = await pool.get();"], "post_context": ["return conn;"]}]}}]},
  "breadcrumbs": [
    {"timestamp": 1778715000, "category": "query", "message": "SELECT * FROM users WHERE id = 1"},
    {"timestamp": 1778715005, "category": "error", "message": "Connection timeout after 5s", "level": "error"}
  ],
  "contexts": {
    "os": {"name": "macOS", "version": "14.4.1"},
    "browser": {"name": "Firefox", "version": "125.0"}
  },
  "release": "1.1.0",
  "environment": "staging"
}
'@

    Invoke-RestMethod -Uri $url -Method Post -Body $envelope1 -ContentType "text/plain"
    Invoke-RestMethod -Uri $url -Method Post -Body $envelope2 -ContentType "text/plain"
    Invoke-RestMethod -Uri $url -Method Post -Body $envelope3 -ContentType "text/plain"
}

Write-Host "Test data generation complete."
