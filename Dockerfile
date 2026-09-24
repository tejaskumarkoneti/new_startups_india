FROM node:22-bookworm-slim

WORKDIR /app

# Copy dependency definition
COPY server/package.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy all server code, public dashboard files, and dataset
COPY server/ ./
COPY IT_Activity_Code_62_Companies_with_Websites.xlsx ./

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "index.js"]
