import type { Ctx } from "../context";
import { rpc } from "../db";
import { renderOp, type OpSummary } from "./render";

export async function opSummary(ctx: Ctx, opId: string): Promise<OpSummary | null> {
  return rpc<OpSummary | null>(ctx.db, "bot_op_summary", { p_op_id: opId });
}

/** Redraw an op's sign-up post after something changed. Failures are logged, not fatal. */
export async function refreshOpMessage(ctx: Ctx, opId: string): Promise<OpSummary | null> {
  const op = await opSummary(ctx, opId);
  if (!op?.channel_id || !op.message_id) return op;
  try {
    const channel = await ctx.client.channels.fetch(op.channel_id);
    if (channel?.isTextBased()) {
      const message = await channel.messages.fetch(op.message_id);
      await message.edit(renderOp(op));
    }
  } catch (err) {
    console.error(`Couldn't update the post for op ${opId}:`, err);
  }
  return op;
}
