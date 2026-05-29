import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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
		const pc = usage?.percent ?? 0;
		const filled = Math.round(pc / 10);
		const bar = "#".repeat(filled) + "-".repeat(10 - filled);
        ctx.ui.setFooter((_tui, theme) => ({
            render(width: number) {
                const left = theme.fg("dim", ` ${model}`);
                const right = theme.fg("dim", `[${bar}] ${Math.round(pc)}% $${totalCost.toFixed(2)} `);
                const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
                return [truncateToWidth(left + pad + right, width)];
            },
            invalidate(){},
        }));
    });
}
