$baseUrl = "http://localhost:3000"
$projectId = "test-project"

# 1. Ensure project exists
Write-Host "Creating project $projectId..."
try {
    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/settings/projects" -Body (@{ id=$projectId; name="Default Project" } | ConvertTo-Json) -ContentType "application/json"
} catch {
    Write-Host "Project might already exist."
}

function Send-Event($payload) {
    $json = $payload | ConvertTo-Json -Depth 10 -Compress
    $header = @{ event_id = [System.Guid]::NewGuid().ToString("n") } | ConvertTo-Json -Compress
    $itemHeader = @{ type = "event"; length = $json.Length } | ConvertTo-Json -Compress
    $envelope = "$header`n$itemHeader`n$json`n"
    
    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/$projectId/envelope/?sentry_key=test_key" -Body $envelope -ContentType "text/plain"
}

# 1. TypeError: CACHE_DROPIN_MODS is not iterable
$e1 = @{
    exception = @{ values = @(@{
        type = "TypeError"
        value = "CACHE_DROPIN_MODS is not iterable"
        stacktrace = @{ frames = @(
            @{ filename = "app:///assets/js/scripts/settings.js"; function = "saveDropinModConfiguration"; lineno = 775; context_line = "for (const mod of CACHE_DROPIN_MODS) {"; pre_context = @("async function save() {"); post_context = @("  await apply(mod);") }
        )}
    })}
    breadcrumbs = @{ values = @(
        @{ timestamp = 1715673600; category = "ui.click"; message = "button#save"; level = "info" }
    )}
    contexts = @{ 
        os = @{ name = "Windows"; version = "11" }; 
        browser = @{ name = "Chrome"; version = "124" };
        device = @{ model = "ASUS ROG Zephyrus"; arch = "x64" }
    }
    tags = @{ release = "2.3.8"; env = "production" }
    release = "2.3.8"
    environment = "production"
}

# 2. RequestError: self signed certificate
$e2 = @{
    exception = @{ values = @(@{
        type = "RequestError"
        value = "self signed certificate"
        stacktrace = @{ frames = @(
            @{ filename = "app:///node_modules/got/dist/source/core/index.js"; function = "ClientRequest.<anonymous>"; lineno = 970; context_line = "error = new RequestError(error.message, this.timings, this);" }
        )}
    })}
    contexts = @{ os = @{ name = "Windows"; version = "10" } }
    release = "2.3.8"
}

Write-Host "Populating events..."
1..10 | % { Send-Event $e1; Send-Event $e2 }
Write-Host "Done."
