'use strict';

module.exports = {
  nodes: [
    {
      name: "WebClean",
      port: 3001,
      specialty: "general-web",
      description: "General web content — news, docs, blogs",
      dbPath: "bootstrap/data/node1.db"
    },
    {
      name: "CodeVault",
      port: 3002,
      specialty: "code",
      description: "Code-focused — GitHub repos, Stack Overflow, API docs",
      dbPath: "bootstrap/data/node2.db"
    },
    {
      name: "DataStream",
      port: 3003,
      specialty: "data-finance",
      description: "Financial data, market reports, analytics",
      dbPath: "bootstrap/data/node3.db"
    }
  ],
  directory: {
    port: 3000,
    dbPath: "bootstrap/data/directory.db"
  }
};
