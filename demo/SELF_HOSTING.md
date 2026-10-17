# Running the Myned voice avatar on your own machine

This is a real-time voice assistant with a lip-synced 3D avatar. You talk to it in the browser; it answers out loud while the avatar speaks. It can also look through your webcam when you ask it to ("what am I holding?").

Everything except the language model runs inside one Docker container, on the CPU:

| Part | What it does | Where it runs |
|---|---|---|
| Speech detection (Silero VAD) | Notices when you start and stop talking | Container, CPU |
| Speech recognition (NVIDIA Parakeet TDT 0.6B) | Turns your speech into text | Container, CPU |
| Voice (Kyutai Pocket TTS) | Speaks the reply | Container, CPU |
| Lip-sync (Myned wav2arkit) | Moves the avatar's face to the voice | Container, CPU |
| 3D avatar (Myned gaussian-splat renderer) | Draws the avatar | Your browser (WebGL) |
| Language model | Writes the reply, decides when to use the camera | **Your choice:** a local model, or a cloud API |

This build is **English only**.

---

## Quick start (Windows or Intel Mac, local model on an NVIDIA GPU)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and [Ollama](https://ollama.com/download).
2. Download the language model (3.3 GB):
   ```
   ollama pull qwen3-vl:4b-instruct
   ```
3. Load the container image from the file Myned gave you (3.5 GB):
   ```
   docker load -i myned-voice-avatar-english.tar.gz
   ```
4. Start it:
   ```
   docker run -d --name voice-avatar -p 7860:7860 \
     -e LLM_UPSTREAM_URL=http://host.docker.internal:11434/v1 \
     -e LLM_MODEL=qwen3-vl:4b-instruct \
     myned-voice-avatar:english
   ```
5. Wait about a minute the first time (it downloads its voice models), then about 40 seconds on later starts. Open **http://localhost:7860** in Chrome or Edge, allow the microphone (and camera), and tap the orb.

On Windows PowerShell, replace the `\` line endings with a backtick `` ` ``, or put the whole command on one line.

---

## Hardware and device requirements

These numbers come from tests of this exact image on a Windows 11 laptop (Intel i7-13800H, 32 GB RAM, NVIDIA RTX A1000 with 6 GB of video memory), with the language model running in Ollama on the GPU.

### The container

| | Minimum | Recommended | Notes |
|---|---|---|---|
| CPU architecture | **x86-64 (Intel/AMD)** | | The image is built for `linux/amd64` only. See *Device types* below. |
| CPU cores for the container | 1 | **2–4** | 2 cores replied as fast as 8. With 1 core it still works, but the voice is generated only 1.5× faster than it plays, so a busy machine can make it stutter. |
| Memory for the container | 7 GB | **8 GB** | It peaks at about 6.9 GB. With a 6 GB limit it is killed while loading its models. |
| Disk | 13 GB | 20 GB | The image is 5.2 GB unpacked; Docker Desktop also keeps the packed copy, so about 9 GB once loaded. Add the 3.5 GB image file (delete it after loading) and about 0.3 GB downloaded at first start. |
| GPU | Not needed | | The container uses the CPU only. |

Because the machine also runs the operating system and the browser, we recommend **16 GB of RAM** in total. Measured response times on the test laptop (2 cores, 7 GB limit): speech recognition about 0.8 s per turn, local model about 0.5 s per reply, and **about 1.5 s from the end of your sentence to the start of the spoken reply**.

### The language model

| Option | What you need |
|---|---|
| Local, `qwen3-vl:4b-instruct` in Ollama | An NVIDIA GPU with **at least 6 GB of video memory** (it uses 3.6 GB), plus 3.3 GB of disk. Tested: runs fully on the GPU, about 0.5 s per reply. |
| Local, larger models | More video memory. `qwen3-vl:8b-instruct` needs about 6.1 GB just for the model. |
| Local, no GPU | Possible, but slow, and it competes with the container for the CPU. Not recommended; use a cloud API instead. |
| Cloud API | Only an internet connection and an API key. |

### Device types

| Device | Works? |
|---|---|
| Linux PC or server, x86-64 | Yes |
| Windows 10/11 PC, x86-64, with Docker Desktop | Yes (tested) |
| Intel Mac with Docker Desktop | Should work; not tested. Ollama on an Intel Mac runs on the CPU, so use a cloud API for the model. |
| Apple Silicon Mac (M1–M4) | Not recommended. The image is x86-64 only, so Docker has to emulate it, which is very likely too slow for real-time speech (not tested). |
| Raspberry Pi and other ARM boards | No |
| Phones and tablets | Only as the **browser**, connecting to a machine that runs the container over HTTPS (see *One server for a whole class*). |

**Browser:** a recent Chrome or Edge (tested), with WebGL for the avatar. Browsers only allow the microphone on `localhost` or on an `https://` address.

**Internet:** needed at first start (about 0.3 GB of voice and speech-detection models), for the avatar (loaded from a CDN by the browser), and for cloud language models.

---

## Getting the container

Myned provides the image as a single file, `myned-voice-avatar-english.tar.gz` (3.5 GB). Load it once:

```
docker load -i myned-voice-avatar-english.tar.gz
```

Docker then lists it as `myned-voice-avatar:english`.

---

## Choosing the language model

The container talks to the language model through the standard OpenAI **chat completions** API, so any server or provider that speaks it will work. Three settings control it:

| Setting | Meaning | Default |
|---|---|---|
| `LLM_UPSTREAM_URL` | The API's base address (ending in `/v1`) | Hugging Face's inference router |
| `LLM_MODEL` | The model name, as that server or provider writes it | `Qwen/Qwen3-VL-30B-A3B-Instruct` |
| `LLM_API_KEY` | The API key, if the provider needs one | none |

**What the model must support:**
- **Streaming chat completions.** Every option below does.
- **Images and tool calls, for the camera.** The assistant uses the webcam through a tool call. A text-only model, or one without tool calling, still holds a conversation, but can't see.

**Tested so far:** Option A on Windows with Docker Desktop, and Option C (it's what the public demo runs). Options B and D, and the Linux variant of A, use the same standard API but haven't been run with this build yet.

### Option A: a local model with Ollama

1. Install Ollama and pull a model:
   ```
   ollama pull qwen3-vl:4b-instruct
   ```
2. **Windows or Mac (Docker Desktop):** the container reaches your machine at `host.docker.internal`:
   ```
   docker run -d --name voice-avatar -p 7860:7860 \
     -e LLM_UPSTREAM_URL=http://host.docker.internal:11434/v1 \
     -e LLM_MODEL=qwen3-vl:4b-instruct \
     myned-voice-avatar:english
   ```
3. **Linux:** let the container share the machine's network, and use `127.0.0.1`. With host networking the app is on port 7860 directly, so no `-p` is needed:
   ```
   docker run -d --name voice-avatar --network host \
     -e LLM_UPSTREAM_URL=http://127.0.0.1:11434/v1 \
     -e LLM_MODEL=qwen3-vl:4b-instruct \
     myned-voice-avatar:english
   ```

No API key is needed. Ollama unloads an idle model after 5 minutes, so the first reply after a break takes a few seconds longer.

### Option B: another local server (vLLM, LM Studio, llama.cpp)

Use the server's OpenAI-compatible address and its model name, the same way:
```
-e LLM_UPSTREAM_URL=http://host.docker.internal:8000/v1 -e LLM_MODEL=<model name>
```
Add `-e LLM_API_KEY=...` only if your server requires a key.

### Option C: Hugging Face Inference Providers

This is what the public demo uses: the larger Qwen3-VL-30B model, with better answers, billed per use to your Hugging Face account. Create a token at https://huggingface.co/settings/tokens with the **"Make calls to Inference Providers"** permission, then:
```
docker run -d --name voice-avatar -p 7860:7860 \
  -e HF_TOKEN=hf_... \
  myned-voice-avatar:english
```
The address and model are already the defaults. A turn uses roughly 500–750 input and 20–70 output tokens.

### Option D: OpenAI or another cloud provider

```
docker run -d --name voice-avatar -p 7860:7860 \
  -e LLM_UPSTREAM_URL=https://api.openai.com/v1 \
  -e LLM_MODEL=gpt-4o-mini \
  -e LLM_API_KEY=sk-... \
  myned-voice-avatar:english
```
Other providers with an OpenAI-compatible API (Together, Groq, OpenRouter, DeepInfra and so on) work the same way: their address, their model name, their key. The key stays on the server; it is never sent to the browser.

---

## Using it

- Open **http://localhost:7860**, allow the microphone, and tap the orb to start. Tap the square button to end the conversation.
- **Settings** (the gear icon) has the voice (8 English voices), the instructions given to the assistant, a noise gate for noisy rooms, and the avatar on/off switch. Changes apply mid-conversation.
- Say things like "look at this" or "what am I holding?" and it takes a snapshot from the webcam. The camera preview shows in the corner.
- To stop and start the container later: `docker stop voice-avatar` and `docker start voice-avatar`.

---

## Limits and known behaviour

- **One conversation at a time per container.** Anyone else who opens the page waits in a queue, up to 10 people, and sees their place in line.
- **English only.** The voices are English, and so is the speech recognition, in practice.
- **Small local models are less capable.** With `qwen3-vl:4b-instruct`, answers are short and simple, it sometimes promises actions it can't take ("I'll grab that for you"), and its other languages are weak. A larger model or a cloud model fixes this.
- **No sign-in when self-hosted.** Anyone who can open the page can talk to it, and with a cloud API that usage is billed to your key. Keep the port private, or put the server behind your own login.
- **Restarting is cheap, removing is not.** `docker stop`/`docker start` keeps the downloaded voice models; `docker rm` means downloading them again (about 0.3 GB).
- **If the language model is down at start-up**, the container still starts and logs a warning. Conversations work as soon as the model is reachable.

---

## One server for a whole class

The simplest setup is for each student to run their own container. To share one machine instead:

1. **Serve it over HTTPS.** Browsers block the microphone on plain `http://` addresses other than `localhost`. Put any reverse proxy in front of port 7860; with [Caddy](https://caddyserver.com/), for example:
   ```
   voice.example.edu {
       reverse_proxy localhost:7860
   }
   ```
2. **Tell the page its public address**, or it will try to connect to `localhost`:
   ```
   -e SPEECH_TO_SPEECH_URL=wss://voice.example.edu/v1/realtime
   ```
3. **Allow more than one conversation at once** with `-e NUM_PIPELINES=3` (for example). Each extra conversation loads its own speech and voice models: plan for **about 5 GB of RAM and 2 CPU cores more per conversation** (an estimate; only one conversation per container was measured). Further visitors wait in the queue (`QUEUE_MAX`, default 10).
4. If you use a cloud model, remember that every student's conversations are billed to the key you set.

---

## All settings

Pass any of these with `-e NAME=value` on `docker run`.

| Setting | Default | What it does |
|---|---|---|
| `LLM_UPSTREAM_URL` | Hugging Face router | Language model API address (OpenAI-compatible, ending in `/v1`) |
| `LLM_MODEL` | `Qwen/Qwen3-VL-30B-A3B-Instruct` | Model name |
| `LLM_API_KEY` | — | API key for the language model provider |
| `HF_TOKEN` | — | Hugging Face token, used when the model is on Hugging Face and `LLM_API_KEY` isn't set |
| `POCKET_VOICE` | `eponine` | Default voice: `alba`, `azelma`, `cosette`, `eponine`, `fantine`, `javert`, `jean`, `marius` |
| `NUM_PIPELINES` | `1` | Conversations served at the same time |
| `QUEUE_MAX` | `10` | How many people can wait in line |
| `SPEECH_TO_SPEECH_URL` | `ws://localhost:7860/v1/realtime` | Public WebSocket address, for a shared server |
| `TORCH_THREADS` | `4` | CPU threads for speech recognition and voice; set it to your core limit (e.g. `2`) |
| `WAV2ARKIT_THREADS` | `2` | CPU threads for lip-sync; `1` on a 2-core limit |
| `LIVE_TRANSCRIPTION` | `1` | Show your words while you speak; `0` saves some CPU |
| `SERPER_API_KEY` | — | Enables the optional web-search tool ([serper.dev](https://serper.dev)) |

To cap the container's resources, add Docker's own limits. This is the tested 2-core, 7 GB setup:
```
--cpus=2 --memory=7g --memory-swap=7g -e TORCH_THREADS=2 -e WAV2ARKIT_THREADS=1
```

---

## Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| The container stops a few seconds after starting | Not enough memory. Give it at least 7 GB (8 GB recommended). `docker inspect -f '{{.State.OOMKilled}}' voice-avatar` shows `true` if this is the cause. |
| The orb says "Connecting" for up to a minute | The models are still loading after a (re)start. It connects by itself once ready. |
| "Disconnected — tap to start again" | The container stopped or restarted. Check `docker logs voice-avatar`. |
| It hears you but never answers | The language model isn't reachable. Check `docker logs voice-avatar` for "LLM warmup failed", and check `LLM_UPSTREAM_URL`, that Ollama is running, and on Linux that you used `--network host`. |
| The browser never asks for the microphone | The page isn't on `localhost` or `https://`. See *One server for a whole class*. |
| The voice stutters | The container is short of CPU. Give it at least 2 cores and set `TORCH_THREADS` to match. |

To read the logs: `docker logs -f voice-avatar`.

---

## Credits

Built on Hugging Face's open-source [speech-to-speech](https://github.com/huggingface/speech-to-speech) pipeline, with NVIDIA Parakeet TDT for speech recognition, Kyutai Pocket TTS for the voices, Silero VAD for speech detection, and Myned's [avatar widget](https://github.com/myned-ai/avatar-chat-widget) and [lip-sync model](https://github.com/myned-ai/avatar-chat-server). Model licences are listed on each model's page.
