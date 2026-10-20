FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    AIPFA_PYTHON=/opt/tts-venv/bin/python \
    AIPFA_TTS_PORT=39173 \
    DB_PATH=/data/finassist.db \
    HF_HOME=/data/huggingface

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv python3-pip build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/tts-venv \
    && /opt/tts-venv/bin/python -m pip install --no-cache-dir --upgrade pip

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements-tts.txt ./
RUN /opt/tts-venv/bin/python -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      'torch>=2.2,<3' \
    && /opt/tts-venv/bin/python -m pip install --no-cache-dir -r requirements-tts.txt

COPY . .
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
CMD ["npm", "start"]
