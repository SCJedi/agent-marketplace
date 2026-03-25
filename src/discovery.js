'use strict';

const DEFAULT_SEEDS = require('./seeds');

/**
 * PeerDiscovery — Bitcoin-style peer-to-peer discovery engine.
 *
 * Once you know ONE node, you can discover the entire network:
 * 1. Bootstrap from seed nodes (or persisted peers from previous runs)
 * 2. Announce yourself to peers so they know about you
 * 3. Periodically ask peers for THEIR peers (peer exchange)
 * 4. Health-check peers and evict dead ones
 */
class PeerDiscovery {
  constructor(db, selfEndpoint, options = {}) {
    this.db = db;
    this.selfEndpoint = selfEndpoint;
    this.selfName = options.name || 'unknown';
    this.selfSpecialty = options.specialty || 'general';
    this.seedNodes = options.seedNodes || DEFAULT_SEEDS;
    this.announceInterval = options.announceInterval || 5 * 60 * 1000;   // 5 min
    this.discoveryInterval = options.discoveryInterval || 10 * 60 * 1000; // 10 min
    this.healthCheckInterval = options.healthCheckInterval || 2 * 60 * 1000; // 2 min
    this.maxFailures = options.maxFailures || 10;
    this._intervals = [];
    this._running = false;
  }

  /**
   * BOOTSTRAP — called on startup.
   * 1. Load known peers from DB (persistence across restarts)
   * 2. If no known peers, connect to seed nodes
   * 3. Ask each connected peer for THEIR peers (peer exchange)
   * 4. Announce ourselves to all discovered peers
   */
  async bootstrap() {
    // 1. Check if we already have peers from a previous run
    const existingPeers = this.db.getPeers();

    if (existingPeers.length === 0) {
      // 2. No known peers — seed from hardcoded list
      for (const seed of this.seedNodes) {
        if (seed === this.selfEndpoint) continue; // don't add ourselves
        try {
          const resp = await fetch(`${seed}/health`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            this.db.addPeer(seed, null, null, 'seed');
            this.db.updatePeerSeen(seed);
          }
        } catch {
          // Seed unreachable — that's fine, try others
        }
      }
    }

    // 3. Ask known peers for their peers (peer exchange)
    await this.discoverPeers();

    // 4. Announce ourselves to all known peers
    await this.announceSelf();
  }

  /**
   * ANNOUNCE — tell peers we exist.
   * POST /peers/announce to all known active peers.
   */
  async announceSelf() {
    const peers = this.db.getPeers();
    const body = JSON.stringify({
      endpoint: this.selfEndpoint,
      name: this.selfName,
      specialty: this.selfSpecialty
    });

    const results = await Promise.allSettled(
      peers.map(async (peer) => {
        if (peer.endpoint === this.selfEndpoint) return;
        try {
          await fetch(`${peer.endpoint}/peers/announce`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(5000)
          });
          this.db.updatePeerSeen(peer.endpoint);
        } catch {
          this.db.incrementPeerFailure(peer.endpoint);
        }
      })
    );

    return results;
  }

  /**
   * DISCOVER — find new peers by asking known peers for their peer lists.
   * GET /peers from a random subset of known peers.
   * The network grows by word of mouth.
   */
  async discoverPeers() {
    const peers = this.db.getPeers();
    // Ask up to 5 random peers
    const shuffled = peers.sort(() => Math.random() - 0.5).slice(0, 5);

    for (const peer of shuffled) {
      if (peer.endpoint === this.selfEndpoint) continue;
      try {
        const resp = await fetch(`${peer.endpoint}/peers`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const peerList = data.data || data.peers || [];

        for (const p of peerList) {
          const ep = p.endpoint || p;
          if (ep === this.selfEndpoint) continue;
          // Add if we don't know about this peer yet
          this.db.addPeer(ep, p.name || null, p.specialty || null, peer.endpoint);
        }

        this.db.updatePeerSeen(peer.endpoint);
      } catch {
        this.db.incrementPeerFailure(peer.endpoint);
      }
    }
  }

  /**
   * HEALTH CHECK — prune dead peers.
   * Ping each known peer. Track consecutive failures.
   * Don't remove too aggressively — nodes go offline temporarily.
   */
  async healthCheck() {
    const peers = this.db.getAllPeers();

    await Promise.allSettled(
      peers.map(async (peer) => {
        if (peer.endpoint === this.selfEndpoint) return;
        try {
          const resp = await fetch(`${peer.endpoint}/health`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            this.db.updatePeerSeen(peer.endpoint);
          } else {
            this.db.incrementPeerFailure(peer.endpoint);
          }
        } catch {
          this.db.incrementPeerFailure(peer.endpoint);
        }

        // Evict peers with too many consecutive failures
        const updated = this.db.getPeerByEndpoint(peer.endpoint);
        if (updated && updated.failures >= this.maxFailures) {
          this.db.removePeer(peer.endpoint);
        }
      })
    );
  }

  /**
   * START — run the periodic discovery loops.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // Run bootstrap immediately
    this.bootstrap().catch(() => {});

    // Set up periodic loops
    this._intervals.push(
      setInterval(() => this.announceSelf().catch(() => {}), this.announceInterval)
    );
    this._intervals.push(
      setInterval(() => this.discoverPeers().catch(() => {}), this.discoveryInterval)
    );
    this._intervals.push(
      setInterval(() => this.healthCheck().catch(() => {}), this.healthCheckInterval)
    );
  }

  /**
   * STOP — clear all intervals.
   */
  stop() {
    this._running = false;
    for (const interval of this._intervals) {
      clearInterval(interval);
    }
    this._intervals = [];
  }
}

module.exports = { PeerDiscovery };
