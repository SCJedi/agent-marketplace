# Deploying Agent Marketplace

## Option 1: Railway (Easiest)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/agent-marketplace)

1. Click the deploy button above (or go to railway.app and create a new project)
2. Connect your GitHub repo
3. Railway auto-detects Node.js and deploys
4. Set environment variables in the Railway dashboard:
   - `PORT=3001`
   - `NODE_NAME=MyPublicNode`
   - `OPEN_BROWSER=false`
5. Your node is live at `https://your-app.up.railway.app`

## Option 2: Fly.io

```bash
# Install flyctl if needed
curl -L https://fly.io/install.sh | sh

# From the project root
cp deploy/fly.toml .
fly launch --no-deploy
fly secrets set NODE_NAME=MyPublicNode
fly deploy
```

Your node is live at `https://agent-marketplace.fly.dev`

## Option 3: Docker

```bash
# From the project root
docker build -f deploy/Dockerfile -t agent-marketplace .
docker run -d -p 3001:3001 --name marketplace agent-marketplace
```

Or use docker-compose:
```bash
cd deploy
docker-compose up -d
```

## Option 4: VPS (DigitalOcean, Linode, etc.)

```bash
# On your VPS
git clone https://github.com/SCJedi/agent-marketplace.git
cd agent-marketplace
npm install --production

# Copy and edit environment
cp deploy/.env.example .env
# Edit .env with your settings

# Run with pm2 (recommended for production)
npm install -g pm2
pm2 start src/server.js --name marketplace
pm2 save
pm2 startup

# Or with systemd
sudo cp deploy/marketplace.service /etc/systemd/system/
sudo systemctl enable marketplace
sudo systemctl start marketplace
```

## After Deployment

1. Visit `https://your-domain/dashboard` to see the dashboard
2. Run the seed script to populate with developer docs:
   ```bash
   node bootstrap/seed-real-content.js
   ```
3. Test the health endpoint: `curl https://your-domain/health`
4. Point the Python SDK at your node:
   ```python
   from agent_marketplace import Marketplace
   m = Marketplace("https://your-domain")
   ```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `NODE_NAME` | `LocalNode` | Name shown in dashboard and federation |
| `NODE_SPECIALTY` | `developer-docs` | What this node specializes in |
| `OPEN_BROWSER` | `true` | Auto-open dashboard on start |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `PUBLIC_URL` | - | Public URL for federation |
| `SEED_NODES` | - | Comma-separated list of peer node URLs |
| `DB_PATH` | `data/marketplace.db` | SQLite database path |
