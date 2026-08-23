import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Bus } from "@/bus"
import { WorkspaceID } from "@/control-plane/schema"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { Project } from "@/project/project"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { CoreMessageProjector } from "@/session/core-message-projector"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { SyncEvent } from "@/sync"
import { MCP } from "@/mcp"
import { ToolRegistry as LegacyToolRegistry } from "@/tool/registry"
import { Tool as LegacyTool } from "@/tool/tool"
import * as LegacyDatabase from "@/storage/database"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Credential } from "@opencode-ai/core/credential"
import { Database as CoreDatabase } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { node as sessionRunnerNode } from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionTable as CoreSessionTable } from "@opencode-ai/core/session/sql"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Cause, Context, DateTime, Effect, JsonSchema, Layer, ManagedRuntime, Schema, Scope } from "effect"
import { eq } from "drizzle-orm"
import { ProjectV2 } from "@opencode-ai/core/project"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import type { TaskPromptOps } from "@/tool/task"
import type { Prompt } from "@opencode-ai/core/session/prompt"
import { asSchema, type Tool as AITool, type ToolExecutionOptions } from "ai"

const ToolResult = Schema.Struct({
  title: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  output: Schema.String,
  attachments: Schema.optional(Schema.Array(Schema.Unknown)),
})

const CORE_TOOL_IDS = new Set([
  "bash",
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "apply_patch",
  "task",
  "spawn_project",
  "todowrite",
  "skill",
  "invalid",
])

export interface Interface {
  readonly setPromptOps: (ops: TaskPromptOps) => void
  readonly current: (directory: string) => Effect.Effect<{
    readonly events: EventV2.Interface
    readonly db: CoreDatabase.Interface["db"]
    readonly store: SessionStore.Interface
    readonly execution: SessionExecution.Interface
    readonly tools: () => ReadonlyMap<string, ApplicationTools.Entry>
    readonly admit: (input: {
      readonly sessionID: SessionID
      readonly messageID: SessionMessage.ID
      readonly prompt: Prompt
    }) => Effect.Effect<void>
    readonly prompt: (input: {
      readonly sessionID: SessionID
      readonly messageID: SessionMessage.ID
      readonly prompt: Prompt
    }) => Effect.Effect<void>
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/CoreSession") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const legacyTools = yield* LegacyToolRegistry.Service
    const legacySessions = yield* Session.Service
    const permissions = yield* Permission.Service
    const agents = yield* Agent.Service
    const providers = yield* Provider.Service
    const auth = yield* Auth.Service
    const projects = yield* Project.Service
    const sync = yield* SyncEvent.Service
    const bus = yield* Bus.Service
    const mcp = yield* MCP.Service
    let promptOps: TaskPromptOps | undefined

    const state = yield* InstanceState.make(
      Effect.fn("CoreSession.state")(function* (instance) {
        const location = Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory: instance.directory,
            project: { id: instance.project.id, directory: instance.worktree },
          }),
        )
        const agentLayer = Layer.succeed(
          AgentV2.Service,
          AgentV2.Service.of({
            get: (id) => agents.get(id).pipe(Effect.map(toCoreAgent)),
            list: () => agents.list().pipe(Effect.map((items) => items.map(toCoreAgent))),
            defaultInfo: () => agents.defaultInfo().pipe(Effect.map(toCoreAgent)),
            defaultAgent: () => agents.defaultAgent().pipe(Effect.map(AgentV2.ID.make)),
            select: (id) =>
              (id ? agents.get(id) : agents.defaultInfo()).pipe(
                Effect.map((info) => ({
                  id: AgentV2.ID.make(info.name),
                  info: { ...toCoreAgent(info), permissions: info.permission },
                })),
              ),
            update: () => Effect.die("Core agent mutation is unavailable through the legacy adapter"),
            remove: () => Effect.die("Core agent mutation is unavailable through the legacy adapter"),
            setDefault: () => Effect.die("Core agent mutation is unavailable through the legacy adapter"),
          }),
        )
        const modelLayer = SessionRunnerModel.layerWith((session) =>
          Effect.gen(function* () {
            const selected = session.model
              ? { providerID: session.model.providerID, modelID: session.model.id }
              : yield* providers.defaultModel()
            const model = yield* providers.getModel(
              ProviderID.make(selected.providerID),
              ModelID.make(selected.modelID),
            )
            const provider = yield* providers.getProvider(ProviderID.make(selected.providerID))
            // The core runner resolves credentials through the v2 integration
            // registry, which the host does not populate. Translate the legacy
            // auth store into the credential shape it expects; without this,
            // routes are built with Auth.none and providers reject the request
            // with HTTP 401 "Missing API key".
            const stored = yield* auth.get(selected.providerID).pipe(Effect.orDie)
            return yield* SessionRunnerModel.fromCatalogModel(
              toCoreModel(model, provider),
              toCredential(stored, provider?.key),
            ).pipe(Effect.orDie)
          }).pipe(Effect.orDie),
        )
        // Re-open the exact database selected by the host (including test/embedded
        // databases) so Core and legacy projectors share one durable store.
        const database = CoreDatabase.layerFromPath(LegacyDatabase.Client().$client.filename)
        const root = LayerNode.group([
          sessionRunnerNode,
          SessionProjector.node,
          EventV2.node,
          SessionStore.node,
          ApplicationTools.node,
          CoreDatabase.node,
        ])
        const core = LayerNode.compile(root, [
          [Location.node, location],
          [AgentV2.node, agentLayer],
          [SessionRunnerModel.node, modelLayer],
          [CoreDatabase.node, database],
        ]) as Layer.Layer<
          | EventV2.Service
          | CoreDatabase.Service
          | SessionStore.Service
          | SessionRunner.Service
          | ApplicationTools.Service
        >
        const runtime = ManagedRuntime.make(core.pipe(Layer.provideMerge(Layer.succeed(InstanceRef, instance))))
        const services: {
          events: EventV2.Interface
          db: CoreDatabase.Interface["db"]
          store: SessionStore.Interface
          runner: SessionRunner.Interface
          applicationTools: ApplicationTools.Interface
          scope: Scope.Closeable
        } = yield* Effect.promise(() =>
          runtime.runPromise(
            Effect.gen(function* () {
              const events = yield* EventV2.Service
              const db = (yield* CoreDatabase.Service).db
              const store = yield* SessionStore.Service
              const runner = yield* SessionRunner.Service
              const applicationTools = yield* ApplicationTools.Service
              const scope = yield* Scope.make()
              return { events, db, store, runner, applicationTools, scope }
            }),
          ),
        )
        const coordinator = yield* Scope.provide(services.scope)(
          SessionRunCoordinator.make({
            drain: (sessionID: SessionID, force: boolean) => services.runner.run({ sessionID, force }),
          }),
        )

        yield* Scope.provide(services.scope)(
          services.applicationTools.register(
            yield* adaptTools(legacyTools, legacySessions, permissions, agents, services.events, () => promptOps),
          ),
        ).pipe(Effect.orDie)
        const unsubscribe = yield* Effect.promise(() =>
          runtime.runPromise(
            services.events.listen((event) =>
              Effect.gen(function* () {
                const definition = EventV2.registry.get(event.type)
                if (definition)
                  yield* bus.publish(EventV2Bridge.toSyncDefinition(definition), event.data as never, { id: event.id })
                if (!event.type.startsWith("session.next.")) return
                const data = event.data as Record<string, unknown>
                const messageID =
                  typeof data.messageID === "string"
                    ? data.messageID
                    : typeof data.assistantMessageID === "string"
                      ? data.assistantMessageID
                      : undefined
                if (!messageID || typeof data.sessionID !== "string") return
                const current = yield* services.store.message(SessionMessage.ID.make(String(messageID)))
                if (current) yield* CoreMessageProjector.project(sync, SessionID.make(data.sessionID), current.message)
              }),
            ),
          ),
        )
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await runtime.runPromise(unsubscribe)
            await runtime.dispose()
          }),
        )
        const execution = SessionExecution.Service.of({
          active: coordinator.active,
          resume: coordinator.run,
          wake: coordinator.wake,
          interrupt: coordinator.interrupt,
        })
        const bootstrap = Effect.fn("CoreSession.bootstrap")(function* (sessionID: SessionID) {
          const row = LegacyDatabase.use((db) =>
            db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
          )
          if (!row) return yield* Effect.die(`Session not found: ${sessionID}`)
          yield* services.db.run("PRAGMA foreign_keys = OFF").pipe(Effect.orDie)
          yield* services.db
            .insert(CoreSessionTable)
            .values({
              ...row,
              project_id: ProjectV2.ID.make(row.project_id),
              workspace_id: row.workspace_id ? WorkspaceV2.ID.make(row.workspace_id) : null,
              revert: null,
            })
            .onConflictDoNothing()
            .run()
            .pipe(Effect.orDie, Effect.ensuring(services.db.run("PRAGMA foreign_keys = ON").pipe(Effect.orDie)))
        })
        const admit = Effect.fn("CoreSession.admit")(function* (input: {
          readonly sessionID: SessionID
          readonly messageID: SessionMessage.ID
          readonly prompt: Prompt
        }) {
          yield* bootstrap(input.sessionID)
          yield* SessionInput.admit(services.db, services.events, {
            id: input.messageID,
            sessionID: input.sessionID,
            prompt: input.prompt,
            delivery: "steer",
          })
        })
        return {
          events: services.events,
          db: services.db,
          store: services.store,
          execution,
          tools: services.applicationTools.entries,
          admit,
          prompt: Effect.fn("CoreSession.prompt")(function* (input) {
            const session = yield* legacySessions.get(input.sessionID).pipe(Effect.orDie)
            const agent = session.agent ? yield* agents.get(session.agent) : yield* agents.defaultInfo()
            const selected = session.model
              ? { providerID: session.model.providerID, modelID: session.model.id }
              : yield* providers.defaultModel().pipe(Effect.orDie)
            const model = yield* providers
              .getModel(ProviderID.make(selected.providerID), ModelID.make(selected.modelID))
              .pipe(Effect.orDie)
            const mcpTools = yield* Effect.forEach(Object.entries(yield* mcp.tools()), ([name, tool]) =>
              adaptMcpTool(name, tool, legacySessions, permissions, agents),
            )
            yield* Scope.provide(services.scope)(
              services.applicationTools.register({
                ...Object.fromEntries(
                  (yield* legacyTools.tools({
                    providerID: ProviderID.make(selected.providerID),
                    modelID: ModelID.make(model.api.id),
                    agent,
                  })).map((tool) => [
                    tool.id,
                    adaptTool(tool, legacySessions, permissions, agents, services.events, () => promptOps),
                  ]),
                ),
                ...Object.fromEntries(mcpTools.filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)),
              }),
            ).pipe(Effect.orDie)
            yield* admit(input)
            if ((yield* execution.active).has(input.sessionID)) yield* execution.wake(input.sessionID)
            else yield* execution.resume(input.sessionID).pipe(Effect.orDie)
            while ((yield* execution.active).has(input.sessionID))
              yield* execution.resume(input.sessionID).pipe(Effect.orDie)
            const assistant = (yield* services.store.context(input.sessionID).pipe(Effect.orDie)).findLast(
              (message) => message.type === "assistant",
            )
            if (assistant) yield* CoreMessageProjector.project(sync, input.sessionID, assistant)
          }),
        }
      }),
    )

    return Service.of({
      setPromptOps: (ops) => {
        promptOps = ops
      },
      current: (directory) =>
        projects.fromDirectory(directory).pipe(
          Effect.flatMap((result) =>
            InstanceState.get(state).pipe(
              Effect.provideService(InstanceRef, {
                directory,
                worktree: result.sandbox,
                project: result.project,
              }),
            ),
          ),
        ),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    LegacyToolRegistry.defaultLayer,
    Session.defaultLayer,
    Permission.defaultLayer,
    Agent.defaultLayer,
    Provider.defaultLayer,
    Auth.defaultLayer,
    Project.defaultLayer,
    SyncEvent.defaultLayer,
    Bus.defaultLayer,
    MCP.defaultLayer,
  ]),
)

function adaptTools(
  registry: LegacyToolRegistry.Interface,
  sessions: Session.Interface,
  permissions: Permission.Interface,
  agents: Agent.Interface,
  events: EventV2.Interface,
  promptOps: () => TaskPromptOps | undefined,
) {
  return Effect.gen(function* () {
    return Object.fromEntries(
      (yield* registry.all())
        .filter((tool) => CORE_TOOL_IDS.has(tool.id))
        .map((tool) => [tool.id, adaptTool(tool, sessions, permissions, agents, events, promptOps)]),
    )
  })
}

function adaptTool(
  tool: LegacyTool.Def,
  sessions: Session.Interface,
  permissions: Permission.Interface,
  agents: Agent.Interface,
  events: EventV2.Interface,
  promptOps: () => TaskPromptOps | undefined,
) {
  return Tool.make({
    description: tool.description,
    input: tool.parameters as Tool.SchemaType<unknown>,
    output: ToolResult,
    execute: (input, context) =>
      Effect.gen(function* () {
        const controller = new AbortController()
        const session = yield* sessions.get(context.sessionID)
        const agent = yield* agents.get(context.agent)
        const result = yield* tool
          .execute(input, {
            sessionID: context.sessionID,
            messageID: MessageID.make(context.assistantMessageID),
            agent: context.agent,
            callID: context.toolCallID,
            abort: controller.signal,
            messages: yield* sessions.messages({ sessionID: context.sessionID }),
            extra: { promptOps: promptOps() },
            metadata: (update) =>
              events
                .publish(SessionEvent.Tool.Progress, {
                  sessionID: context.sessionID,
                  callID: context.toolCallID,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                  structured: { title: update.title, metadata: update.metadata },
                  content: [],
                })
                .pipe(Effect.asVoid),
            ask: (request) =>
              permissions
                .ask({
                  ...request,
                  sessionID: context.sessionID,
                  ruleset: Permission.merge(agent.permission, session.permission ?? []),
                  tool: { messageID: MessageID.make(context.assistantMessageID), callID: context.toolCallID },
                })
                .pipe(Effect.orDie),
          })
          .pipe(
            Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
            Effect.catchCause((cause) => Effect.fail(new Tool.Failure({ message: Cause.pretty(cause) }))),
          )
        return result
      }).pipe(Effect.catchCause((cause) => Effect.fail(new Tool.Failure({ message: Cause.pretty(cause) })))),
    toStructuredOutput: ({ output }) => output,
    toModelOutput: ({ output }) => [
      { type: "text", text: output.output },
      ...(output.attachments ?? []).flatMap((attachment) =>
        typeof attachment === "object" && attachment !== null && "url" in attachment && "mime" in attachment
          ? [
              {
                type: "file" as const,
                data: String(attachment.url),
                mime: String(attachment.mime),
                name: "filename" in attachment ? String(attachment.filename) : undefined,
              },
            ]
          : [],
      ),
    ],
  })
}

function adaptMcpTool(
  name: string,
  tool: AITool,
  sessions: Session.Interface,
  permissions: Permission.Interface,
  agents: Agent.Interface,
) {
  return Effect.gen(function* () {
    const execute = tool.execute
    if (!execute) return undefined
    const inputJsonSchema = (yield* Effect.promise(() =>
      Promise.resolve(asSchema(tool.inputSchema).jsonSchema),
    )) as JsonSchema.JsonSchema
    return [
      name,
      Tool.make({
        description: tool.description ?? "",
        input: Schema.Unknown,
        inputJsonSchema,
        output: ToolResult,
        execute: (input, context) =>
          Effect.gen(function* () {
            const session = yield* sessions.get(context.sessionID)
            const agent = yield* agents.get(context.agent)
            yield* permissions
              .ask({
                permission: name,
                patterns: ["*"],
                always: ["*"],
                metadata: {},
                sessionID: context.sessionID,
                ruleset: Permission.merge(agent.permission, session.permission ?? []),
                tool: { messageID: MessageID.make(context.assistantMessageID), callID: context.toolCallID },
              })
              .pipe(Effect.orDie)
            const controller = new AbortController()
            const result = yield* Effect.promise(() =>
              execute(input, {
                toolCallId: context.toolCallID,
                messages: [],
                abortSignal: controller.signal,
              } as ToolExecutionOptions),
            ).pipe(
              Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
              Effect.catchCause((cause) => Effect.fail(new Tool.Failure({ message: Cause.pretty(cause) }))),
            )
            const content =
              typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)
                ? result.content
                : []
            return {
              title: "",
              metadata:
                typeof result === "object" && result !== null && "metadata" in result && result.metadata
                  ? (result.metadata as Record<string, unknown>)
                  : {},
              output: content
                .flatMap((item) =>
                  typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item
                    ? [String(item.text)]
                    : [],
                )
                .join("\n\n"),
              attachments: content.flatMap((item) => {
                if (typeof item !== "object" || item === null || !("type" in item)) return []
                if (item.type === "image" && "data" in item && "mimeType" in item)
                  return [
                    { url: `data:${String(item.mimeType)};base64,${String(item.data)}`, mime: String(item.mimeType) },
                  ]
                if (item.type !== "resource" || !("resource" in item)) return []
                const resource = item.resource
                if (typeof resource !== "object" || resource === null || !("blob" in resource) || !resource.blob)
                  return []
                const mime = "mimeType" in resource ? String(resource.mimeType) : "application/octet-stream"
                return [
                  {
                    url: `data:${mime};base64,${String(resource.blob)}`,
                    mime,
                    filename: "uri" in resource ? String(resource.uri) : undefined,
                  },
                ]
              }),
            }
          }).pipe(Effect.catchCause((cause) => Effect.fail(new Tool.Failure({ message: Cause.pretty(cause) })))),
        toStructuredOutput: ({ output }) => output,
        toModelOutput: ({ output }) => [
          { type: "text", text: output.output },
          ...(output.attachments ?? []).map((attachment) => ({
            type: "file" as const,
            data: String((attachment as { url: unknown }).url),
            mime: String((attachment as { mime: unknown }).mime),
            name: (attachment as { filename?: string }).filename,
          })),
        ],
      }),
    ] as const
  })
}

function toCoreAgent(agent: Agent.Info): AgentV2.Info {
  return {
    name: AgentV2.ID.make(agent.name),
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    color: agent.color,
    permission: agent.permission,
    model: agent.model
      ? {
          id: ModelV2.ID.make(agent.model.modelID),
          providerID: ProviderV2.ID.make(agent.model.providerID),
          variant: agent.variant ? ModelV2.VariantID.make(agent.variant) : undefined,
        }
      : undefined,
    system: agent.prompt,
    options: { headers: {}, body: agent.options, aisdk: { provider: {}, request: {} } },
    steps: agent.steps,
  }
}

function toCredential(stored: Auth.Info | undefined, providerKey: string | undefined): Credential.Value | undefined {
  if (stored?.type === "api") return Credential.Key.make({ type: "key", key: stored.key })
  if (stored?.type === "oauth")
    return Credential.OAuth.make({
      type: "oauth",
      methodID: Integration.MethodID.make("default"),
      refresh: stored.refresh,
      access: stored.access,
      expires: stored.expires,
    })
  if (!providerKey) return
  return Credential.Key.make({ type: "key", key: providerKey })
}

function toCoreModel(model: Provider.Model, provider: Provider.Info) {
  const options = { ...provider.options, ...model.options }
  const body = Object.fromEntries(Object.entries(options).filter(([key]) => key !== "baseURL"))
  return new ModelV2.Info({
    id: ModelV2.ID.make(model.id),
    apiID: ModelV2.ID.make(model.api.id),
    providerID: ProviderV2.ID.make(model.providerID),
    family: model.family ? ModelV2.Family.make(model.family) : undefined,
    name: model.name,
    endpoint: {
      type: "aisdk",
      package: model.api.npm,
      url: model.api.url || (typeof options.baseURL === "string" ? options.baseURL : undefined),
    },
    capabilities: {
      tools: model.capabilities.toolcall,
      input: Object.entries(model.capabilities.input).flatMap(([name, enabled]) => (enabled ? [name] : [])),
      output: Object.entries(model.capabilities.output).flatMap(([name, enabled]) => (enabled ? [name] : [])),
    },
    options: {
      headers: model.headers,
      body,
      aisdk: { provider: options, request: {} },
    },
    variants: Object.entries(model.variants ?? {}).map(([id, options]) => ({
      id: ModelV2.VariantID.make(id),
      headers: {},
      body: options,
      aisdk: { provider: {}, request: {} },
    })),
    time: { released: DateTime.makeUnsafe(Date.parse(model.release_date) || 0) },
    cost: [{ input: model.cost.input, output: model.cost.output, cache: model.cost.cache }],
    status: model.status,
    enabled: true,
    limit: model.limit,
  })
}

export * as CoreSession from "./core-session"
