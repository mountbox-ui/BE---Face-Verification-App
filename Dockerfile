FROM node:20-slim

# Install system dependencies for node-canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-turbo8-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    girs-gdkpixbuf \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

# Adjust the server start command based on your server.js location
CMD ["node", "server.js"]
