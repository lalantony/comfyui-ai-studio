"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  Copy,
  Hash,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { Workflow } from "@/types";

interface WorkflowOverflowMenuProps {
  workflow: Workflow | null;
  /** Called after the workflow is mutated server-side. The page should refresh. */
  onChanged: () => void;
}

const ITEM_CLASS =
  "flex items-center gap-2 px-2.5 py-1.5 text-xs text-foreground rounded-md outline-none cursor-pointer hover:bg-panel-elevated focus:bg-panel-elevated transition-colors";

/**
 * Workflow header overflow menu — `…` button on the workflow editor.
 *
 * Items:
 *   - Duplicate     → POST /api/workflows/[id]/duplicate, navigate to the new wf
 *   - Archive       → PUT /api/workflows/[id] {status:"archived"}, navigate back to list
 *   - Copy ID       → navigator.clipboard.writeText(workflow.id)
 *   - Delete (red)  → confirm, DELETE /api/workflows/[id], navigate back to list
 */
export function WorkflowOverflowMenu({ workflow, onChanged }: WorkflowOverflowMenuProps) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const disabled = !workflow || submitting;

  const handleDuplicate = async () => {
    if (!workflow) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/workflows/${encodeURIComponent(workflow.id)}/duplicate`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const { workflow: created } = (await res.json()) as { workflow: Workflow };
      toast.success(`Duplicated as "${created.name}"`);
      router.push(`/workflows/${created.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Duplicate failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!workflow) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      toast.success(`Archived "${workflow.name}"`);
      onChanged();
      router.push("/workflows");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyId = async () => {
    if (!workflow) return;
    try {
      await navigator.clipboard.writeText(workflow.id);
      toast.success("Workflow ID copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const handleDelete = async () => {
    if (!workflow) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workflows/${encodeURIComponent(workflow.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      toast.success(`Deleted "${workflow.name}"`);
      router.push("/workflows");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSubmitting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="p-2 rounded-xl bg-panel-soft border border-white/10 text-muted-foreground hover:text-foreground hover:bg-panel-elevated transition-colors disabled:opacity-50"
            aria-label="More actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-[180px] rounded-xl bg-panel-elevated/95 backdrop-blur-xl border border-white/10 p-1 shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
          >
            <DropdownMenu.Item className={ITEM_CLASS} onSelect={handleDuplicate}>
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM_CLASS} onSelect={handleArchive}>
              <Archive className="w-3.5 h-3.5 text-muted-foreground" />
              Archive
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM_CLASS} onSelect={handleCopyId}>
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              Copy workflow ID
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="h-px bg-white/8 my-1 mx-1" />
            <DropdownMenu.Item
              className={`${ITEM_CLASS} !text-danger hover:!bg-danger/10 focus:!bg-danger/10`}
              onSelect={(e) => {
                e.preventDefault();
                setConfirmDelete(true);
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
        title={workflow ? `Delete ${workflow.name}?` : "Delete workflow?"}
        description="This permanently removes the workflow and all its persisted data. Cannot be undone."
        confirmLabel="Delete workflow"
        destructive
        onConfirm={handleDelete}
      />
    </>
  );
}
