# Mezmo Log Export

A standalone dev utility that provides a web UI for downloading logs from the Mezmo (LogDNA) Export API v2 between two timestamps.

No dependencies required — uses only Node.js built-in modules.

## Setup

1. Copy the example env file and add your Mezmo service key:

   ```
   cp .env.example .env
   ```

2. Add your key to `.env`:

   ```
   MEZMO_API_KEY=sts_your_service_key_here
   ```

   Find your service key in Mezmo under **Settings > Organization > API Keys > Service Keys**.

## Usage

```
npm start
```

Then open [http://localhost:3456](http://localhost:3456).

### Exporting logs

1. Set the **From** and **To** timestamps
2. Optionally expand **Filters** to narrow by app, host, level, or search query
3. Click **Export Logs**
4. The `.log` file downloads automatically when complete

The API key can also be entered directly in the UI instead of the `.env` file.

### Output format

Downloaded files are named `mezmo-<from>_to_<to>.log` and contain one JSON object per line.

## Environment variables

| Variable       | Default | Description                      |
| -------------- | ------- | -------------------------------- |
| `MEZMO_API_KEY`| —       | Mezmo service key (required)     |
| `MEZMO_PORT`   | `3456`  | Local server port                |

## Authentication

The tool supports both key formats:

- **`sts_` keys** (newer platform access tokens) — sent as `Authorization: Token <key>`
- **Legacy service keys** — sent via `servicekey` header + Basic auth
