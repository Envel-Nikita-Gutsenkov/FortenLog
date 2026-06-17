# FortenLog Widget JSON Schema

Every individual analytical widget in FortenLog is fully represented as a JSON object. This "Infrastructure as Code" approach allows you to seamlessly share, export, or manually craft highly customized telemetry components.

You can import any widget by pasting its JSON via the **"{ } Import JSON"** button in the Custom Dashboard Builder, or modify an existing one by clicking **"{ } JSON"** on the widget's header.

## Schema Definition

A typical widget JSON structure looks like this:

```json
{
  "title": "Production Event Types",
  "projectId": "12345678-abcd-efgh-ijkl-1234567890ab",
  "table": "events",
  "metric": "count",
  "dimension": "event_type",
  "formula": "x * 10",
  "filters": [
    {
      "column": "environment",
      "op": "eq",
      "value": "production"
    }
  ],
  "chartType": "bar",
  "widthSpan": "2",
  "heightSpan": "medium",
  "colorPalette": "cyberpunk",
  "showLegend": false,
  "showGridlines": true,
  "xAxisLabel": "Event Type",
  "yAxisLabel": "Total Triggers"
}
```

### Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | The display name of the widget. |
| `projectId` | `string` | The UUID of the FortenLog project this widget tracks. (Optional on import; automatically assigned to active project). |
| `table` | `string` | The data source. Options: `"events"` (telemetry logs), `"sessions"` (heartbeats & uptime). |
| `metric` | `string` | Aggregation method. Options: `"count"` (total volume), `"unique_users"` (unique HWIDs), `"errors"`. |
| `dimension` | `string` | Field to group by. Standard options: `"os"`, `"browser"`, `"region"`, `"release_version"`, `"environment"`, `"event_type"`, `"title"`. Custom properties use `"custom:my_key"`. |
| `formula` | `string` | (Optional) Mathematical formula evaluated on the metric result, e.g., `A / 1000` or `x * 5`. Variables `A` or `x` represent the raw metric output. |
| `filters` | `Array` | Array of filter objects. See [Filters](#filters) below. |
| `chartType` | `string` | Type of visualizer. Options: `"bar"`, `"line"`, `"pie"`, `"doughnut"`, `"polarArea"`, `"radar"`, `"kpi"` (big number representation). |
| `widthSpan` | `string` | CSS Grid column width multiplier (from `"1"` to `"4"`). |
| `heightSpan` | `string` | CSS Grid height. Options: `"small"` (280px), `"medium"` (390px), `"large"` (500px). |
| `colorPalette` | `string` | Data visualization colors. Options: `"neon_grape"`, `"cyberpunk"`, `"toxic_mint"`, `"ocean_breeze"`. |
| `showLegend` | `boolean` | Toggle chart legend visibility. |
| `showGridlines` | `boolean` | Toggle graph background gridlines (Line/Bar charts). |
| `xAxisLabel` | `string` | (Optional) Text label under the X axis. |
| `yAxisLabel` | `string` | (Optional) Text label beside the Y axis. |

### Filters

Each filter is an object within the `filters` array specifying exact matching rules.

| Property | Description |
| :--- | :--- |
| `column` | The database column to filter on (e.g., `"environment"`, `"os"`). Custom metadata columns should be prefixed with `"custom:"` (e.g., `"custom:selected_server"`). |
| `op` | Evaluation operator. Options: `"eq"` (equals), `"neq"` (not equals). |
| `value` | The string value to match against. |

## Custom Dimensions

If you log customized telemetry payloads to FortenLog via the SDK, you can visualize them by using the `"custom:"` prefix in the `dimension` field.

**Example**:
If your logs include `{ "game_mode": "survival" }`, you can chart the distribution by setting:
```json
"dimension": "custom:game_mode"
```
