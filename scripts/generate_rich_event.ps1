$projectId = "test-project"
$url = "http://localhost:3000/api/$projectId/envelope/"

$envelope = @'
{"event_id":"652a9ff1","sent_at":"2026-05-13T15:56:16.908Z"}
{"type":"event"}
{
  "exception": {
    "values": [{
      "type": "RequestError",
      "value": "self signed certificate",
      "stacktrace": {
        "frames": [
          {"filename": "node:events", "function": "onceWrapper", "lineno": 444},
          {"filename": "node:events", "function": "emit", "lineno": 333},
          {"filename": "node_modules/got/dist/source/core/index.js", "function": "ClientRequest.<anonymous>", "lineno": 970, "context_line": "error = error instanceof timed_out_1.TimeoutError ? new TimeoutError(error, this.timings, this) : new RequestError(error.message);", "pre_context": ["request.destroy();", "(_a = request.res) === null || _a === void 0 ? void 0 : _a.removeAllListeners('end');"], "post_context": ["this._beforeError(error);", "});"]}
        ]
      }
    }]
  },
  "breadcrumbs": [
    {"timestamp": 1778715376, "category": "info", "message": "AutoUpdater: No new update found."},
    {"timestamp": 1778715377, "category": "error", "message": "Download failed for OpenJDK17U-jdk_x64_windows_hotspot_17.0.19+10", "level": "error"}
  ],
  "contexts": {
    "os": {"name": "Windows", "version": "10.0.19045"},
    "browser": {"name": "Chrome", "version": "142.0.7444.162"},
    "device": {"id": "hw-unique-123", "cpu_description": "Intel(R) Core(TM) i3-9100 CPU @ 3.60GHz", "memory_size": 8334127104},
    "runtime": {"name": "Electron", "version": "39.2.1"}
  },
  "release": "2.3.8",
  "environment": "production"
}
'@

Invoke-RestMethod -Uri $url -Method Post -Body $envelope -ContentType "text/plain"
Write-Host "Rich test event sent to $url"
