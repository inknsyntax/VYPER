## VYPER local operations console

VYPER runs as a local Node server and keeps memory, monitoring signals, and staged automation actions on the local machine.

```powershell
npm install
npm start
```

Open `http://127.0.0.1:2727`.

### AI and research

`ai on` loads the WebLLM neural core into the browser using WebGPU. The model download is large and may be cached by the browser. `research <question>` sends a logged research request through the local server and returns public DuckDuckGo results.

Every research request is recorded locally in `search.json`. Email and SMS remain staged queue concepts until a provider is configured and the operator approves each action. Capability defaults live in `agent-config.json`; decisions are recorded in `audit.json`. VYPER still has no self-editing or arbitrary shell endpoint.

The current API surface is:

- `GET /api/integrations/status`
- `GET /api/agent/config`
- `GET /api/audit`
- `GET /api/automation/queue`
- `POST /api/automation/queue` with `{ "type": "email|sms", "content": "..." }` (staged locally only)
- `PATCH /api/automation/queue/:id` with `{ "action": "approve|reject" }`
- `POST /api/search` with `{ "type": "...", "query": "..." }`
- `GET|POST /api/memory`

The server binds only to `127.0.0.1`. The browser CSP permits HTTPS resources for the explicitly enabled AI and research features.

### Voice and inspection boundaries

On supported Windows systems, the microphone starts in active mode and remains listening until `stop listening` or the microphone button is used. Clicking the microphone resumes it. Windows microphone permissions, an input device, and an installed recognition language still apply.

VYPER can inspect project source through `GET /api/code?file=index.html`. This endpoint is read-only and limited to the explicit manifest in `file-access.json`. It has no edit or shell endpoint.

The exact readable files are listed in `file-access.json`. Say `list allowed files`, `view code index.html`, or `read file server.js` to inspect them. Add files to that manifest deliberately; VYPER cannot read files outside it.

On Windows, speech uses the native `System.Speech` recognizer through `voice-engine.ps1`, launched by the local server. The browser receives transcripts only through the localhost `/api/voice/stream` endpoint, so browser `SpeechRecognition` and its potential cloud service are not used. The default microphone is used, and normal Windows microphone permissions still apply.

The `POST /api/web/fetch` gateway permits HTTPS hosts and logs requests in `search.json`. Research uses the separate `POST /api/web/search` endpoint.

### USB portability

Copy the whole project folder to the USB. Run `Install-VYPER.bat` once on a computer with Node.js to install dependencies, then use `Start-VYPER.bat`. A portable Node runtime can be placed at `tools\node\node.exe` so starting does not depend on a system Node installation.

The app and local data can travel on the USB, but “works on every computer” is not guaranteed: Windows may block `.bat` or PowerShell execution, the computer may lack a microphone or compatible `System.Speech` voice, and permissions/security software are controlled by that computer. Keep the USB encrypted and physically secured; the software cannot prevent someone with access to the drive from copying its files.
