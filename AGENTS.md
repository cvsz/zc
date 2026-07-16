# AGENTS.md - Enterprise Agent Architecture & Integration Guide
## Language and Coding Standards
- **Communication**: Always talk in Thai when interacting with users.
- **Code & Technical Assets**: All code, comments, documentation, and technical definitions must be in English.

Act as a Principal Software Architect and Senior Backend Engineer. 

I need you to design and implement a highly optimized, enterprise-grade, production-ready full-stack system that handles file uploads and optimizes performance for a CLI-to-API workflow (specifically optimized for "Wire"). The implementation must utilize the latest 2026 enterprise backend standards and feature a comprehensive control panel for full-stack management.

Please perform a deep-dive analysis and provide the implementation based on the following specifications:

### 1. Advanced File Upload & Processing
* Implement a highly scalable, secure, and chunked/resumable file upload mechanism.
* Support delta-updates (patching only changed parts of files) to minimize bandwidth.
* Include asynchronous background processing (e.g., using distributed worker queues) with real-time status updates via WebSockets or SSE.

### 2. Wire CLI-to-API Performance Optimization
* Optimize the communication protocol between the Wire CLI and the backend API (e.g., using gRPC, HTTP/3, or highly compressed, multiplexed JSON/Protocol Buffers).
* Implement aggressive connection pooling, pipelining, and zero-copy data transfer.
* Design a smart caching layer (e.g., Redis/Valkey) and an optimized indexing strategy to ensure sub-millisecond API response times for CLI commands.

### 3. Enterprise-Grade Backend Architecture (2026 Standards)
* Architectural Patterns: Microservices or modular monolith with strict domain-driven design (DDD), event-driven architecture, and non-blocking I/O.
* Resiliency & Security: Implement distributed tracing (OpenTelemetry), rate limiting (leaky bucket/token bucket), circuit breakers, strict IAM/RBAC, and end-to-end encryption.
* Scalability: Auto-scaling stateless services with optimized database connection pooling and read/write splitting.

### 4. Full-Stack Control Panel (Enterprise Management)
* Provide a comprehensive dashboard UI architecture (frontend and backend integration).
* Features required: Real-time system performance monitoring, CLI activity logs, file upload queue management, API health metrics, and granular feature flags/toggle controls.

[CODEX MASTER META TEMPLATE INITIATED]
**Primary Role:** Principal System Architect & Full-Stack Automation Engineer
**Objective:** Architect, optimize, and provide production-ready implementation for an enterprise-grade Wire CLI-to-API workflow, advanced file upload system, and comprehensive full-stack control panel (2026 Standards).

### System Context & Hard Constraints
1. **Architectural Principles:** The system must strictly adhere to trust-minimized, sovereign, and non-blocking intent-gateway models.
2. **Infrastructure Target:** Designed for deployment on Ubuntu 24.04 utilizing k3s. 
3. **Networking & Routing:** Assume a Cilium CNI environment where `kube-proxy` is strictly disabled to prevent double encapsulation routing issues.
4. **Deployment Strategy:** GitOps-first structure (e.g., ArgoCD ready) with automated reconciliation.
5. **Language Rule:** ALL code, variables, and comments within code blocks MUST be written entirely in English.

Please perform a deep reasoning dive and execute the following phases:

### Phase 1: High-Performance CLI-to-API Communication (Wire Optimized)
*   **Protocol & Transport:** Design the Wire CLI to backend API communication utilizing low-latency, high-throughput protocols (e.g., gRPC, HTTP/3, or multiplexed Protobufs over WebSocket).
*   **Optimization:** Implement zero-copy serialization, aggressive connection pooling, and payload compression to guarantee sub-millisecond API reconciliation.
*   **Stateless Gateway:** Route CLI requests through a stateless intent-gateway that validates and forwards requests without holding session state.

### Phase 2: Enterprise-Grade File Upload System
*   **Chunking & Resumability:** Architect a robust, concurrent chunked file upload mechanism capable of handling massive payloads securely.
*   **Delta-Updates:** Implement binary diffing/patching so the Wire CLI only transmits changed bytes, drastically reducing bandwidth overhead.
*   **Async Processing:** Offload file validation, virus scanning, and storage (e.g., S3-compatible endpoints) to decoupled background worker queues.

### Phase 3: Master Observability & Full-Stack Control Panel
*   **Telemetry:** Integrate real-time distributed tracing (OpenTelemetry) and API health metrics.
*   **Control Panel Architecture:** Design the backend endpoints and frontend data flow for a Master Observability Node that provides visual telemetry, CLI activity logs, and granular feature flag controls.
*   **Authentication & RBAC:** Ensure the control panel utilizes strict, token-based, trust-minimized access controls.

### Deliverables Required:
1.  **Architecture Blueprint:** A detailed system data flow and microservices layout (use Mermaid.js syntax).
2.  **Core Code Implementation:** Production-ready code blocks for the hardest performance bottlenecks:
    *   The Wire CLI-to-API network handler.
    *   The chunked file upload/delta-update logic.
3.  **Infrastructure Config:** The Kubernetes/k3s manifest snippets specifically optimized for the Cilium routing constraints mentioned above.

### Output Expectations:
1. Provide a clear architectural blueprint/data flow diagram (using Markdown/Mermaid text).
2. Write production-ready, clean, well-commented, and highly optimized code snippets for the core performance bottlenecks (CLI-API communication, file upload handler, and control panel API).
3. Explain the performance tradeoffs and the specific 2026 technologies/libraries chosen to achieve maximum throughput.

*Think deeply, step-by-step, and do not skimp on production-level details. Prioritize performance, security, and scalability. Do not provide generic boilerplate; output highly optimized, edge-case resilient code.*

## Overview
This document defines the architecture, capabilities, and integration patterns for autonomous agents within the Wire CLI-to-API ecosystem (2026 Enterprise Standards).

## Agent Taxonomy

### 1. Core System Agents
- **Orchestrator Agent**: Manages workflow coordination across microservices
- **Security Sentinel**: Real-time threat detection and response
- **Performance Optimizer**: Dynamic resource allocation and caching strategies
- **Data Integrity Guardian**: Ensures consistency across distributed systems

### 2. Domain-Specific Agents
- **File Processing Agent**: Handles chunked uploads, delta-sync, and validation
- **CLI Interaction Agent**: Mediates between Wire CLI commands and API endpoints
- **Observability Agent**: Collects metrics, traces, and logs for the control panel
- **Compliance Agent**: Enforces regulatory requirements and audit trails

## Agent Communication Protocol

### Message Format (Protobuf)
```protobuf
syntax = "proto3";

package agents.v1;

message AgentEnvelope {
    string agent_id = 1;
    string target_agent = 2;
    uint64 timestamp = 3;
    MessageType type = 4;
    bytes payload = 5;
    string correlation_id = 6;
}

enum MessageType {
    COMMAND = 0;
    RESPONSE = 1;
    EVENT = 2;
    HEARTBEAT = 3;
}

message Command {
    string action = 1;
    map<string, string> parameters = 2;
    int32 timeout_ms = 3;
}

message Event {
    string event_type = 1;
    map<string, string> metadata = 2;
    bytes data = 3;
}
```

### Communication Patterns
- **Request-Response**: Synchronous command execution with timeouts
- **Pub/Sub**: Event-driven architecture using NATS JetStream
- **Streaming**: Real-time data flows via gRPC bidirectional streams
- **Heartbeat**: Liveness monitoring with automatic failover

## Agent Lifecycle Management

### Registration
```python
class AgentRegistry:
    async def register(self, agent: BaseAgent) -> None:
        """Register agent with discovery service"""
        await self.redis.hset(
            "agents:registry",
            agent.id,
            json.dumps({
                "status": "active",
                "capabilities": agent.capabilities,
                "endpoint": agent.endpoint,
                "last_heartbeat": datetime.now(timezone.utc).isoformat()
            })
        )
    
    async def discover(self, capability: str) -> List[str]:
        """Find agents with specific capability"""
        all_agents = await self.redis.hgetall("agents:registry")
        return [
            agent_id for agent_id, info in all_agents.items()
            if capability in json.loads(info)["capabilities"]
        ]
```

### Health Monitoring
- Heartbeat interval: 5 seconds
- Failure threshold: 3 missed heartbeats
- Automatic failover to standby agents
- Graceful degradation with circuit breakers

## Security Model

### Authentication
- Mutual TLS (mTLS) for agent-to-agent communication
- JWT tokens with short-lived expiration (5 minutes)
- Role-Based Access Control (RBAC) per agent type

### Authorization Matrix
| Agent Type | Read Permissions | Write Permissions | Admin Actions |
|------------|------------------|-------------------|---------------|
| Orchestrator | All resources | Workflow control | Scale operations |
| Security Sentinel | Logs, metrics | Block threats | Isolate components |
| File Processor | Upload sessions | Chunk storage | Quarantine files |
| CLI Agent | Command queue | Response channel | Rate limit users |

### Audit Trail
All agent actions are logged with:
- Agent ID and version
- Timestamp (UTC with nanosecond precision)
- Action performed
- Target resource
- Outcome (success/failure)
- Correlation ID for tracing

## Integration Points

### Wire CLI Integration
```python
class CLIAgent(BaseAgent):
    capabilities = ["command_execution", "file_upload", "status_query"]
    
    async def execute_command(self, command: str, context: dict) -> Response:
        """Execute CLI command via API gateway"""
        envelope = AgentEnvelope(
            agent_id=self.id,
            target_agent="orchestrator",
            timestamp=time_ns(),
            type=MessageType.COMMAND,
            payload=Command(action=command, parameters=context).SerializeToString(),
            correlation_id=generate_correlation_id()
        )
        return await self.send_and_wait(envelope, timeout_ms=30000)
    
    async def stream_upload(self, file_path: Path) -> AsyncIterator[bytes]:
        """Stream file chunks with delta optimization"""
        async for chunk in self.delta_encode(file_path):
            yield chunk
```

### Control Panel Integration
```python
class ObservabilityAgent(BaseAgent):
    capabilities = ["metrics_collection", "log_aggregation", "alerting"]
    
    async def collect_metrics(self) -> MetricsBundle:
        """Gather system-wide metrics"""
        return MetricsBundle(
            cpu_usage=await self.get_cpu_metrics(),
            memory_usage=await self.get_memory_metrics(),
            active_uploads=await self.get_upload_count(),
            error_rate=await self.calculate_error_rate()
        )
    
    async def push_to_dashboard(self, metrics: MetricsBundle) -> None:
        """Real-time update to control panel via WebSocket"""
        await self.websocket.send_json(metrics.dict())
```

## Performance Optimization Strategies

### Caching Layers
- **L1 Cache**: In-memory cache within each agent (LRU, 100MB limit)
- **L2 Cache**: Redis cluster for shared state (TTL-based invalidation)
- **L3 Cache**: Persistent storage for historical data

### Connection Pooling
- gRPC channels: Reused across requests with keepalive
- Database connections: PgBouncer with transaction pooling
- HTTP clients: aiohttp with connection limits per host

### Batch Processing
- Aggregate multiple small requests into batch operations
- Configurable batch size (default: 100 items)
- Timeout-based flushing (max 50ms latency)

## Fault Tolerance

### Retry Logic
```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((ConnectionError, TimeoutError))
)
async def resilient_call(agent: BaseAgent, request: Any) -> Any:
    return await agent.execute(request)
```

### Circuit Breaker Pattern
- **Closed**: Normal operation
- **Open**: Fail fast after 5 consecutive failures
- **Half-Open**: Test with single request after 30 seconds

### Dead Letter Queue
Failed messages are routed to DLQ for:
- Manual inspection
- Automated replay with exponential backoff
- Alert generation for critical failures

## Deployment Configuration

### Kubernetes Resources
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-orchestrator
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: orchestrator
        image: wire-agents:latest
        env:
        - name: AGENT_TYPE
          value: "orchestrator"
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: url
        resources:
          requests:
            cpu: "250m"
            memory: "256Mi"
          limits:
            cpu: "1000m"
            memory: "1Gi"
        livenessProbe:
          grpc:
            port: 9090
            service: "health.Health"
          initialDelaySeconds: 5
          periodSeconds: 10
```

### Scaling Policies
- **Horizontal Pod Autoscaler**: Based on CPU (70%) and custom metrics
- **Vertical Pod Autoscaler**: Right-size resource requests
- **Cluster Autoscaler**: Add nodes when pending pods detected

## Monitoring & Debugging

### Distributed Tracing
- OpenTelemetry integration with W3C Trace Context
- Span attributes: agent_id, action, duration, status
- Sampling rate: 10% for production, 100% for staging

### Log Aggregation
- Structured logging (JSON format)
- Correlation IDs across service boundaries
- Log levels: DEBUG, INFO, WARN, ERROR, FATAL

### Alerting Rules
```yaml
groups:
- name: agent-alerts
  rules:
  - alert: AgentDown
    expr: up{job="agents"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Agent {{ $labels.agent_id }} is down"
  
  - alert: HighErrorRate
    expr: rate(agent_errors_total[5m]) > 0.05
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High error rate detected"
```

## Version Compatibility

| Agent Version | CLI Version | API Version | Protocol Version |
|---------------|-------------|-------------|------------------|
| 1.0.0         | 1.32.0+     | 2026.1.0    | v1               |
| 1.1.0         | 1.33.0+     | 2026.2.0    | v1.1             |
| 2.0.0         | 2.0.0+      | 2027.1.0    | v2               |

## Future Roadmap

### Q1 2026
- AI-powered anomaly detection
- Predictive scaling based on usage patterns
- Multi-region agent federation

### Q2 2026
- Quantum-resistant cryptography integration
- Edge computing support for IoT scenarios
- Natural language command interface

### Q3 2026
- Self-healing capabilities with automated remediation
- Cross-cloud agent mobility
- Blockchain-based audit trail immutability

---

*Last Updated: 2026-01-15*
*Document Version: 1.0.0*
*Maintained by: Platform Architecture Team*
