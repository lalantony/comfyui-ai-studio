"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { useNodeUpdate } from "@/components/nodes/use-node-update";
import type { NodeProps } from "@/lib/plugins/types";
import type { LLMNodeData } from "./manifest";

const HANDLE_BASE = "!w-2.5 !h-2.5 !border-2 !border-panel";

type Provider = LLMNodeData["provider"];

function LLMNode({ id, data }: NodeProps<LLMNodeData>) {
  const update = useNodeUpdate(id);
  const provider: Provider = data?.provider ?? "openai-compat";
  const baseUrl: string = data?.baseUrl ?? "";
  const apiKey: string = data?.apiKey ?? "";
  const model: string = data?.model ?? "";
  const temperature: number = typeof data?.temperature === "number" ? data.temperature : 0.7;
  const maxTokens: number | "" = typeof data?.maxTokens === "number" ? data.maxTokens : "";
  const systemPrompt: string = data?.systemPrompt ?? "";

  return (
    <div className="w-72 rounded-xl bg-panel border border-white/10 shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-white/8">
        <div className="w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center">
          <Sparkles className="w-3 h-3 text-primary" />
        </div>
        <input
          type="text"
          value={data?.label ?? ""}
          onChange={(e) => update({ label: e.target.value })}
          placeholder="LLM"
          className="flex-1 bg-transparent text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none nodrag"
        />
      </div>

      <div className="p-3 space-y-2">
        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Provider</span>
          <select
            value={provider}
            onChange={(e) => update({ provider: e.target.value as Provider })}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="openai-compat">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        {provider === "openai-compat" && (
          <div className="space-y-1 nodrag">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
        )}

        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Model</span>
          <input
            type="text"
            value={model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder={provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o-mini"}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder={apiKey ? "" : "Required for remote providers"}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 nodrag">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Temp</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => update({ temperature: Number(e.target.value) })}
              className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Max tokens</span>
            <input
              type="number"
              min={1}
              value={maxTokens}
              onChange={(e) => {
                const v = e.target.value;
                update({ maxTokens: v === "" ? undefined : Math.max(1, Number(v)) });
              }}
              placeholder="1024"
              className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="space-y-1 nodrag">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            System prompt <span className="text-muted-foreground/70 normal-case">(used when no system handle is connected)</span>
          </span>
          <textarea
            value={systemPrompt}
            onChange={(e) => update({ systemPrompt: e.target.value })}
            placeholder="You are a helpful assistant…"
            rows={2}
            className="w-full bg-panel-soft border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
          />
        </div>

        {!apiKey && (
          <p className="text-[10px] text-warning">⚠ API key required to run this node.</p>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="system"
        className={`${HANDLE_BASE} !bg-muted`}
        style={{ left: -5, top: "25%" }}
        title="system (optional)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="user"
        className={`${HANDLE_BASE} !bg-primary`}
        style={{ left: -5, top: "50%" }}
        title="user message (required)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        className={`${HANDLE_BASE} !bg-accent-blue`}
        style={{ left: -5, top: "75%" }}
        title="image (optional, for Vision)"
      />

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={`${HANDLE_BASE} !bg-primary`}
        style={{ right: -5, top: "50%" }}
      />
    </div>
  );
}

export default memo(LLMNode);
