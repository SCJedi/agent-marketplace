'use strict';

const Scenario = require('../../framework/scenario');

/**
 * RT-A004: Self-Verification Attack
 *
 * Hypothesis: A publisher can verify their own artifact.
 *
 * Attack: Register as node, publish artifact. Join verifier pool with same identity.
 * Also register 2 more Sybil verifier identities. Request verification, have all 3
 * Sybil verifiers approve.
 *
 * Pass: Self-verified artifact does NOT get verified status.
 * Fail: It does.
 */
class SelfVerification extends Scenario {
  constructor() {
    super(
      'RT-A004',
      'Self-Verification Attack',
      'A publisher can verify their own artifact using Sybil verifiers'
    );
    this.publisherNode = null;
    this.artifact = null;
    this.sybilVerifiers = [];
  }

  async setup(baseUrl) {
    // Step 1: Register as a publisher node
    this.publisherNode = await this.registerNode(baseUrl, 'publisher-attacker', 0.01);
    if (!this.publisherNode) {
      throw new Error('Failed to register publisher node');
    }

    // Step 2: Publish an artifact
    const artifactRes = await this.fetch(baseUrl, '/publish/artifact', {
      method: 'POST',
      body: {
        name: 'Malicious Artifact',
        slug: 'malicious-artifact-rt-a004',
        description: 'This artifact should NOT be verified',
        price: 10,
        category: 'tools',
      },
    });

    if (!artifactRes.data?.data) {
      throw new Error('Failed to publish artifact');
    }
    this.artifact = artifactRes.data.data;

    // Step 3: Join verifier pool with 3 Sybil identities
    for (let i = 0; i < 3; i++) {
      const verifierRes = await this.fetch(baseUrl, '/verify/pool/join', {
        method: 'POST',
        body: {
          endpoint: `https://sybil-verifier-${i}.evil.com/verify`,
          stake_amount: 0.01,
        },
      });

      if (verifierRes.data?.data) {
        this.sybilVerifiers.push(verifierRes.data.data);
      }
    }

    if (this.sybilVerifiers.length < 3) {
      throw new Error(`Only ${this.sybilVerifiers.length}/3 Sybil verifiers registered`);
    }
  }

  async execute(baseUrl, config) {
    // Step 4: Request verification for the artifact
    const verifyReqRes = await this.fetch(baseUrl, '/verify/request', {
      method: 'POST',
      body: {
        artifact_id: this.artifact.id,
        publisher_id: this.publisherNode.id,
        fee: 0.05,
      },
    });

    if (!verifyReqRes.data?.data?.request) {
      return {
        verificationRequested: false,
        error: 'Failed to create verification request',
        selfVerified: false,
      };
    }

    const verificationRequest = verifyReqRes.data.data.request;

    // Step 5: Submit approvals from all 3 Sybil verifiers
    const submissions = [];
    for (const verifier of this.sybilVerifiers) {
      const submitRes = await this.fetch(baseUrl, '/verify/submit', {
        method: 'POST',
        body: {
          request_id: verificationRequest.id,
          verifier_id: verifier.id,
          passed: true,
          report: { notes: 'Looks great!', score: 10 },
        },
      });

      submissions.push({
        verifierId: verifier.id,
        status: submitRes.status,
        accepted: submitRes.status === 201,
      });
    }

    // Step 6: Check if the artifact is now verified
    const artifactCheck = await this.fetch(baseUrl, `/artifacts/${this.artifact.slug}`);
    const isVerified = artifactCheck.data?.data?.verified === 1;

    // Step 7: Check verification request status
    const pendingCheck = await this.fetch(baseUrl, '/verify/pending');

    return {
      verificationRequested: true,
      verificationRequestId: verificationRequest.id,
      sybilSubmissions: submissions,
      submissionsAccepted: submissions.filter(s => s.accepted).length,
      artifactVerified: isVerified,
      selfVerified: isVerified,
      publisherId: this.publisherNode.id,
      sybilVerifierIds: this.sybilVerifiers.map(v => v.id),
    };
  }

  assert(results) {
    if (!results.verificationRequested) {
      return {
        pass: null,
        metric: null,
        threshold: null,
        details: `Infrastructure error: ${results.error}`,
        severity: 'infrastructure',
      };
    }

    if (!results.selfVerified) {
      return {
        pass: true,
        metric: 0,
        threshold: 0,
        details: `Self-verification attack BLOCKED. ${results.submissionsAccepted}/3 Sybil submissions were accepted but the artifact was NOT marked as verified. The system has protections against self-verification.`,
        severity: 'none',
      };
    }

    return {
      pass: false,
      metric: 1,
      threshold: 0,
      details: `VULNERABILITY: Self-verification attack SUCCEEDED. Publisher ${results.publisherId} created artifact, registered ${results.sybilVerifierIds.length} Sybil verifiers, all approved, and artifact is now verified. No check prevents: (1) publisher from being a verifier, (2) single entity from controlling multiple verifiers, (3) colluding verifiers from approving each other's artifacts.`,
      severity: 'critical',
    };
  }
}

module.exports = SelfVerification;
