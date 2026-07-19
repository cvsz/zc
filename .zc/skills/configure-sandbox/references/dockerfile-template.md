# Dockerfile template

## Structure

```dockerfile
# Build: docker build -f docker/Dockerfile.dev -t <project>-dev .
# Run:   docker run -it --rm -v $(pwd):/workspace <project>-dev

FROM ubuntu:24.04

ARG TARGETARCH
# Add version ARGs for each tool

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# System packages (single layer)
# [Note: these may not all be required for a given workspace]
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build essentials
    build-essential \
    gcc \
    g++ \
    make \
    cmake \
    pkg-config \
    # Version control and core utilities
    git \
    git-lfs \
    curl \
    wget \
    ca-certificates \
    gnupg \
    unzip \
    zip \
    jq \
    # Container filesystem support
    fuse-overlayfs \
    # Misc utilities
    tree \
    ripgrep \
    fd-find \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# [Add tool installations here - see sections below]

WORKDIR /workspace

SHELL ["/bin/bash", "-c"]

# Verify installations
RUN echo "=== Installed versions ===" && \
    # [Add version checks for each installed tool]
    echo "go: $(go version)" && \
    echo "done"

CMD ["/bin/bash"]
```

## Tool installation patterns (examples)

### Go

```dockerfile
ARG GO_VERSION=1.26.1

RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/go"
ENV PATH="${GOPATH}/bin:${PATH}"
```

### Node.js

```dockerfile
ARG NODE_VERSION=24.7.0

RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "x64") && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" | \
    tar -xJf - -C /usr/local --strip-components=1
```

### pnpm

```dockerfile
ARG PNPM_VERSION=10.15.1

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
```

### Python (via uv)

```dockerfile
ARG PYTHON_VERSION=3.12

RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
RUN uv python install ${PYTHON_VERSION} && \
    uv venv /opt/venv --python ${PYTHON_VERSION}
ENV PATH="/opt/venv/bin:${PATH}"
```
