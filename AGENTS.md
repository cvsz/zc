# AGENTS.md - Enterprise Agent Architecture & Integration Guide

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
