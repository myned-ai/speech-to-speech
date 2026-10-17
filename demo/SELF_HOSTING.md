# Running the Myned voice avatar on your own machine

A real-time voice assistant with a lip-synced 3D avatar. You talk to it in the browser, it answers out loud while the avatar speaks, and it can look through your webcam when you ask it to.

Speech detection, speech recognition, the voice and the lip-sync all run in one Docker container, on the CPU. The avatar is drawn in your browser. The language model is your choice: a local model or a cloud API.

This build is English only. Tested on consumer laptops, where replies start about 1.5 seconds after you stop talking.

---

## Requirements

- **Computer:** Windows, Linux or macOS with [Docker](https://www.docker.com/products/docker-desktop/) and [Git](https://git-scm.com/downloads). On Intel or AMD (x86-64) it's tested. On ARM, such as Apple Silicon Macs or ARM boards, the build makes a native ARM image that should work but hasn't been tested yet; small boards are likely too slow.
- **For the container:** 2 CPU cores and 8 GB of RAM. It won't start with less than 7 GB. Plan for 16 GB of RAM in the machine overall.
- **Disk:** about 20 GB free to build the image.
- **A language model:** a local model (a GPU makes it faster, but a recent laptop CPU works) or an API key for a cloud provider.
- **Browser:** Chrome or Edge. Browsers only allow the microphone on `localhost` or an `https://` address.

---

## 1. Build the image

```
git clone -b lean-image https://github.com/myned-ai/speech-to-speech
cd speech-to-speech/demo
docker build -t myned-voice-avatar:english .
```

This takes about 5–10 minutes and downloads several GB of packages and models. Afterwards, `docker builder prune` frees about 9 GB of build cache. To change the app (the page, the default instructions), edit the files in `demo` and build again.

---

## 2. Choose the language model

The pipeline (Hugging Face's speech-to-speech) talks to the language model over the standard **OpenAI-compatible chat completions API**, so any local server or cloud provider that offers it works. Three settings choose it:

| Setting | Meaning |
|---|---|
| `LLM_UPSTREAM_URL` | The API address, ending in `/v1` |
| `LLM_MODEL` | The model name |
| `LLM_API_KEY` | The API key, if the provider needs one |

For the camera to work, use a model that accepts images and supports tool calls.

**Example: a local model with [Ollama](https://ollama.com/download)**

```
ollama pull qwen3-vl:4b-instruct
docker run -d --name voice-avatar -p 7860:7860 \
  -e LLM_UPSTREAM_URL=http://host.docker.internal:11434/v1 \
  -e LLM_MODEL=qwen3-vl:4b-instruct \
  myned-voice-avatar:english
```

**Linux with Docker Engine:** replace `-p 7860:7860` with `--network host` and use `http://127.0.0.1:11434/v1` (ports 7860 and 8765 must be free). With Docker Desktop on Linux, use the command above unchanged.

**Example: a cloud provider (OpenAI shown; others work the same way)**

```
docker run -d --name voice-avatar -p 7860:7860 \
  -e LLM_UPSTREAM_URL=https://api.openai.com/v1 \
  -e LLM_MODEL=gpt-4o-mini \
  -e LLM_API_KEY=sk-... \
  myned-voice-avatar:english
```

**Hugging Face Inference Providers** is the default: pass only `-e HF_TOKEN=hf_...`, using a token with the "Make calls to Inference Providers" permission.

On Windows PowerShell, put each command on one line, or replace the `\` line endings with a backtick.

---

## 3. Use it

Wait about a minute while it starts (the first start downloads its voice models). Then open **http://localhost:7860**, allow the microphone and camera, and tap the orb.

- **Settings** (the gear icon) has the voice, the assistant's instructions, a noise gate and the avatar switch.
- **The camera:** say "look at this" or "what am I holding?" and it takes a snapshot from the webcam.
- **Stopping and starting:** `docker stop voice-avatar` and `docker start voice-avatar`.

---

## Good to know

- **One conversation at a time per container.** Others wait in a queue and see their place in line.
- **No sign-in when self-hosted.** Anyone who can open the page can talk to it, and with a cloud API that usage is billed to your key.
- **Small local models give simpler answers.** A larger or cloud model gives better ones.
- **To cap the container's resources,** add `--cpus=2 --memory=8g --memory-swap=8g -e TORCH_THREADS=2 -e WAV2ARKIT_THREADS=1` to `docker run`.

---

## Other settings

| Setting | Default | What it does |
|---|---|---|
| `POCKET_VOICE` | `eponine` | Default voice: `alba`, `azelma`, `cosette`, `eponine`, `fantine`, `javert`, `jean`, `marius` |
| `NUM_PIPELINES` | `1` | Conversations served at once |
| `QUEUE_MAX` | `10` | How many people can wait in line |
| `LIVE_TRANSCRIPTION` | `1` | Show your words while you speak; `0` saves some CPU |
| `SERPER_API_KEY` | none | Enables the optional web-search tool ([serper.dev](https://serper.dev)) |

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The container stops right after starting | Not enough memory: give it 8 GB. |
| "Connecting" for up to a minute | It's still loading its models; wait. |
| It hears you but never answers | The language model isn't reachable. Check `docker logs voice-avatar`, `LLM_UPSTREAM_URL`, and that your model server is running. |
| The browser never asks for the microphone | Open it on `localhost`, or serve it over `https://`. |

---

Built on Hugging Face's open-source [speech-to-speech](https://github.com/huggingface/speech-to-speech) pipeline, with NVIDIA Parakeet, Kyutai Pocket TTS, Silero VAD, and Myned's [avatar widget](https://github.com/myned-ai/avatar-chat-widget) and [lip-sync model](https://github.com/myned-ai/avatar-chat-server).
