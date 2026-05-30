# OpenCode (oclite) Build, Packaging & Distribution Analysis

## Executive Summary

oclite is a **Bun + TypeScript monorepo** with a sophisticated multi-platform build and distribution system. It ships:
- **CLI binaries** for macOS, Linux, and Windows (x64, arm64, baseline variants)
- **npm packages** for the SDK, plugins, and a wrapper package
- **Docker containers** published to GHCR
- **Package managers**: AUR (Arch Linux), Homebrew, npm
- **Code signing**: Windows binaries signed via Azure Trusted Signing, macOS via Apple

---

## 1. Top-Level Package.json

**Path:** `/home/rryando/Work/fork/oclite/package.json`

### Key Fields:
```json
{
  "name": "opencode",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.11",
  "workspaces": {
    "packages": [
      "packages/opencode",      // Main CLI
      "packages/core",          // Core library
      "packages/llm",           // LLM integration
      "packages/plugin",        // Plugin SDK
      "packages/sdk/js",        // JavaScript SDK
      "packages/script",        // Version/release utilities
      "packages/http-recorder"  // HTTP recording for tests
    ]
  }
}
```

### Scripts:
- `dev`: Dev mode in browser conditions
- `lint`: oxlint
- `typecheck`: turbo typecheck
- `postinstall`: Fixes node-pty cross-platform issues
- `test`: Explicitly errors - tests must run from package dirs

### Key Dependencies:
- **Effect 4.0.0-beta.66**: Core runtime/effect system
- **@opentui/***: Terminal UI components (OpenTUI)
- **TypeScript 5.8.2**
- **Zod 4.1.8**: Schema validation
- **Drizzle ORM 1.0.0-rc.2**: Database layer

### Publishing Config:
- Uses **workspace:*** protocol for internal packages
- Monorepo with custom `catalog` for dependency resolution
- Patchedependencies for non-semver-compliant libraries (solid-js, photon-node, ai-sdk/xai, gcp-metadata, @npmcli/agent)

---

## 2. packages/opencode/package.json

**Path:** `/home/rryando/Work/fork/oclite/packages/opencode/package.json`

### Key Fields:
```json
{
  "name": "opencode",
  "version": "1.15.12",
  "type": "module",
  "private": true,
  "bin": {
    "opencode": "./bin/opencode",
    "oclite": "./bin/oclite"
  }
}
```

### Bin Entries:
1. **`./bin/opencode`**: Node.js wrapper script (CommonJS) that spawns the built binary
2. **`./bin/oclite`**: Bash wrapper that runs via `bun run --conditions=browser`

### Scripts:
- `build`: **`bun run script/build.ts`** - Main build orchestrator
- `dev`: Runs in browser conditions for live development
- `typecheck`: tsgo
- `test`: Full suite with 30s timeout
- `test:ci`: JUnit reporter for CI
- `test:httpapi`: HTTP API exercise tests
- `db`: Drizzle Kit database management

### Dependencies:
- **80+ AI SDK providers**: @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, @ai-sdk/aws, @ai-sdk/azure, etc.
- **@opentui/core, @opentui/keymap, @opentui/solid**: Terminal UI
- **@modelcontextprotocol/sdk 1.27.1**: MCP support
- **Drizzle ORM**: SQLite database
- **web-tree-sitter 0.25.10**: Syntax tree support
- **node-pty variants**: Cross-platform terminal emulation

### Exports:
```json
{
  "exports": {
    "./*": "./src/*.ts"
  },
  "imports": {
    "#db": { "bun": "./src/storage/db.bun.ts", "node": "./src/storage/db.node.ts" },
    "#pty": { "bun": "./src/pty/pty.bun.ts", "node": "./src/pty/pty.node.ts" }
  }
}
```

---

## 3. Build System

### Build Script: `packages/opencode/script/build.ts`

**Purpose**: Compiles TypeScript → Bun standalone binaries for all platforms

**Targets** (12 total):
```
Linux:
  - opencode-linux-arm64
  - opencode-linux-x64
  - opencode-linux-x64-baseline      (non-AVX2)
  - opencode-linux-arm64-musl        (Alpine)
  - opencode-linux-x64-musl
  - opencode-linux-x64-baseline-musl

macOS:
  - opencode-darwin-arm64
  - opencode-darwin-x64
  - opencode-darwin-x64-baseline

Windows:
  - opencode-windows-arm64
  - opencode-windows-x64
  - opencode-windows-x64-baseline
```

**Build Method**:
```typescript
await Bun.build({
  conditions: ["browser"],           // Use "browser" condition imports
  tsconfig: "./tsconfig.json",
  plugins: [createSolidTransformPlugin()],  // JSX transform
  external: ["node-gyp"],
  format: "esm",
  minify: true,
  sourcemap: sourcemapsFlag ? "linked" : "none",
  splitting: true,
  compile: {
    target: name.replace(pkg.name, "bun") as any,  // e.g., "bun-linux-x64"
    outfile: `dist/${name}/bin/opencode`,
    execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--`],
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    OPENCODE_VERSION: version string,
    OPENCODE_MIGRATIONS: JSON array of SQL migrations,
    OPENCODE_MODELS_DEV: generated model definitions,
    OPENCODE_WORKER_PATH: web worker path,
    OPENCODE_LIBC: "glibc" | "musl" (Linux only),
  },
})
```

**Post-build**:
1. Smoke test: Run `${binaryPath} --version` if native platform
2. Delete worker files
3. Create platform-specific package.json in each dist folder
4. If `Script.release`: Create .tar.gz (Linux) and .zip (macOS/Windows) archives
5. Upload to GitHub Release via `gh release upload`

**Output**:
```
dist/
  opencode-linux-x64/
    bin/opencode              (executable)
    package.json              (platform metadata)
  opencode-darwin-arm64/
    ...
```

---

## 4. Bin Entry Points

### `/packages/opencode/bin/opencode` (Node.js wrapper)
```javascript
#!/usr/bin/env node

// Loads the built binary from node_modules and spawns it
// Used by npm package wrapper to find correct platform variant
// Handles signal forwarding (SIGINT, SIGTERM, SIGHUP)
```

### `/packages/opencode/bin/oclite` (Bash wrapper)
```bash
#!/usr/bin/env bash
exec bun run --conditions=browser --preload="..." "$PACKAGE_DIR/src/index.ts" "$@"
```
**Used for**: Local development via `bun run`

---

## 5. NPM Package Distribution

### Strategy: **Umbrella Package + Optional Dependencies**

The CLI is distributed as **two npm packages**:

#### 1. **Platform-Specific Binary Packages**
- Name: `opencode-linux-x64`, `opencode-darwin-arm64`, etc.
- Scope: Private (created during build)
- Contains: Binary only at `bin/opencode`
- Access: `optionalDependencies` of umbrella package

#### 2. **Umbrella Package: `opencode-ai`**
- Name: `opencode-ai` (published name, source is `opencode`)
- Location: `packages/opencode/dist/opencode/`
- Contains:
  - Postinstall script: `postinstall.mjs`
  - Wrapper bin: `bin/opencode.exe` (error script)
  - LICENSE
  - `optionalDependencies` pointing to all platform packages
  
**Postinstall Flow**:
1. Detect platform + CPU (x64, arm64)
2. Check for AVX2 support (x64 only)
3. Check for musl libc (Linux only)
4. Build priority list: e.g., `[opencode-linux-x64-musl, opencode-linux-x64, opencode-linux-arm64-musl]`
5. Try to link binary from already-installed optional dep
6. If not found, `npm install --ignore-scripts` the matching package temporarily
7. Copy/link binary to `bin/opencode`
8. Verify: Run `opencode --version`

**Location**: `/home/rryando/Work/fork/oclite/packages/opencode/script/postinstall.mjs` (189 lines)

### Publish Script: `packages/opencode/script/publish.ts`

```typescript
// 1. Prepare release files
for each package.json:
  - Update version field
  
// 2. Run platform binary publish
for each dist/opencode-${platform}-${arch}/:
  - bun pm pack → *.tgz
  - npm publish *.tgz --tag ${Script.channel}  (latest or beta)

// 3. Publish umbrella package
- dist/opencode-ai/package.json with optionalDependencies
- bun pm pack → *.tgz
- npm publish *.tgz --tag ${Script.channel}

// 4. Docker multi-arch build
- docker buildx build --platform linux/amd64,linux/arm64 --push

// 5. AUR PKGBUILD update (if Script.release)
- Calculate SHA256 for all artifacts
- Clone aur@aur.archlinux.org:opencode-bin.git
- Update PKGBUILD with SHA256 and version
- git commit && push

// 6. Homebrew formula update
- Generate Ruby formula with URLs and SHA256
- Push to github.com/anomalyco/homebrew-tap
```

**Note**: Published packages are scoped as `@opencode-ai/` (SDK, Plugin) or global (`opencode-ai`).

---

## 6. SDK & Plugin Publishing

### packages/sdk/js/script/build.ts
```typescript
// Regenerate SDK from opencode's OpenAPI schema
await $`bun dev generate > openapi.json`.cwd(opencode)

// Use @hey-api/openapi-ts to generate client
await createClient({
  input: "./openapi.json",
  output: { path: "./src/v2/gen" },
  plugins: ["@hey-api/typescript", "@hey-api/sdk", "@hey-api/client-fetch"],
})

// Patch SSE type generation bug
// Compile TypeScript
await $`bun tsc`
```

### packages/sdk/js/script/publish.ts
```typescript
// 1. Check if already published
if (published("@opencode-ai/sdk", version)) return

// 2. Transform exports: ./src/*.ts → ./dist/*.js + ./dist/*.d.ts
// 3. Write modified package.json
// 4. bun pm pack → *.tgz
// 5. npm publish *.tgz --tag ${Script.channel}
// 6. Restore original package.json
```

### packages/plugin/script/publish.ts
```typescript
// 1. Build TypeScript
await $`bun tsc`

// 2. Transform exports similarly
// 3. npm publish *.tgz --tag ${Script.channel}
```

---

## 7. Release Workflows

### Main Release Workflow: `.github/workflows/publish.yml` (491 lines)

**Triggers**: Push to `dev`, `beta`, `ci`, `snapshot-*` or manual dispatch

**Jobs**:

#### 1. **version** (ubuntu)
- Runs `./script/version.ts`
- Outputs: `version`, `release` (ID), `tag`, `repo`
- Creates GitHub release as **draft**

#### 2. **build-cli** (ubuntu)
- Downloads artifacts from version job
- Runs `./packages/opencode/script/build.ts`
- Uploads Darwin/Linux binaries to GitHub artifacts
- Uploads Windows binaries separately

#### 3. **sign-cli-windows** (windows)
- Downloads Windows binaries
- Uses **Azure Trusted Signing** service to code-sign .exe files
- Re-zips signed binaries
- Uploads to GitHub release

#### 4. **build-electron** (matrix: macOS x2, Windows x2, Ubuntu x2)
- Prepares Electron build via `bun ./scripts/prepare.ts`
- Builds desktop app with `bun run build`
- Packages with `electron-builder`
- Publishes via electron-update (auto-update)
- Signs macOS apps (codesign + notarization)
- Signs Windows .exe + installer
- Creates and uploads .app.tar.gz for macOS

#### 5. **publish** (ubuntu) - Final aggregation
```typescript
// Downloads all artifacts (CLI, Windows, Electron)
// Sets up Git/GitHub
// Sets up Docker buildx + QEMU for multi-arch

// Runs ./script/publish.ts which:
//   1. Updates version in all package.json
//   2. npm publish CLI (all platforms) + umbrella
//   3. npm publish SDK
//   4. npm publish plugin
//   5. Docker buildx push (linux/amd64,linux/arm64)
//   6. Update AUR repo (Arch Linux)
//   7. Update Homebrew formula repo
```

---

## 8. Dockerfile & Container Distribution

**Path**: `/home/rryando/Work/fork/oclite/packages/opencode/Dockerfile`

```dockerfile
FROM alpine AS base
RUN apk add libgcc libstdc++ ripgrep

FROM base AS build-amd64
COPY dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}
RUN opencode --version
ENTRYPOINT ["opencode"]
```

**Registry**: `ghcr.io/anomalyco/opencode`

**Tags**:
- `${version}` (semver)
- `${Script.channel}` (latest, beta, dev, etc.)

**Build**: Multi-arch via `docker buildx build --platform linux/amd64,linux/arm64`

---

## 9. Versioning & Channel System

**Location**: `/home/rryando/Work/fork/oclite/packages/script/src/index.ts`

```typescript
export const Script = {
  channel,   // "latest" (prod), "beta", or branch name (dev preview)
  version,   // Semantic or preview: "0.0.0-${branch}-${timestamp}"
  preview,   // true if not main release
  release,   // true if OPENCODE_RELEASE env var set
  team,      // List of authorized team members from .github/TEAM_MEMBERS
}
```

**Version determination**:
1. If `OPENCODE_VERSION` env: Use it directly
2. If `OPENCODE_BUMP` env: Bump from latest npm registry (major/minor/patch)
3. If preview (beta/dev branch): Generate `0.0.0-${branch}-${YYYYMMDDhhmm}`
4. Else: Fetch latest from npm and semver bump

**Channel**:
- `latest`: From `main` or `dev` with version bump
- `beta`: From `beta` branch (preview)
- Dev/preview: From `ci` / `fix/*` / `snapshot-*` branches

---

## 10. Monorepo Structure

```
/home/rryando/Work/fork/oclite/
├── package.json                          (root workspaces)
├── bun.lock                              (lock file)
├── bunfig.toml                           (Bun config: @opentui/solid preload)
├── tsconfig.json                         (root TS config)
│
├── packages/
│   ├── opencode/                         ⭐ Main CLI
│   │   ├── package.json                  (name: "opencode", private)
│   │   ├── bin/
│   │   │   ├── opencode                  (Node wrapper)
│   │   │   └── oclite                    (Bash wrapper)
│   │   ├── src/
│   │   │   └── index.ts                  (Bun build entry)
│   │   ├── script/
│   │   │   ├── build.ts                  (Multi-platform Bun build)
│   │   │   ├── publish.ts                (npm/Docker/AUR/Homebrew publish)
│   │   │   ├── postinstall.mjs           (Binary selection at npm install)
│   │   │   └── generate.ts               (Model definitions)
│   │   ├── Dockerfile                    (Multi-arch Alpine container)
│   │   ├── drizzle.config.ts             (SQLite migrations)
│   │   └── dist/                         (Built binaries per platform)
│   │
│   ├── core/                             (Core library: @opencode-ai/core)
│   │   └── package.json                  (AI SDK providers, semver)
│   │
│   ├── llm/                              (LLM integration: @opencode-ai/llm)
│   │   └── package.json                  (Effect-based LLM client)
│   │
│   ├── plugin/                           (Plugin SDK: @opencode-ai/plugin)
│   │   ├── package.json
│   │   ├── script/
│   │   │   └── publish.ts                (tsc build + npm publish)
│   │   └── src/
│   │
│   ├── sdk/js/                           (JavaScript SDK: @opencode-ai/sdk)
│   │   ├── package.json
│   │   ├── script/
│   │   │   ├── build.ts                  (OpenAPI schema → @hey-api/openapi-ts)
│   │   │   └── publish.ts                (npm publish)
│   │   ├── src/
│   │   │   └── v2/gen/                   (Generated client)
│   │   └── tsconfig.json
│   │
│   ├── script/                           (Version utilities: @opencode-ai/script)
│   │   ├── package.json                  (dependencies: semver)
│   │   └── src/
│   │       └── index.ts                  (Script export: channel, version, preview, release)
│   │
│   └── http-recorder/                    (Test fixture helper)
│
├── script/
│   ├── version.ts                        (Create GitHub release, set outputs)
│   ├── publish.ts                        (Orchestrate all package publishes)
│   ├── changelog.ts                      (Generate UPCOMING_CHANGELOG.md)
│   ├── release                           (Bash: gh workflow run publish.yml)
│   └── [10+ CI/utility scripts]
│
├── .github/
│   ├── workflows/
│   │   ├── publish.yml                   (Main release: build + sign + publish)
│   │   ├── containers.yml                (Build Docker images)
│   │   ├── release-github-action.yml     (GitHub Actions release for /github/*)
│   │   ├── typecheck.yml
│   │   ├── test.yml
│   │   └── [20+ more workflows]
│   │
│   ├── actions/
│   │   └── setup-bun/                    (Custom action: Bun + cache + install)
│   │       └── action.yml
│   │
│   └── TEAM_MEMBERS                      (Authorized release members)
│
├── patches/                              (pnpm-style patches for dependencies)
│   ├── @npmcli%2Fagent@4.0.0.patch
│   ├── solid-js@1.9.10.patch
│   └── [5 more]
│
├── nix/                                  (Nix flake support)
├── github/                               (GitHub Actions helper package)
├── .opencode/                            (opencode project config)
└── README.md + 20+ language READMEs

```

---

## 11. Build Tooling Summary

| Tool | Purpose | Config |
|------|---------|--------|
| **Bun 1.3.11** | Runtime + builder + package manager | package.json, bunfig.toml |
| **TypeScript 5.8.2** | Type checking + compilation | tsconfig.json (extends @tsconfig/bun) |
| **Bun.build()** | Compile TypeScript → standalone binaries | Called from script/build.ts |
| **tsc** (via plugin/script/publish.ts) | Compile plugin package | tsconfig.json |
| **@hey-api/openapi-ts** | Generate SDK from OpenAPI | Configured in sdk/js/script/build.ts |
| **docker buildx** | Multi-arch container builds | Used in publish.ts + containers.yml |
| **electron-builder** | Desktop app packaging | Used in publish.yml for build-electron job |
| **Azure Trusted Signing** | Windows code signing | Secrets in publish.yml sign-cli-windows |
| **gh (GitHub CLI)** | Release/artifact management | Used in version.ts, publish.ts |

---

## 12. Key Differentiators

1. **No .goreleaser.yml**: Uses custom Bun scripts instead of GoReleaser
2. **No traditional bundler**: Uses Bun's native `Bun.build()` for all compilation
3. **No esbuild/webpack**: Leverages Bun's built-in bundler
4. **Platform detection at install-time**: Postinstall script runs target detection + optional dependency resolution
5. **Multi-channel releases**: `latest` (production), `beta` (pre-release), `dev` (branch previews)
6. **Signed binaries**: Windows via Azure Trusted Signing, macOS via Apple's developer account
7. **Multi-package distribution**: SDK, plugin, CLI umbrella package all published separately
8. **All-in-one Docker image**: Single Alpine image supporting both amd64 and arm64

---

## 13. Publishing Access

**Required Secrets** (in GitHub):
- `NPM_TOKEN` or auth via node setup-node action
- `GITHUB_TOKEN` (for releases + AUR)
- `AUR_KEY` (SSH key for arch.archlinux.org)
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (Windows signing)
- `AZURE_TRUSTED_SIGNING_*` (Azure Trusted Signing account)
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_KEY*` (macOS signing)

**Required Vars**:
- `OPENCODE_APP_ID` (GitHub App for commits)
- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` (error tracking)

---

## 14. Development Workflow

### Local Build:
```bash
# Root
bun install

# packages/opencode
cd packages/opencode
bun build --single           # Single platform (current arch)
bun build                    # All platforms (12 total)

# Test
bun test
```

### Local Run:
```bash
# Via wrapper
bun run bin/oclite --help

# Or directly
bun run --conditions=browser src/index.ts --help
```

### Type Checking:
```bash
cd packages/opencode
bun typecheck              # or `tsgo --noEmit`

# Root
cd /home/rryando/Work/fork/oclite
bun typecheck              # Runs turbo typecheck across all packages
```

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **Repository** | https://github.com/anomalyco/opencode (fork: oclite) |
| **Default Branch** | `dev` |
| **Runtime** | Bun 1.3.11 (TypeScript first) |
| **Build System** | Bun.build() → Standalone binaries |
| **Package Manager** | bun + npm (for publish) |
| **Platforms** | macOS (Intel + ARM), Linux (glibc + musl, x64 + ARM64), Windows (x64 + ARM64) |
| **Variants** | Baseline (non-AVX2), Standard (AVX2) |
| **Distribution** | npm packages (umbrella + platform-specific optional deps) |
| **Containers** | Docker (ghcr.io/anomalyco/opencode) |
| **Package Repos** | AUR (Arch Linux), Homebrew |
| **Code Signing** | Azure Trusted Signing (Windows), Apple (macOS) |
| **Release Channels** | latest, beta, dev |
| **SDK** | npm package with TypeScript types |
| **Plugin System** | npm package with TypeScript support |
| **Current Version** | 1.15.12 |

