'use strict';

/**
 * Base class for all market participants.
 * Tracks wallet, P&L, bankruptcy, and adaptive behavior.
 */
class Participant {
  constructor(id, type, startingBalance) {
    this.id = id;
    this.type = type;
    this.balance = startingBalance;
    this.startingBalance = startingBalance;
    this.active = true;
    this.enteredRound = 0;
    this.exitedRound = null;
    this.exitReason = null;

    // P&L tracking
    this.ledger = [];       // { round, type, amount, description }
    this.roundIncome = 0;
    this.roundExpense = 0;
    this.totalIncome = 0;
    this.totalExpense = 0;
    this.negativeRounds = 0; // consecutive rounds with negative balance

    // Adaptive behavior
    this.riskTolerance = 0.3 + Math.random() * 0.5; // 0.3–0.8
    this.lastAdaptRound = 0;
  }

  recordIncome(round, amount, description) {
    this.balance += amount;
    this.roundIncome += amount;
    this.totalIncome += amount;
    this.ledger.push({ round, type: 'income', amount, description });
  }

  recordExpense(round, amount, description) {
    this.balance -= amount;
    this.roundExpense += amount;
    this.totalExpense += amount;
    this.ledger.push({ round, type: 'expense', amount, description });
  }

  getRoundPnL() {
    return this.roundIncome - this.roundExpense;
  }

  resetRoundPnL() {
    this.roundIncome = 0;
    this.roundExpense = 0;
  }

  getTotalPnL() {
    return this.totalIncome - this.totalExpense;
  }

  getRecentPnL(rounds = 10) {
    const recent = this.ledger.slice(-rounds * 5); // approximate
    let income = 0, expense = 0;
    for (const entry of recent) {
      if (entry.type === 'income') income += entry.amount;
      else expense += entry.amount;
    }
    return income - expense;
  }

  checkBankruptcy(round, bankruptcyThreshold) {
    if (this.balance < 0) {
      this.negativeRounds++;
      if (this.negativeRounds >= bankruptcyThreshold) {
        this.active = false;
        this.exitedRound = round;
        this.exitReason = 'bankruptcy';
        return true;
      }
    } else {
      this.negativeRounds = 0;
    }
    return false;
  }

  // Override in subclasses — called every adaptEvery rounds
  adapt(round, marketState) {
    this.lastAdaptRound = round;
  }

  getSummary() {
    return {
      id: this.id,
      type: this.type,
      active: this.active,
      balance: +this.balance.toFixed(6),
      totalPnL: +this.getTotalPnL().toFixed(6),
      totalIncome: +this.totalIncome.toFixed(6),
      totalExpense: +this.totalExpense.toFixed(6),
      enteredRound: this.enteredRound,
      exitedRound: this.exitedRound,
      exitReason: this.exitReason,
    };
  }
}

module.exports = Participant;
