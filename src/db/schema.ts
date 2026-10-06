import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  uuid,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------- Providers ----------
export const providers = pgTable("providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // openai | anthropic | google | xai | ollama | openai_compatible | custom
  baseUrl: text("base_url").notNull().default(""),
  apiKeyEncrypted: text("api_key_encrypted").default(""),
  enabled: boolean("enabled").notNull().default(true),
  isLocal: boolean("is_local").notNull().default(false),
  status: text("status").notNull().default("disconnected"), // connected|disconnected|local|error|disabled
  statusMessage: text("status_message").default(""),
  lastCheckedAt: timestamp("last_checked_at"),
  capabilities: jsonb("capabilities").$type<string[]>().default([]),
  defaultModel: text("default_model").default(""),
  fallbackModels: jsonb("fallback_models").$type<string[]>().default([]),
  assignedCapabilities: jsonb("assigned_capabilities").$type<string[]>().default([]),
  extraConfig: jsonb("extra_config").$type<Record<string, unknown>>().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const models = pgTable("models", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  capabilities: jsonb("capabilities").$type<Record<string, unknown>>().default({}),
  contextWindow: integer("context_window").default(0),
  isDefault: boolean("is_default").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Projects ----------
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  routingMode: text("routing_mode").notNull().default("auto"), // auto|ask|manual
  preferredProviderId: uuid("preferred_provider_id"),
  preferredModel: text("preferred_model").default(""),
  toolPermissions: jsonb("tool_permissions").$type<Record<string, string>>().default({}),
  allowCrossProjectMemory: boolean("allow_cross_project_memory").notNull().default(false),
  color: text("color").notNull().default("#6366f1"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Conversations ----------
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull().default("New conversation"),
  projectId: uuid("project_id"),
  routingMode: text("routing_mode").notNull().default("auto"),
  selectedProviderId: uuid("selected_provider_id"),
  selectedModel: text("selected_model").default(""),
  agentMode: boolean("agent_mode").notNull().default(false),
  privacyMode: boolean("privacy_mode").notNull().default(false),
  systemPrompt: text("system_prompt").notNull().default(""),
  pinned: boolean("pinned").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").notNull(), // user|assistant|system|tool
  content: text("content").notNull().default(""),
  providerId: uuid("provider_id"),
  model: text("model").default(""),
  capability: text("capability").default(""),
  tokensIn: integer("tokens_in").default(0),
  tokensOut: integer("tokens_out").default(0),
  costUsd: real("cost_usd").default(0),
  citations: jsonb("citations").$type<Array<Record<string, unknown>>>().default([]),
  toolCalls: jsonb("tool_calls").$type<Array<Record<string, unknown>>>().default([]),
  attachments: jsonb("attachments").$type<Array<Record<string, unknown>>>().default([]),
  status: text("status").notNull().default("complete"), // streaming|complete|error|stopped
  error: text("error").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Memory ----------
export const memories = pgTable("memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category").notNull().default("general"), // preferences|projects|businesses|people|workflows|decisions|goals|instructions|facts|general
  title: text("title").notNull().default(""),
  content: text("content").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  projectId: uuid("project_id"),
  importance: integer("importance").notNull().default(5), // 1-10
  source: text("source").notNull().default("user"), // user|agent|import
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Project files ----------
export const projectFiles = pgTable("project_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id"),
  conversationId: uuid("conversation_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull().default("text/plain"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path").notNull().default(""),
  contentPreview: text("content_preview").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Agent tasks ----------
export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id"),
  projectId: uuid("project_id"),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("pending"), // pending|planning|running|awaiting_approval|paused|completed|failed|stopped
  plan: jsonb("plan").$type<Array<Record<string, unknown>>>().default([]),
  history: jsonb("history").$type<Array<Record<string, unknown>>>().default([]),
  currentStep: integer("current_step").notNull().default(0),
  maxSteps: integer("max_steps").notNull().default(25),
  modelsUsed: jsonb("models_used").$type<string[]>().default([]),
  toolsUsed: jsonb("tools_used").$type<string[]>().default([]),
  outcome: text("outcome").default(""),
  error: text("error").default(""),
  privacyMode: boolean("privacy_mode").notNull().default(false),
  routingMode: text("routing_mode").notNull().default("auto"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const taskSteps = pgTable("task_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull(),
  stepIndex: integer("step_index").notNull().default(0),
  kind: text("kind").notNull().default("note"), // plan|llm|tool_call|approval|note|result
  title: text("title").notNull().default(""),
  detail: text("detail").notNull().default(""),
  toolName: text("tool_name").default(""),
  toolInput: jsonb("tool_input").$type<Record<string, unknown>>().default({}),
  toolOutput: jsonb("tool_output").$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("complete"), // pending|running|complete|failed|awaiting_approval|skipped
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id"),
  conversationId: uuid("conversation_id"),
  toolName: text("tool_name").notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  riskLevel: text("risk_level").notNull().default("medium"), // low|medium|high
  status: text("status").notNull().default("pending"), // pending|approved|rejected|expired
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ---------- Tool permissions ----------
export const toolPermissions = pgTable("tool_permissions", {
  toolName: text("tool_name").primaryKey(),
  policy: text("policy").notNull().default("ask"), // always_allow|ask|always_ask|deny
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Usage ----------
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id"),
  providerName: text("provider_name").notNull().default(""),
  model: text("model").notNull().default(""),
  capability: text("capability").notNull().default(""),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  conversationId: uuid("conversation_id"),
  taskId: uuid("task_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------- Automations ----------
export const automations = pgTable("automations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  scheduleKind: text("schedule_kind").notNull().default("interval"), // interval|cron|once
  scheduleValue: text("schedule_value").notNull().default(""), // e.g. "60" minutes or cron expr
  goal: text("goal").notNull(),
  projectId: uuid("project_id"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastStatus: text("last_status").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Connectors / Search providers ----------
export const connectors = pgTable("connectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(), // search_tavily|search_brave|search_serper|search_searxng|email|calendar|github|custom
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  secretsEncrypted: text("secrets_encrypted").default(""),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("disconnected"),
  statusMessage: text("status_message").default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Settings ----------
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------- Audit logs ----------
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  level: text("level").notNull().default("info"), // debug|info|warn|error
  category: text("category").notNull().default("app"), // provider|router|tool|agent|auth|system|chat
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProviderRow = typeof providers.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type AgentTaskRow = typeof agentTasks.$inferSelect;
