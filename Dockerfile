# Production Dockerfile
FROM node:22-alpine

WORKDIR /app

# Copy dependency definitions
COPY server/package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application files and dataset
COPY server/ ./
COPY IT_Activity_Code_62_Companies_with_Websites.xlsx ./

# Expose port (default 5000, can be overridden by environment variable)
ENV PORT=5000
EXPOSE 5000

# Start server (auto-seeds database on first boot if not present)
CMD ["npm", "start"]
