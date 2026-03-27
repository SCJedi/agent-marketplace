# Agent Marketplace SDK

Pre-cached developer docs for AI agents. Your agent reads 500+ doc pages
in 50ms instead of crawling them.

## Install

```
pip install agent-marketplace
```

## Usage

```python
from agent_marketplace import Marketplace

# Connect to the free public node
m = Marketplace("https://marketplace.agentcache.dev")

# Search across 500+ cached developer doc pages
results = m.search("python asyncio tutorial")

# Get clean, structured content instantly
content = m.fetch("https://docs.python.org/3/library/asyncio.html")
print(content.text)  # Clean text, no HTML parsing needed

# Smart fetch — marketplace first, fallback to direct crawl
doc = m.smart_fetch("https://fastapi.tiangolo.com/tutorial/first-steps/")
```

## What's Cached

188+ real developer doc pages including:
- Python standard library (40 pages)
- Node.js API docs (23 pages)
- FastAPI, Express, Flask, Django tutorials
- React hooks reference
- TypeScript handbook
- MDN Web Docs
- pytest, Docker, GitHub Actions
- OWASP security cheat sheets

## Run Your Own Node

```bash
git clone https://github.com/SCJedi/agent-marketplace.git
cd agent-marketplace && npm install && node src/server.js
```

Dashboard at http://localhost:3001/dashboard

## Links

- [GitHub](https://github.com/SCJedi/agent-marketplace)
- [Protocol Spec](https://github.com/SCJedi/agent-marketplace/blob/master/PROTOCOL.md)
- [Full Documentation](https://github.com/SCJedi/agent-marketplace#readme)
