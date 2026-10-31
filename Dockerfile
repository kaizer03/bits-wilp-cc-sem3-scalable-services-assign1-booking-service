FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db

USER node
EXPOSE 4181
CMD ["node", "src/server.js"]
