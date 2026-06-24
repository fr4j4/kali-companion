export const SAMPLE_ENTITY = {
  name: "Sample Entity",
  tags: ["Protagonist", "Mage"],
  attributes: [
    { label: "Strength", value: 18, max: 30 },
    { label: "Agility", value: 22, max: 30 },
    { label: "Intelligence", value: 28, max: 30 },
  ],
  bars: [
    { label: "HP", value: 420, max: 420, color: "var(--ok)" },
    { label: "Mana", value: 320, max: 380, color: "var(--accent)" },
  ],
  abilities: [
    { name: "Arcane Bolt", description: "Fires a bolt of pure arcane energy.", key: "Q", cd: 6 },
    { name: "Phase Shift", description: "Shifts through dimensions, evading attacks.", key: "W", cd: 12 },
    { name: "Time Warp", description: "Slows time in a target area.", key: "E", cd: 18 },
    { name: "Cataclysm", description: "Unleashes a devastating wave of energy.", key: "R", cd: 90 },
  ],
  synergies: ["Amplifies magic damage", "Vulnerable to silence"],
};

export const SAMPLE_RESOURCE = {
  name: "Sample Resource",
  price: 250,
  category: "Consumable",
  description: "A versatile resource used for crafting and upgrading equipment.",
  warning: "Consumes on use. Effect lasts 30 seconds.",
  metrics: [
    { label: "Cooldown", value: "60s" },
    { label: "Mana Cost", value: 50 },
  ],
};

export const SAMPLE_PLACE = {
  name: "Sample Place",
  preview: "topographic",
  metadata: [
    { label: "Climate", value: "Temperate" },
    { label: "Threat Level", value: "Medium" },
    { label: "Faction", value: "Neutral" },
    { label: "Population", value: "~1,200" },
  ],
};

export const SAMPLE_CODE = `// Robust error handling
use tokio_tungstenite::accept_async;
use futures_util::StreamExt;

async fn handle(stream: TcpStream) {
    match accept_async(stream).await {
        Ok(ws) => {
            while let Some(msg) = ws.next().await {
                if let Ok(m) = msg {
                    ws.send(m).await.ok();
                }
            }
        }
        Err(e) => eprintln!("conn failed: {e}"),
    }
}`;

export const SAMPLE_DOCUMENT = `# Event-Sourced Implementation Guide

This guide describes how to implement an **event-sourced** system with **CQRS** projections.

## Architecture

The system is divided into three components:

- **Event Store**: append-only, immutable
- **Projections**: materialized views for reading
- **Command Handlers**: validate and produce events

### Event Store

The event store is the source of truth. Each event is immutable.

> Event sourcing is not about saving the current state, but about how we got there.

### Projections

Projections are rebuilt by applying events in order.

> Events must be immutable. Never modify a persisted event.

## Implementation

### Step 1: Define Events

1. Identify root aggregates
2. Define events per aggregate
3. Version events
4. Implement upcasters

### Step 2: Create Event Store

Use a store with optimistic concurrency support.

### Step 3: Configure Replay

Replay rebuilds state from scratch. For large systems, use **snapshots**.

## Testing

For testing, use \`event-store-testkit\`. Event-based tests are deterministic.

## Conclusion

Event sourcing with CQRS is powerful for complete audit trails and state replay.`;

export const SAMPLE_MERMAID = `flowchart TD
    A[Request] --> B{Authenticated?}
    B -->|no| C[401 Error]
    B -->|yes| D[Process]
    D --> E[Response 200]
    A --> F[Log Event]`;

export const SAMPLE_JSON = JSON.stringify({
  system: {
    name: "Sample Service",
    version: "2.4.1",
    status: "healthy",
    uptime: "72h 14m",
  },
  metrics: {
    requests: { total: 12483, success: 12001, error: 482 },
    latency: { p50: 45, p95: 120, p99: 340 },
  },
  config: {
    host: "0.0.0.0",
    port: 8080,
    tls: true,
    debug: false,
  },
}, null, 2);

export const SAMPLE_LONGTEXT = `[00:00:01] Speaker A: Welcome to today's session on distributed systems.
[00:00:08] Speaker A: We'll cover three main topics today.
[00:00:15] Speaker B: First, let's talk about consensus algorithms.
[00:00:22] Speaker B: Raft and Paxos are the most widely used.
[00:00:30] Speaker A: Second, we'll discuss data replication strategies.
[00:00:38] Speaker A: Synchronous vs asynchronous replication.
[00:00:45] Speaker B: Finally, fault tolerance and recovery mechanisms.
[00:00:52] Speaker B: Including leader election and log replication.`;

export const SAMPLE_TERMINAL_OUTPUT = [
  { type: "prompt", text: "$ cd project && cargo build" },
  { type: "out", text: "   Compiling core v0.1.0" },
  { type: "out", text: "   Compiling utils v0.1.0" },
  { type: "ok", text: "    Finished dev [unoptimized + debuginfo] target(s) in 4.32s" },
  { type: "prompt", text: "$ cargo test" },
  { type: "out", text: "   Compiling core v0.1.0" },
  { type: "ok", text: "    Finished test [unoptimized + debuginfo] target(s) in 1.12s" },
  { type: "err", text: "    FAILED tests::integration_test (0.34s)" },
  { type: "prompt", text: "$ cargo clippy" },
  { type: "warn", text: "warning: redundant clone" },
  { type: "warn", text: "warning: unused import" },
  { type: "prompt", text: "$ _ " },
];

export const QUIZ_QUESTIONS = [
  {
    question: "What is the CAP theorem about?",
    options: [
      "Consistency, Availability, Partition tolerance",
      "Cost, Architecture, Performance",
      "Caching, Authentication, Protocols",
      "Concurrency, Atomicity, Persistence",
    ],
    correct: 0,
    explanation: "The CAP theorem states that distributed systems can only guarantee two of three properties: Consistency, Availability, and Partition tolerance.",
  },
  {
    question: "Which algorithm is used for leader election in distributed systems?",
    options: [
      "Paxos",
      "Raft",
      "Both Paxos and Raft",
      "MapReduce",
    ],
    correct: 2,
    explanation: "Both Paxos and Raft are consensus algorithms used for leader election and log replication in distributed systems.",
  },
  {
    question: "What is idempotency in distributed systems?",
    options: [
      "Operations that can be repeated with the same result",
      "Operations that cannot be undone",
      "Operations that require authentication",
      "Operations that run in parallel",
    ],
    correct: 0,
    explanation: "Idempotent operations produce the same result regardless of how many times they are executed.",
  },
];

export const CHECKLIST_ITEMS = [
  { text: "Review system architecture", done: true },
  { text: "Implement data layer", done: true },
  { text: "Add API endpoints", done: false },
  { text: "Write integration tests", done: false },
  { text: "Deploy to staging", done: false },
];

export const SAMPLE_CHART_DATA = [
  { name: "Mon", latency: 42, throughput: 230 },
  { name: "Tue", latency: 38, throughput: 280 },
  { name: "Wed", latency: 55, throughput: 210 },
  { name: "Thu", latency: 48, throughput: 260 },
  { name: "Fri", latency: 62, throughput: 190 },
  { name: "Sat", latency: 35, throughput: 310 },
  { name: "Sun", latency: 30, throughput: 340 },
];

export const SAMPLE_TABLE_DATA = [
  { service: "api-gateway", status: "healthy", instances: 3, latency: 12 },
  { service: "user-service", status: "healthy", instances: 2, latency: 8 },
  { service: "payment-service", status: "degraded", instances: 1, latency: 45 },
  { service: "notification-service", status: "healthy", instances: 2, latency: 15 },
  { service: "analytics-service", status: "down", instances: 0, latency: 0 },
];
