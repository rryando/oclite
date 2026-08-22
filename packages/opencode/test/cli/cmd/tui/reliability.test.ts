import { describe, expect, test } from "bun:test"
import { getComponentCatalogue } from "@opentui/solid/components"
import { Schema } from "effect"
import { registerOpencodeSpinner } from "@/cli/cmd/tui/component/register-spinner"
import { TuiInfo } from "@/cli/cmd/tui/config/tui-schema"
import { osc52Sequence } from "@/cli/cmd/tui/util/clipboard"

describe("tui reliability", () => {
  test("restores spinner registration after catalogue replacement", () => {
    const catalogue = getComponentCatalogue() as Record<string, unknown>
    delete catalogue.spinner
    registerOpencodeSpinner()
    expect(catalogue.spinner).toBeDefined()
  })

  test("writes direct and passthrough OSC 52 sequences in tmux", () => {
    const direct = osc52Sequence("copy", {})
    expect(osc52Sequence("copy", { TMUX: "/tmp/tmux" })).toBe(`${direct}\x1bPtmux;\x1b${direct}\x1b\\`)
    expect(osc52Sequence("copy", { STY: "screen" })).toBe(`\x1bPtmux;\x1b${direct}\x1b\\`)
  })

  test("validates cursor settings", () => {
    const decode = Schema.decodeUnknownSync(TuiInfo)
    expect(decode({ cursor: { blinking: false } })).toEqual({ cursor: { blinking: false } })
    expect(() => decode({ cursor: { style: "beam" } })).toThrow()
  })
})
