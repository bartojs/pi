import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
    pi.on("message_end", async (event, ctx) => {
        if (event.message.role !== "assistant") return;

        let totalCost = 0;
        for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.message?.role === "assistant") {
                totalCost += entry.message.usage?.cost?.total ?? 0;
            }
        }

        const model = ctx.model?.id || "no-model";
        const usage = ctx.getContextUsage();
        ctx.ui.setFooter((_tui, theme) => ({
            render(_width: number) {
                return [
                    `${model}`,
                    `Tokens: ${usage?.tokens ?? 0} $${totalCost.toFixed(2)}`,
                ];
            },
            invalidate() {},
        }));
    });
}
