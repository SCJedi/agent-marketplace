'use strict';

class SimVerifier {
  constructor(id, baseUrl, config) {
    this.name = `Verifier-${id}`;
    this.baseUrl = baseUrl;
    this.config = config;

    this.verifierId = null;
    this.stakeAmount = config.verifierStake;
    this.verificationsCompleted = 0;
    this.earned = 0;
    this.agreementCount = 0;
    this.log = [];
  }

  async register() {
    try {
      const res = await this._post('/verify/pool/join', {
        endpoint: `http://localhost:${this.config.nodePort}/sim/${this.name}`,
        stake_amount: this.stakeAmount,
      });
      if (res.success && res.data) {
        this.verifierId = res.data.id;
      }
    } catch (err) {
      // ignore
    }
  }

  async act(round) {
    if (!this.verifierId) return;

    try {
      // Check for pending verification work
      const pendingRes = await this._get('/verify/pending');
      if (!pendingRes.success || !pendingRes.data || pendingRes.data.length === 0) return;

      // Pick a pending request to verify
      const request = pendingRes.data[Math.floor(Math.random() * pendingRes.data.length)];

      // Honest verifier: 90% pass rate (most artifacts are legit)
      const passed = Math.random() < 0.90;

      const report = {
        verifier: this.name,
        round,
        checks: {
          code_runs: passed,
          description_accurate: passed || Math.random() < 0.5,
          no_malware: true,
          license_valid: true,
        },
        notes: passed ? 'Artifact passes all checks' : 'Issues found during verification',
      };

      const res = await this._post('/verify/submit', {
        request_id: request.id,
        verifier_id: this.verifierId,
        passed,
        report,
      });

      if (res.success) {
        this.verificationsCompleted++;
        this.earned += this.config.verifierFee;
        this.log.push({ round, action: 'verify', requestId: request.id, passed });
      }
    } catch (err) {
      // ignore — likely already submitted for this request
    }
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  getStats() {
    return {
      name: this.name,
      verifierId: this.verifierId,
      stake: this.stakeAmount,
      verifications: this.verificationsCompleted,
      earned: this.earned,
    };
  }
}

module.exports = SimVerifier;
