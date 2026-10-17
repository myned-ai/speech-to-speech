# Single-container deployment: the demo app AND the speech-to-speech pipeline
# (CPU) in one image, sized for an HF Space on the cpu-upgrade tier. HF Spaces
# (sdk: docker) route traffic to $PORT, default 7860; the pipeline runs
# internally on 8765 behind the same-origin /v1/realtime passthrough.
FROM python:3.11-slim

# libsndfile for librosa/soundfile, libportaudio for the sounddevice import,
# libgomp for onnxruntime/ggml.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git libsndfile1 libportaudio2 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt constraints.txt ./
# Every pip install below is held to the known-good versions in constraints.txt.
ENV PIP_CONSTRAINT=/app/constraints.txt
# CPU-only torch first (the default index pulls multi-GB CUDA builds), then
# the CPU build of the Qwen3-TTS GGML runtime (unused at runtime — Kokoro is
# the TTS — but required to satisfy speech-to-speech's dependency set), then
# the pipeline itself and the demo requirements.
# Pipeline from source at the commit this branch is based on (the PyPI
# release lags the repo — it lacks the chat-completions backend).
ARG S2S_REF=eb4d0387dcc4b8f34220797fd00591850eacc52c
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir huggingface_hub \
    && python -c "from huggingface_hub import hf_hub_download; import subprocess, sys; \
        p = hf_hub_download('andito/qwentts-cpp-python-wheels', 'whl/cpu/qwentts_cpp_python-0.3.0+cpu-py3-none-manylinux_2_34_x86_64.manylinux_2_35_x86_64.whl', repo_type='dataset'); \
        sys.exit(subprocess.run(['pip', 'install', '--no-cache-dir', p]).returncode)" \
    && pip install --no-cache-dir "speech-to-speech[kokoro,pocket] @ git+https://github.com/huggingface/speech-to-speech.git@${S2S_REF}" \
    && pip install --no-cache-dir -r requirements.txt

# Wav2Arkit lip-sync module (myned-ai/avatar-chat-server, MIT) at a pinned ref
# — linked, not copied — plus the models every build needs, baked in so the
# Space boots warm: wav2arkit (lip-sync) and Parakeet (STT). Only Parakeet's
# .nemo is loaded; its repo also carries safetensors and GGUF copies (3.1 GB).
ARG WAV2ARKIT_REF=6229737de9cb4766dda4854b447fe4fb97835472
ADD https://github.com/myned-ai/avatar-chat-server/archive/${WAV2ARKIT_REF}.tar.gz /tmp/acs.tar.gz
RUN tar -xzf /tmp/acs.tar.gz -C /tmp \
    && cp -r /tmp/avatar-chat-server-*/src/wav2arkit /app/wav2arkit \
    && rm -rf /tmp/acs.tar.gz /tmp/avatar-chat-server-* \
    && python -c "from huggingface_hub import snapshot_download; \
        snapshot_download('myned-ai/wav2arkit_cpu', local_dir='pretrained_models'); \
        snapshot_download('nvidia/parakeet-tdt-0.6b-v3', allow_patterns=['*.nemo'])"

# Languages beside English: Pocket TTS models and their Parakeet STT
# fine-tunes (pocket_voices.py). English-only build:
#   docker build --build-arg POCKET_MODELS= --build-arg PARAKEET_MODELS= .
# Listed STT fine-tunes are baked into plain folders (PARAKEET_DIR in
# run_pipeline.py); Pocket models download at startup.
ARG POCKET_MODELS="greek=hf://myned-ai/pocket-tts-greek/greek.yaml"
ARG PARAKEET_MODELS="greek=myned-ai/parakeet-tdt-0.6b-v3-greek"
ENV POCKET_MODELS=$POCKET_MODELS PARAKEET_MODELS=$PARAKEET_MODELS
RUN python -c "import os; from huggingface_hub import snapshot_download; \
    files = ['config.json', 'vocab.txt', 'encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.onnx']; \
    entries = [e.strip().partition('=') for e in os.environ['PARAKEET_MODELS'].split(',')]; \
    [snapshot_download(repo.strip(), local_dir='parakeet_models/' + name.strip().lower(), allow_patterns=files) \
     for name, _, repo in entries if repo.strip()]"

COPY . .
RUN chmod +x start.sh

EXPOSE 7860

CMD ["./start.sh"]
