FROM node:20.17.0-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port (optional, mainly for health checks)
EXPOSE 3000

# Run the bot
CMD ["node", "index.js"]