FROM node:20-alpine

WORKDIR /app

# Install FFmpeg
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm install

COPY . .

# Build if necessary, but start:dev uses ts-node
# RUN npm run build

EXPOSE 3001

CMD ["npm", "run", "start:dev"]
