FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ ./src/
COPY dashboard/ ./dashboard/
COPY bootstrap/seed-real-content.js ./bootstrap/
ENV PORT=3001
ENV NODE_NAME=PublicNode
ENV OPEN_BROWSER=false
EXPOSE 3001
CMD ["node", "src/server.js"]
